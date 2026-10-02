import pg from "pg";
import { readFile } from "node:fs/promises";
export function poolOptions(env = process.env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
  const neon = url.hostname.endsWith(".neon.tech");
  if (neon || env.DATABASE_SSL === "true")
    url.searchParams.set("sslmode", "verify-full");
  return {
    connectionString: url.toString(),
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 30000,
    enableChannelBinding: true,
  };
}
export async function createDatabase() {
  if (process.env.DATABASE_URL) {
    const pool = new pg.Pool(poolOptions());
    // Sleeping databases may close idle connections; pg discards them and reconnects.
    pool.on("error", () =>
      console.warn(
        "An idle database connection closed; the next request will reconnect.",
      ),
    );
    return {
      query: (...args) => pool.query(...args),
      transaction: async (fn) => {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          await c.query(
            "LOCK TABLE persons, unions, parent_child_relationships IN SHARE ROW EXCLUSIVE MODE",
          );
          const result = await fn(c);
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
      close: () => pool.end(),
    };
  }
  if (
    process.env.NODE_ENV === "production" ||
    process.env.LOCAL_DATABASE !== "true"
  )
    throw new Error(
      "Set DATABASE_URL, or explicitly enable LOCAL_DATABASE=true for local development.",
    );
  const { PGlite } = await import("@electric-sql/pglite");
  return embeddedDatabase(
    new PGlite(process.env.LOCAL_DB_PATH || "./.local-db"),
  );
}
export function embeddedDatabase(db) {
  return {
    query: (...args) => db.query(...args),
    exec: (sql) => db.exec(sql),
    transaction: (fn) => db.transaction(fn),
    close: () => db.close(),
  };
}
export async function migrate(db, { seedHeads = true } = {}) {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");
  if (db.exec) await db.exec(sql);
  else await db.query(sql);
  if (seedHeads)
    await db.transaction(async (c) => {
      if (
        (
          await c.query(
            "SELECT 1 FROM app_migrations WHERE id='002_clan_heads'",
          )
        ).rows.length
      )
        return;
      const first = "a1715ea1-701a-4412-9000-000000000001",
        second = "a1715ea1-701a-4412-9000-000000000002";
      await c.query(
        "INSERT INTO persons(id,first_name,last_name,birth_date,gender) VALUES($1,'Pinosian','',NULL,'Unknown'),($2,'Bucannaw','',NULL,'Unknown')",
        [first, second],
      );
      await c.query("INSERT INTO unions(person1_id,person2_id) VALUES($1,$2)", [
        first,
        second,
      ]);
      await c.query(
        "INSERT INTO clan_heads(person_id,position) VALUES($1,1),($2,2)",
        [first, second],
      );
      await c.query("INSERT INTO app_migrations(id) VALUES('002_clan_heads')");
    });
}
