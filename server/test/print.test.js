import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { graph } from "../src/model.js";
import { printReport } from "../src/print.js";
import { createApp } from "../src/app.js";
import request from "supertest";

test("printing includes 500 descendants without pagination, preserves order, and excludes a partner’s unrelated child", async () => {
  const people = Array.from({ length: 504 }, (_, i) => ({
    id: randomUUID(),
    first_name: "Person " + i,
    last_name: "",
    entry_order: i,
    gender: "Unknown",
    birth_date: null,
  }));
  const links = [];
  for (let i = 1; i <= 500; i++)
    links.push({
      id: randomUUID(),
      parent_id: people[i <= 20 ? 0 : Math.floor((i - 21) / 4) + 1].id,
      child_id: people[i].id,
      union_id: null,
    });
  // One partnership's child; partner has another child elsewhere.
  const unions = [
    { id: randomUUID(), person1_id: people[0].id, person2_id: people[501].id },
  ];
  links[0].union_id = unions[0].id;
  links.push({
    id: randomUUID(),
    parent_id: people[501].id,
    child_id: people[1].id,
    union_id: unions[0].id,
  });
  links.push({
    id: randomUUID(),
    parent_id: people[501].id,
    child_id: people[502].id,
    union_id: null,
  });
  people[2].sibling_order = 1;
  const db = { query: async () => ({ rows: [{ people, unions, links }] }) };
  const g = await graph(db),
    report = printReport(g, people[0].id);
  assert.equal(report.descendant_count, 500);
  assert.equal(report.member_count, 502);
  assert.ok(
    !report.people.some(
      (p) => p.id === people[502].id || p.id === people[503].id,
    ),
  );
  assert.equal(
    report.families.find((f) => f.id === "single-" + people[0].id).children[0],
    people[2].id,
  );
  assert.equal(new Set(report.families.flatMap((f) => f.children)).size, 500);
  assert.equal(report.families.filter((f) => f.id === unions[0].id).length, 1);
  const all = printReport(g);
  assert.equal(all.member_count, 504);
  const solo = printReport(g, people[503].id);
  assert.equal(solo.families.length, 1);
  assert.equal(solo.descendant_count, 0);
  await request(createApp(db)).get("/api/print?root=invalid").expect(400);
  await request(createApp(db))
    .get("/api/print?root=" + randomUUID())
    .expect(404);
  const result = await request(createApp(db))
    .get("/api/print?root=" + people[0].id)
    .expect(200);
  assert.equal(result.body.descendant_count, 500);
});
