import { posix } from "node:path";
import ts from "typescript";
import type { Mode } from "../src/types.ts";
import { reviewSource, sourceHash } from "./review-source.ts";
import {
  installedAt, installedExport, isBareSpecifier, isPackagePath, lineOf, linkedModule, readInstalledFile, typedAt, type PackageInfo,
} from "./package-definitions.ts";

const supported = /\.[cm]?[jt]sx?$/i;
const notFound = (name: string) => new Error(`No definition found for “${name}”.`);
type Location = { file: string; line: number; code: string; package?: PackageInfo };

// Lines split on \n alone, as Git and the browser count them.
function position(code: string, line: number, column: number, name: string) {
  let start = 0;
  for (let n = 1; n < line && start !== -1; n++) start = code.indexOf("\n", start) + 1 || -1;
  const end = code.indexOf("\n", start);
  if (start === -1 || (end === -1 ? code.length : end) < start + column + name.length
    || code.slice(start + column, start + column + name.length) !== name)
    throw new Error("The call has moved. Refresh the review and try again.");
  return start + column;
}

// The module an expression such as `_.pick` or `knex(table).select` starts from.
function importedFrom(checker: ts.TypeChecker, token: ts.Identifier) {
  let head: ts.Expression = token;
  if (ts.isPropertyAccessExpression(token.parent) && token.parent.name === token) {
    head = token.parent.expression;
    while (ts.isPropertyAccessExpression(head) || ts.isElementAccessExpression(head) || ts.isCallExpression(head)
      || ts.isNonNullExpression(head) || ts.isParenthesizedExpression(head) || ts.isAsExpression(head)) head = head.expression;
  }
  if (!ts.isIdentifier(head)) return;
  const decl = checker.getSymbolAtLocation(head)?.declarations?.[0];
  const spec = !decl ? undefined
    : ts.isImportSpecifier(decl) ? decl.parent.parent.parent.moduleSpecifier
    : ts.isImportClause(decl) ? decl.parent.moduleSpecifier
    : ts.isNamespaceImport(decl) ? decl.parent.parent.moduleSpecifier
    : ts.isImportEqualsDeclaration(decl) && ts.isExternalModuleReference(decl.moduleReference) ? decl.moduleReference.expression
    : ts.isVariableDeclaration(decl) && decl.initializer && ts.isCallExpression(decl.initializer)
      && ts.isIdentifier(decl.initializer.expression) && decl.initializer.expression.text === "require"
      ? decl.initializer.arguments[0] : undefined;
  return spec && ts.isStringLiteral(spec) ? spec.text : undefined;
}

// Keep the compiler's view inside the selected Git revision or working tree, plus the packages
// installed in the worktree. The host never loads project plugins or global compiler libraries.
export async function functionDefinition(path: string, base: string, mode: Mode, side: string,
  file: string, line: number, column: number, name: string, version: string) {
  if (!["old", "new"].includes(side) || !supported.test(file) || !Number.isSafeInteger(line)
    || !Number.isSafeInteger(column) || line < 1 || column < 0 || !name) throw notFound(name || "this call");
  const { files, changes, read, editorTarget, root } = await reviewSource({ path, base, mode, side, version });
  let result: Location;
  if (isPackagePath(file)) {
    const { code } = readInstalledFile(root, file);
    const found = installedAt(root, file, code, position(code, line, column, name), name).found;
    if (!found) throw notFound(name);
    result = found;
  } else {
    if (!files.has(file)) throw notFound(name);
    result = await repositoryDefinition();
  }
  return {
    ...result, paths: [...files], changes,
    editorTarget: result.package ? sourceHash(result.code) : await editorTarget(result.file, result.code),
  };

  async function repositoryDefinition(): Promise<Location> {
    let dir = posix.dirname(file);
    let options: ts.CompilerOptions = { allowJs: true, moduleResolution: ts.ModuleResolutionKind.Bundler };
    while (true) {
      const config = ["tsconfig.json", "jsconfig.json"].map(n => posix.join(dir, n)).find(p => files.has(p));
      if (config) {
        const parsed = ts.parseConfigFileTextToJson(config, await read(config)).config;
        options = { ...options, ...ts.convertCompilerOptionsFromJson(parsed?.compilerOptions ?? {}, "/" + dir).options };
        break;
      }
      if (dir === ".") break;
      dir = posix.dirname(dir);
    }
    const linked = new Map<string, string | undefined>();
    const modulePath = (from: string, spec: string) => {
      const found = ts.resolveModuleName(spec, "/" + from, { ...options, baseUrl: options.baseUrl ?? (options.paths ? "/" + dir : undefined) }, {
        fileExists: p => files.has(p.slice(1)), readFile: () => undefined,
      }).resolvedModule;
      if (found || !isBareSpecifier(spec)) return found?.resolvedFileName.slice(1);
      const key = posix.dirname(from) + "\0" + spec;
      if (!linked.has(key)) {
        const target = linkedModule(root, from, spec);
        linked.set(key, target && files.has(target) ? target : undefined);
      }
      return linked.get(key);
    };
    const code = await read(file);
    const pos = position(code, line, column, name);
    // Imports that leave the repository, tried in installed packages once the repository has no answer.
    const hops: { from: string; spec: string; exported: string }[] = [];
    let origin: string | undefined;
    const visited = new Set<string>();
    async function lookup(p: string, exported?: string): Promise<Location | undefined> {
      const key = JSON.stringify([p, exported]);
      if (visited.has(key) || visited.size >= 32 || !supported.test(p)) return;
      visited.add(key);
      const text = p === file ? code : await read(p);
      const ast = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
      const compilerOptions = { allowJs: true, noLib: true, noResolve: true, types: [] };
      const checker = ts.createProgram([p], compilerOptions, {
        ...ts.createCompilerHost(compilerOptions), getCurrentDirectory: () => "",
        fileExists: f => f === p, readFile: f => f === p ? text : undefined,
        getSourceFile: f => f === p ? ast : undefined, writeFile() {},
      }).getTypeChecker();
      const follow = (spec: ts.Expression, id: string) => {
        if (!ts.isStringLiteral(spec)) return;
        const target = modulePath(p, spec.text);
        if (target) return lookup(target, id);
        if (isBareSpecifier(spec.text)) hops.push({ from: p, spec: spec.text, exported: id });
      };
      let symbol: ts.Symbol | undefined;
      if (exported !== undefined) {
        const mod = checker.getSymbolAtLocation(ast);
        symbol = mod && checker.getExportsOfModule(mod).find(s => s.name === exported);
        if (!symbol) {
          const matches = new Map<string, Location>();
          for (const stmt of ast.statements) {
            if (!ts.isExportDeclaration(stmt) || stmt.exportClause || !stmt.moduleSpecifier || exported === "default") continue;
            const found = await follow(stmt.moduleSpecifier, exported);
            if (found) matches.set(JSON.stringify([found.file, found.line]), found);
          }
          return matches.size === 1 ? [...matches.values()][0] : undefined;
        }
      } else {
        const tokenAt = (node: ts.Node): ts.Identifier | undefined => {
          if (ts.isIdentifier(node) && node.getStart(ast) === pos && node.text === name) return node;
          return node.forEachChild(child => child.pos <= pos && pos < child.end ? tokenAt(child) : undefined);
        };
        const token = tokenAt(ast);
        if (!token) return;
        const spec = importedFrom(checker, token);
        if (spec && isBareSpecifier(spec) && !modulePath(p, spec)) origin = spec;
        if (ts.isPropertyAccessExpression(token.parent) && token.parent.name === token) {
          const ns = checker.getSymbolAtLocation(token.parent.expression)?.declarations?.[0];
          if (ns && ts.isNamespaceImport(ns)) return follow(ns.parent.parent.moduleSpecifier, name);
        }
        symbol = checker.getSymbolAtLocation(token);
      }
      let decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (!decl) return;
      if (ts.isExportSpecifier(decl)) {
        const statement = decl.parent.parent;
        if (statement.moduleSpecifier) return follow(statement.moduleSpecifier, (decl.propertyName ?? decl.name).text);
        symbol = checker.getExportSpecifierLocalTargetSymbol(decl);
        decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      } else if (ts.isExportAssignment(decl) && ts.isIdentifier(decl.expression)) {
        symbol = checker.getSymbolAtLocation(decl.expression);
        decl = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      }
      if (!decl) return;
      if (ts.isImportSpecifier(decl)) return follow(decl.parent.parent.parent.moduleSpecifier, (decl.propertyName ?? decl.name).text);
      if (ts.isImportClause(decl)) return follow(decl.parent.moduleSpecifier, "default");
      const implementation = symbol?.declarations?.find(d => ts.isFunctionLike(d) && "body" in d && d.body);
      const target = implementation ?? decl;
      return { file: p, line: lineOf(text, target.getStart(ast)), code: text };
    }
    const found = await lookup(file);
    if (found) return found;
    let missing: string | undefined;
    for (const hop of hops) {
      const installed = installedExport(root, hop.from, hop.spec, hop.exported);
      if (installed.found) return installed.found;
      missing ??= installed.missing;
    }
    if (origin) {
      const installed = installedAt(root, file, code, pos, name, origin);
      if (installed.found) return installed.found;
      missing ??= installed.missing;
    }
    const typed = typedAt(root, file, pos, name, await nearby());
    if (typed.found) return typed.found;
    throw missing ? new Error(`“${name}” comes from ${missing}, which isn't installed in this worktree.`) : notFound(name);

    // The clicked file and the repository files it imports, two levels deep, as the review shows them.
    // Packages load only for the clicked file and its direct imports, which keeps SDKs imported
    // somewhere deeper from swamping the lookup.
    async function nearby() {
      const texts = new Map([[file, code]]);
      const packagesFrom = new Set([file]);
      let frontier = [file];
      for (let depth = 0; depth < 2 && frontier.length; depth++) {
        if (depth === 1) for (const direct of frontier) packagesFrom.add(direct);
        const targets = [...new Set(frontier.flatMap(from => ts.preProcessFile(texts.get(from)!, true, true).importedFiles
          .map(({ fileName }) => modulePath(from, fileName))))]
          .filter((target): target is string => !!target && !texts.has(target) && supported.test(target))
          .slice(0, Math.max(0, 60 - texts.size));
        frontier = [];
        for (let i = 0; i < targets.length; i += 8) {
          await Promise.all(targets.slice(i, i + 8).map(async target => {
            const text = await read(target).catch(() => undefined);
            if (text === undefined) return;
            texts.set(target, text);
            frontier.push(target);
          }));
        }
      }
      return { texts, packagesFrom, resolve: modulePath };
    }
  }
}
