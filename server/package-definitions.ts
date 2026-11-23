import { readFileSync, realpathSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { basename, dirname, join, relative, sep } from "node:path";
import ts from "typescript";
import { MAX_PATCH } from "./git.ts";

export type PackageInfo = { name: string; version: string };
type Location = { file: string; line: number; code: string; package?: PackageInfo };
type Lookup = { found?: Location; missing?: string };
// Files of the reviewed revision, by worktree-relative path, and how one of them imports another.
// Only the files in `packagesFrom` load the packages they import.
export type RepoFiles = {
  texts: Map<string, string>; packagesFrom: Set<string>; resolve: (from: string, spec: string) => string | undefined;
};

// Lines split on \n alone, as Git and the browser count them; TypeScript also breaks at \r, U+2028 and U+2029.
export function lineOf(text: string, pos: number) {
  let line = 1;
  for (let at = text.indexOf("\n"); at !== -1 && at < pos; at = text.indexOf("\n", at + 1)) line++;
  return line;
}

export const isPackagePath = (file: string) => file.split("/").includes("node_modules");
export const isBareSpecifier = (spec: string) => !/^(\.{1,2}(\/|$)|\/|[a-z]+:\/\/)/i.test(spec);

// Without `jsx`, the compiler leaves out every .tsx file an import reaches.
const options: ts.CompilerOptions = {
  allowJs: true, jsx: ts.JsxEmit.Preserve, noLib: true, noEmit: true, types: [], skipLibCheck: true,
  esModuleInterop: true, allowSyntheticDefaultImports: true, maxNodeModuleJsDepth: 1,
  module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.Latest,
};
// Installed type packages are large and rarely change; reparsing @types/node on every click costs seconds.
const parsed = new Map<string, { stamp: string; file: ts.SourceFile }>();
let parsedBytes = 0;

// Reads only files whose path and real path both sit under a node_modules folder inside the worktree.
// `linked` also follows a node_modules link back into the worktree, as a workspace package is, but
// only to resolve imports: the review, not the disk, supplies that file's contents.
export function installedFiles(root: string) {
  const top = realpathSync(root);
  const installed = (path: string) => path.startsWith(top + sep) && relative(top, path).split(sep).includes("node_modules");
  const stat = (path: string, linked = false) => {
    if (!installed(path)) return;
    try {
      const target = realpathSync(path);
      return installed(target) || (linked && target.startsWith(top + sep)) ? { target, stats: statSync(target) } : undefined;
    } catch {
      return;
    }
  };
  const readFile = (path: string, linked = false) => {
    const found = stat(path, linked);
    if (!found?.stats.isFile() || found.stats.size > MAX_PATCH) return;
    const text = readFileSync(found.target, "utf8");
    return text.includes("\0") ? undefined : text;
  };
  return {
    top, stat, readFile,
    fileExists: (path: string) => !!stat(path)?.stats.isFile(),
    directoryExists: (path: string) => !!stat(path)?.stats.isDirectory(),
    realpath: (path: string) => stat(path)?.target ?? path,
    sourceFile(path: string) {
      const found = stat(path);
      if (!found?.stats.isFile()) return;
      const stamp = found.stats.mtimeMs + ":" + found.stats.size;
      const cached = parsed.get(path);
      if (cached) {
        parsed.delete(path);
        if (cached.stamp === stamp) {
          parsed.set(path, cached);
          return cached.file;
        }
        parsedBytes -= cached.file.text.length;
      }
      const text = readFile(path);
      if (text === undefined) return;
      const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest);
      parsed.set(path, { stamp, file });
      parsedBytes += text.length;
      while (parsed.size > 4000 || parsedBytes > 96 << 20) {
        const [oldest, entry] = parsed.entries().next().value!;
        parsed.delete(oldest);
        parsedBytes -= entry.file.text.length;
      }
      return file;
    },
  };
}

// The worktree file a bare import reaches through a node_modules link, as a workspace package does.
export function linkedModule(root: string, from: string, spec: string) {
  if (isBuiltin(spec)) return;
  const installed = installedFiles(root);
  const found = ts.resolveModuleName(spec, join(installed.top, from), options, {
    fileExists: path => !!installed.stat(path, true)?.stats.isFile(),
    directoryExists: path => !!installed.stat(path, true)?.stats.isDirectory(),
    realpath: path => installed.stat(path, true)?.target ?? path,
    readFile: path => basename(path) === "package.json" ? installed.readFile(path, true) : undefined,
  }).resolvedModule;
  const parts = found && relative(installed.top, found.resolvedFileName).split(sep);
  return parts && !parts.includes("node_modules") && !parts.includes("..") ? parts.join("/") : undefined;
}

export function readInstalledFile(root: string, file: string) {
  if (!isPackagePath(file) || file.split("/").some(part => !part || part === "." || part === ".."))
    throw new Error("File is outside the comparison.");
  const installed = installedFiles(root);
  const code = installed.readFile(join(installed.top, file));
  if (code === undefined) throw new Error("This installed file can't be previewed.");
  return { code, package: packageOf(installed, join(installed.top, file)) };
}

function packageOf(installed: ReturnType<typeof installedFiles>, file: string): PackageInfo {
  for (let dir = dirname(file); dir.startsWith(installed.top + sep); dir = dirname(dir)) {
    const text = installed.readFile(join(dir, "package.json"));
    if (!text) continue;
    try {
      const { name, version } = JSON.parse(text);
      if (typeof name === "string" && name) return { name, version: typeof version === "string" ? version : "" };
    } catch { /* Keep walking up to the package's own manifest. */ }
  }
  return { name: relative(installed.top, file).split(sep).find(part => part !== "node_modules") ?? "package", version: "" };
}

const identifierAt = (file: ts.SourceFile, pos: number, name: string): ts.Identifier | undefined => {
  const visit = (node: ts.Node): ts.Identifier | undefined => {
    if (ts.isIdentifier(node) && node.getStart(file) === pos && node.text === name) return node;
    return node.forEachChild(child => child.pos <= pos && pos < child.end ? visit(child) : undefined);
  };
  return visit(file);
};

// A prop, an object literal's key or a destructured name stands for a property of the type around it.
export function propertyOwner(token: ts.Identifier) {
  const parent = token.parent;
  if (ts.isJsxAttribute(parent) && parent.name === token) return parent.parent;
  if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) && parent.name === token
    && ts.isObjectLiteralExpression(parent.parent)) return parent.parent;
  if (ts.isBindingElement(parent) && parent.name === token && !parent.propertyName
    && ts.isObjectBindingPattern(parent.parent)) return parent.parent;
}

// A shorthand `{ limit }` stands for the value it copies.
export function symbolAt(checker: ts.TypeChecker, token: ts.Identifier) {
  if (ts.isShorthandPropertyAssignment(token.parent)) return checker.getShorthandAssignmentValueSymbol(token.parent);
  const owner = propertyOwner(token);
  const type = owner && (ts.isObjectBindingPattern(owner) ? checker.getTypeAtLocation(owner) : checker.getContextualType(owner));
  return (type && checker.getPropertyOfType(type, token.text)) ?? checker.getSymbolAtLocation(token);
}

const extensions = [ts.Extension.Dts, ts.Extension.Dmts, ts.Extension.Dcts, ts.Extension.Tsx, ts.Extension.Ts,
  ts.Extension.Mts, ts.Extension.Cts, ts.Extension.Jsx, ts.Extension.Js, ts.Extension.Mjs, ts.Extension.Cjs];
const extensionOf = (path: string) => extensions.find(extension => path.endsWith(extension)) ?? ts.Extension.Ts;

// `allow` limits which of the starting file's own imports may load from node_modules, so a click
// never pulls in every package that file imports. Repository files come only from `repo`, never from disk.
function resolveInstalled(root: string, start: { path: string; code: string; pos: number; name: string; installed?: boolean },
  allow: (spec: string) => boolean, builtin: boolean, repo?: RepoFiles): Lookup {
  const installed = installedFiles(root);
  const cache = ts.createModuleResolutionCache(installed.top, name => name, options);
  const inRepo = (path: string) => repo?.texts.get(relative(installed.top, path).split(sep).join("/"));
  const text = (path: string) => path === start.path ? start.code : inRepo(path);
  let missing: string | undefined;
  // Caps one lookup however large the installed type graph is; whatever is left out reads as untyped.
  let room = { files: 1500, bytes: 16 << 20 };
  const host: ts.CompilerHost = {
    getSourceFile(path) {
      const code = text(path);
      if (code !== undefined) return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true);
      if (room.files <= 0 || room.bytes <= 0) return;
      const file = installed.sourceFile(path);
      if (file) room = { files: room.files - 1, bytes: room.bytes - file.text.length };
      return file;
    },
    getDefaultLibFileName: () => "lib.d.ts",
    writeFile() {},
    getCurrentDirectory: () => installed.top,
    getCanonicalFileName: name => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: path => text(path) !== undefined || installed.fileExists(path),
    readFile: path => text(path) ?? installed.readFile(path),
    directoryExists: installed.directoryExists,
    realpath: installed.realpath,
    getDirectories: () => [],
    resolveModuleNameLiterals: (literals, containing, _project, settings) => literals.map(literal => {
      if (repo && text(containing) !== undefined) {
        const from = relative(installed.top, containing).split(sep).join("/");
        const target = repo.resolve(from, literal.text);
        if (target !== undefined) return {
          resolvedModule: repo.texts.has(target)
            ? { resolvedFileName: join(installed.top, target), extension: extensionOf(target), isExternalLibraryImport: false }
            : undefined,
        };
        if (!isBareSpecifier(literal.text) || !repo.packagesFrom.has(from)) return { resolvedModule: undefined };
      }
      if (containing === start.path && !allow(literal.text)) return { resolvedModule: undefined };
      const resolved = ts.resolveModuleName(literal.text, containing, settings, host, cache);
      if (containing === start.path && !resolved.resolvedModule && !isBuiltin(literal.text)) missing = literal.text;
      return resolved;
    }),
  };
  const roots = [start.path];
  if (builtin) {
    const node = ts.resolveTypeReferenceDirective("node", start.path, options, host).resolvedTypeReferenceDirective;
    if (node?.resolvedFileName) roots.push(node.resolvedFileName);
  }
  const program = ts.createProgram({ rootNames: roots, options, host });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(start.path);
  const token = source && identifierAt(source, start.pos, start.name);
  let symbol = token && symbolAt(checker, token);
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const declarations = (symbol?.declarations ?? []).filter(node => repo
    ? ts.getNameOfDeclaration(node as ts.Declaration) !== token
    : start.installed || node.getSourceFile() !== source);
  const target = declarations.find(node => ts.isFunctionLike(node) && "body" in node && node.body) ?? declarations[0];
  if (!target) return { missing };
  const file = target.getSourceFile();
  const line = lineOf(file.text, target.getStart(file));
  const local = file.fileName === start.path || inRepo(file.fileName) !== undefined;
  const real = local ? file.fileName : installed.realpath(file.fileName);
  if (!local && !installed.fileExists(real)) return {};
  const path = relative(installed.top, real).split(sep).join("/");
  return { found: local ? { file: path, line, code: file.text } : { file: path, line, code: file.text, package: packageOf(installed, real) } };
}

const isBuiltin = (spec: string) => spec.startsWith("node:") || builtinModules.includes(spec);

// Resolves what `exported` names in the package `spec`, as imported by a file at `from`.
export function installedExport(root: string, from: string, spec: string, exported: string): Lookup {
  if (exported !== "default" && !/^[A-Za-z_$][\w$]*$/.test(exported)) return {};
  const top = realpathSync(root);
  const code = exported === "default"
    ? `import target from ${JSON.stringify(spec)};\ntarget;\n`
    : `import { ${exported} as target } from ${JSON.stringify(spec)};\ntarget;\n`;
  const path = join(top, dirname(from), "__preread_definition__.ts");
  return resolveInstalled(root, { path, code, pos: code.lastIndexOf("target;"), name: "target" },
    () => true, isBuiltin(spec));
}

// Resolves a name at a position in a file, loading only the package `spec` when one is given.
export function installedAt(root: string, file: string, code: string, pos: number, name: string, spec?: string) {
  const top = realpathSync(root);
  return resolveInstalled(root, { path: join(top, file), code, pos, name, installed: isPackagePath(file) },
    imported => spec === undefined ? true : imported === spec, spec !== undefined && isBuiltin(spec));
}

// Resolves a name with types, so `query.where` finds the method of whatever `query` is. Only the
// repository files in `repo` load; imports of any other repository file resolve to nothing.
export function typedAt(root: string, file: string, pos: number, name: string, repo: RepoFiles) {
  const top = realpathSync(root);
  const code = repo.texts.get(file)!;
  const builtin = ts.preProcessFile(code, true, true).importedFiles.some(({ fileName }) => isBuiltin(fileName));
  return resolveInstalled(root, { path: join(top, file), code, pos, name }, () => true, builtin, repo);
}
