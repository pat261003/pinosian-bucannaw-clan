import { personSchema, idSchema } from "./model.js";

// Offline import only. Refuse to replace a database already used by the family.
export async function importSnapshot(db, data) {
  if (
    data.format !== 1 ||
    !Array.isArray(data.people) ||
    data.heads?.length !== 2
  )
    throw new Error("This is not a supported family backup.");
  for (const p of data.people) {
    idSchema.parse(p.id);
    personSchema.parse(p);
  }
  await db.transaction(async (c) => {
    const occupied = (
      await c.query(`SELECT id FROM persons WHERE id NOT IN (SELECT person_id FROM clan_heads)
      UNION SELECT person1_id FROM unions WHERE person1_id NOT IN (SELECT person_id FROM clan_heads)
      UNION SELECT child_id FROM parent_child_relationships`)
    ).rows;
    const edited = (
      await c.query("SELECT 1 FROM persons WHERE updated_at<>created_at")
    ).rows;
    if (occupied.length || edited.length)
      throw new Error(
        "Import stopped: the destination already has family records or edited heads. Nothing was replaced.",
      );
    await c.query("DELETE FROM clan_heads");
    await c.query("DELETE FROM unions");
    await c.query("DELETE FROM persons");
    for (const p of data.people) {
      const values = {
        id: p.id,
        ...personSchema.parse(p),
        created_at: p.created_at,
        updated_at: p.updated_at,
        entry_order: p.entry_order,
        sibling_order: p.sibling_order ?? null,
      };
      const keys = Object.keys(values);
      await c.query(
        `INSERT INTO persons(${keys.join(",")}) VALUES(${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
        Object.values(values),
      );
    }
    for (const u of data.unions)
      await c.query(
        "INSERT INTO unions(id,person1_id,person2_id) VALUES($1,$2,$3)",
        [u.id, u.person1_id, u.person2_id],
      );
    for (const r of data.links)
      await c.query(
        "INSERT INTO parent_child_relationships(id,parent_id,child_id,union_id) VALUES($1,$2,$3,$4)",
        [r.id, r.parent_id, r.child_id, r.union_id],
      );
    for (const h of data.heads)
      await c.query(
        "INSERT INTO clan_heads(person_id,position) VALUES($1,$2)",
        [h.person_id, h.position],
      );
    await c.query(
      "SELECT setval('person_entry_sequence',(SELECT COALESCE(max(entry_order),0)+1 FROM persons),false)",
    );
  });
}
