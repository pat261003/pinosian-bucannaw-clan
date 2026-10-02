# Put your family tree online: GitHub → Render → Vercel

GitHub stores the code. Render runs the API and PostgreSQL database. Vercel serves the website. Family edits go to Render's database and do not require a GitHub commit.

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

## 2. Create the Render API and database

1. Sign in to Render, choose **New → Blueprint**, and connect GitHub.
2. Select this repository and branch `main`. Use `render.yaml` as the Blueprint path.
3. Review the resources: `reunion-api` and `reunion-db`. The supplied configuration selects **paid** Starter web service and Basic database plans; review the displayed cost before deploying.
4. When asked for `FRONTEND_URL`, enter `http://localhost:5173` temporarily. You will replace it with the real Vercel address later.
5. Choose **Deploy Blueprint**. Wait for the database and API service to become available.
6. Open the API service and copy its actual `https://....onrender.com` address. Render may append characters to the name; use the exact address shown.
7. Open that address followed by `/api/health`. It should show `{"status":"ok"}`. `/api/heads` should show Pinosian and Bucannaw.

The Blueprint already supplies DATABASE_URL, NODE_ENV, the build/start commands and health check. Do not enable LOCAL_DATABASE on Render. [Render Blueprint setup](https://render.com/docs/infrastructure-as-code).

## 3. Move your existing eight family members to Render

**Do this before editing or adding people on the online site.** GitHub does not upload your local family records. The import preserves member IDs, details, relationships, and the saved child order. It refuses to replace a destination that has other members or edited heads.

With the local app running, open another PowerShell window in the project folder:

```powershell
node scripts/export-family.mjs
```

It prints the new backup's path under `backups/`. Keep that file on your computer. An initial backup of your eight current members is already saved there; export again if you have made more changes. Avoid editing during the export. If it says the family changed, rerun it.

In Render, open **reunion-db → Info / Connections** and copy its **External Database URL**. The external URL is for connecting from your computer; the API already uses Render's internal connection. If access is restricted, allow your computer's public IP in the database's Networking settings. [Render connection instructions](https://render.com/docs/postgresql-creating-connecting).

Create a file named `.env.render` in the project root (not in `server`). Put these lines in it, replacing the placeholder with the actual external connection string:

```dotenv
DATABASE_URL=postgresql://YOUR-EXTERNAL-DATABASE-CONNECTION
DATABASE_SSL=true
NODE_ENV=production
```

This file contains your database password and is excluded from Git. Do not put these values in Vercel or a VITE_ variable.

Run this command, replacing `YOUR-BACKUP.json` with the actual file name printed by the export:

```powershell
node --env-file=.env.render scripts/import-family.mjs "backups/YOUR-BACKUP.json"
```

Success says `Imported 8 family members successfully.` Open the Render API address followed by `/api/stats` and confirm `members` is 8. If import stops because the destination has been edited, it leaves its existing family records intact; do not delete them to force the import.

## 4. Deploy the website on Vercel

1. Sign in to Vercel using GitHub. Choose **Add New → Project** and import the same repository.
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

## 5. Connect the two services

In Render, open **reunion-api → Environment**, change `FRONTEND_URL` to your exact Vercel production origin, and save/redeploy. Do not include a trailing slash or a page path. Wait until the API is live again, then reload the Vercel site.

If you use a custom domain or a specific Vercel preview URL, add that exact origin as well, separated by a comma. New preview URLs need their own allowed origin; the stable production URL is easiest for family testing.

## 6. Test before sharing

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

If the page loads but family data does not, check the Render `/api/health` URL, Vercel's VITE_API_URL, and Render's FRONTEND_URL. Redeploy Vercel after correcting VITE_API_URL. If only two heads appear, confirm you imported the local backup into the same Render database used by the API. If a build fails, read its deployment logs and check the root/build/output settings above.

After moving online, use the Vercel site for family edits. Your original local database and Render's database are separate; later local edits are not automatically copied online. Keep database backups in Render as the family grows.
