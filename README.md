# Beth's Books

A personal reading library and tracker: an installable, offline-first web app (PWA) for Android, hosted on
Cloudflare Pages, with an optional online library (Cloudflare D1) so books can be added from a laptop.

```
index.html         the app (repo root = the website)
x/                 one-off spreadsheet importer, at /x/
_headers           caching rules for Cloudflare
functions/api/     the sync API, at /api/sync (Cloudflare Pages Function)
```

There is no build step.

## 1. Put it on GitHub
Push this whole folder, so `index.html` and `functions/` are at the top level of the repo:
```
git init -b main
git add .
git commit -m "Beth's Books v1.1"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```
If you upload through GitHub's website instead, **drag the folders** onto the upload page. The file picker loses the
folder structure.

## 2. Cloudflare Pages project
**Workers & Pages → Create application → Pages → Connect to Git**, pick the repo, then:
- Framework preset: **None**
- Build command: *(leave blank)*
- Build output directory: *(leave blank — the repo root is the site)*

If the project already exists: **Settings → Build → Build configuration → Edit**, and clear the output directory (or set it to `/`).

## 3. Online library (D1 + sync key)
1. **Storage & Databases → D1 → Create database**. Name it e.g. `bethsbooks`. You don't need to create any tables;
   the app does that itself.
2. In the Pages project: **Settings → Bindings → Add → D1 database bindings**. Variable name **`DB`**, database `bethsbooks`.
3. In the Pages project: **Settings → Variables and Secrets → Add**. Name **`SYNC_KEY`**, choose **Encrypt** (secret),
   value: a long passphrase only you and Beth know (e.g. four random words). This is what you type into the app.
4. **Deployments → latest deployment → Retry deployment**. Bindings only take effect after a new deployment.

Check it: open `https://<project>.pages.dev/api/sync`. It should say `{"error":"unauthorised"}`. If it says
`not_configured`, the binding or secret is missing; add it and redeploy.

## 4. Beth's phone
1. Open the site in **Chrome**, **⋮ → Install app**.
2. In the app: **More → Connect to online library**, enter the sync key.

From then on the app syncs on its own: when it opens, a moment after each change, when the connection comes back,
and every few minutes while open. It keeps working offline; changes wait and go up later.
**More → Online library** shows the status and has **Sync now**.

## 5. Importing the spreadsheet (from a laptop)
1. Save the spreadsheet as **CSV UTF-8** (Excel: *File → Save As → CSV UTF-8*). `.xlsx` also works.
2. On the laptop open `https://<project>.pages.dev/x/`, choose **Connect**, enter the sync key.
3. Choose the file, check the column matching and the preview, then **Import**. The books are uploaded straight away.
4. Beth's phone picks them up next time the app is open and online.

Books already in the online library are recognised by title and author and skipped by default, so importing again is safe.

## Covers
Covers are found automatically on Open Library (free, no account) from each book's title and author, including
imported books, which are filled in gradually in the background. Tap a cover on a book's page to pick a different one.
Turn this off under **More → Covers**. Covers are saved as image links (not uploaded), and the app keeps a copy of each
one it shows so they appear offline.

## Backups
**More → Export & backup → Download full backup** gives a `.json` file with everything.

## Updating the app
Change the files, bump `VERSION` in `sw.js`, push. The app shows "A new version is ready".

## Running it locally
```
npx wrangler pages dev . --d1 DB=local --binding SYNC_KEY=test
```
