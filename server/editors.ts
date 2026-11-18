import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const applications = [
  { name: "VS Code", cli: "Visual Studio Code.app/Contents/Resources/app/bin/code", goto: true },
  { name: "Cursor", cli: "Cursor.app/Contents/Resources/app/bin/cursor", goto: true },
  { name: "Zed", cli: "Zed.app/Contents/MacOS/cli", goto: false },
];

export async function installedEditors() {
  const editors = new Map<string, { command: string; args: (path: string, line: number) => string[] }>();
  for (const app of applications) {
    const cli = app.cli.split("/").at(-1)!;
    const paths = process.platform === "darwin"
      ? [join("/Applications", app.cli), join(homedir(), "Applications", app.cli)]
      : [];
    for (const dir of ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"]) paths.push(join(dir, cli === "cli" ? "zed" : cli));
    for (const command of paths) {
      if (!await access(command, constants.X_OK).then(() => true, () => false)) continue;
      editors.set(app.name, { command, args: (path, line) => [...(app.goto ? ["--goto"] : []), path + ":" + line] });
      break;
    }
  }
  if (process.platform === "darwin") editors.set("Finder", { command: "/usr/bin/open", args: path => ["-R", path] });
  return editors;
}

export async function openInEditor(name: string, path: string, line: number) {
  const target = (await installedEditors()).get(name);
  if (!target || !Number.isSafeInteger(line) || line < 1) throw new Error("Select an installed editor and a valid line.");
  await execute(target.command, target.args(path, line), { timeout: 10_000, cwd: homedir() });
}
