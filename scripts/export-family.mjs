import { mkdir, writeFile } from "node:fs/promises";
const base = (process.env.EXPORT_API_URL || "http://127.0.0.1:3001").replace(
  /\/$/,
  "",
);
async function get(path) {
  const r = await fetch(base + "/api" + path);
  if (!r.ok) throw new Error("Export failed at " + path);
  return r.json();
}
const revision = await get("/revision");
const people = [];
for (let offset = 0; ; offset += 100) {
  const page = await get("/persons?limit=100&offset=" + offset);
  people.push(...page.items);
  if (people.length >= page.total) break;
}
const unions = new Map(),
  links = [];
for (const p of people) {
  const d = await get("/persons/" + p.id);
  for (const f of d.families)
    if (f.id)
      unions.set(f.id, {
        id: f.id,
        person1_id: p.id,
        person2_id: f.partner.id,
      });
  for (const parent of d.parents) {
    // Group is determined from the child's two parents, independent of pagination.
    const pair =
      d.parents.length === 2
        ? [...unions.values()].find((u) =>
            d.parents.every((x) => [u.person1_id, u.person2_id].includes(x.id)),
          )
        : null;
    links.push({
      id: parent.relationship_id,
      parent_id: parent.id,
      child_id: p.id,
      union_id: pair?.id || null,
    });
  }
}
// Resolve pairs after every partnership has been collected.
for (const r of links) {
  const parents = links
    .filter((x) => x.child_id === r.child_id)
    .map((x) => x.parent_id);
  r.union_id =
    parents.length === 2
      ? [...unions.values()].find((u) =>
          parents.every((id) => [u.person1_id, u.person2_id].includes(id)),
        )?.id
      : null;
  if (parents.length === 2 && !r.union_id)
    throw new Error("Incomplete parent pair; export stopped.");
}
const heads = (await get("/heads")).map((p, i) => ({
  person_id: p.id,
  position: i + 1,
}));
if ((await get("/revision")).revision !== revision.revision)
  throw new Error(
    "Someone changed the family during export. Please try again.",
  );
await mkdir("backups", { recursive: true });
const path =
  "backups/family-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
await writeFile(
  path,
  JSON.stringify(
    { format: 1, people, unions: [...unions.values()], links, heads },
    null,
    2,
  ),
  { flag: "wx" },
);
console.log(
  `Saved ${people.length} members to ${path}. Keep this backup private.`,
);
