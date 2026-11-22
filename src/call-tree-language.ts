import type { LanguageFn, Mode } from "highlight.js";

// Call trees mix code with English, so a control word counts only where a clause starts.
export const callTree: LanguageFn = () => {
  const quoted: Mode = { match: /"[^"\n]*"/ };
  // "Todo's" holds an apostrophe, not a quote.
  const single: Mode = { match: /(?<![\w'])'[^'\n]*'(?![\w'])/ };
  const mark: Mode = {
    scope: "comment",
    // The same notes the outline turns into labels: after a space, starting with a known word, and within the line.
    begin: /(?<!\S)\((?=(?:existing|above|below|changed|the service)\b|see\s+\S|PR \d+\b)/,
    end: /\)|$/,
    contains: [
      quoted,
      single,
      { begin: /\(/, end: /\)|$/, contains: ["self", quoted, single] },
      { scope: "keyword", match: /\bchange[ds]?\b/ },
    ],
  };
  const inline: Mode[] = [
    mark,
    { scope: "string", ...quoted },
    { scope: "string", ...single },
    {
      scope: "keyword",
      match: /(?<=^\s*|[:;,] |-> )(?:if|else|unless|try|catch|finally|while|return|for each|at once|in (?:parallel|both|a new transaction)|on (?:success|an error|a throw))\b/,
    },
    { scope: "keyword", match: /\b(?:await|throws?)\b/ },
    { scope: "type", match: /(?<=\b(?:else|throws?) )[a-z]+(?:-[a-z]+)+\b/ },
    { scope: "keyword", match: /\b(?:GET|POST|PUT|PATCH|DELETE)(?= \/)/ },
    { scope: "string", match: /(?<![\w.)\]])\/[\w:{}.-]+(?:\/[\w:{}.-]+)*/ },
    { scope: "title.function", match: /\b[A-Za-z_][\w$]*(?=\()/ },
    { scope: "title.class", match: /\b[A-Z][a-z\d]+(?:[A-Z][a-z\d]*)+\b/ },
    { scope: "variable.constant", match: /\b[A-Z][A-Z\d]*(?:_[A-Z\d]+)+\b/ },
    { scope: "literal", match: /\b(?:null|undefined|true|false|NULL)\b/ },
    { scope: "number", match: /\b\d+(?:\.\d+)?\b/ },
    { scope: "symbol", match: /->/ },
  ];
  return {
    name: "Call tree",
    contains: [{ scope: "section", begin: /^(?=\S)/, end: /$/, contains: inline }, ...inline],
  };
};
