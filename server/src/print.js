import { fail } from "./model.js";

// One consistent graph snapshot; print never depends on the interactive tree's pagination.
export function printReport(g, rootId = null, scope = "branch") {
  if (rootId && !g.byId.has(rootId)) fail("Family member not found.", 404);
  const immediate = scope === "immediate";
  if (immediate && !rootId)
    fail("Select a person for immediate-family printing.");
  const children = new Map();
  for (const r of g.links) {
    if (!children.has(r.parent_id)) children.set(r.parent_id, []);
    children.get(r.parent_id).push(r.child_id);
  }
  const queue = rootId ? [rootId] : [...g.roots],
    seen = new Set(queue);
  for (let i = 0; i < (immediate ? 1 : queue.length); i++)
    for (const id of children.get(queue[i]) || [])
      if (!seen.has(id)) {
        seen.add(id);
        queue.push(id);
      }
  const families = [],
    used = new Set(),
    included = new Set(seen);
  for (const id of immediate ? [rootId] : queue) {
    const links = g.links.filter((r) => r.parent_id === id);
    const pairs = g.unions.filter(
      (u) => u.person1_id === id || u.person2_id === id,
    );
    for (const pair of pairs) {
      if (used.has(pair.id)) continue;
      used.add(pair.id);
      const parents = [pair.person1_id, pair.person2_id];
      parents.forEach((p) => included.add(p));
      families.push({
        id: pair.id,
        parents,
        children: links
          .filter((r) => r.union_id === pair.id)
          .map((r) => r.child_id),
      });
    }
    const single = links.filter((r) => !r.union_id).map((r) => r.child_id);
    if (
      single.length ||
      (!pairs.length &&
        !links.length &&
        (rootId === id || g.roots.includes(id)))
    )
      families.push({ id: "single-" + id, parents: [id], children: single });
  }
  const people = g.people
    .filter((p) => included.has(p.id))
    .map((p) => ({
      id: p.id,
      full_name: p.full_name,
      birth_date: p.birth_date,
      gender: p.gender,
      life_status: p.life_status || "Unknown",
    }));
  return {
    root_id: rootId,
    scope: immediate ? "immediate" : rootId ? "branch" : "all",
    title: rootId
      ? g.byId.get(rootId).full_name +
        (immediate ? " - immediate family" : " - family branch")
      : "Pinosian Bucannaw Clan - all families",
    generated_at: new Date().toISOString(),
    descendant_count: rootId ? seen.size - 1 : null,
    member_count: people.length,
    people,
    families,
  };
}
