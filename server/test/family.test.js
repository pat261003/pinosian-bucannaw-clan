import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { embeddedDatabase, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";
import { importSnapshot } from "../src/transfer.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
let db, app;
before(async () => {
  db = embeddedDatabase(new PGlite());
  await migrate(db, { seedHeads: false });
  app = createApp(db);
});
after(async () => db.close());
test("backup import preserves identities and order, rolls back bad links, and refuses used databases", async () => {
  const source = embeddedDatabase(new PGlite()),
    destination = embeddedDatabase(new PGlite());
  try {
    await migrate(source);
    await migrate(destination);
    const api = createApp(source),
      heads = (await request(api).get("/api/heads")).body;
    const child = (
      await request(api)
        .post("/api/persons")
        .send({
          first_name: "Transfer child",
          gender: "Unknown",
          relation: { type: "child", person_id: heads[0].id },
        })
    ).body;
    await source.query("UPDATE persons SET sibling_order=1 WHERE id=$1", [
      child.id,
    ]);
    const data = {
      format: 1,
      people: (await source.query("SELECT *,birth_date::text FROM persons"))
        .rows,
      unions: (await source.query("SELECT * FROM unions")).rows,
      links: (await source.query("SELECT * FROM parent_child_relationships"))
        .rows,
      heads: (await source.query("SELECT * FROM clan_heads")).rows,
    };
    const bad = structuredClone(data);
    bad.links[0].parent_id = "00000000-0000-4000-8000-000000000000";
    await assert.rejects(() => importSnapshot(destination, bad));
    assert.equal(
      (await destination.query("SELECT count(*)::int AS n FROM persons"))
        .rows[0].n,
      2,
    );
    await importSnapshot(destination, data);
    const imported = (
      await request(createApp(destination)).get("/api/persons/" + child.id)
    ).body;
    assert.equal(imported.sibling_order, 1);
    assert.equal(imported.parents.length, 2);
    assert.equal(imported.gender, "Unknown");
    await assert.rejects(
      () => importSnapshot(destination, data),
      /destination already/,
    );
    await migrate(destination);
    assert.equal(
      (await destination.query("SELECT count(*)::int AS n FROM persons"))
        .rows[0].n,
      3,
    );
  } finally {
    await source.close();
    await destination.close();
  }
});
test("clan heads are seeded once, editable, and revision changes persist", async () => {
  const isolated = embeddedDatabase(new PGlite());
  try {
    await migrate(isolated);
    const service = createApp(isolated),
      heads = (await request(service).get("/api/heads")).body;
    assert.deepEqual(
      heads.map((p) => p.first_name),
      ["Pinosian", "Bucannaw"],
    );
    assert.ok(
      heads.every((p) => p.gender === "Unknown" && p.birth_date === null),
    );
    const revision = (await request(service).get("/api/revision")).body
      .revision;
    const update = await request(service)
      .put("/api/persons/" + heads[0].id)
      .send({ first_name: "Pinosian", gender: "Female" });
    assert.equal(update.status, 200);
    assert.notEqual(
      (await request(service).get("/api/revision")).body.revision,
      revision,
    );
    await migrate(isolated);
    assert.equal((await request(service).get("/api/stats")).body.members, 2);
    assert.equal(
      (await request(service).get("/api/persons/" + heads[0].id)).body.gender,
      "Female",
    );
    assert.equal(
      (await request(service).get("/api/persons/" + heads[0].id + "/spouses"))
        .body[0].id,
      heads[1].id,
    );
    for (const head of heads) {
      const child = await request(service)
        .post("/api/persons")
        .send({
          gender: "Female",
          relation: { type: "child", person_id: head.id },
        });
      assert.equal(child.status, 201);
      const parents = (
        await request(service).get("/api/persons/" + child.body.id + "/parents")
      ).body;
      assert.deepEqual(
        new Set(parents.map((p) => p.id)),
        new Set(heads.map((h) => h.id)),
      );
      assert.equal(
        (
          await request(service).delete(
            "/api/relationships/" + parents[0].relationship_id,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await request(service)
            .post("/api/persons")
            .send({
              gender: "Male",
              relation: { type: "spouse", person_id: head.id },
            })
        ).status,
        400,
      );
    }
    const outsider = (
      await request(service).post("/api/persons").send({ gender: "Male" })
    ).body;
    assert.equal(
      (
        await request(service)
          .post("/api/persons")
          .send({
            gender: "Female",
            relation: {
              type: "child",
              person_id: heads[0].id,
              other_parent_id: outsider.id,
            },
          })
      ).status,
      400,
    );
    const unlinked = (
      await request(service).post("/api/persons").send({ gender: "Female" })
    ).body;
    assert.equal(
      (
        await request(service)
          .post("/api/relationships/parent-child")
          .send({ parent_id: heads[1].id, child_id: unlinked.id })
      ).status,
      201,
    );
    assert.equal(
      (await request(service).get("/api/persons/" + unlinked.id + "/parents"))
        .body.length,
      2,
    );
  } finally {
    await isolated.close();
  }
});
const person = (first_name, gender = "Male") => ({
  first_name,
  last_name: "Test Family",
  birth_date: "1970-01-01",
  gender,
});
test("delete and move preserve other relatives, reject cycles, and protect heads", async () => {
  const database = embeddedDatabase(new PGlite());
  try {
    await migrate(database);
    const service = createApp(database),
      heads = (await request(service).get("/api/heads")).body;
    const create = async (first_name, relation) => {
      const r = await request(service)
        .post("/api/persons")
        .send({ first_name, gender: "Female", relation });
      assert.equal(r.status, 201);
      return r.body;
    };
    const target = await create("Wrong entry", {
      type: "child",
      person_id: heads[0].id,
    });
    const partner = await create("Surviving partner", {
      type: "spouse",
      person_id: target.id,
    });
    const child = await create("Surviving child", {
      type: "child",
      person_id: target.id,
      other_parent_id: partner.id,
    });
    const grandchild = await create("Surviving grandchild", {
      type: "child",
      person_id: child.id,
    });
    const otherParent = await create("Correct parent");
    const move = (id, parents) =>
      request(service)
        .put("/api/persons/" + id + "/parents")
        .send({ parent_ids: parents });
    assert.equal((await move(target.id, [otherParent.id])).status, 200);
    assert.deepEqual(
      (
        await request(service).get("/api/persons/" + target.id + "/parents")
      ).body.map((p) => p.id),
      [otherParent.id],
    );
    assert.equal((await move(target.id, [grandchild.id])).status, 400);
    assert.deepEqual(
      (
        await request(service).get("/api/persons/" + target.id + "/parents")
      ).body.map((p) => p.id),
      [otherParent.id],
    );
    assert.equal((await move(target.id, [heads[1].id])).status, 200);
    assert.equal(
      (await request(service).get("/api/persons/" + target.id + "/parents"))
        .body.length,
      2,
    );
    const revision = (await request(service).get("/api/revision")).body
      .revision;
    assert.equal(
      (await request(service).delete("/api/persons/" + target.id)).status,
      200,
    );
    assert.equal(
      (await request(service).get("/api/persons/" + target.id)).status,
      404,
    );
    assert.notEqual(
      (await request(service).get("/api/revision")).body.revision,
      revision,
    );
    for (const member of [partner, child, grandchild, otherParent, ...heads])
      assert.equal(
        (await request(service).get("/api/persons/" + member.id)).status,
        200,
      );
    assert.deepEqual(
      (
        await request(service).get("/api/persons/" + child.id + "/parents")
      ).body.map((p) => p.id),
      [partner.id],
    );
    assert.equal(
      (await request(service).get("/api/tree/" + partner.id)).body.family
        .partner,
      null,
    );
    assert.equal(
      (await request(service).get("/api/persons/" + grandchild.id + "/parents"))
        .body[0].id,
      child.id,
    );
    for (const head of heads) {
      assert.equal(
        (await request(service).delete("/api/persons/" + head.id)).status,
        409,
      );
      assert.equal((await move(head.id, [otherParent.id])).status, 409);
    }
  } finally {
    await database.close();
  }
});
const post = (path, body) =>
  request(app)
    .post("/api" + path)
    .send(body);
const get = (path) => request(app).get("/api" + path);
async function add(label, gender, relation) {
  const r = await post("/persons", { ...person(label, gender), relation });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
test("optional names and birth date; gender remains required; shared editing", async () => {
  assert.equal((await get("/stats")).body.members, 0);
  for (const body of [
    { gender: "Female" },
    { first_name: "Only first", gender: "Male" },
    { last_name: "Only surname", birth_date: "", gender: "Female" },
  ]) {
    const result = await post("/persons", body);
    assert.equal(result.status, 201, JSON.stringify(result.body));
    assert.equal(result.body.birth_date, null);
  }
  for (const body of [
    {},
    { gender: "" },
    { gender: "Male", birth_date: "2999-01-01" },
    { gender: "Female", birth_date: "2023-02-29" },
  ])
    assert.equal((await post("/persons", body)).status, 400);
});
for (const gender of ["Male", "Female"])
  test(`three partners, disjoint children, and ancestry with central ${gender}`, async () => {
    const central = await add("Central " + gender, gender),
      partners = [],
      children = [];
    for (let i = 0; i < 3; i++) {
      const spouse = await add(
        `Partner ${gender} ${i}`,
        gender === "Male" ? "Female" : "Male",
        { type: "spouse", person_id: central.id },
      );
      partners.push(spouse);
      const own = [];
      for (let j = 0; j < (i === 2 ? 1 : 2); j++)
        own.push(
          await add(`Child ${gender} ${i} ${j}`, "Female", {
            type: "child",
            person_id: central.id,
            other_parent_id: spouse.id,
          }),
        );
      children.push(own);
    }
    const details = (await get("/persons/" + central.id)).body;
    assert.equal(details.families.length, 3);
    for (let i = 0; i < 3; i++) {
      const family = details.families.find(
        (f) => f.partner.id === partners[i].id,
      );
      const listed = (await get(`/unions/${family.id}/children`)).body.items;
      assert.deepEqual(
        new Set(listed.map((p) => p.id)),
        new Set(children[i].map((p) => p.id)),
      );
      const tree = (await get(`/tree/${central.id}?union=${family.id}`)).body;
      assert.equal(tree.children.total, i === 2 ? 1 : 2);
      for (const child of children[i])
        assert.deepEqual(
          new Set(
            (await get(`/persons/${child.id}/parents`)).body.map((p) => p.id),
          ),
          new Set([central.id, partners[i].id]),
        );
    }
    const grandchild = await add("Grandchild " + gender, "Male", {
      type: "child",
      person_id: children[0][0].id,
    });
    assert.equal((await get("/persons/" + grandchild.id)).body.generation, 3);
    const incoming = await add("Incoming ancestor " + gender, "Male", {
      type: "parent",
      person_id: partners[0].id,
    });
    assert.equal((await get("/persons/" + central.id)).body.generation, 1);
    assert.ok(
      !(await get("/persons/" + central.id)).body.branches.includes(
        incoming.id,
      ),
    );
    assert.equal(
      (
        await post("/relationships/parent-child", {
          parent_id: grandchild.id,
          child_id: central.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/unions", {
          person1_id: partners[0].id,
          person2_id: central.id,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await post("/unions", {
          person1_id: central.id,
          person2_id: central.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/relationships/parent-child", {
          parent_id: central.id,
          child_id: central.id,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("/relationships/parent-child", {
          parent_id: central.id,
          child_id: children[0][0].id,
        })
      ).status,
      409,
    );
  });
test("complete a single-parent family later; edit, search, duplicates, and remove an incorrect link", async () => {
  const parent = await add("Single parent", "Female"),
    child = await add("Single child", "Male", {
      type: "child",
      person_id: parent.id,
    });
  let details = (await get("/persons/" + parent.id)).body;
  assert.equal(details.families[0].partner, null);
  const second = await add("Later parent", "Male");
  assert.equal(
    (
      await post("/relationships/parent-child", {
        parent_id: second.id,
        child_id: child.id,
      })
    ).status,
    201,
  );
  details = (await get("/persons/" + child.id)).body;
  assert.equal(details.parents.length, 2);
  assert.equal(
    (await get("/persons/" + parent.id)).body.families[0].child_count,
    1,
  );
  const third = await add("Third parent", "Male");
  assert.equal(
    (
      await post("/relationships/parent-child", {
        parent_id: third.id,
        child_id: child.id,
      })
    ).status,
    400,
  );
  const duplicate = await post("/persons", person("Single child"));
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.duplicates[0].parents.length, 2);
  assert.equal(
    (
      await post("/persons", {
        ...person("Single child"),
        allow_duplicate: true,
      })
    ).status,
    201,
  );
  assert.equal((await get("/search?q=SINGLE%20CH")).body.total, 2);
  const edited = await request(app)
    .put("/api/persons/" + child.id)
    .send({
      ...person("Edited child"),
      notes: "Preserved story",
      current_location: "Somewhere",
    });
  assert.equal(edited.status, 200);
  assert.equal(
    (await get("/persons/" + child.id)).body.notes,
    "Preserved story",
  );
  assert.equal(
    (
      await request(app).delete(
        "/api/relationships/" + details.parents[0].relationship_id,
      )
    ).status,
    200,
  );
  assert.equal((await get("/persons/" + child.id)).body.parents.length, 1);
});
test("failed mutations roll back the newly created person", async () => {
  const count = (await get("/stats")).body.members;
  const response = await post("/persons", {
    ...person("Rollback"),
    relation: {
      type: "child",
      person_id: "00000000-0000-4000-8000-000000000000",
    },
  });
  assert.equal(response.status, 404);
  assert.equal((await get("/stats")).body.members, count);
});
test("PostgreSQL engine persists records after closing and reopening the database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reunion-test-"));
  let persistent;
  try {
    persistent = embeddedDatabase(new PGlite(directory));
    await migrate(persistent, { seedHeads: false });
    await persistent.query(
      "INSERT INTO persons(first_name,last_name,birth_date,gender) VALUES($1,$2,$3,$4)",
      ["Persistence", "Test", "1970-01-01", "Female"],
    );
    await persistent.close();
    persistent = embeddedDatabase(new PGlite(directory));
    assert.equal(
      (await persistent.query("SELECT count(*)::int AS count FROM persons"))
        .rows[0].count,
      1,
    );
  } finally {
    await persistent?.close();
    if (
      dirname(resolve(directory)) === resolve(tmpdir()) &&
      basename(directory).startsWith("reunion-test-")
    )
      await rm(directory, { recursive: true, force: true });
  }
});

test("entry order, automatic birthdays, manual order, stale edits and union consistency", async () => {
  const isolated = embeddedDatabase(new PGlite());
  try {
    await migrate(isolated);
    const service = createApp(isolated),
      heads = (await request(service).get("/api/heads")).body;
    const make = async (first_name, birth_date = null, relation) => {
      const r = await request(service)
        .post("/api/persons")
        .send({ first_name, gender: "Unknown", birth_date, relation });
      assert.equal(r.status, 201, JSON.stringify(r.body));
      return r.body;
    };
    const z = await make("Z root"),
      a = await make("A root");
    const roots = (await request(service).get("/api/branches")).body.items;
    assert.ok(
      roots.findIndex((p) => p.id === z.id) <
        roots.findIndex((p) => p.id === a.id),
    );
    const relation = { type: "child", person_id: heads[0].id };
    const unknown = await make("Z child", null, relation),
      young = await make("A child", "2000-01-01", relation),
      old = await make("B child", "1980-01-01", relation),
      tie = await make("C child", "1980-01-01", relation);
    const path = "/api/persons/" + heads[0].id;
    const children = async () =>
      (await request(service).get(path + "/children")).body.items;
    assert.deepEqual(
      (await children()).map((p) => p.id),
      [old.id, tie.id, young.id, unknown.id],
    );
    const union_id = (await children())[0].union_id,
      child_ids = [unknown.id, young.id, tie.id, old.id];
    assert.equal(
      (
        await request(service)
          .put(path + "/child-order")
          .send({ union_id, child_ids })
      ).status,
      200,
    );
    assert.deepEqual(
      (await children()).map((p) => p.id),
      child_ids,
    );
    assert.deepEqual(
      (
        await request(service).get("/api/unions/" + union_id + "/children")
      ).body.items.map((p) => p.id),
      child_ids,
    );
    assert.deepEqual(
      (
        await request(service).get("/api/persons/" + heads[1].id + "/children")
      ).body.items.map((p) => p.id),
      child_ids,
    );
    assert.equal(
      (
        await request(service)
          .put(path + "/child-order")
          .send({
            union_id,
            child_ids: [unknown.id, unknown.id, tie.id, old.id],
          })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(service)
          .put(path + "/child-order")
          .send({ union_id, child_ids, automatic: true })
      ).status,
      200,
    );
    assert.deepEqual(
      (await children()).map((p) => p.id),
      [old.id, tie.id, young.id, unknown.id],
    );
    const added = await make("New arrival", null, relation);
    assert.equal(
      (
        await request(service)
          .put(path + "/child-order")
          .send({ union_id, child_ids })
      ).status,
      409,
    );
    assert.equal((await children()).at(-1).id, added.id);
    await request(service)
      .put(path + "/child-order")
      .send({ union_id, child_ids: [...child_ids, added.id] })
      .expect(200);
    await request(service)
      .put("/api/persons/" + unknown.id + "/parents")
      .send({ parent_ids: [z.id] })
      .expect(200);
    assert.equal(
      (await request(service).get("/api/persons/" + unknown.id)).body
        .sibling_order,
      null,
    );
    assert.equal(
      (await request(service).get(path + "/children?offset=Infinity&limit=NaN"))
        .status,
      200,
    );
  } finally {
    await isolated.close();
  }
});
