# Pinosian Bucannaw Clan

For the full beginner walkthrough, including transferring existing family records, see [DEPLOYMENT.md](DEPLOYMENT.md).

A shared family tree with React + Vite, Express, and PostgreSQL. The supplied clan logo is bundled in `client/public/clan-logo.png`; the interface uses light ivory, cream, and gold. Everyone visiting the site can add and edit records. There is no login, editor password, cookie-based member storage, or browser-only family database.

## One screen on phone and desktop

Search, browse members, view the tree and edit relatives from one screen, without navigation tabs. Search results appear above the tree. Choose a name, then **Add a relative**. Mobile forms use one column with larger text and touch targets. **Display** changes between Generation tree and Simple tree. **Full screen** opens a tree-only view for reunions with zoom controls and an **Exit full screen** button; browsers without native fullscreen use the full available viewport. Printing remains beside Full screen.

## Starting heads and member details

Pinosian and Bucannaw are inserted as partners once by the database migration, with no surnames or birthdays and gender **Unknown** until the clan supplies those details. The default tree opens on their family. Their records can be edited in the app; restarting or redeploying never resets those edits or duplicates the heads. Existing family data is preserved during upgrades.

First name, middle name, surname, suffix, and birthday are optional. Gender is required when creating a member. A supplied birthday must be a real date that is not in the future. Nameless members receive a stable display label containing part of their unique database ID, so different unknown people can still be distinguished. Unknown is available for every member; a gender choice is still required.

## Shared, permanent storage

Every person, partnership, and parent-child link is saved on the server in PostgreSQL. Cookies, local storage, and session storage are not used for family records. All deployed visitors use the same backend and database. The browser checks a database revision every 10 seconds while visible and recently active, and when returning to the tab; another visitor's changes appear automatically. Polling pauses after two minutes without interaction so unattended tabs can let Neon sleep. Interaction resumes polling. Unsaved forms stay open during refreshes.

Production must use a managed PostgreSQL `DATABASE_URL`. Render's service filesystem is not used for production family storage. The optional local preview database is server-side PGlite with disk persistence, not a browser database; it is disabled in production.

## Local development

Requires Node.js 22.16+ and npm.

```sh
npm ci
```

Copy `server/.env.example` to `server/.env` and supply your PostgreSQL connection string. For the existing local preview, `LOCAL_DATABASE=true` is already configured: omit `DATABASE_URL` to use persistent PGlite under `server/.local-db`.

```sh
npm run dev
```

Open http://127.0.0.1:5173. The frontend proxies `/api` to port 3001. Set `FRONTEND_URL=http://localhost:5173,http://127.0.0.1:5173` for both local hostnames. Open either clan head and use **Add relative → Child** to begin adding their descendants. Both founding heads are automatically recorded for their children; for other members select the correct other parent.

```sh
npm run build
npm test
npm run migrate -w server
```

The idempotent schema upgrade and one-time heads migration run at API startup. They preserve existing member details and relationships. `.env`, local database files, dependencies, and test screenshots are ignored by Git.

## Free hosting: Neon + Render

1. Create a **Neon Free** project and copy its direct PostgreSQL URL from Connect (pooling off).
2. Push the code to GitHub and create a Render Blueprint. `render.yaml` creates only a **Free web service**, with no Render database or paid disk.
3. Supply the Neon URL as `DATABASE_URL`, and your Vercel origin as `FRONTEND_URL` (localhost temporarily until Vercel is ready). The Blueprint enables verified TLS and production mode.
4. `/api/health` checks process liveness without querying Neon. `/api/heads` verifies database access. The pool uses at most three connections and releases idle connections after ten seconds.
5. Transfer local records to the fresh Neon database with the export/import scripts; see [DEPLOYMENT.md](DEPLOYMENT.md).

Manual settings: instance **Free**, build `npm ci --workspace server --include-workspace-root`, start `npm run start -w server`. Supply `DATABASE_URL`, `DATABASE_SSL=true`, `FRONTEND_URL` and `NODE_ENV=production`. No local database in production.

This can cost $0 within free allowances. Render sleeps after inactivity; cold starts can take about a minute. Neon Free has storage, compute and transfer quotas. Stay on free plans and use provider domains. Render can bill excess bandwidth/build usage when a payment method is present; without one it suspends access/builds at the limits. The deployment guide explains the account settings.

## Vercel Hobby frontend (free)

1. Use a personal Hobby account and import the same repository with the repository root as the Root Directory.
2. `vercel.json` sets `npm run build` and output directory `client/dist`.
3. Set `VITE_API_URL=https://YOUR-API.onrender.com`, without an `/api` suffix. Never put database credentials in a `VITE_` variable.
4. Deploy, then add the final Vercel origin to Render's `FRONTEND_URL`.
5. Open the site in two separate browsers. Add a relative in one; the other should show the addition within about 10 seconds. Reload both to verify persistence.

Changing `VITE_API_URL` requires a frontend rebuild. Family edits never require redeployment. The shared link allows viewing and editing by anyone who receives it, as requested.

## Relationships and integrity

Use **Change parents / family** on a person's details to correct their branch without losing their own partners, descendants, or details. Selecting either clan head assigns both as parents. Moves are atomic and reject ancestry cycles. **Delete person** shows a confirmation with the person's name; it permanently removes only that person and their links. Surviving partners, children, grandchildren, and other parents remain, and children retain their other known parent. Clan heads cannot be deleted or moved. These actions update the shared database and other visitors' views.

Pinosian and Bucannaw are a fixed founding couple. Adding a child through either head automatically records both as parents. Additional partners, parents above the heads, and removing just one founding-parent link are blocked by the API. Descendants retain multiple-partner and single-parent support. These rules use the heads' stable database IDs, so editing their names does not change them.

- `persons` stores member details with UUID identities.
- `unions` stores unique unordered partner pairs; each person may have multiple partners.
- `parent_child_relationships` explicitly stores each actual parent → child connection, optionally referencing the parents' union.
- Single-parent children are supported. Adding their second parent later creates or reuses the correct union and updates only that child's grouping.
- Children remain grouped separately under each partnership. The generation tree stays anchored to both heads and renders up to 12 children per family at once, with pagination, touch pan/pinch, zoom, and centering controls.
- Generations and roots follow ancestry only. Partnerships never change a person's ancestors or generation.
- Duplicate warnings use case-insensitive first/middle/last names, compatible known birth dates, and show recorded parents. Unknown birth dates do not prevent a warning. Completely unnamed people are not all treated as duplicates.
- Self-relationships, duplicate links, and circular ancestry are rejected. Parent corrections are available from the Parents section. Failed writes roll back atomically.

Parameterized queries, Zod validation, database constraints/triggers, transaction write locks, request-size limits, rate limiting, CORS allowlisting, and secure headers remain enabled. React escapes all user-entered text. No member pictures, uploads, or death-date fields are included.

## API

All routes begin with `/api`. There is no authorization header requirement.

- `GET /health`, `/revision`, `/heads`, `/stats`, `/branches`
- `GET /persons`, `/search?q=...`; `POST /persons`; `GET/PUT /persons/:id`
- `DELETE /persons/:id`; `PUT /persons/:id/parents` with `{parent_ids: [UUID, ...]}` to replace parents
- `GET /persons/:id/parents`, `/children`, `/spouses`, `/unions`
- `POST /unions`; `GET /unions/:id`, `/unions/:id/children`; `POST /unions/:id/children`
- `POST /relationships/parent-child`; `DELETE /relationships/:id`
- `DELETE /unions/:id` for a childless partnership
- `GET /tree/:id?union=UUID&offset=0&limit=12`

Paginated routes return `{items,total,offset,limit}` with a maximum limit of 100. `/persons` accepts `q`, `roots=true`, and `branch=UUID`. Member creation optionally includes `relation: {type: "child" | "parent" | "spouse", person_id, other_parent_id?}`. Existing parent-child connections use `{parent_id,child_id,other_parent_id?}`.

Graph metadata is computed from a consistent SQL snapshot and topological ancestry traversal. Only requested pages and focused families reach the browser. For significantly larger collections than thousands of members, add versioned graph caching and indexed SQL search. Rate limiting is process-local; use a shared limiter before running multiple API replicas. Configure database-provider backups and test restores.

## Verification

`npm test` runs isolated PostgreSQL-engine tests for optional fields, mandatory gender, one-time editable heads, multiple partnerships for both genders, correct parent pairs, missing-parent completion, duplicates, cycle prevention, rollback, and persistence after closing/reopening the database.

Run `npx playwright install chromium` once and `npm run test:browser` for desktop/mobile checks. Alternatively set `PLAYWRIGHT_CHANNEL=chrome` for installed Chrome. Browser tests run on ports 3002 and 5174 with an isolated database, and verify two independent browser sessions see the same records and receive automatic updates. Screenshots are in `test-results`. Test families never enter the local preview or production database.

Managed Neon/PostgreSQL, Render Free and Vercel connectivity still require a smoke test after deploying with your accounts.

## Tree views and birth order

## Printing a branch or the whole clan

Select a person (for example Tangaya), choose **Print family tree**, keep **this person and all descendants**, then **Prepare print preview**. The report includes every generation from a single database snapshot, even when the interactive tree is collapsed or paginated. Partners appear alongside the selected branch's members, but a partner's unrelated branches are not followed. Choose **Entire clan** to include every recorded family, including disconnected records.

Use **Print / Save as PDF**, choose A4 or Letter, portrait, 100% scale, and turn off browser headers/footers. The compact report uses 9-point names, 8-point details and tight spacing. Several small family groups share one page, with parents above their children and references to each child's own family pages. Separate partnerships get separate groups. Large groups repeat the parents on continuation pages. Long names get fewer children per page to prevent clipping. Printed content includes names, birth dates and gender; notes and locations are excluded. Black-and-white printing works without background colors.

For about 500 descendants, use a booklet/PDF or print each main branch separately. A single ordinary sheet would make the names too small. The exact page count is displayed before printing; the compact layout substantially reduces the page count in the 500-descendant test fixture, including deliberately long names. That is a test example, not a fixed page count for the clan. Printing requires no paid service and does not alter family data.

`GET /api/print?root=UUID` returns the entire selected branch; omitting root returns the whole clan. `npm run test:print` uses installed Chrome and an isolated 500-descendant database to check complete inclusion, desktop/mobile previews, page heights and A4/Letter PDF generation. Test PDFs are in `test-results/` and contain no real family data.

### Birth order controls

**Generation tree** shows the heads above children and grandchildren, regardless of which person was entered first or selected. **Simple tree** uses expandable indented branches. Partnerships keep their children in separate groups in both views.

Roots use entry order, never alphabetical order. Children use known birthdays oldest first, then unknown birthdays in entry order; equal birthdays use entry order. **Arrange children** lets you move children up/down and save a manual birth order even without dates. Manual order takes priority over birthday order, and newly added children follow the saved children. **Use automatic order** clears that override. Moving a person to another family clears their old rank. If someone adds, moves or removes a child while the arrangement is open, saving asks you to reopen the list instead of applying an incomplete order.

`PUT /persons/:id/child-order` accepts `{union_id: UUID | null, child_ids: [UUID, ...], automatic?: boolean}`. Every current child of that family must be supplied exactly once. At most 500 children can be manually arranged in one family; tree pagination remains available for larger families.

`node scripts/export-family.mjs` backs up the running local API to a timestamped JSON under `backups/` (excluded from Git). `scripts/import-family.mjs` restores into a fresh managed database only; see the deployment guide for the required private environment file and exact command. Import is transactional and refuses an already-used destination.
