# Free deployment: GitHub → Neon → Render → Vercel

Use **Vercel Hobby (free)** for the frontend, **Render Free Web Service** for the API, and **Neon Free PostgreSQL** for permanent family records. GitHub stores only the code. The included render.yaml provisions one free web service and no database, disk or paid service.

This can cost **$0 within the free allowances**, not unlimited hosting. Keep all accounts on their free plans and use the supplied .vercel.app/.onrender.com addresses instead of buying a domain. For a strict zero-cost Render setup, avoid adding a payment method: Render documents that excess bandwidth/build usage can be billed when a payment method is present; otherwise services/builds are suspended at those limits. See [Render Free](https://render.com/docs/free), [Vercel Hobby](https://vercel.com/docs/plans/hobby), and [Neon Free quotas](https://github.com/neondatabase/website/blob/main/content/faqs/free-plan-limits-and-quotas.md).

## 1. Upload the project to GitHub

Create a new **private** repository on GitHub called `pinosian-bucannaw-clan`. Leave its README, .gitignore and license options unchecked because this project already has files. Copy its HTTPS repository URL.

Open PowerShell in this project folder and run the following commands one line at a time. Replace `YOUR-USERNAME` with your GitHub username:

```powershell
cd "C:\Users\Patrick\OneDrive\Desktop\Reunion family tree"
git init
git add .
git status
```

The file list should contain the source code, logo, package-lock.json, render.yaml and vercel.json. `.env`, `.local-db`, `backups`, `node_modules` and `test-results` must not appear: the included .gitignore excludes them. Then run:

```powershell
git commit -m "Prepare clan family tree for deployment"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/pinosian-bucannaw-clan.git
git push -u origin main
```

Complete GitHub's browser sign-in if prompted. If Git asks for your identity, set `git config user.name "Your Name"` and `git config user.email "Your GitHub email"`, then retry the commit. If `git` is not recognized, install Git for Windows and reopen PowerShell. If this folder is already connected to GitHub, use its existing repository instead of adding another origin.

Refresh your GitHub repository page and confirm the files appear. See [GitHub's existing-project instructions](https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github).

## 2. Create the Neon Free database

1. Sign in at [Neon](https://console.neon.tech) and keep the account on **Free**. Do not select Launch or Scale.
2. Create a project named `pinosian-bucannaw-clan`, in a region near your Render service where available. Keep the default database, usually `neondb`.
3. Open **Connect** and select your production branch, database and owner role.
4. Turn **Connection pooling off** and copy the PostgreSQL connection URL. This app already limits its pool to three connections; the direct URL also works for migrations/imports.
5. Copy only the `postgresql://...` URL, without a surrounding `psql` command or shell quotes. Keep its SSL parameters and treat the URL as a password.

No manual table creation or Neon SDK is needed. Startup creates/upgrades the tables. The app automatically verifies TLS certificates for Neon connections. Keep Neon's scale-to-zero behavior enabled. [Neon connection guidance](https://github.com/neondatabase/website/blob/main/content/docs/get-started/connect-neon.md).

## 3. Create the Render FREE API

1. Sign in to Render, choose **New → Blueprint**, and connect GitHub.
2. Select this repository and branch `main`. Use `render.yaml` as the Blueprint path.
3. Confirm the only proposed resource is `reunion-api`, with instance plan **Free**. There should be **no Render database**.
4. Enter your Neon URL as `DATABASE_URL`. For `FRONTEND_URL`, enter `http://localhost:5173` temporarily; replace it with the Vercel address later.
5. Choose **Deploy Blueprint** and wait for the API service to become available.
6. Open the API service and copy its actual `https://....onrender.com` address. Render may append characters to the name; use the exact address shown.
7. Open that address followed by `/api/health`. It should show `{"status":"ok"}`. This checks the API process without waking Neon. Open `/api/heads` too: seeing Pinosian and Bucannaw confirms real database access.

The Blueprint supplies DATABASE_SSL=true, NODE_ENV=production, Node version, commands and health check; you supply the Neon URL. Do not enable LOCAL_DATABASE on Render. Render Free sleeps after 15 idle minutes and waking can take about a minute. Records remain in Neon. Do not add uptime-pinging services to prevent sleep. [Render Blueprint setup](https://render.com/docs/infrastructure-as-code).

For manual **New → Web Service** setup: use repository root, runtime Node, instance **Free**, build `npm ci --workspace server --include-workspace-root`, start `npm run start -w server`, and health path `/api/health`. Add DATABASE_URL (Neon URL), DATABASE_SSL=true, NODE_ENV=production, NODE_VERSION=22.16.0 and FRONTEND_URL. No disk is needed.

## 4. Move your existing family members to Neon

**Do this before editing or adding people on the online site.** GitHub does not upload your local family records. The import preserves member IDs, details, relationships, and the saved child order. It refuses to replace a destination that has other members or edited heads.

With the local app running, open another PowerShell window in the project folder:

```powershell
node scripts/export-family.mjs
```

It prints the new backup's path under `backups/`. Keep that file on your computer. An initial backup of your eight current members is already saved there; export again if you have made more changes. Avoid editing during the export. If it says the family changed, rerun it.

Use the same direct Neon connection URL from step 2. It must select the same branch/database as Render's DATABASE_URL.

Create `.env.neon` in the project root (not in `server`). Put these lines in it, replacing the placeholder with your actual Neon URL:

```dotenv
DATABASE_URL=postgresql://USER:PASSWORD@YOUR-ENDPOINT.neon.tech/neondb?sslmode=require
DATABASE_SSL=true
NODE_ENV=production
```

This file contains your database password and is excluded from Git. Do not put these values in Vercel or a VITE_ variable.

Run this command, replacing `YOUR-BACKUP.json` with the actual file name printed by the export:

```powershell
node --env-file=.env.neon scripts/import-family.mjs "backups/YOUR-BACKUP.json"
```

Success says `Imported 8 family members successfully.` Open the Render API address followed by `/api/stats` and confirm `members` is 8. If import stops because the destination has been edited, it leaves its existing family records intact; do not delete them to force the import.

## 5. Deploy the website on Vercel Hobby (free)

1. Sign in to Vercel with GitHub using a personal **Hobby** account, without a Pro trial. Choose **Add New → Project** and import the same repository.
2. Keep **Root Directory** at the repository root (`./`), not `client` or `server`.
3. Select **Vite** as the framework. Confirm these settings (vercel.json already supplies build and output):

   | Setting | Value |
   | --- | --- |
   | Install command | `npm ci` |
   | Build command | `npm run build` |
   | Output directory | `client/dist` |
   | Node.js | 22.x or a compatible newer version |

4. Add environment variable `VITE_API_URL` with your exact Render API origin, for example `https://reunion-api-xxxx.onrender.com`. Do **not** append `/api` or a trailing slash. Apply it to Production; apply it to Preview too if using previews.
5. Choose **Deploy** and copy the stable production address, such as `https://pinosian-bucannaw-clan.vercel.app`.

The frontend bakes this variable into its build. Changing it requires a new deployment. [Vercel's Vite guide](https://vercel.com/docs/frameworks/frontend/vite).

## 6. Connect the two services

In Render, open **reunion-api → Environment**, change `FRONTEND_URL` to your exact Vercel production origin, and save/redeploy. Do not include a trailing slash or a page path. Wait until the API is live again, then reload the Vercel site.

If you use a custom domain or a specific Vercel preview URL, add that exact origin as well, separated by a comma. New preview URLs need their own allowed origin; the stable production URL is easiest for family testing.

## 7. Test before sharing

Open the Vercel URL on your computer and on a phone using mobile data. Confirm:

- The clan logo and both heads appear.
- The six children are Tangaya, Budatan, Bangtitiyan (Pang-olen), Katingban, Obanan, Sagiyod.
- Generation tree keeps the heads at the top. Simple tree expands like folders.
- A temporary test child added on one device appears on the other within about ten seconds. Unknown gender and missing birthday/name are accepted.
- Arrange children saves its order after reloading. Delete the temporary test person using the confirmation screen.
- Redeploying the Render API keeps the real members and their saved order.

Share the **Vercel URL** with your clan. As requested, there is no login: anyone who can reach the website/API can edit. A private GitHub repository does not make the deployed website private.

## Later updates and troubleshooting

For code changes, run `git add .`, `git commit -m "Describe the update"`, and `git push`. Connected services deploy from GitHub. Family edits are already saved in the database and do not need those commands.

If the page loads but family data does not, allow a minute for Render to wake, then check `/api/heads`, Vercel's VITE_API_URL and Render's FRONTEND_URL. Redeploy Vercel after correcting VITE_API_URL. If only two heads appear, confirm you imported into the same Neon branch/database used by the API. If a build fails, read its logs and check the settings above.

After moving online, use the Vercel site for family edits. Your local database and Neon database are separate; later local edits are not automatically copied online. Keep private backups as the family grows. For an online export, set `$env:EXPORT_API_URL="https://YOUR-API.onrender.com"` before running `node scripts/export-family.mjs`.

## 8. Stay within the free allowances

- Render Free sleeps after 15 idle minutes and provides 750 free instance hours per workspace/month, shared across free services. Traffic and builds also have limits; exceeding them can interrupt access. External database traffic is subject to Render's fair-use limits.
- Neon Free currently includes 100 CU-hours/month per project, 0.5 GB storage and 5 GB public transfer. Compute sleeps after inactivity; stored records remain. Monitor Usage and keep the plan on Free.
- Vercel Hobby is for personal, non-commercial projects and has usage limits. Use its free domain and keep the account on Hobby.
- Health checks do not query Neon. Shared-update polling pauses in hidden tabs and after two minutes without interaction. Clicking, typing, scrolling or returning to the tab resumes it, reducing unattended compute use.

If a quota is exhausted, wait for its reset or reduce usage instead of upgrading. These plans cannot guarantee unlimited or uninterrupted service. Provider links at the top describe the current allowances.

If you already deployed the previous paid configuration, changing render.yaml does **not** delete the old database or cancel its charges. Preserve/transfer its records first, switch the API to Free with the Neon URL, then remove the unused paid Render database through your dashboard. These local edits have not changed any existing cloud resources.
