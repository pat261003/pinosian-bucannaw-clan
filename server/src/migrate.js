import { createDatabase, migrate } from "./db.js";
const db = await createDatabase();
try {
  await migrate(db);
  console.log("Database schema and initial clan heads are ready. Existing edits are preserved.");
} finally {
  await db.close();
}
