# ReeferReady PMS

Container readiness tracking for one reefer depot (Crystal Yard, JNPT) — a
container enters at Gate-In, is surveyed, works through whichever of four
Sections (Painting, PTI, Cleaning, Repairment) its survey flagged, and the
app's job ends at Ready to Move. Gate-Out is optional and only reachable once
a container has reached that state.

Built entirely on the Crystal Design System in
[`source/crystal-design-system.html`](source/crystal-design-system.html).

---

## Run it

One command per line — Windows PowerShell 5.1 does not accept `&&` as a
statement separator, and these are meant to be readable on every shell.

```
npm install
npm run setup      # generates tokens, pushes the schema, seeds the 4 login accounts
npm run dev        # api on :4000, web on :5173
```

`npm run setup` creates `apps/api/.env` from the example if it is missing —
fill in `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from your Supabase
project's Settings → API before running it. **Change `JWT_SECRET` before this
is deployed anywhere** — the committed example value is not safe to ship.

Open http://localhost:5173.

| Account                           | Role       |
| ---------------------------------- | ---------- |
| `sitaram@reeferready.example`      | manager (shown as "Admin" in the UI) |
| `supervisor@reeferready.example`   | supervisor |
| `tech@reeferready.example`         | technician |
| `viewer@reeferready.example`       | viewer     |

Password for all four: `readiness`. These are dev-only seed accounts
(`apps/api/scripts/seedUsers.ts`) — the four-role distinction is a holdover
from an earlier version of this product; today only one of them is actually
used day to day (signed in as "Admin").

---

## The one rule this repo enforces mechanically

**No value is ever typed twice.**

`tools/extract-design-system.mjs` reads the design system HTML and writes:

| Output                          | What it is                                   |
| ------------------------------- | -------------------------------------------- |
| `apps/web/src/styles/tokens.css`  | the `:root` and `[data-theme]` blocks, verbatim |
| `apps/web/src/styles/crystal.css` | every component rule, verbatim                  |
| `apps/web/src/generated/icons.ts` | the sprite icons                                |
| `apps/web/src/generated/manifest.json` | what was taken, what was left, source hash |

All four are gitignored — they are build output, not source. Change the design
system, run `npm run tokens`, and the app follows. There is no second copy of a
colour, a radius, a shadow or an icon anywhere in this repository.

**stylelint** rejects any colour literal in the one hand-written stylesheet
(`apps/web/src/styles/app.css`, which holds layout only).

### Dark mode

There is no dark-mode CSS in this repo. The design system scopes both palettes
on `[data-theme]`; the app sets that attribute on `<html>` and stops. If a
screen ever needs a dark-specific rule, the foundation is wrong.

---

## Layout

```
packages/shared     the few genuinely shared pieces: the login schema, the
                    API error shape, and a couple of small display helpers
                    (toISODate, initials) both apps use
apps/api            Fastify + Supabase (Postgres) + JWT auth
apps/web            React 19 + Vite; design system classes bound to
                    headless primitives (Radix, TanStack Table, cmdk, TipTap)
tools               the design system extractor
source              the design system, and the original concept
```

Supabase is the only database — `workers`, `containers`, `sections`, `tasks`,
`drafts`, `users`, and `api_keys`, all under `apps/api/supabase/migrations/`.
`apps/api/src/supabase.ts` is the one place the service-role key is read;
nothing with write access to it ever reaches the browser.

### Outside integrations

| What | Direction | What it's for |
| --- | --- | --- |
| Google Drive | apps/api → Drive | Gate-In/Gate-Out photo and PTI video uploads, into one Shared Drive |
| Google Sheets — IMS lookup | apps/api → IMS's sheet | The "Check IMS" button at Gate-In — read-only, never writes back |
| External yard-summary API | IMS → apps/api | `/api/external/yard-summary`, gated by its own hashed API key — a narrow, read-only count of what's in the yard |

---

## Tests

```bash
npm test            # 5 shared + 5 API
npm run verify       # typecheck + eslint + stylelint + unit tests
```

| Suite                          | Covers                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| `packages/shared/src/ui.test.ts` | the two small shared helpers (`toISODate`, `initials`)                  |
| `apps/api/src/__tests__/api.test.ts` | the auth seam — health check, login success/failure, a protected route refusing an anonymous request |

That's the whole automated suite. Every v2 feature beyond login (containers,
tasks, drafts, workers, IMS lookup, uploads) is verified live against the
real Supabase project as it's built, rather than through an automated suite —
see `DEVELOPMENT-STATUS.md` for how each one was checked. `api.test.ts` hits
the real Supabase project too; `npm run seed-users` (in apps/api) must have
been run at least once for its accounts to exist.

There is no browser/e2e suite today — the previous one targeted a now-deleted
product and was removed along with it rather than kept failing.

---

## Current state

This repo has gone through two major versions. The first (ten fixed repair
stages, four depots, role-based permissions) has been fully removed — its
screens, its Prisma/SQLite backend, and its domain logic are gone, not just
unused. What remains and is live:

- **v2 UI** — Live Board, Yard Board, Worker Roster, Dashboards, plus two
  chrome-free printable reports (Container Report, Yard Report).
- **v2 backend** — Supabase-backed persistence for every screen above; real
  Google Drive uploads; a read-only IMS lookup; an API-key-gated endpoint for
  IMS's own integration into this app.
- **Auth** — still the original scrypt + JWT design, now checking Supabase's
  `users` table instead of a separate Prisma database.

There is no demo/mock data anywhere in this repo — `npm run setup` seeds only
the 4 login accounts above. A fresh database genuinely starts empty: every
screen shows its real empty state until a container is actually gated in
through the app.

See `DEVELOPMENT-STATUS.md` for the full, dated history of how this was built.
