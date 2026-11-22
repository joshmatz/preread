import type { BriefStructure } from "./brief-outline.ts";

// Where a part's code groups list in Contents: under the first top-level heading whose section links them,
// the same place a group's overview link in the code opens.
export type PartTree = { lead: string[]; headings: Map<string, string[]>; other: string[] };

export function partTree(review: string, groups: string[], structure: Pick<BriefStructure, "outline" | "sections">): PartTree {
  const headings = new Map<string, string[]>();
  if (!structure.outline.length) return { lead: groups, headings, other: [] };
  const known = new Set(groups);
  const placed = new Set<string>();
  const lead: string[] = [];
  for (const section of structure.sections) {
    const linked = section.groups.flatMap((target) =>
      target.review === review && known.has(target.group) && !placed.has(target.group) ? [target.group] : []);
    linked.forEach((group) => placed.add(group));
    if (!linked.length) continue;
    if (section.heading) headings.set(section.heading.key, linked);
    else lead.push(...linked);
  }
  return { lead, headings, other: groups.filter((group) => !placed.has(group)) };
}
