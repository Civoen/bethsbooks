# Beth's Books

A personal reading library and tracker, built as an installable, offline-first web app (PWA) for Android.

Everything is stored on the device (IndexedDB). Nothing is sent to a server. The only online feature is the optional
"Search for a book" lookup, which uses the free Open Library catalogue.

There is no build step: the files in this folder are the site.

## Hosting: GitHub + Cloudflare Pages

1. Create a new GitHub repository and push the **contents** of this folder to it, so `index.html` sits at the repo root:
   ```
   cd bethsbooks
   git init -b main
   git add .
   git commit -m "Beth's Books v1"
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, and pick the repository.
3. Build settings:
   - Framework preset: **None**
   - Build command: *(leave empty)*
   - Build output directory: **/**
4. Deploy. You get an `https://<project>.pages.dev` address (a custom domain can be added later).

Every push to `main` redeploys automatically. `_headers` tells Cloudflare not to cache `index.html` and `sw.js`,
so updates reach the phone promptly.

## Installing on Beth's phone
1. Open the address in **Chrome** on Android.
2. Tap **⋮ → Install app** (or "Add to Home screen").
3. Open Beth's Books from the home screen. It runs full-screen and works offline.

## One-off spreadsheet import: `/x`
The importer is not part of the app. It lives at `https://<project>.pages.dev/x/`.

1. Save the spreadsheet as **CSV UTF-8** (Excel: *File → Save As → CSV UTF-8*). `.xlsx` also works.
2. On **Beth's phone, in Chrome** (the same browser the app is installed from), open `/x/`.
3. Choose the file, check the column matching, review the preview, and import. Books come in as **Read**.
4. Tap **See my books**.

The import has to happen on Beth's phone because the library lives in that browser's storage; importing on a laptop
fills a library on the laptop instead.

Duplicates (same title and author) are skipped by default, so running it twice is safe. When you're done, you can
delete the `x/` folder from the repo and push; the app doesn't depend on it.

## Backups
*More → Export & backup → Download full backup* now and then. The `.json` backup restores everything, including
shelves, goals and covers, on any device.

## Updating the app later
Change the files, bump `VERSION` in `sw.js` (e.g. `bb-v1.0.2`), and push. The app shows "A new version is ready"
and refreshes when tapped. Beth's data is untouched by updates.

## Files
- `index.html`, `manifest.webmanifest`, `sw.js` — app shell, install details, offline caching
- `_headers` — Cloudflare Pages caching rules
- `css/app.css` — Reading Nook theme (light and dark)
- `js/` — `db.js` storage · `store.js` data and rules · `ui.js` sheets, dialogs, toasts · `views/` screens
- `x/` — the one-off spreadsheet importer
- `vendor/xlsx.full.min.js` — SheetJS (Apache-2.0) for Excel import/export, loaded only when needed
- `fonts/` — Figtree and Newsreader (SIL Open Font License), self-hosted so they work offline
