# Crystal PMS — Workflow Redesign Spec (v2)

**Status:** Draft — decisions below are confirmed, one field list is still
pending from the user. No schema, API, or UI code has been changed yet —
plan only, per explicit instruction not to code until this is settled.
This document proposes replacing the current role/pipeline model with the
depot's real operating process, as described in the operator's own notes
("Crystal — Cold Chain Solution Company").

> **Hard constraint, confirmed 2026-09-30: the visual design system does not
> change.** This is a domain/data-model replacement, not a redesign. Every
> screen keeps the exact same Crystal tokens, colour palette, component
> styling (buttons, cards, tables, the theme toggle, everything in
> `source/crystal-design-system.html` / `crystal.css` / `tokens.css`) it has
> today. Only the underlying data model, routes, and what the screens *show*
> change — not how anything looks.

---

## 1. Objective & target users

One **Admin** for the yard — the single authenticated user of the system. Every
other person in the process (painter, technician, etc.) is a **record** the
Admin manages, not an account that logs in.

Goal: track a container or tank from yard arrival, through a pre-gate-in
**Survey**, **Gate-In**, whichever repair/prep **sections** the survey flags
as needed (running in parallel, not a fixed sequence), to **Ready to Move**
— with the Admin as the only one who ever verifies work, and a start/stop
**timer** on every task standing in for a checkbox.

---

## 2. What changes from today

| Concept | Today | Proposed |
|---|---|---|
| Roles | manager / supervisor / technician / viewer, all with JWT logins and an RBAC permission table | **Admin** (full control) is the only role for now. An **Owner** role may be added later — real-time read-only view across every screen, cannot manipulate anything. Painter / Painter Helper / Technician / All-Rounder / Cleaner / Tea Boy are Worker **records** Admin creates and assigns — no auth, no permissions of their own |
| Pipeline | 10 fixed sequential stages every container visits identically (`packages/shared/src/process.ts`) | **Survey** (pre-gate-in) → **Gate-In** → only the **sections** Survey flags as required, running in parallel → **Ready to Move** |
| Marking work done | a checkbox, ticked by whoever has `container:task` permission | a **start/stop timer** per task, operated by Admin; stopping it *is* what marks the task done |
| Checklist scope | derived from container type only (standard / double / anteroom) | derived from the container/product's **type code** — more types than today's 3, each with its own checklist — plus whatever Survey flags as needed |
| Container Sailing (load/offload/shift) | not modeled | a **separate movement log**, not a checklist section — its own record of events, distinct from the section/task model |
| Audit trail | `ContainerEvent`, actor = whichever user acted | carries over conceptually; actor is always Admin (Owner, if built, never writes one) |
| Visual design | Crystal design system, generated CSS/tokens | **unchanged, byte-for-byte** — same palette, same components, same toggle |

---

## 3. Roles & operations

### Admin (full control)
- Create / edit / deactivate Worker records (name, type, active flag, notes).
- Run a Survey against an incoming container/tank.
- Gate a container in.
- Start and stop the timer on any task, for any section, on any container.
- Assign an All-Rounder an ad hoc task, including a required free-text reason when the task is "Other."
- Log a Container Sailing movement (load / offload / shift, with from-site/to-site for a shift).
- Mark a container Ready to Move once every section Survey flagged is fully complete.
- View dashboards: fleet overview, the technician-style PTI breakdown, per-section pending counts and average time.

### Owner (possible future role — not in the first build)
- Everything Admin can *see*, live, on every screen.
- Nothing Admin can *do* — no creating, editing, starting/stopping timers,
  running a survey, or logging a movement. Pure read-only.
- Reuses the existing JWT/RBAC machinery in `auth.ts`, just collapsed from
  today's four roles down to two (`admin`, `owner`), with `owner` mapped to
  read-only on every permission. Not built in the first pass — the
  permission table should just leave room for it.

### Worker types (records, not accounts)
Each: name, type, active flag, notes. Type-specific behavior below.

---

## 4. The new pipeline

### 4.1 Survey — before gate-in
Physical/mechanical health check of the container/tank as it arrives.
Outcome is either straight to **Ready to Move**, or it flags one or more
sections as required (painting, PTI, cleaning, etc.).

> **Exact field list confirmed — see §8, item 8.** A 12-item Container
> Inspection Checklist every container gets, plus a 14-item Machine Check for
> Reefer units only. Each item carries a severity (not a plain pass/fail) and
> a note once flagged.

### 4.2 Gate-In
Same idea as today: records arrival time and location. Container becomes
active in the yard.

### 4.3 Sections (replace the fixed "stages")

Each section is **optional per container** — only the ones Survey flags (or
Admin adds manually later) apply.

**Painting** — owner: Painter
- Tasks, each with its own timer: **Primer** → **1st Coat** → **2nd Coat**
  (can be marked **Not Applicable** instead of timed) → **Logo** (readymade,
  or painted).
- Rule: reefer containers default to white; dry containers' color depends on
  customer requirement, entered as **either** a pick from a standard colour
  list **or** free text for a custom/one-off colour — both options, not one.

**Painter Helper** — tied to the Painting section
- **Pre-paint**: tape display + gasket (timer).
- **Post-paint**: uncover compressor + display (timer).

**PTI (Pre-Trip Inspection)** — owner: Technician
- Tasks: **Lights**, **Strip & Curtain**, **Mantrap** (only when the
  container needs one — e.g. anteroom type).
- Dashboard requirement: total inventory count, broken down by combination —
  PTI pending / PTI ok but lights pending / PTI ok but lights & curtain
  pending / fully ok, etc.

**All-Rounder ad hoc**
- Admin assigns one task per pick from: lights/strip/curtain install,
  dry/reefer repair, painting, logo, or **Other** (free-text reason
  required). Timer tracks it like any other task.

**Cleaning** — owner: Cleaner
- Single task: clean container (timer). Tea Boy is the fallback assignee
  when no Cleaner is available.

### 4.3b Container Sailing — a separate log, not a section, but driven by the work
Confirmed: load / offload / shift is **not** a checklist section with tasks
and a timer like the others. It's its own **movement log** — an entry per
event (load, offload, or shift), with a shift entry recording which site the
container moved *from* and *to* (painting / washing / strip / light). It
doesn't gate Ready to Move the way a section does; it's a record of physical
movement, kept separately.

**Resolved 2026-09-30:** the shift half of that log isn't a free-standing
manual form — every task implies a site (painting tasks → painting site,
cleaning → washing site; PTI's two checks are two different sites: Lights →
light site, Strip & Curtain → strip site), and starting a task whose site
differs from where the container currently is replaces the "Start" button
with an explicit **"Move to `<site>`"** step first. Clicking it logs the
shift and updates the container's current site; only then does "Start"
become available. All-Rounder tasks have no fixed site, so the Admin picks
one per task (alongside assigning the worker) before the same move gate
applies. Load/Offload stay manual — those are real external events (a vessel
loading/unloading), not something any task implies. The manual Shift form
stays too, as a fallback for a move that isn't tied to any task.

### 4.4 Ready to Move
Same gating idea the current `advance`-with-open-tasks logic already has,
generalized: a container is Ready to Move once every task in every section
Survey flagged is done (its timer stopped). This computation belongs in
`packages/shared`, exactly like `isLate`/`isReady` do today, so the API and
UI can't disagree about it.

---

## 5. Proposed data model (sketch — not final, not applied)

Replaces `User.role`'s worker roles, `Container.stage`, `ContainerTask`, and
`process.ts`'s fixed `STAGES` list.

```prisma
// Simplified from today's 4-role table to 2. `owner` is read-only on every
// permission; not built in the first pass, but the shape leaves room for it.
model User {
  id           String @id @default(cuid())
  email        String @unique
  name         String
  passwordHash String
  role         String // admin | owner
}

model Worker {
  id     String  @id @default(cuid())
  name   String
  type   String  // painter | painter_helper | technician | all_rounder | cleaner | tea_boy | sailing_crew
  active Boolean @default(true)
  notes  String  @default("")
}

model Survey {
  id          String    @id @default(cuid())
  containerId String    @unique
  container   Container @relation(fields: [containerId], references: [id])
  performedAt DateTime  @default(now())
  // fields: see §8, item 8 — [{ label, severity: unassessed|good|minor|major, note }]
  outcome     String    // ready | needs-work
}

// Container/product type code (more than today's 3) drives which of these
// get created by default, same idea as checklistFor(type) today — see §8.3.
model ContainerSection {
  id          String    @id @default(cuid())
  containerId String
  container   Container @relation(fields: [containerId], references: [id])
  kind        String    // painting | pti | cleaning | all_rounder
  required    Boolean   @default(true) // flagged by survey, or added manually
  tasks       SectionTask[]
}

model SectionTask {
  id         String            @id @default(cuid())
  sectionId  String
  section    ContainerSection  @relation(fields: [sectionId], references: [id])
  key        String   // primer | coat1 | coat2 | logo | tape_display | lights | strip_curtain | mantrap | clean | other
  label      String
  applicable Boolean  @default(true) // false = "N/A" (e.g. 2nd coat skipped)
  workerId   String?
  worker     Worker?  @relation(fields: [workerId], references: [id])
  startedAt  DateTime?
  stoppedAt  DateTime?          // non-null = done
  note       String   @default("") // required when key = "other"
}

// Container Sailing — a log, not a section (confirmed §4.3b). Not part of
// the Ready-to-Move gate.
model MovementLogEntry {
  id          String    @id @default(cuid())
  containerId String
  container   Container @relation(fields: [containerId], references: [id])
  kind        String    // load | offload | shift
  fromSite    String?   // shift only: painting | washing | strip | light
  toSite      String?   // shift only
  workerId    String?
  worker      Worker?   @relation(fields: [workerId], references: [id])
  at          DateTime  @default(now())
}
```

`Container` keeps `id`/`size`/`customer`/`notes`, drops `stage` **and
`depot`** (confirmed 2026 — this build is for one yard, not a multi-depot
network; see §8 resolved), gains a `typeCode` (replacing today's 3-value
`type` enum with the fuller product-code list — pending §8.3), `readyAt`,
and relations to `Survey`, `ContainerSection[]`, and `MovementLogEntry[]`.

---

## 6. What carries over unchanged
- `CustomerOrder`, `OffLeaseUnit` — untouched by this redesign. `Depot` does
  **not** carry over — see §8.
- The audit-trail concept (`ContainerEvent`) — kept; actor is always Admin.
- **The entire visual layer** — `source/crystal-design-system.html`, the
  extractor pipeline, `tokens.css`, `crystal.css`, every Crystal component
  (`Button`, `DataTable`, `Overlay`, `StatusPill`, the theme toggle, …) —
  confirmed unchanged. This redesign reuses all of it; it only replaces what
  the screens are built *on top of*, not the design system itself.
- `packages/shared` as the single source of truth — timer/elapsed math,
  section-completion gating, and the PTI-breakdown aggregation all belong
  there, so this redesign keeps the project's existing "no value is ever
  typed twice" principle rather than breaking it.

---

## 7. Testing strategy
- **`packages/shared`**: pure-function tests for survey-outcome → required
  sections, timer elapsed/duration math, the "every flagged section
  complete → ready to move" gate, and the PTI-breakdown aggregation — same
  style as today's `readiness.test.ts` (fixed `today`, no mocks).
- **`apps/api`**: integration tests per new route — worker CRUD, survey
  submission, section/task timer start/stop, the ready-to-move gate — plus
  a rewritten `seed.ts` fixture matching the new shape.
- **`apps/web` e2e**: rewritten around a single Admin login (the existing
  role-permission-matrix tests go away with the roles they tested),
  covering survey → gate-in → section work → ready-to-move as one flow,
  plus the technician-style PTI breakdown dashboard.

---

## 8. Open questions

### Resolved 2026-09-30
1. ~~Container Sailing~~ → **separate movement log**, not a section (§4.3b, §5).
2. ~~Existing manager/supervisor/viewer accounts~~ → **Admin has full
   control**; an **Owner** (real-time read-only, no manipulation) may be
   added later, reusing the existing JWT/RBAC machinery collapsed to two
   roles (§3).
3. ~~Paint colour for dry containers~~ → **both** a picklist and free text,
   not one or the other (§4.3).
4. ~~Rollout~~ → **replace the current model in place** (no production data
   to migrate) — but see the hard constraint at the top of this doc: the
   visual design system is explicitly out of scope for this change.
5. ~~"sats team" / "mgr"~~ → **ignore for now**, not load-bearing.

### Resolved 2026-10-01
6. ~~Multi-depot network~~ → **dropped.** This build is for one yard, not a
   network of depots — `Container.depot`, the `Depot` model, and every
   depot selector/list in the UI are removed. Physical sites *within* the
   yard (painting / washing / strip / light — used by the Container Sailing
   movement log, §4.3b) are unaffected; those aren't depots.
7. ~~"New container" entry point~~ → confirmed: creating a container always
   goes through Survey first; there's no direct-registration path anymore.
   The existing top-bar "New container" button's position/label stays as
   is — only what it opens changes, to the survey-first flow.
8. ~~"Tomorrow's Work"~~ → superseded, in the v2 preview, by a **Live Board**
   with a by-stage / by-crew toggle: what needs doing right now, sliced by
   section or by worker, instead of a static next-day checklist.
9. ~~Worker records~~ → confirmed each Worker gets its own detail record
   (opened from the roster), not just a table row: type, notes, the
   active/inactive toggle, and a live breakdown of that worker's running /
   assigned-not-started / completed tasks.

### Resolved 2026-09-30 (later)
10. ~~v1 screens in the UI~~ → **removed entirely.** Confirmed: nothing from
    the v1 pipeline UI stays reachable — Depot Command, Dashboard, Tomorrow's
    Work, Readiness Pipeline, Stage Timeline, All Containers, Checklist
    Library, and Delayed/At Risk are deleted (screens, nav entries, routes,
    and the v1-only components/hooks that only they used: `AddContainerDialog`,
    `ContainerDrawer`, `ContainerGauge`, `KanbanBoard`, `lib/queries.ts`,
    `lib/format.ts`). This is now a single-workflow app. With v1 gone, the
    `/v2/` route prefix and "(Preview)" labeling no longer meant anything, so
    routes and nav/page titles dropped them too (`/v2/yard` → `/yard`, "Yard
    Board (Preview)" → "Yard Board", etc.); the root `/` now redirects to
    `/yard` instead of `/depot`.
    **Left alone, on purpose:** `apps/api` and `packages/shared` (the
    backend/domain layer — this was a UI-only request), `Login`/`auth.tsx`/
    `devAccounts.ts` (real authentication, not part of the v1 pipeline
    concept being replaced), and `api.ts`'s HTTP client (still mirrors real,
    working backend routes — trimming it serves no UI-visible purpose). The
    command palette's container search, previously backed by the v1
    `overview` API, was rewired to the v2 mock store instead of being cut,
    so ⌘K search still works.
11. ~~Movement log~~ → **coupled to the work, not a free-standing form** —
    see §4.3b for the full flow (task → site → "Move to `<site>`" → Start).
12. ~~Worker records — edit & delete~~ → confirmed: Admin can edit a worker's
    name/type/notes (including changing their designation) from the Worker
    Detail drawer, and can delete a worker outright. Deleting is **blocked**
    while that worker has a running task (stop it first, so a live timer
    never silently loses its assignee); their unstarted assignments go back
    to unassigned, and finished work keeps its historical record of who did
    it. A destructive confirm ("Delete `<name>`", naming the consequence, per
    the design system's `ConfirmDialog` convention) gates the delete itself.
13. ~~Detail views as centered rectangles, not side drawers~~ → the Worker
    Detail, New Container/Survey, and Container Detail views were all moved
    off the right-anchored `Drawer` onto the centered `Modal` primitive
    (`size="lg"`, 760px), each laid out with its content side-by-side rather
    than stacked, so none of them requires scrolling for a typical case —
    Container Detail (the busiest: up to 4 sections plus a movement log) uses
    an auto-fit two-column grid of section panels. Extended `Modal` itself
    with `subtitle` and `headerActions` slots (name/designation left,
    Edit/Delete right) so it could carry what `Drawer` used to.
14. ~~Quick actions on the Live Board~~ → Start / "Move to `<site>`" / Stop
    now sit directly on each task row in both Live Board views, so acting on
    a task no longer requires opening the container's full detail first. The
    row's label still opens that detail, for anything beyond start/stop/move.
15. ~~Move destination isn't fixed by the task~~ → confirmed: a container can
    genuinely be shifted from any site to any other, so the "needs move" step
    (§4.3b) is a **picker** (defaulting to the task's own site, marked
    "recommended") rather than a single fixed-destination button —
    everywhere it appears: Container Detail's task rows and both Live Board
    views. Clicking "Move" pops up the site list (the design system's
    `Menu`/`DropdownMenu`); picking one logs that move immediately. Start
    still strictly requires the container to be at that task's specific site
    (unchanged — "you can't paint a container sitting at the washing site").
    **Bug fixed along the way:** `.dd-menu`'s z-index (`--z-dropdown`, 400)
    sat *below* a modal's scrim (`--z-modal`, 800) in the design system's
    scale, so any dropdown menu opened from inside a Modal rendered behind
    the scrim — visible but unclickable. Raised `.dd-menu` specifically to
    `calc(var(--z-modal) + 1)`, matching the same pattern the command
    palette already used to guarantee it renders above modals. Left the
    shared `--z-dropdown` token itself untouched, since it's also used by
    the sidebar rail's hover-expand — surfaces above ordinary content, never
    above an open modal.

### Resolved 2026-09-30 (later still)
16. ~~Painting task order was never enforced~~ → **bug fixed.** §4.3's
    Primer → 1st Coat → 2nd Coat → Logo order was written down but not built:
    every task's Start button was independently clickable regardless of the
    others' state, so 1st Coat could start before Primer had even begun.
    Container Detail's Painting tasks now check the tasks before them in that
    fixed order; a task whose predecessor isn't `done`/`na` shows "Waiting on
    `<predecessor>`" in place of its Start/Move control. PTI, Cleaning, and
    All-Rounder are unaffected — their tasks always ran in parallel, per §4.3,
    and still do. Marking an optional task N/A is never blocked, since that's
    a "this step isn't needed" decision independent of timing.
17. ~~Paint colour picker was missing from the UI~~ → §4.3/item 3 above
    documented the *decision* (picklist + free text) but the survey-intake
    form had no such field yet. Added: reefers skip the field entirely and
    are implicitly white (shown, disabled, as confirmation); dry/tank units
    get a standard-colour dropdown with a trailing "Custom…" option that
    reveals a free-text input. The chosen colour is stored on the container
    and shown in Container Detail's subtitle line.

### Resolved 2026-10-01
18. ~~Per-container report~~ → confirmed: new **Ready to Move** nav tab
    (sidebar, `/ready`) lists only containers that are actually ready
    (`readyAt` or `isReadyToMove`) — the report is generated only once work
    is finished, not mid-process. Opening one shows its full timeline
    (survey → every section's tasks, each with who did it and how long it
    took → movement log → ready confirmation) in a modal, with a "Get
    report" button. That navigates (same tab, so the live `V2DataProvider`
    state carries over — no new browser tab, which would reinitialize the
    store from scratch) to `/containers/:id/report`, a page mounted
    *outside* `AppShell` (no sidebar/topbar) so there's nothing but the
    report to capture. Its "Print / Save as PDF" button is just
    `window.print()` — no PDF library, no backend. Direct-URL access to a
    not-yet-ready container's report is handled defensively: the page still
    renders (so nothing 404s) but Print is disabled with a visible warning,
    since that path only happens by typing/bookmarking the URL — the normal
    flow (via Ready to Move) never offers a report before it's earned.
    Content lives in one shared `ContainerReportContent` component so the
    on-screen timeline and the printed report can never drift apart.

### Resolved 2026-10-01 (feature backlog — batch 1)
19. ~~Edit/cancel a container, draft registrations~~ → Container Detail
    gets Edit (type/size/customer/colour — not the ID, which is the lookup
    key for tasks/movements/drafts everywhere else) and Delete
    (`ConfirmDialog`, disabled while a task is running), matching the
    existing Worker Detail pattern exactly. The intake form gets "Save as
    draft", storing a snapshot (`ContainerDraftData`) in the same
    `V2DataProvider` store (not localStorage — nothing else here survives a
    reload yet either; drafts stay consistent with that until the real
    backend lands). A "Drafts (N)" button next to "New container" in the
    top bar resumes one, pre-filling the form.
20. ~~Priority/rush flag~~ → `priority: boolean` on `MockContainer`, set at
    intake or toggled from Container Detail's header. Rush containers sort
    first on Yard Board and Live Board (By stage) and carry a red "Rush"
    marker — card border + pill on Yard Board, a small icon on Live Board's
    tighter cards.
21. ~~Site occupancy visibility~~ → `containersBySite()` backs a "Containers
    by site" panel on Dashboards (new panel, not a second copy of the total
    count — Dashboards already had that via `HeroCard`) and inline counts in
    Container Detail's Move picker and the Movement log's destination
    select, where the number actually matters for the decision.
22. ~~Stronger Yard Board filtering~~ → customer (text), worker, colour, and
    survey-date-range filters added alongside the existing status chips, all
    AND-combined.
23. ~~Aging/SLA indicator~~ → `agingDays()`/`agingStatus()`, baselined on
    `registeredAt` (new field, stamped at gate-in — the only timestamp a
    not-yet-surveyed container has) pre-survey, or `survey.performedAt`
    once surveyed. Thresholds (3d warn, 7d bad) are a starting guess, not a
    number from the depot. Surfaces as a badge on Yard Board (cards + a new
    list column) and a "Needs attention" panel on Dashboards, worst-first.
24. ~~Backend portability~~ → no backend decision made (language still
    open), but every new mutation (`updateContainer`, `removeContainer`,
    `setPriority`, the draft CRUD) follows the exact shape the existing ones
    already use in `v2Store.tsx` — a plain named function, store internals
    swappable for real API calls later without touching a single call site.
25. ~~Reporting beyond the per-container report~~ → a yard-wide report
    (`/reports/yard`, same chrome-free print pattern as the per-container
    one, linked from a new "Download yard report" button on Dashboards):
    containers by status, average turnaround per section, volume by
    customer. Worker Detail's hours-worked stat gets a Week/Month/All-time
    toggle, and was switched from summing `estHrs` (the estimate) to actual
    `elapsedSec` — summing the estimate was a pre-existing inaccuracy for a
    stat labelled "hours worked". Week/Month need a real timestamp, so a new
    `completedAt` field was added to `MockTask`, stamped on stop/N-A; tasks
    completed before this change have no `completedAt` and only ever count
    toward "All time" — there's no genuine date to bucket them into a
    week or month, and backfilling one would be inventing data.

**Preview implementation note:** the v2 preview's mock data lives in one
shared `V2DataProvider` (`apps/web/src/lib/v2Store.tsx`) so a timer started
on one screen is genuinely live on every other v2 screen. It must be mounted
*above* `AppShell` in `App.tsx`, not inside one of AppShell's routes —
`AppShell`'s `<main key={pathname}>` remounts its entire subtree on every
navigation (to replay the per-page entrance animation), which would silently
reset the shared store on every route change if the provider sat underneath
it. Keep this in mind for any future provider that needs to outlive
in-app navigation.

### Resolved 2026-10-01 (navigation consolidation)
26. ~~Ready to Move as its own sidebar tab~~ → **removed, folded into
    Container Detail.** It was a second screen showing the same containers
    Yard Board's "Ready to move" filter chip already showed, plus a timeline
    and a report button — Container Detail already renders that same
    survey/sections/movement-log content for *every* container, ready or
    not, so the duplication added a screen without adding information. The
    "Get report" button now lives directly in Container Detail's footer,
    next to the "Ready to move" pill, enabled once `readyAt` is set — found
    exactly where an admin already is when a container finishes, not on a
    separate screen they'd have to think to visit. Sidebar is down to 4
    tabs: Yard Board, Live Board, Worker Roster, Dashboards.

### Resolved 2026-10-03 (survey checklist)
8. ~~Survey fields~~ → **confirmed, from the depot's actual printed form**:
   a 12-item **Container Inspection Checklist** every container gets
   (Outside/Undercarriage, Inside and Outside Doors, Right Side, Left Side,
   Front Wall, Ceiling/Roof, Floor (Inside), Contamination, Gasket Door,
   Curtain, Tube Light, Mantrap), plus a 14-item **Machine Check** for Reefer
   units only (Compressor, Condenser Coil, Evaporator Coil, Condenser Fan,
   Evaporator Fan, Controller/Microprocessor, Power Cable & Plug, Refrigerant
   Gas Charge, Temperature Sensors/Probes, Defrost System, Cable 4 Core 4mm
   18Mtr, Motor Condition, Contractor, ISO Plug) — a Dry/Tank unit has no
   refrigeration machinery to check. Each item is **not** a plain pass/fail:
   it carries a severity (`unassessed` / `good` / `minor damage` / `major
   damage` — unassessed is its own state, distinct from good, since nothing
   is assumed OK) and, once flagged, a free-text note on what's actually
   wrong — a generic "Good/Bad" checkbox can't say *what* the issue is, only
   *that* there is one. Lives in `mockV2.ts` as `CONTAINER_INSPECTION_FIELDS`
   / `MACHINE_CHECK_FIELDS` / `FieldSeverity`; the intake form
   (`SurveyIntakeDialog.tsx`) re-derives the active field set live if the
   container type crosses the Reefer/non-Reefer line mid-form, keeping any
   answers already given for fields that still apply.

### Resolved 2026-10-03 (repair routing)
27. ~~Where physical repair work happens~~ → **its own stage, by its own
    worker, not folded into Painting.** Painting stays painter/painter-helper
    territory — the repaint, not the fix. A flagged Container Inspection item
    that's actual body/structural damage (Outside/Undercarriage, Doors,
    Right/Left Side, Front Wall, Ceiling/Roof, Floor, Gasket Door — see
    `REPAIR_ITEMS`) now generates its own "Repair: `<item>`" task in the
    **Repairment** stage, done by an **All-Rounder**. Same underlying
    `all_rounder` SectionKind as before — only the display label changed
    (`SECTION_LABELS.all_rounder`), which also resolves the earlier
    "All-Rounder is both a stage and a role" confusion: Repairment is the
    stage, All-Rounder is the worker who staffs it
    (`WORKER_TYPE_LABELS.all_rounder` is untouched). A flagged Machine Check
    item generates the same kind of task inside **PTI** instead, for a
    **Technician** (`repairTasksFor`, shared by both). Contamination drives
    **Cleaning** on its own. Three checklist items (Curtain, Tube Light,
    Mantrap) already matched an existing PTI task by name and don't spawn a
    second one. Each stage now reacts only to its own issues — a single
    "anything at all failed" flag no longer drives Painting *and* Cleaning
    *and* nothing else, the way it used to.

### Still open
9. **Container/product type code.** Confirmed that type still gates which
   checklist applies — "we have multiple types of container here so each
   one will have its respective checklist" — but the message describing the
   full type/product-code list was cut off. Still need: the complete list
   of type codes and, for each, which sections/tasks it maps to (today's
   `checklistFor(type)` in `process.ts` is the equivalent to extend).

---

## 9. Boundaries
- **Always**: keep `npm run typecheck` / `lint` / `lint:css` / `test` green
  at every incremental step; keep section/timer/gating logic living in
  `packages/shared`, not duplicated into the API or the UI.
- **Never**: touch `source/crystal-design-system.html`, `tokens.css`,
  `crystal.css`, `generated/icons.ts`, or any Crystal component's styling as
  part of this work — confirmed out of scope. Only consume those primitives,
  the same way the app does today.
- **Never**: guess at the full container/product type-code list and build
  against the guess — still pending from the user (§8, item 9). The Survey
  field list itself is resolved (§8, item 8) — build against that.
- **Ask first**: before deleting the JWT/RBAC scaffolding in `auth.ts` —
  reuse and collapse it to `admin`/`owner` rather than removing it, since
  Owner is a likely near-term addition.
- **Don't code yet.** Per explicit instruction: this file is the plan.
  Implementation starts only once items 6–7 above are answered.
