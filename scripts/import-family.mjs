import { readFile } from "node:fs/promises";
import { createDatabase, migrate } from "../server/src/db.js";
import { importSnapshot } from "../server/src/transfer.js";
if (!process.env.DATABASE_URL || process.env.NODE_ENV !== "production")
  throw new Error(
    "Use your Neon DATABASE_URL and NODE_ENV=production in .env.neon for this import.",
  );
const path = process.argv[2];
if (!path) throw new Error("Supply the backup JSON path.");
const data = JSON.parse(await readFile(path, "utf8"));
const db = await createDatabase();
try {
  await migrate(db);
  await importSnapshot(db, data);
  console.log(`Imported ${data.people.length} family members successfully.`);
} finally {
  await db.close();
}
