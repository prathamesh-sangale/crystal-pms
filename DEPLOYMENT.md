# Deployment — Vercel today, portable by design

## The short answer

Moving from Vercel to a VPS (or anywhere else) later costs **no data migration and no code changes**. Verified directly against the actual code, not assumed:

- **All real data lives in Supabase** — a separate, independently-hosted Postgres project (`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`). Vercel never stores anything; it's just the compute that talks to Supabase over the network. Whatever runs this app next talks to the exact same Supabase project the exact same way.
- **All uploaded files (photos, PDFs) live in Google Drive**, via a service account — same story, already independent of where the app runs.
- **The Google Sheets integrations** (PMS Sheet export, IMS lookup) — same service account, same independence.
- **The API has zero Vercel-specific code.** `api/[...path].ts` (the only Vercel-specific file in the whole repo) is a thin wrapper that just hands requests to `apps/api/src/app.ts`'s `buildApp()` — the real application. `apps/api/src/server.ts` already runs that same app as a plain, standalone Node/Fastify server (`npm run start -w @pms/api`) — this is what a VPS would run directly, today, unchanged.
- **The rate limiter is Supabase-backed, not in-memory** (`SupabaseRateLimitStore`) — deliberately, so behavior doesn't depend on how many server instances or which platform is running it.
- A repo-wide check for `VERCEL`/`process.env.VERCEL` found zero matches in `apps/api/src` or `apps/web/src` — nothing in the actual application branches on "am I running on Vercel."

So switching hosts later is: redeploy the same code, point it at the same Supabase project and the same Google service account, done.

## What a VPS deployment actually looks like, when that day comes

**1. Build**
```
npm run tokens
npm run build -w @pms/shared
npm run build -w @pms/api     # -> apps/api/dist
npm run build -w @pms/web     # -> apps/web/dist (static files)
```

**2. Run the API as a long-lived process** (pm2, systemd, Docker — any of them), not a serverless function:
```
node apps/api/dist/server.js
```
Needs the same env vars `apps/api/.env.example` already documents:
- `JWT_SECRET`, `PORT`, `WEB_ORIGIN` (set to the real domain)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — same project, unchanged
- `GOOGLE_SERVICE_ACCOUNT_JSON` — on a VPS this can be **left unset**; `googleAuth.ts` falls back to reading `apps/api/credentials/google-service-account.json` directly off disk, which a VPS actually has (unlike Vercel's serverless filesystem). Simpler there than on Vercel, not harder.
- `DEV_LOGS_PASSWORD` — optional, only if `/dev/logs` should stay reachable

**3. Serve the frontend + route `/api`** — any reverse proxy works; nginx example:
```nginx
server {
  listen 443 ssl;
  server_name your-domain;

  location /api/ {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
  }

  location / {
    root /path/to/apps/web/dist;
    try_files $uri /index.html;   # SPA fallback, same thing vercel.json's catch-all route does today
  }
}
```

That's the entire migration. No step touches Supabase, Drive, or Sheets — those three keep working identically no matter which box is running the Node process in front of them.
