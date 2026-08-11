# ReeferReady PMS

Container readiness pipeline for a reefer depot network — ten repair stages from
gate-in to release, a checklist that changes with the container type, and one
view of what is delayed across four depots.

Built entirely on the Crystal Design System in
[`source/crystal-design-system.html`](source/crystal-design-system.html).

---

## Run it

```bash
npm install
cp apps/api/.env.example apps/api/.env    # then change JWT_SECRET
npm run setup                             # tokens + schema + seed
npm run dev                               # api :4000, web :5173
```

Open http://localhost:5173.

| Account                          | Role       | Can                                        |
| -------------------------------- | ---------- | ------------------------------------------ |
| `sitaram@reeferready.example`     | manager    | everything, including removing a container |
| `supervisor@reeferready.example`  | supervisor | everything except removing                 |
| `tech@reeferready.example`        | technician | tick checklist items                       |
| `viewer@reeferready.example`      | viewer     | read only                                  |

Password for all four: `readiness`.

---

## The one rule this repo enforces mechanically

**No value is ever typed twice.**

`tools/extract-design-system.mjs` reads the design system HTML and writes:

| Output                          | What it is                                   |
| ------------------------------- | -------------------------------------------- |
| `apps/web/src/styles/tokens.css`  | the `:root` and `[data-theme]` blocks, verbatim |
| `apps/web/src/styles/crystal.css` | every component rule, verbatim                  |
| `apps/web/src/generated/icons.ts` | all 58 sprite icons                             |
| `apps/web/src/generated/manifest.json` | what was taken, what was left, source hash |

All four are gitignored — they are build output, not source. Change the design
system, run `npm run tokens`, and the app follows. There is no second copy of a
colour, a radius, a shadow or an icon anywhere in this repository.

Two gates keep it that way:

- **stylelint** rejects any colour literal in the one hand-written stylesheet
  (`apps/web/src/styles/app.css`, which holds layout only).
- **Playwright + axe** runs on all eight screens in both themes.

### Dark mode

There is no dark-mode CSS in this repo. The design system scopes both palettes
on `[data-theme]`; the app sets that attribute on `<html>` and stops. If a
screen ever needs a dark-specific rule, the foundation is wrong.

---

## Layout

```
packages/shared     the readiness process and every rule derived from it,
                    plus the zod schemas both sides validate against
apps/api            Fastify + Prisma + SQLite, JWT auth, audit trail
apps/web            React 19 + Vite; design system classes bound to
                    headless primitives (Radix, TanStack Table, cmdk, TipTap)
tools               the design system extractor
source              the design system, and the original concept
```

`packages/shared` is the reason the API and the UI can never disagree about
whether a container is late: `isLate()` is defined once and imported by both.

---

## Tests

```bash
npm test            # 25 domain + 21 API
npm run test:e2e    # 77 browser, in apps/web
npm run verify      # typecheck + eslint + stylelint + unit tests
```

| Suite                          | Covers                                                                   |
| ------------------------------ | ------------------------------------------------------------------------ |
| `packages/shared/*.test.ts`     | stage budgets, variant work, lateness, order matching                     |
| `apps/api/src/__tests__`        | auth, permissions, validation, checklist snapshotting, the audit trail    |
| `apps/web/e2e/a11y.spec.ts`     | axe on 8 screens × 2 themes, focus return, keyboard routes                |
| `apps/web/e2e/responsive.spec.ts` | table→cards, sidebar→sheet, tablet, 200% zoom, no sideways page scroll  |
| `apps/web/e2e/screens.spec.ts`  | design system rules 4, 5 and 12 asserted directly against the DOM         |
| `apps/web/e2e/interactions.spec.ts` | register, tick, advance, note, remove — end to end                    |

Time-dependent behaviour is pinned with an `x-today` header the API honours
outside production, so "three containers are delayed" is a real assertion
rather than something that breaks next Tuesday.

### Screenshots

```bash
npm run shots -w @pms/web
```

Writes `apps/web/screenshots/{before,after}/…` — the rebuilt app beside the
original concept, at desktop and phone widths, in both themes. "Before" is the
concept file opened straight off disk.

---

## Changes made to the design system

Every one is commented in place in `source/crystal-design-system.html` and
listed in the handover report. In short: five new sections (kanban, responsive
table, mobile navigation, data panel, headless bindings), a corrected contrast
ramp, two new icons, and a note that the rich text component must not ship on
`document.execCommand`.
