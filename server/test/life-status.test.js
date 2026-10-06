import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import request from "supertest";
import { embeddedDatabase, migrate } from "../src/db.js";
import { createApp } from "../src/app.js";

test("living status migration is one-time, edits persist and immediate printing excludes grandchildren", async () => {
  const db = embeddedDatabase(new PGlite());
  try {
    await migrate(db);
    const app = createApp(db);
    const heads = (await request(app).get("/api/heads")).body;
    assert.ok(heads.every((p) => p.life_status === "Deceased"));
    const add = async (first_name, relation, life_status) =>
      (
        await request(app)
          .post("/api/persons")
          .send({
            first_name,
            gender: "Unknown",
            ...(relation ? { relation } : {}),
            ...(life_status ? { life_status } : {}),
          })
          .expect(201)
      ).body;
    const child = await add("Child", { type: "child", person_id: heads[0].id });
    const partner = await add(
      "Partner",
      { type: "spouse", person_id: child.id },
      "Living",
    );
    const grandchild = await add(
      "Grandchild",
      { type: "child", person_id: child.id, other_parent_id: partner.id },
      "Living",
    );
    const great = await add("Great grandchild", {
      type: "child",
      person_id: grandchild.id,
    });
    assert.equal(child.life_status, "Unknown");
    // Simulate upgrading an existing clan that already has the heads' children.
    await db.query("DELETE FROM app_migrations WHERE id='003_living_status'");
    await migrate(db);
    assert.equal(
      (await request(app).get("/api/persons/" + child.id)).body.life_status,
      "Deceased",
    );
    assert.equal(
      (await request(app).get("/api/persons/" + grandchild.id)).body
        .life_status,
      "Living",
    );
    await request(app)
      .put("/api/persons/" + child.id)
      .send({ first_name: "Child", gender: "Unknown", life_status: "Living" })
      .expect(200);
    await migrate(db);
    assert.equal(
      (await request(app).get("/api/persons/" + child.id)).body.life_status,
      "Living",
    );
    // Cached older clients must not erase a confirmed status.
    await request(app)
      .put("/api/persons/" + child.id)
      .send({ first_name: "Child edited", gender: "Unknown" })
      .expect(200);
    assert.equal(
      (await request(app).get("/api/persons/" + child.id)).body.life_status,
      "Living",
    );
    await request(app)
      .put("/api/persons/" + child.id)
      .send({ gender: "Unknown", life_status: "Maybe" })
      .expect(400);
    const immediate = (
      await request(app)
        .get("/api/print?root=" + child.id + "&scope=immediate")
        .expect(200)
    ).body;
    assert.equal(immediate.scope, "immediate");
    assert.deepEqual(
      new Set(immediate.people.map((p) => p.id)),
      new Set([child.id, partner.id, grandchild.id]),
    );
    assert.equal(immediate.descendant_count, 1);
    assert.ok(immediate.people.every((p) => p.life_status === "Living"));
    const full = (
      await request(app)
        .get("/api/print?root=" + child.id)
        .expect(200)
    ).body;
    assert.ok(full.people.some((p) => p.id === great.id));
    await request(app).get("/api/print?scope=immediate").expect(400);
    await request(app).get("/api/print?scope=invalid").expect(400);
  } finally {
    await db.close();
  }
});
