import { posix } from "node:path";
import ts from "typescript";
import type { Mode } from "../src/types.ts";
import { reviewSource } from "./review-source.ts";

const supported = /\.[cm]?[jt]sx?$/i;
const unavailable = "No local definition found for this call.";
type Location = { file: string; line: number; code: string };

// Keep the compiler's view inside the selected Git revision or working tree.
// The host never loads project plugins, dependencies, or global compiler libraries.
export async function functionDefinition(path: string, base: string, mode: Mode, side: string,
  file: string, line: number, column: number, name: string, version: string) {
  if (!["old", "new"].includes(side) || !supported.test(file) || !Number.isSafeInteger(line)
    || !Number.isSafeInteger(column) || line < 1 || column < 0 || !name) throw new Error(unavailable);
  const { files, changes, read, editorTarget } = await reviewSource({ path, base, mode, side, version });
  if (!files.has(file)) throw new Error(unavailable);
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
  const modulePath = (from: string, spec: string) => {
    const found = ts.resolveModuleName(spec, "/" + from, { ...options, baseUrl: options.baseUrl ?? (options.paths ? "/" + dir : undefined) }, {
      fileExists: p => files.has(p.slice(1)), readFile: () => undefined,
    }).resolvedModule;
    return found?.resolvedFileName.slice(1);
  };
  const visited = new Set<string>();
  async function lookup(p: string, exported?: string): Promise<Location | undefined> {
    const key = JSON.stringify([p, exported]);
    if (visited.has(key) || visited.size >= 32 || !supported.test(p)) return;
    visited.add(key);
    const code = await read(p);
    const ast = ts.createSourceFile(p, code, ts.ScriptTarget.Latest, true);
    const compilerOptions = { allowJs: true, noLib: true, noResolve: true, types: [] };
    const checker = ts.createProgram([p], compilerOptions, {
      ...ts.createCompilerHost(compilerOptions), getCurrentDirectory: () => "",
      fileExists: f => f === p, readFile: f => f === p ? code : undefined,
      getSourceFile: f => f === p ? ast : undefined, writeFile() {},
    }).getTypeChecker();
    const follow = (spec: ts.Expression, id: string) => {
      const target = ts.isStringLiteral(spec) && modulePath(p, spec.text);
      return target ? lookup(target, id) : undefined;
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
      const start = ast.getLineStarts()[line - 1];
      if (start === undefined || (ast.getLineStarts()[line] ?? code.length + 1) <= start + column || code.slice(start + column, start + column + name.length) !== name)
        throw new Error("The call has moved. Refresh the review and try again.");
      const pos = start + column;
      const tokenAt = (node: ts.Node): ts.Identifier | undefined => {
        if (ts.isIdentifier(node) && node.getStart(ast) === pos && node.text === name) return node;
        return node.forEachChild(child => child.pos <= pos && pos < child.end ? tokenAt(child) : undefined);
      };
      const token = tokenAt(ast);
      if (!token) return;
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
    const first = ast.getLineAndCharacterOfPosition(target.getStart(ast)).line;
    return { file: p, line: first + 1, code };
  }
  const result = await lookup(file);
  if (!result) throw new Error(unavailable);
  return { ...result, paths: [...files], changes, editorTarget: await editorTarget(result.file, result.code) };
}
