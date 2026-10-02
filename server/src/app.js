import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { printReport } from "./print.js";
import {
  graph,
  fail,
  idSchema,
  personSchema,
  createPerson,
  union,
  addParents,
  ensurePerson,
} from "./model.js";
export function createApp(db) {
  const app = express();
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(
    cors({
      origin: (origin, cb) =>
        cb(
          null,
          !origin ||
            (process.env.FRONTEND_URL || "http://localhost:5173")
              .split(",")
              .map((s) => s.trim())
              .includes(origin),
        ),
    }),
  );
  app.use(express.json({ limit: "32kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  // Process liveness only: platform probes must not prevent Neon from sleeping.
  // Startup migrations establish database connectivity; /api/heads verifies it on demand.
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });
  app.get("/api/revision", async (req, res) =>
    res.json(
      (await db.query("SELECT revision::text FROM tree_revision WHERE id=1"))
        .rows[0],
    ),
  );
  app.get("/api/heads", async (req, res) =>
    res.json(
      (
        await db.query(
          "SELECT p.*,p.birth_date::text FROM persons p JOIN clan_heads h ON h.person_id=p.id ORDER BY h.position",
        )
      ).rows,
    ),
  );
  const page = (req, items) => {
    const offset = Math.max(
        0,
        Math.min(10000000, Math.floor(Number(req.query.offset)) || 0),
      ),
      limit = Math.min(
        100,
        Math.max(1, Math.floor(Number(req.query.limit)) || 30),
      );
    return {
      items: items.slice(offset, offset + limit),
      total: items.length,
      offset,
      limit,
    };
  };
  app.get(
    ["/api/persons", "/api/search", "/api/branches"],
    async (req, res) => {
      const g = await graph(db),
        q = String(req.query.q || "")
          .toLowerCase()
          .trim();
      let people = g.people.filter((p) =>
        p.full_name.toLowerCase().includes(q),
      );
      if (req.path === "/api/branches" || req.query.roots === "true")
        people = people.filter((p) => g.roots.includes(p.id));
      if (req.query.branch)
        people = people.filter((p) => p.branches.includes(req.query.branch));
      res.json(page(req, people));
    },
  );
  app.get("/api/stats", async (req, res) => {
    const g = await graph(db);
    res.json({
      members: g.people.length,
      unions: g.unions.length,
      generations: g.people.reduce((n, p) => Math.max(n, p.generation), 0),
      branches: g.roots.length,
    });
  });
  app.get("/api/print", async (req, res) => {
    const root = req.query.root ? idSchema.parse(req.query.root) : null;
    res.json(printReport(await graph(db), root));
  });
  function detail(g, id) {
    const p = g.byId.get(id);
    if (!p) fail("Family member not found.", 404);
    const ancestorIds = new Set(),
      pending = [id];
    for (let i = 0; i < pending.length; i++)
      for (const link of g.links)
        if (link.child_id === pending[i] && !ancestorIds.has(link.parent_id)) {
          ancestorIds.add(link.parent_id);
          pending.push(link.parent_id);
        }
    const links = g.links.filter((r) => r.parent_id === id),
      unions = g.unions.filter((u) =>
        [u.person1_id, u.person2_id].includes(id),
      );
    return {
      ...p,
      ancestor_ids: [...ancestorIds],
      branch_names: p.branches.map((id) => ({
        id,
        name: g.byId.get(id).full_name,
      })),
      parents: g.links
        .filter((r) => r.child_id === id)
        .map((r) => ({ ...g.byId.get(r.parent_id), relationship_id: r.id })),
      families: [
        ...unions.map((u) => ({
          id: u.id,
          partner: g.byId.get(
            u.person1_id === id ? u.person2_id : u.person1_id,
          ),
          child_count: links.filter((r) => r.union_id === u.id).length,
        })),
        ...(links.some((r) => !r.union_id)
          ? [
              {
                id: null,
                partner: null,
                child_count: links.filter((r) => !r.union_id).length,
              },
            ]
          : []),
      ],
    };
  }
  app.get("/api/persons/:id", async (req, res) => {
    idSchema.parse(req.params.id);
    res.json(detail(await graph(db), req.params.id));
  });
  app.get("/api/persons/:id/:kind", async (req, res) => {
    const g = await graph(db),
      p = detail(g, req.params.id);
    switch (req.params.kind) {
      case "parents":
        res.json(p.parents);
        break;
      case "spouses":
        res.json(p.families.filter((f) => f.partner).map((f) => f.partner));
        break;
      case "unions":
        res.json(p.families);
        break;
      case "children":
        res.json(
          page(
            req,
            g.links
              .filter(
                (r) =>
                  r.parent_id === p.id &&
                  (!("union" in req.query) ||
                    String(r.union_id || "single") === req.query.union),
              )
              .map((r) => ({
                ...g.byId.get(r.child_id),
                union_id: r.union_id,
              })),
          ),
        );
        break;
      default:
        fail("Route not found.", 404);
    }
  });
  app.get("/api/unions/:id", async (req, res) => {
    const g = await graph(db),
      u = g.unions.find((u) => u.id === req.params.id);
    if (!u) fail("Family union not found.", 404);
    res.json({
      ...u,
      parents: [g.byId.get(u.person1_id), g.byId.get(u.person2_id)],
    });
  });
  app.get("/api/unions/:id/children", async (req, res) => {
    const g = await graph(db);
    if (!g.unions.some((u) => u.id === req.params.id))
      fail("Family union not found.", 404);
    res.json(
      page(
        req,
        [
          ...new Set(
            g.links
              .filter((r) => r.union_id === req.params.id)
              .map((r) => r.child_id),
          ),
        ].map((id) => g.byId.get(id)),
      ),
    );
  });
  app.get("/api/tree/:id", async (req, res) => {
    const g = await graph(db),
      p = detail(g, req.params.id);
    const family =
      p.families.find((f) => String(f.id || "single") === req.query.union) ||
      p.families[0] ||
      null;
    const children = page(
      req,
      g.links
        .filter(
          (r) => r.parent_id === p.id && r.union_id === (family?.id || null),
        )
        .map((r) => g.byId.get(r.child_id)),
    );
    res.json({ person: p, parents: p.parents, family, children });
  });
  app.post("/api/persons", async (req, res) =>
    res
      .status(201)
      .json(await db.transaction((c) => createPerson(c, req.body))),
  );
  app.put("/api/persons/:id/child-order", async (req, res) => {
    const parent = idSchema.parse(req.params.id);
    const body = z
      .object({
        union_id: idSchema.nullable(),
        child_ids: z.array(idSchema).max(500),
        automatic: z.boolean().default(false),
      })
      .parse(req.body);
    await db.transaction(async (c) => {
      await ensurePerson(c, parent);
      const current = (
        await c.query(
          "SELECT child_id FROM parent_child_relationships WHERE parent_id=$1 AND union_id IS NOT DISTINCT FROM $2::uuid",
          [parent, body.union_id],
        )
      ).rows.map((r) => r.child_id);
      if (
        new Set(body.child_ids).size !== body.child_ids.length ||
        current.length !== body.child_ids.length ||
        current.some((id) => !body.child_ids.includes(id))
      )
        fail(
          "This family changed or the list contains repeated children. Close this list and open Arrange children again before saving.",
          409,
        );
      for (let i = 0; i < body.child_ids.length; i++)
        await c.query(
          "UPDATE persons SET sibling_order=$1,updated_at=now() WHERE id=$2",
          [body.automatic ? null : i + 1, body.child_ids[i]],
        );
    });
    res.json({ ok: true });
  });
  app.put("/api/persons/:id/parents", async (req, res) => {
    const child = idSchema.parse(req.params.id),
      { parent_ids } = z
        .object({ parent_ids: z.array(idSchema).min(1).max(2) })
        .parse(req.body);
    await db.transaction(async (c) => {
      await ensurePerson(c, child);
      if (
        (await c.query("SELECT 1 FROM clan_heads WHERE person_id=$1", [child]))
          .rows.length
      )
        fail("The clan heads cannot be moved to another family.", 409);
      await c.query(
        "DELETE FROM parent_child_relationships WHERE child_id=$1",
        [child],
      );
      await addParents(c, child, parent_ids);
      await c.query("UPDATE persons SET sibling_order=NULL WHERE id=$1", [
        child,
      ]);
    });
    res.json({ ok: true });
  });
  app.delete("/api/persons/:id", async (req, res) => {
    const id = idSchema.parse(req.params.id);
    await db.transaction(async (c) => {
      await ensurePerson(c, id);
      if (
        (await c.query("SELECT 1 FROM clan_heads WHERE person_id=$1", [id]))
          .rows.length
      )
        fail(
          "Pinosian and Bucannaw are protected clan heads and cannot be deleted.",
          409,
        );
      // Keep surviving relatives and their explicit parent links; remove only this person's links.
      await c.query(
        "UPDATE parent_child_relationships SET union_id=NULL WHERE union_id IN (SELECT id FROM unions WHERE person1_id=$1 OR person2_id=$1)",
        [id],
      );
      await c.query(
        "DELETE FROM parent_child_relationships WHERE parent_id=$1 OR child_id=$1",
        [id],
      );
      await c.query("DELETE FROM unions WHERE person1_id=$1 OR person2_id=$1", [
        id,
      ]);
      await c.query("DELETE FROM persons WHERE id=$1", [id]);
    });
    res.json({ ok: true });
  });
  app.put("/api/persons/:id", async (req, res) => {
    const p = personSchema.parse(req.body);
    res.json(
      await db.transaction(async (c) => {
        await ensurePerson(c, req.params.id);
        const keys = Object.keys(p);
        return (
          await c.query(
            `UPDATE persons SET ${keys.map((k, i) => k + "=$" + (i + 1)).join(",")},updated_at=now() WHERE id=$${keys.length + 1} RETURNING *,birth_date::text`,
            [...Object.values(p), req.params.id],
          )
        ).rows[0];
      }),
    );
  });
  app.post("/api/unions", async (req, res) => {
    const b = z
      .object({ person1_id: idSchema, person2_id: idSchema })
      .parse(req.body);
    res
      .status(201)
      .json(await db.transaction((c) => union(c, b.person1_id, b.person2_id)));
  });
  app.post("/api/unions/:id/children", async (req, res) => {
    const child = idSchema.parse(req.body.child_id);
    res.status(201).json(
      await db.transaction(async (c) => {
        const u = (
          await c.query("SELECT * FROM unions WHERE id=$1", [
            idSchema.parse(req.params.id),
          ])
        ).rows[0];
        if (!u) fail("Family union not found.", 404);
        await addParents(c, child, [u.person1_id, u.person2_id]);
        return { ok: true };
      }),
    );
  });
  app.post("/api/relationships/parent-child", async (req, res) => {
    const b = z
      .object({
        parent_id: idSchema,
        child_id: idSchema,
        other_parent_id: idSchema.optional(),
      })
      .parse(req.body);
    res.status(201).json(
      await db.transaction(async (c) => {
        await addParents(c, b.child_id, [
          b.parent_id,
          ...(b.other_parent_id ? [b.other_parent_id] : []),
        ]);
        return { ok: true };
      }),
    );
  });
  app.delete("/api/relationships/:id", async (req, res) => {
    idSchema.parse(req.params.id);
    await db.transaction(async (c) => {
      if (
        (
          await c.query(
            "SELECT 1 FROM parent_child_relationships r JOIN clan_heads h ON h.person_id=r.parent_id WHERE r.id=$1",
            [req.params.id],
          )
        ).rows.length
      )
        fail(
          "A child of the clan heads must remain connected to both parents.",
          409,
        );
      const r = (
        await c.query(
          "DELETE FROM parent_child_relationships WHERE id=$1 RETURNING child_id",
          [req.params.id],
        )
      ).rows[0];
      if (!r) fail("Relationship not found.", 404);
      await c.query(
        "UPDATE parent_child_relationships SET union_id=NULL WHERE child_id=$1",
        [r.child_id],
      );
    });
    res.json({ ok: true });
  });
  app.delete("/api/unions/:id", async (req, res) => {
    idSchema.parse(req.params.id);
    await db.transaction(async (c) => {
      if (
        (
          await c.query(
            "SELECT 1 FROM unions u JOIN clan_heads h ON h.person_id=u.person1_id OR h.person_id=u.person2_id WHERE u.id=$1",
            [req.params.id],
          )
        ).rows.length
      )
        fail("The partnership between the clan heads cannot be removed.", 409);
      if (
        (
          await c.query(
            "SELECT 1 FROM parent_child_relationships WHERE union_id=$1 LIMIT 1",
            [req.params.id],
          )
        ).rows.length
      )
        fail(
          "Remove or correct the parent links before removing a partnership with children.",
          409,
        );
      const result = await c.query(
        "DELETE FROM unions WHERE id=$1 RETURNING id",
        [req.params.id],
      );
      if (!result.rows.length) fail("Partnership not found.", 404);
    });
    res.json({ ok: true });
  });
  app.use((req, res) => res.status(404).json({ error: "Route not found." }));
  app.use((e, req, res, next) => {
    if (e instanceof z.ZodError)
      return res.status(400).json({
        error: e.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
    if (["23514", "23505", "23503"].includes(e.code))
      return res.status(400).json({
        error:
          e.code === "23505"
            ? "This relationship already exists."
            : e.code === "23503"
              ? "A referenced family member no longer exists."
              : e.message,
      });
    if (e.type === "entity.too.large")
      return res.status(413).json({ error: "This request is too large." });
    if (e instanceof SyntaxError)
      return res.status(400).json({ error: "Invalid JSON request." });
    if (!e.status) console.error(e);
    res.status(e.status || 500).json({
      error: e.status
        ? e.message
        : "Unable to complete the request. Please try again.",
      ...(e.duplicates ? { duplicates: e.duplicates } : {}),
    });
  });
  return app;
}
