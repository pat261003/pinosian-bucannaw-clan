import { z } from "zod";
export const idSchema = z.uuid();
const text = (n) => z.string().trim().max(n).default("");
export const personSchema = z.object({
  first_name: text(100),
  middle_name: text(100),
  last_name: text(100),
  suffix: text(30),
  birth_date: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((s) => {
        const d = new Date(s + "T00:00:00Z");
        return (
          !isNaN(d) &&
          d.toISOString().slice(0, 10) === s &&
          s <= new Date().toISOString().slice(0, 10) &&
          s >= "0001-01-01"
        );
      }, "Enter a valid birth date that is not in the future.")
      .nullable(),
  ),
  gender: z.enum(["Male", "Female", "Other", "Unknown"]),
  birth_place: text(200),
  current_location: text(200),
  notes: text(5000),
});
export const fullName = (p) =>
  [p.first_name, p.middle_name, p.last_name, p.suffix]
    .filter(Boolean)
    .join(" ") || `Unknown member · ${p.id?.slice(0, 8) || "new"}`;
export function fail(message, status = 400, extra = {}) {
  throw Object.assign(new Error(message), { status, ...extra });
}
export async function graph(db) {
  const snapshot = (
    await db.query(`SELECT
  (SELECT COALESCE(jsonb_agg(p ORDER BY p.entry_order,p.id),'[]'::jsonb) FROM (SELECT persons.*, EXISTS(SELECT 1 FROM clan_heads h WHERE h.person_id=persons.id) AS is_clan_head FROM persons) p) AS people,
  (SELECT COALESCE(jsonb_agg(u ORDER BY u.created_at,u.id),'[]'::jsonb) FROM unions u) AS unions,
  (SELECT COALESCE(jsonb_agg(r),'[]'::jsonb) FROM parent_child_relationships r) AS links`)
  ).rows[0];
  const { people, unions, links } = snapshot,
    byId = new Map(
      people.map((p) => [
        p.id,
        { ...p, generation: 1, branches: [], full_name: fullName(p) },
      ]),
    );
  const children = new Map(),
    counts = new Map(people.map((p) => [p.id, 0]));
  for (const r of links) {
    counts.set(r.child_id, counts.get(r.child_id) + 1);
    if (!children.has(r.parent_id)) children.set(r.parent_id, []);
    children.get(r.parent_id).push(r.child_id);
  }
  const roots = people.filter((p) => counts.get(p.id) === 0).map((p) => p.id),
    queue = [...roots];
  for (const id of roots) byId.get(id).branches = [id];
  for (let i = 0; i < queue.length; i++) {
    const p = byId.get(queue[i]);
    for (const id of children.get(p.id) || []) {
      const c = byId.get(id);
      c.generation = Math.max(c.generation, p.generation + 1);
      c.branches = [...new Set([...c.branches, ...p.branches])];
      counts.set(id, counts.get(id) - 1);
      if (counts.get(id) === 0) queue.push(id);
    }
  }
  // A total ordering avoids inconsistent comparisons when dates are missing.
  const compareChildren = (a, b) =>
    (a.sibling_order ?? Number.MAX_SAFE_INTEGER) -
      (b.sibling_order ?? Number.MAX_SAFE_INTEGER) ||
    (a.birth_date || "9999").localeCompare(b.birth_date || "9999") ||
    Number(a.entry_order) - Number(b.entry_order) ||
    a.id.localeCompare(b.id);
  links.sort((a, b) =>
    compareChildren(byId.get(a.child_id), byId.get(b.child_id)),
  );
  return { people: [...byId.values()], unions, links, roots, byId };
}
export async function ensurePerson(db, id) {
  idSchema.parse(id);
  const p = await db.query("SELECT id FROM persons WHERE id=$1", [id]);
  if (!p.rows.length) fail("Family member not found.", 404);
}
export async function union(db, a, b, reuse = false) {
  const heads = (await db.query("SELECT person_id FROM clan_heads")).rows.map(
    (h) => h.person_id,
  );
  if (
    (heads.includes(a) || heads.includes(b)) &&
    !(heads.includes(a) && heads.includes(b))
  )
    fail("The clan heads are partners only with each other.");
  await ensurePerson(db, a);
  await ensurePerson(db, b);
  if (a === b) fail("A person cannot be their own partner.");
  const existing = await db.query(
    "SELECT * FROM unions WHERE (person1_id=$1 AND person2_id=$2) OR (person1_id=$2 AND person2_id=$1)",
    [a, b],
  );
  if (existing.rows.length) {
    if (reuse) return existing.rows[0];
    fail("This partnership already exists.", 409);
  }
  return (
    await db.query(
      "INSERT INTO unions(person1_id,person2_id) VALUES($1,$2) RETURNING *",
      [a, b],
    )
  ).rows[0];
}
export async function addParents(db, child, parents) {
  const heads = (await db.query("SELECT person_id FROM clan_heads")).rows.map(
    (h) => h.person_id,
  );
  if (heads.includes(child))
    fail("The clan heads are the starting ancestors of this tree.");
  if (parents.some((id) => heads.includes(id)))
    parents = [...new Set([...parents, ...heads])];
  await ensurePerson(db, child);
  for (const id of parents) await ensurePerson(db, id);
  const prior = (
    await db.query(
      "SELECT * FROM parent_child_relationships WHERE child_id=$1",
      [child],
    )
  ).rows;
  const combined = [...new Set([...prior.map((r) => r.parent_id), ...parents])];
  if (combined.includes(child)) fail("A person cannot be their own parent.");
  if (combined.length > 2)
    fail(
      "Two parents are already recorded. Remove an incorrect parent link before adding another.",
    );
  if (parents.every((id) => prior.some((r) => r.parent_id === id)))
    fail("This parent-child relationship already exists.", 409);
  const pair =
    combined.length === 2 ? await union(db, ...combined, true) : null;
  for (const id of combined) {
    if (!prior.some((r) => r.parent_id === id))
      await db.query(
        "INSERT INTO parent_child_relationships(parent_id,child_id,union_id) VALUES($1,$2,$3)",
        [id, child, pair?.id || null],
      );
  }
  await db.query(
    "UPDATE parent_child_relationships SET union_id=$1 WHERE child_id=$2",
    [pair?.id || null, child],
  );
  return pair;
}
export async function createPerson(db, body) {
  const p = personSchema.parse(body);
  const relation = body.relation
    ? z
        .object({
          type: z.enum(["child", "parent", "spouse"]),
          person_id: idSchema,
          other_parent_id: idSchema.optional(),
        })
        .parse(body.relation)
    : null;
  const duplicates = (
    await db.query(
      "SELECT *,birth_date::text FROM persons WHERE (birth_date=$1 OR birth_date IS NULL OR $1::date IS NULL) AND lower(first_name)=lower($2) AND lower(last_name)=lower($3) AND lower(middle_name)=lower($4) AND ($2<>'' OR $3<>'' OR $4<>'')",
      [p.birth_date, p.first_name, p.last_name, p.middle_name],
    )
  ).rows;
  if (duplicates.length && body.allow_duplicate !== true) {
    for (const d of duplicates)
      d.parents = (
        await db.query(
          "SELECT p.*,p.birth_date::text FROM persons p JOIN parent_child_relationships r ON p.id=r.parent_id WHERE r.child_id=$1",
          [d.id],
        )
      ).rows;
    fail("Possible Existing Family Member", 409, { duplicates });
  }
  const keys = Object.keys(p);
  const person = (
    await db.query(
      `INSERT INTO persons(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING *,birth_date::text`,
      Object.values(p),
    )
  ).rows[0];
  if (relation) {
    if (relation.type === "spouse")
      await union(db, person.id, relation.person_id);
    else if (relation.type === "parent")
      await addParents(db, relation.person_id, [person.id]);
    else
      await addParents(db, person.id, [
        relation.person_id,
        ...(relation.other_parent_id ? [relation.other_parent_id] : []),
      ]);
  }
  return person;
}
