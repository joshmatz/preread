export type DefinitionName = { index: number; name: string; call: boolean };

const reserved = new Set(`break case catch class const continue debugger default delete do else enum export extends
  false finally for function if import in instanceof new null return super switch this throw true try typeof var void
  while with yield let static implements interface package private protected public async await undefined
  as satisfies keyof readonly infer`.split(/\s+/));
const callAhead = /\s*(?:\?\.\s*)?(?:<[^<>();]+>\s*)?\(/y;

// Every identifier in a script that could name something defined elsewhere, with whether it's
// called. Lines over 10,000 characters are minified code and get none. Plain .ts can't hold JSX,
// where `<T>(value: T) => value` is a generic function instead.
export function definitionNames(source: string, jsx = true) {
  const code = codeMask(source, jsx);
  const names: DefinitionName[] = [];
  let lineEnd = -1;
  let long = false;
  for (const match of source.matchAll(/(?<![\w$#])[A-Za-z_$][\w$]*/g)) {
    const { index } = match;
    const name = match[0];
    if (index > lineEnd) {
      lineEnd = source.indexOf("\n", index);
      if (lineEnd < 0) lineEnd = source.length;
      long = lineEnd - source.lastIndexOf("\n", index) - 1 > 10_000;
    }
    if (long || !code[index] || (reserved.has(name) && !afterDot(source, index))) continue;
    callAhead.lastIndex = index + name.length;
    names.push({ index, name, call: callAhead.test(source) });
  }
  return names;
}

// `promise.catch` and `map.delete` are properties, not keywords.
function afterDot(source: string, index: number) {
  let at = index - 1;
  while (at >= 0 && /\s/.test(source[at])) at--;
  return source[at] === "." && source[at - 1] !== ".";
}

// Which characters are code rather than strings, comments, regular expressions or JSX text. The
// highlighter knows too, but it loses its place partway through some TSX files and skips files over 100 KB.
function codeMask(source: string, jsx: boolean) {
  const code = new Uint8Array(source.length);
  let last = -1;
  let i = 0;
  // A misread `<` or backtick would swallow the rest of the file, so one that never closes is
  // read again as code. In a diff this also covers a hunk that ends partway through.
  const attempt = (from: number, read: () => boolean) => {
    if (read()) return;
    code.fill(0, from);
    code[from] = 1;
    last = from;
    i = from + 1;
  };
  // Up to the `}` that closes the `${` or JSX `{` this code sits in.
  const script = (nested: boolean) => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      let end = 0;
      if (c === "/" && source[i + 1] === "/") {
        end = source.indexOf("\n", i);
        i = end < 0 ? source.length : end;
      } else if (c === "/" && source[i + 1] === "*" && (end = source.indexOf("*/", i + 2)) >= 0) {
        i = end + 2;
      } else if ((c === '"' || c === "'") && (end = quoteEnd(source, i))) {
        last = end - 1;
        i = end;
      } else if (c === "`") {
        attempt(i++, template);
      } else if (c === "/" && regexAllowed(source, last) && (end = regexEnd(source, i))) {
        last = end - 1;
        i = end;
      } else if (c === "<" && jsx && regexAllowed(source, last) && opensTag(source, i)) {
        attempt(i, element);
      } else if (c === "}" && nested && !depth) {
        last = i++;
        return true;
      } else {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        code[i] = 1;
        if (c.trim()) last = i;
        i++;
      }
    }
    return !nested;
  };
  const template = () => {
    while (i < source.length) {
      if (source[i] === "\\") i += 2;
      else if (source[i] === "`") {
        last = i++;
        return true;
      } else if (source[i] === "$" && source[i + 1] === "{") {
        last = (i += 2) - 1;
        if (!script(true)) return false;
      } else i++;
    }
    return false;
  };
  // Tag names, props and `{…}` are code; quoted props and the text between tags aren't.
  const element = (): boolean => {
    for (i++; i < source.length && source[i] !== ">"; i++) {
      const c = source[i];
      if (c === "{") {
        last = i++;
        if (!script(true)) return false;
        i--;
      } else if (c === '"' || c === "'") {
        const end = source.indexOf(c, i + 1);
        if (end < 0) return false;
        i = end;
      } else if (c === "<") {
        // Type arguments, as in `<Select<Item> value={item} />`.
        for (let depth = 0; i < source.length; i++) {
          code[i] = 1;
          if (source[i] === "<") depth++;
          else if (source[i] === ">" && !--depth) break;
        }
      } else if (c === "/" && source[i + 1] === ">") {
        last = ++i;
        i++;
        return true;
      } else code[i] = 1;
    }
    for (i++; i < source.length;) {
      if (source[i] === "{") {
        last = i++;
        if (!script(true)) return false;
      } else if (source[i] === "<" && source[i + 1] === "/") {
        for (; i < source.length && source[i] !== ">"; i++) code[i] = 1;
        if (i === source.length) return false;
        last = i++;
        return true;
      } else if (source[i] === "<") {
        if (!element()) return false;
      } else i++;
    }
    return false;
  };
  script(false);
  return code;
}

// A quote with no partner on its line is an apostrophe in text, not a string.
function quoteEnd(source: string, start: number) {
  for (let i = start + 1; i < source.length && source[i] !== "\n"; i++) {
    if (source[i] === "\\") i += source.startsWith("\r\n", i + 1) ? 2 : 1;
    else if (source[i] === source[start]) return i + 1;
  }
  return 0;
}

// A slash after a value divides; anywhere else it starts a regular expression, and a `<` starts JSX.
// `total!` and `index++` end in operators but are values.
function regexAllowed(source: string, last: number) {
  const before = source.slice(Math.max(0, last - 9), last + 1);
  return last < 0 || (/[(,=:[!&|?{};~+\-*%>^]$/.test(before) && !/[\w$)\]](?:!|\+\+|--)$/.test(before))
    || /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await)$/.test(before);
}

function regexEnd(source: string, start: number) {
  let inClass = false;
  for (let i = start + 1; i < source.length && source[i] !== "\n"; i++) {
    if (source[i] === "\\") i++;
    else if (source[i] === "[") inClass = true;
    else if (source[i] === "]") inClass = false;
    else if (source[i] === "/" && !inClass) {
      for (i++; /[a-z]/i.test(source[i] ?? ""); i++);
      return i;
    }
  }
  return 0;
}

// Type parameters look like tags: `<T,>`, `<T extends U>` and `<T = U>` never are, and a bare `<T>`
// is one only when its closing tag follows, as the highlighter decides.
const tagStart = /<(?:([A-Za-z_$][\w$.:-]*)(\s*)(?=(.?)))?/y;
function opensTag(source: string, at: number) {
  tagStart.lastIndex = at;
  const [whole, name, space, next] = tagStart.exec(source)!;
  if (!name) return source[at + 1] === ">";
  if (next === "<" || next === "," || next === "=") return false;
  if (space && /^extends\s/.test(source.slice(at + whole.length, at + whole.length + 8))) return false;
  if (next !== ">") return true;
  // `</Tooltip>` doesn't close `<T>`.
  for (let close = source.indexOf("</" + name, at); close >= 0; close = source.indexOf("</" + name, close + 1))
    if (!/[\w$.:-]/.test(source[close + name.length + 2] ?? "")) return true;
  return false;
}
