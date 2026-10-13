import { useMemo, useState } from 'react';
import { EmptyState } from '../../components/crystal/Feedback';
import { InputWithIcon } from '../../components/crystal/Form';
import { Icon, type IconName } from '../../components/crystal/Icon';

interface Step {
  icon: IconName;
  text: string;
}

/** One line each, on purpose — this is a cheat sheet, not a document. The
 * first cut had a paragraph per step plus a 30-question grouped FAQ below it
 * and read as a wall of text to scroll through; trimmed hard after direct
 * feedback that it wasn't helping. */
const STEPS: Step[] = [
  { icon: 'truck', text: 'New container → Yard Board → survey → Gate In' },
  { icon: 'grid', text: 'Sections (Painting/PTI/Cleaning/Repairment/Sailing Crew) are created from the survey' },
  { icon: 'pulse', text: 'Assign & start tasks from Live Board or inside the container' },
  { icon: 'upload', text: 'Finish every task, then upload the ready-to-move photo' },
  { icon: 'door', text: 'Gate Out' },
  { icon: 'gauge', text: 'Worker Roster, Dashboards, Hydra and IMS Stock are the supporting screens' },
];

interface FaqItem {
  icon: IconName;
  q: string;
  a: string;
}

/** The highest-value questions only — not "every possible query." */
const FAQ: FaqItem[] = [
  { icon: 'search', q: 'Fast way to jump anywhere?', a: 'Ctrl+K (Cmd+K on Mac) — jumps to any screen or container by number.' },
  { icon: 'truck', q: 'How do I register a new container?', a: 'Yard Board → New container → do the survey → Gate In.' },
  { icon: 'package', q: 'What does IMS auto-fill mean?', a: 'Type/size/grade fill in automatically if IMS already has that container. Still fully editable.' },
  { icon: 'doc', q: 'Lost my gate-in form halfway through?', a: 'It saved itself as a draft — open "Drafts" in the top bar to resume it.' },
  { icon: 'user', q: 'How do I assign a worker to a task?', a: 'Tap Start on the task, pick a worker — its clock begins.' },
  { icon: 'upload', q: 'Why can\'t I mark a container ready to move?', a: 'Every task has to be done first, then the ready-to-move photo upload appears — it\'s required.' },
  { icon: 'user', q: 'How do I add a real worker?', a: 'Worker Roster → add worker → name, role, active.' },
  { icon: 'gauge', q: 'What does "Sync to PMS Sheet" do?', a: 'Pushes current data into your own Google Sheet. Manual — click it whenever you want the sheet caught up.' },
  { icon: 'shield', q: 'Does this app write anything back to IMS?', a: 'No — never. IMS is only ever read from, nothing is written to it.' },
  { icon: 'truck', q: 'What is Hydra?', a: 'A separate loading/unloading/shifting log, independent of the main workflow.' },
  { icon: 'package', q: 'What is IMS Stock?', a: 'Every container IMS marks "Stock" (available) at your yard, in one filterable list. Read-only.' },
];

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

export function Guide(): React.ReactElement {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return FAQ;
    return FAQ.filter((item) => `${item.q} ${item.a}`.toLowerCase().includes(needle));
  }, [query]);

  return (
    <div className="stack stack-loose">
      <div className="card" style={{ padding: 'var(--s-3) var(--s-4)' }}>
        <div className="stack stack-tight">
          {STEPS.map((step, i) => (
            <div key={step.text} className="cluster" style={{ gap: 'var(--s-2)', fontSize: '12.5px' }}>
              <span className="subtle" style={{ fontFamily: 'var(--f-mono)', width: '14px', flexShrink: 0 }}>
                {i + 1}
              </span>
              <Icon name={step.icon} size="sm" />
              <span>{step.text}</span>
            </div>
          ))}
        </div>
      </div>

      <InputWithIcon
        icon="search"
        placeholder="Search questions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '280px' }}
      />

      {filtered.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches that">
          Try a different word.
        </EmptyState>
      ) : (
        <div className="stack stack-tight">
          {filtered.map((item) => (
            <details key={slugify(item.q)} className="card" style={{ padding: 'var(--s-2) var(--s-3)' }}>
              <summary className="cluster" style={{ gap: 'var(--s-2)', cursor: 'pointer', fontWeight: 600, fontSize: '12.5px', color: 'var(--text)' }}>
                <Icon name={item.icon} size="sm" />
                {item.q}
              </summary>
              <p style={{ margin: 'var(--s-1) 0 0 26px', fontSize: '12px', color: 'var(--text-3)', lineHeight: 1.4 }}>
                {item.a}
              </p>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
