import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../../lib/nav';
import { EmptyState } from '../../components/crystal/Feedback';
import { InputWithIcon } from '../../components/crystal/Form';
import { Icon, type IconName } from '../../components/crystal/Icon';

interface Step {
  icon: IconName;
  label: string;
}

/** A flow, not a document — icon + 2-4 words each, read in one glance, no
 * sentences to parse. Replaces the earlier paragraph/FAQ versions entirely
 * after direct feedback that text-and-scroll wasn't the right shape for
 * this at all. */
const STEPS: Step[] = [
  { icon: 'truck', label: 'New container' },
  { icon: 'grid', label: 'Sections created' },
  { icon: 'pulse', label: 'Assign & run tasks' },
  { icon: 'upload', label: 'Ready photo' },
  { icon: 'door', label: 'Gate out' },
];

/** One punchy line per screen — the first one (Live Board) gets the most
 * personality on purpose, since it's the one everyone opens first every day. */
const BLURB: Record<string, string> = {
  '/live': "The yard's pulse, live",
  '/yard': 'One container, full picture',
  '/workers': 'Your crew, on record',
  '/dashboards': "Today's numbers, at a glance",
  '/hydra': 'Loading, unloading, shifting — logged',
  '/ims-stock': "What's ready to go, from IMS",
};

const TIPS: Array<{ icon: IconName; text: string }> = [
  { icon: 'search', text: 'Ctrl+K jumps anywhere' },
  { icon: 'shield', text: 'IMS is read-only, always' },
  { icon: 'refresh', text: 'PMS Sheet sync is manual' },
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

/** The deep reference beneath the quick map above — every real question an
 * admin is likely to hit, grouped by topic. Collapsed by default (just the
 * question line shows) so "detailed" doesn't mean "a wall of open text" —
 * the groups themselves run in CSS columns too, so a normal desktop screen
 * shows several topics side by side instead of one long single column. */
const FAQ: FaqGroup[] = [
  {
    heading: 'Getting started',
    icon: 'info',
    items: [
      { q: 'What is each part of the sidebar for?', a: 'Live Board and Yard Board are the daily work screens. Worker Roster is your crew list. Dashboards is the day\'s numbers and your PMS Sheet sync. Hydra is a separate loading/unloading/shifting log. IMS Stock shows what\'s available at your yard right now, straight from IMS.' },
      { q: 'Is there a fast way to jump to any screen?', a: 'Press Ctrl+K (Cmd+K on Mac) anywhere — it opens a search box that jumps to any screen or any container by number.' },
      { q: 'Can I switch between light and dark mode?', a: 'Yes — the sun/moon icon in the top bar swaps the whole app\'s theme instantly.' },
      { q: 'Who can sign in?', a: 'Right now, one Admin account runs the app day to day (SPEC.md\'s direction). A few other seeded roles exist in the system but aren\'t part of daily use yet.' },
    ],
  },
  {
    heading: 'Registering a container (Gate-In)',
    icon: 'truck',
    items: [
      { q: 'How do I register a new container?', a: 'Yard Board → "New container." Do the survey first (this decides what sections the container needs), then fill in type/size/color and the rest of the gate-in details, then submit.' },
      { q: 'What does the survey actually decide?', a: 'If it comes back clean, the container may need very little work. If it finds issues, those become the sections and tasks the container gets — survey carefully, it drives everything after.' },
      { q: 'What does auto-fill from IMS mean?', a: 'If the container number already exists in IMS for your yard, its type/size/grade and other details fill in automatically. You can still change any of it.' },
      { q: 'I got interrupted mid gate-in — is my work lost?', a: 'No. Unfinished gate-in forms save as drafts automatically. Open "Drafts" in the top bar to resume exactly where you left off.' },
      { q: 'Does this app write anything back into IMS?', a: 'No, never. IMS is only ever read from — nothing in this app writes to it, by design.' },
    ],
  },
  {
    heading: 'Working the yard (sections & tasks)',
    icon: 'grid',
    items: [
      { q: 'What are the five sections?', a: 'Painting, PTI, Cleaning, Repairment (general repair work), and Sailing Crew (loading/offloading/shifting tasks). A container only gets the sections its survey calls for.' },
      { q: 'How do I assign a worker to a task?', a: 'Tap "Start" on the task, pick a worker, and its clock starts running. Tap it again once finished to mark it done.' },
      { q: 'Can I add a task that wasn\'t there from the start?', a: 'Yes — open the container and use "Add task" on the relevant section. Good for anything that comes up after gate-in.' },
      { q: 'What\'s the difference between Live Board and Yard Board?', a: 'Live Board shows every open task across every container, grouped by stage or by crew. Yard Board shows one container at a time with its full picture.' },
      { q: 'What does the priority (fast-track) flag mean?', a: 'It marks a container to be handled ahead of normal work — shown as a red outline everywhere it appears.' },
      { q: 'How do I find one specific container quickly?', a: 'Search on Live Board/Yard Board by container number, or press Ctrl+K to jump straight to it from anywhere.' },
    ],
  },
  {
    heading: 'Marking ready & Gate-Out',
    icon: 'door',
    items: [
      { q: 'Why can\'t I mark a container ready to move?', a: 'Every task in every section has to be done (or N/A) first. Once nothing is open, the ready-to-move photo upload appears in its place.' },
      { q: 'Why does it ask for a photo before Gate Out?', a: 'The ready-to-move photo is a required proof step, not optional — the final check before a container can leave.' },
      { q: 'Where can I see a container\'s history after it leaves?', a: 'Its printable report — survey, every task, both gate-in and gate-out details — stays available even after it has departed.' },
    ],
  },
  {
    heading: 'Worker Roster',
    icon: 'user',
    items: [
      { q: 'How do I add a real worker?', a: 'Worker Roster → add worker → name, role, whether they\'re active. They then show up as an option everywhere tasks get assigned.' },
      { q: 'What do the roles mean?', a: 'Painter, Painter Helper, Technician, All-Rounder, Cleaner, Tea Boy, Sailing Crew — each task is normally built for one of these as a suggestion.' },
      { q: 'What happens if I mark a worker inactive instead of deleting?', a: 'They stay in the records (past work still shows correctly) but stop appearing as an option for new assignments.' },
    ],
  },
  {
    heading: 'Dashboards & the PMS Sheet',
    icon: 'gauge',
    items: [
      { q: 'What does Dashboards show?', a: 'A PTI breakdown and how much load each section is carrying — a quick read on where the day\'s work stands.' },
      { q: 'What does "Sync to PMS Sheet" do?', a: 'Pushes a fresh snapshot of containers, the gate log, workers, and Hydra movements into your own Google Sheet, across its own four tabs. Manual — click it whenever you want the sheet caught up.' },
      { q: 'Is the PMS Sheet the same as IMS\'s sheet?', a: 'No — two separate sheets. IMS\'s own sheet is never written to. The PMS Sheet is yours, and this app only ever writes to it, never reads from it.' },
    ],
  },
  {
    heading: 'Hydra movement log',
    icon: 'truck',
    items: [
      { q: 'What is Hydra?', a: 'A separate loading/unloading/shifting log, independent of the Painting/PTI/Cleaning readiness workflow.' },
      { q: 'Can I export Hydra\'s log?', a: 'Yes — "Export CSV" on the Hydra screen, filterable by month.' },
    ],
  },
  {
    heading: 'IMS Stock',
    icon: 'package',
    items: [
      { q: 'What does IMS Stock show?', a: 'Every container IMS currently marks "Stock" (available) at your yard, in one browsable list instead of searching one number at a time.' },
      { q: 'Can I filter it?', a: 'Yes — by container number, and by any combination of Type and Size at once. Switch between a table (List) or cards.' },
      { q: 'Can I change anything from this screen?', a: 'No — read-only, same as every other IMS connection in this app.' },
      { q: 'Why does it sometimes take a moment to open?', a: 'Its data comes live from Google Sheets, cached 5 minutes at a time — the first open in that window takes a couple of seconds, every open after is instant.' },
    ],
  },
];

function StepIcon({ icon, size = 52 }: { icon: IconName; size?: number }): React.ReactElement {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--r-lg)',
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={size > 40 ? 'md' : 'sm'} />
    </span>
  );
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function Guide(): React.ReactElement {
  const navigate = useNavigate();
  const screens = NAV_ITEMS.filter((item) => item.to !== '/guide');
  const [query, setQuery] = useState('');

  const filteredFaq = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return FAQ;
    return FAQ.map((group) => ({
      ...group,
      items: group.items.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(needle)),
    })).filter((group) => group.items.length > 0);
  }, [query]);

  return (
    <div className="stack stack-loose">
      {/* The flow — a glance, not a read. */}
      <div
        className="cluster"
        style={{ gap: 'var(--s-2)', flexWrap: 'wrap', justifyContent: 'center', padding: 'var(--s-4) 0' }}
      >
        {STEPS.map((step, i) => (
          <span key={step.label} className="cluster" style={{ gap: 'var(--s-2)' }}>
            <span className="stack" style={{ alignItems: 'center', gap: '6px', width: '96px' }}>
              <StepIcon icon={step.icon} />
              <span style={{ fontSize: '11.5px', fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>
                {step.label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span style={{ color: 'var(--text-3)', opacity: 0.6 }}>
                <Icon name="arrow-right" size="sm" />
              </span>
            )}
          </span>
        ))}
      </div>

      {/* The map — tap a screen instead of reading about it. .stack (not a
          bare inline flex column) on purpose: it's the exact layout utility
          already proven to render icon+label correctly in the flow strip
          above, and it carries min-width:0 — a plain inline flex column on a
          CSS Grid item was leaving these labels unreadably clipped. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--s-3)' }}>
        {screens.map((item) => (
          <button
            key={item.to}
            type="button"
            className="card hoverable stack stack-tight"
            style={{ textAlign: 'left', color: 'var(--text)' }}
            onClick={() => navigate(item.to)}
          >
            <StepIcon icon={item.icon} size={36} />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{item.label}</span>
            {BLURB[item.to] && (
              <span style={{ fontSize: '11.5px', color: 'var(--text-3)' }}>{BLURB[item.to]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="cluster" style={{ gap: 'var(--s-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {TIPS.map((tip) => (
          <span
            key={tip.text}
            className="cluster"
            style={{
              gap: '6px',
              fontSize: '11.5px',
              color: 'var(--text-3)',
              padding: '6px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-full)',
            }}
          >
            <Icon name={tip.icon} size="sm" />
            {tip.text}
          </span>
        ))}
      </div>

      {/* The deep reference — collapsed by default, so "detailed" doesn't
          mean "a wall of open text." Runs in CSS columns, same multi-column
          technique Yard Board's card grid uses, so a normal desktop shows
          several topics side by side instead of one long single column. */}
      <div className="stack">
        <h2 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: '15px' }}>
          Frequently asked questions
        </h2>
        <InputWithIcon
          icon="search"
          placeholder="Search every question…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ width: '280px' }}
        />

        {filteredFaq.length === 0 ? (
          <EmptyState icon="search" title="Nothing matches that">
            Try a different word.
          </EmptyState>
        ) : (
          <div style={{ columnWidth: '340px', columnGap: 'var(--s-4)' }}>
            {filteredFaq.map((group) => (
              <div key={group.heading} className="stack stack-tight" style={{ breakInside: 'avoid', marginBottom: 'var(--s-4)' }}>
                <div className="cluster" style={{ gap: 'var(--s-2)' }}>
                  <Icon name={group.icon} size="sm" />
                  <h3 style={{ margin: 0, fontFamily: 'var(--f-display)', fontSize: '12.5px' }}>{group.heading}</h3>
                </div>
                {group.items.map((item) => (
                  <details key={slugify(item.q)} className="card" style={{ padding: '8px 12px' }}>
                    <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '12.5px', color: 'var(--text)' }}>
                      {item.q}
                    </summary>
                    <p style={{ margin: '6px 0 0', fontSize: '11.5px', color: 'var(--text-3)', lineHeight: 1.45 }}>
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
