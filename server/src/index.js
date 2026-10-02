import { createDatabase, migrate } from "./db.js";
import { createApp } from "./app.js";
const db = await createDatabase();
await migrate(db);
const server = createApp(db).listen(process.env.PORT || 3001, () =>
  console.log("Reunion API is ready."),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(async () => {
      await db.close();
      process.exit(0);
    }),
  );
