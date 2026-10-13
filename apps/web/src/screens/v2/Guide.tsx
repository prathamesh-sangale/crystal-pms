import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/crystal/Feedback';
import { InputWithIcon } from '../../components/crystal/Form';
import { Icon, type IconName } from '../../components/crystal/Icon';

interface Step {
  icon: IconName;
  title: string;
  body: string;
}

/** The "easiest way possible" overview — a short, always-visible walkthrough
 * of the one loop the whole app is built around, read top to bottom in under
 * a minute. The FAQ below this is the deep reference; this is the cheat
 * sheet, not a duplicate of it. */
const STEPS: Step[] = [
  {
    icon: 'truck',
    title: '1. A container arrives',
    body: 'Open Yard Board and tap "New container." Fill in the survey first — this decides what work the container actually needs.',
  },
  {
    icon: 'check-circle',
    title: '2. Gate it in',
    body: 'Type the container number and its details auto-fill from IMS if it\'s already in there — you can still change anything. Submit to gate it in.',
  },
  {
    icon: 'grid',
    title: '3. Work starts automatically',
    body: 'Based on the survey, the container gets its own set of sections — Painting, PTI, Cleaning, Repairment, Sailing Crew — each with its own task list.',
  },
  {
    icon: 'pulse',
    title: '4. Assign and run tasks',
    body: 'On Live Board or inside the container, tap a task to assign a worker and start its clock. Tap it again to mark it done.',
  },
  {
    icon: 'upload',
    title: '5. Mark it ready to move',
    body: 'Once every task is done, upload a photo — this is required, not optional. That unlocks Gate Out.',
  },
  {
    icon: 'door',
    title: '6. Gate it out',
    body: 'Gate Out closes the container\'s file. It still stays visible in its printable report afterward.',
  },
];

interface FaqItem {
  q: string;
  a: string;
}

interface FaqGroup {
  heading: string;
  icon: IconName;
  items: FaqItem[];
}

const FAQ: FaqGroup[] = [
  {
    heading: 'Getting started',
    icon: 'info',
    items: [
      { q: 'What is each part of the sidebar for?', a: 'Live Board and Yard Board are the daily work screens. Worker Roster is your crew list. Dashboards is the day\'s numbers and your PMS Sheet sync. Hydra is a separate loading/unloading/shifting log. IMS Stock shows what\'s available at your yard right now, straight from IMS.' },
      { q: 'Is there a fast way to jump to any screen?', a: 'Press Ctrl+K (Cmd+K on Mac) anywhere in the app — it opens a search box that jumps to any screen or any container by number.' },
      { q: 'Can I switch between light and dark mode?', a: 'Yes — the sun/moon icon in the top bar swaps the whole app\'s theme instantly.' },
    ],
  },
  {
    heading: 'Registering a container (Gate-In)',
    icon: 'truck',
    items: [
      { q: 'How do I register a new container?', a: 'Yard Board → "New container." Do the survey first (this decides what sections the container needs), then fill in type/size/color and the rest of the gate-in details, then submit.' },
      { q: 'What does the survey actually decide?', a: 'If the survey comes back clean, the container may need very little work. If it finds issues, those become the sections and tasks the container gets — so always survey carefully, it drives everything after.' },
      { q: 'What does auto-fill from IMS mean?', a: 'If you type a container number that already exists in IMS\'s own records for your yard, its type/size/grade and other details fill in automatically. You can still change any of it — it\'s a starting point, never locked in.' },
      { q: 'I started a gate-in form but got interrupted — is my work lost?', a: 'No. Unfinished gate-in forms save automatically as drafts. Look for "Drafts" in the top bar to pick up exactly where you left off.' },
      { q: 'Does this system write anything back into IMS?', a: 'No, never. IMS is only ever read from, for auto-fill and for IMS Stock — nothing in this app writes to it, by design.' },
    ],
  },
  {
    heading: 'Working the yard (sections & tasks)',
    icon: 'grid',
    items: [
      { q: 'What are the five sections?', a: 'Painting, PTI, Cleaning, Repairment (general repair work), and Sailing Crew (loading/offloading/shifting tasks). A container only gets the sections its survey actually calls for.' },
      { q: 'How do I assign a worker to a task?', a: 'Tap "Start" on the task, pick a worker from the list, and its clock starts running. Tap it again once the work is finished to mark it done.' },
      { q: 'Can I add a task that wasn\'t there from the start?', a: 'Yes — open the container and use "Add task" on the relevant section. Useful for anything that comes up after gate-in, like an extra repair or a late Sailing Crew job.' },
      { q: 'What\'s the difference between Live Board and Yard Board?', a: 'Live Board shows every open task across every container, grouped by stage or by crew — it\'s the "what needs doing right now" view. Yard Board shows one container at a time with its full picture — survey, sections, progress.' },
      { q: 'What does the priority flag (fast-track) mean?', a: 'It marks a container to be handled ahead of normal work — shown as a red outline/flag everywhere that container appears.' },
      { q: 'How do I find one specific container quickly?', a: 'Use the search box on Live Board or Yard Board (by container number), or press Ctrl+K to jump straight to it from anywhere.' },
    ],
  },
  {
    heading: 'Marking ready & Gate-Out',
    icon: 'door',
    items: [
      { q: 'Why can\'t I mark a container ready to move?', a: 'Every task in every section has to be marked done (or N/A) first. Once nothing is left open, the ready-to-move photo upload appears in its place.' },
      { q: 'Why does it ask for a photo before Gate Out?', a: 'The ready-to-move photo is a required proof step, not optional evidence — it\'s the final check before a container can leave.' },
      { q: 'Where can I see a container\'s full history after it leaves?', a: 'Its printable report — survey, every task, both gate-in and gate-out details — stays available even after the container has departed.' },
    ],
  },
  {
    heading: 'Worker Roster',
    icon: 'user',
    items: [
      { q: 'How do I add a real worker?', a: 'Worker Roster → add worker → name, role, and whether they\'re active. They\'ll then show up as an option everywhere tasks get assigned.' },
      { q: 'What do the roles mean?', a: 'Painter, Painter Helper, Technician, All-Rounder, Cleaner, Tea Boy, and Sailing Crew — each task is normally built for one of these roles, shown as a suggestion when assigning.' },
      { q: 'What happens if I mark a worker inactive instead of deleting them?', a: 'They stay in the records (so past work they did still shows correctly) but stop appearing as an option for new task assignments.' },
    ],
  },
  {
    heading: 'Dashboards & the PMS Sheet',
    icon: 'gauge',
    items: [
      { q: 'What does Dashboards show?', a: 'A PTI breakdown and how much load each section is carrying — a quick read on where the day\'s work actually stands.' },
      { q: 'What does "Sync to PMS Sheet" do?', a: 'It pushes a fresh, full snapshot of containers, the gate log, workers, and Hydra movements into your own PMS Google Sheet, across its own four tabs. It only runs when you click it — not automatically — so click it whenever you want the sheet caught up.' },
      { q: 'Is the PMS Sheet the same as IMS\'s sheet?', a: 'No — two completely separate sheets. IMS\'s own sheet is never written to by this app. The PMS Sheet is your own, and this app only ever writes to it, never reads from it.' },
    ],
  },
  {
    heading: 'Hydra movement log',
    icon: 'truck',
    items: [
      { q: 'What is Hydra, and how is it different from the main workflow?', a: 'It\'s a separate loading/unloading/shifting log — independent of the Painting/PTI/Cleaning readiness workflow. Use it to record Hydra crane movements on their own timeline.' },
      { q: 'Can I export Hydra\'s log?', a: 'Yes — "Export CSV" on the Hydra screen, filterable by month.' },
    ],
  },
  {
    heading: 'IMS Stock',
    icon: 'package',
    items: [
      { q: 'What does IMS Stock show?', a: 'Every container IMS currently marks as "Stock" (available) at Crystal Yard — in one browsable list instead of searching one container number at a time.' },
      { q: 'Can I filter it?', a: 'Yes — by container number (search), and by any combination of Type and Size at once. Switch between a table (List) or a card view (Cards).' },
      { q: 'Can I change anything from this screen?', a: 'No — IMS Stock is read-only, the same as every other IMS connection in this app. It never writes anything back.' },
      { q: 'Why does it sometimes take a moment to open the first time?', a: 'Its data comes live from Google Sheets and is cached for 5 minutes at a time — the very first open in that window takes a couple of seconds, every open after that is instant until the cache refreshes.' },
    ],
  },
  {
    heading: 'Shortcuts & tips',
    icon: 'star',
    items: [
      { q: 'What keyboard shortcut should I actually remember?', a: 'Ctrl+K (Cmd+K on Mac) — opens search from anywhere, jumps to any screen or any container by number.' },
      { q: 'Is there a one-click way to reach IMS Stock specifically?', a: 'Yes — the package icon in the top bar, next to search, on every screen.' },
    ],
  },
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function Guide(): React.ReactElement {
  const [query, setQuery] = useState('');

  const filteredGroups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return FAQ;
    return FAQ.map((group) => ({
      ...group,
      items: group.items.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <div className="stack stack-loose">
      <div className="card">
        <h2 style={{ margin: '0 0 var(--s-3)', fontFamily: 'var(--f-display)', fontSize: '15px' }}>
          The system in six steps
        </h2>
        <div style={{ columnWidth: '300px', columnGap: 'var(--s-4)' }}>
          {STEPS.map((step) => (
            <div
              key={step.title}
              className="cluster"
              style={{ alignItems: 'flex-start', gap: 'var(--s-3)', breakInside: 'avoid', marginBottom: 'var(--s-4)' }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: '36px',
                  height: '36px',
                  borderRadius: 'var(--r-md)',
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon name={step.icon} size="sm" />
              </span>
              <div>
                <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '2px' }}>{step.title}</div>
                <div style={{ fontSize: '12.5px', color: 'var(--text-3)' }}>{step.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <InputWithIcon
        icon="search"
        placeholder="Search every question…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '320px' }}
      />

      {filteredGroups.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches that">
          Try a different word, or browse the groups below with the search box cleared.
        </EmptyState>
      ) : (
        <div className="stack stack-loose">
          {filteredGroups.map((group) => (
            <div key={group.heading} className="stack stack-tight">
              <div className="cluster" style={{ gap: 'var(--s-2)' }}>
                <Icon name={group.icon} size="sm" />
                <h3 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: '13px' }}>{group.heading}</h3>
              </div>
              <div className="stack stack-tight">
                {group.items.map((item) => (
                  <details key={slugify(item.q)} className="card" style={{ padding: 'var(--s-3) var(--s-4)' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '13px', color: 'var(--text)' }}>
                      {item.q}
                    </summary>
                    <p style={{ margin: 'var(--s-2) 0 0', fontSize: '12.5px', color: 'var(--text-3)', lineHeight: 1.5 }}>
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
