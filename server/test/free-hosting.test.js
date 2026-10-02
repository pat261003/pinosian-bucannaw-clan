import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import pg from "pg";
import { poolOptions } from "../src/db.js";
import { createApp } from "../src/app.js";

test("platform health probes never query or wake the database", async () => {
  let queries = 0;
  const app = createApp({
    query: async () => {
      queries++;
      throw new Error("Database asleep");
    },
  });
  await request(app).get("/api/health").expect(200, { status: "ok" });
  assert.equal(queries, 0);
});

test("Neon direct and pooled URLs enable verified TLS with a small idle pool", () => {
  for (const host of ["ep-example.neon.tech", "ep-example-pooler.neon.tech"]) {
    const options = poolOptions({
      DATABASE_URL: `postgresql://user:encoded%40password@${host}/neondb?sslmode=require&channel_binding=require`,
    });
    const client = new pg.Client(options);
    assert.notEqual(client.connectionParameters.ssl, false);
    assert.notEqual(client.connectionParameters.ssl.rejectUnauthorized, false);
    assert.equal(client.connectionParameters.password, "encoded@password");
    assert.equal(
      new URL(options.connectionString).searchParams.get("sslmode"),
      "verify-full",
    );
    assert.equal(options.max, 3);
    assert.equal(options.idleTimeoutMillis, 10000);
  }
  const local = poolOptions({
    DATABASE_URL: "postgresql://user:password@localhost/reunion",
  });
  assert.equal(
    new URL(local.connectionString).searchParams.has("sslmode"),
    false,
  );
  const required = poolOptions({
    DATABASE_URL:
      "postgresql://user:password@db.example/reunion?sslmode=disable",
    DATABASE_SSL: "true",
  });
  assert.equal(
    new URL(required.connectionString).searchParams.get("sslmode"),
    "verify-full",
  );
  assert.throws(
    () => poolOptions({ DATABASE_URL: "secret-invalid-value" }),
    (e) => !e.message.includes("secret-invalid-value"),
  );
});
