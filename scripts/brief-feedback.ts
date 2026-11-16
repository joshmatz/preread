import { readFile } from "node:fs/promises";
import { z } from "zod";
import { feedbackJson, feedbackText, replyAsAgent, type AgentReply } from "../server/feedback.ts";
import { requestRefresh } from "../server/live.ts";

const usage = `Usage: pnpm feedback <collection-id> [--review <review-id>] [--all] [--json]
       pnpm feedback reply <collection-id> <ID> "<reply>" [--resolve] [--review <review-id> | --feature]
       pnpm feedback reply <collection-id> --file <replies.json>`;
class UsageError extends Error {}
const batchSchema = z.array(z.strictObject({ id: z.string(), body: z.string(), resolve: z.boolean().optional(),
  review: z.string().optional(), feature: z.boolean().optional() })).min(1, "The file lists no replies.").max(500);
function parse(args: string[]) {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") { positional.push(...args.slice(index + 1)); break; }
    if (argument === "--review" || argument === "--file") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--") || values.has(argument)) return null;
      values.set(argument, value);
      index += 1;
    } else if (["--json", "--all", "--resolve", "--feature"].includes(argument)) flags.add(argument);
    else if (argument.startsWith("--")) return null;
    else positional.push(argument);
  }
  return { flags, values, positional };
}
async function reply(collection: string, replies: AgentReply[]) {
  const results = await replyAsAgent(collection, replies);
  const written = results.filter((entry) => !entry.removed);
  const resolved = written.filter((entry) => entry.resolved).length;
  console.log(`Replied to ${written.length} ${written.length === 1 ? "item" : "items"}${resolved ? `, resolving ${resolved}` : ""}:`);
  for (const entry of results) console.log(`- ${entry.id} · ${entry.place}${entry.removed ? " (not sent: the reader removed it)" : entry.resolved ? " (resolved)" : ""}`);
  await requestRefresh(false).then((sent) => { if (sent) console.log("Open review pages will refresh within a second."); },
    (error: Error) => console.log(`Open pages were not refreshed: ${error.message}`));
}

const parsed = parse(process.argv.slice(2));
const review = parsed?.values.get("--review");
const file = parsed?.values.get("--file");
try {
  if (!parsed) throw new UsageError();
  const { flags, positional } = parsed;
  if (positional[0] === "reply") {
    if (flags.has("--json") || flags.has("--all") || (review !== undefined && flags.has("--feature"))) throw new UsageError();
    if (file !== undefined) {
      if (positional.length !== 2 || review !== undefined || flags.size) throw new UsageError();
      const text = await readFile(file, "utf8");
      let data: unknown;
      try { data = JSON.parse(text); } catch (error) { throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`); }
      const replies = batchSchema.safeParse(data);
      if (!replies.success) {
        const [issue] = replies.error.issues;
        const [index, ...field] = issue.path;
        throw new Error(`${file}${typeof index === "number" ? `, reply ${index + 1}${field.length ? ` (${field.join(".")})` : ""}` : ""}: ${issue.message}`);
      }
      await reply(positional[1], replies.data);
    } else {
      if (positional.length !== 4) throw new UsageError();
      await reply(positional[1], [{ id: positional[2], body: positional[3], resolve: flags.has("--resolve"), review, feature: flags.has("--feature") }]);
    }
  } else {
    if (positional.length !== 1 || file !== undefined || flags.has("--resolve") || flags.has("--feature")) throw new UsageError();
    const options = { review, all: flags.has("--all") };
    if (flags.has("--json")) console.log(JSON.stringify(await feedbackJson(positional[0], options), null, 2));
    else console.log((await feedbackText(positional[0], options)).text);
  }
} catch (error) {
  console.error(error instanceof UsageError ? usage : error instanceof Error ? error.message : "Could not read feature feedback.");
  process.exitCode = 1;
}
