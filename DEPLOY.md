# Deploying to Aruba Linux Hosting

## What this project is

| Part | Technology | Where it runs |
|---|---|---|
| Website (`index.html`, `mam1.jpg`) | Plain HTML/CSS/JS + D3 (CDN), no framework | Aruba (static files) |
| Build system | **Vite 6** → outputs `dist/` | Your PC |
| Database + storage | Supabase (`people`, `reviews`, `photos` bucket) | Supabase |
| Admin/comments API | Supabase Edge Function `admin` (`supabase/functions/admin/index.ts`) | Supabase |

The website is fully static, so Aruba needs only Apache. No PHP, Node, or database is needed on Aruba.
The page has one view with no client-side routes. `.htaccess` still sends any unknown path to `index.html`,
so deep links and refreshes never return 404.

Admin login uses a passphrase checked by the Edge Function, not Supabase Auth. That means you don't need
to configure any Supabase Auth redirect URLs for the new domain.

## Secrets: what goes where

| Value | Location | Public? |
|---|---|---|
| `VITE_SUPABASE_URL` | `.env` → embedded in the website | Yes |
| `VITE_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`) | `.env` → embedded in the website | Yes (protected by RLS) |
| `VITE_GOOGLE_MAPS_KEY` | `.env` → embedded in the website | Yes (restrict by referrer, see step 4) |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected automatically into the Edge Function by Supabase | **Never** in `.env` / website |
| `ADMIN_PASSPHRASE` | Edge Function secret (`supabase secrets set`) | **Never** in `.env` / website |

`vite.config.js` stops the build if a `sb_secret_…` or `service_role` key is put in any `VITE_` variable.

---

## 1. Build (on your PC)

```bash
npm install
npm run build
```

Output:

```
dist/
├── .htaccess          ← Apache rules (hidden file! must be uploaded)
├── index.html
└── assets/mam1-<hash>.jpg
```

To change the Supabase project or keys, edit `.env` (template: `.env.example`) and build again.
You can test the build locally with `npm run preview` at http://localhost:4173.

## 2. Upload to Aruba

**Option A: FTP (FileZilla)**
1. Get your FTP credentials from the Aruba control panel (`admin.aruba.it` → Hosting Linux → your domain → FTP).
   - Host: `ftp.yourdomain.it`, Port 21, Encryption: *Require explicit FTP over TLS*
2. In FileZilla, turn on **Server → Force showing hidden files**. Otherwise `.htaccess` won't upload.
3. Open the web root. On Aruba Linux this is the root of the FTP space (`/`). If your plan shows a
   `www.yourdomain.it` or `public_html` folder, open that one instead.
4. Delete any old placeholder `index.html`/`index.php` that Aruba created.
5. Upload the **contents** of `dist/` (not the `dist` folder itself): `.htaccess`, `index.html`, `assets/`.

**Option B: Aruba File Manager** (control panel → File Manager): upload the same three items into the web root.

Upload **only** what's in `dist/`. Never upload `.env`, `node_modules`, `supabase/`, `index.ts`, or `schema.sql`.

## 3. Enable HTTPS on Aruba

Control panel → *SSL Certificates* → enable the free Let's Encrypt/DV certificate for the domain.
`.htaccess` already redirects `http://` → `https://`. If you see a redirect loop before SSL is active,
comment out the 3 "Force HTTPS" lines in `.htaccess` until the certificate is issued.

## 4. Restrict the Google Maps key (recommended)

Google Cloud Console → APIs & Services → Credentials → the Maps key → *Application restrictions:
Websites* → add:
```
https://yourdomain.it/*
https://www.yourdomain.it/*
http://localhost:5173/*
http://localhost:4173/*
```

## 5. Supabase: nothing to change for the move

- The REST API (`/rest/v1/people`, `/rest/v1/reviews`) and the Edge Function already send
  `Access-Control-Allow-Origin: *`, so the new domain works without changes.
- RLS: public reads only. All writes go through the Edge Function using the service role.

### (Re)deploying the Edge Function, only if you change `index.ts`

The deployable copy is `supabase/functions/admin/index.ts` (identical to the root `index.ts`).

```bash
npx supabase login
npx supabase link --project-ref umgtnalfygbuqunojdyf
npx supabase secrets set ADMIN_PASSPHRASE="your-secret-phrase"   # only if not already set
npm run deploy:function        # = supabase functions deploy admin --no-verify-jwt
```

`--no-verify-jwt` (also in `supabase/config.toml`) is **required**. The site calls the function with the
`sb_publishable_` key, which is not a JWT, so leaving gateway JWT verification on would break comments
and admin. The function checks the admin passphrase itself.

### Fresh Supabase project

Run `schema.sql` in the Supabase SQL Editor, deploy the function as shown above, then put the new
project URL and publishable key in `.env` and rebuild.

## 6. Verify after upload

1. Open `https://yourdomain.it`. The map loads and professionals appear (data from Supabase).
2. Open `https://yourdomain.it/anything`. The site still loads (no 404).
3. Open `https://yourdomain.it/.htaccess`. It should return 403 Forbidden.
4. Click the lock icon and enter the admin passphrase. "Modalità admin attiva" should appear.
5. Post a test comment on a professional, then resolve or delete it from the admin inbox.
6. Edit a professional and upload a photo to test Storage.

## Updating the site later

`npm run build`, then upload the new `dist/` contents over the old files. Delete stale files in
`assets/` if you like (the names are hashed, so old ones won't conflict).
