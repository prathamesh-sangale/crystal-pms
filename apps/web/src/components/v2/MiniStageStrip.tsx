import { SECTION_LABELS, sectionStatus, type SectionKind, type MockContainer } from '../../lib/mockV2';

/** Short tags, not full labels — chosen to read as the word they're short
 * for without a hover. Painting/Cleaning/Repairment keep their first two
 * letters (the obvious read), but PTI can't: Painting already claims "PT",
 * and sampling two non-initial letters instead ("TI") isn't a real
 * abbreviation anyone recognizes on sight. "PTI" itself is the standard,
 * already-known three-letter term in this industry (Pre-Trip Inspection),
 * so it's spelled out in full rather than invented a second time. */
const SECTION_SHORT: Record<SectionKind, string> = {
  painting: 'PT',
  pti: 'PTI',
  cleaning: 'CL',
  all_rounder: 'RP',
  sailing: 'SC',
};

/**
 * A compact inline read of a container's section progress — one tagged node
 * per section, joined by a line, tinted by `sectionStatus()`'s own tone.
 * Never a second "done"/"in progress" concept invented just for this strip
 * — it's the same tone every StatusPill in the app already computes. Each
 * node carries its own two-letter tag so the state reads without having to
 * hover for the tooltip — a bare colour dot doesn't say which stage it is or
 * what "done" means at this size.
 *
 * The shape (nodes + connecting lines, a brighter ring on whichever one is
 * actively running) is borrowed from the sibling CRM project's order-list
 * mini stage strip; the colours are this app's own tokens, so dark mode
 * keeps working without any extra work.
 */
export function MiniStageStrip({ container }: { container: MockContainer }): React.ReactElement | null {
  if (container.sections.length === 0) return null;
  return (
    <span
      className="ministrip"
      title={container.sections.map((s) => `${SECTION_LABELS[s.kind]}: ${sectionStatus(s).label}`).join(' · ')}
    >
      {container.sections.map((s, i) => {
        const status = sectionStatus(s);
        return (
          <span key={s.kind} className="ministrip-step">
            <span className={`ministrip-node ${status.tone}`}>{SECTION_SHORT[s.kind]}</span>
            {i < container.sections.length - 1 && <span className={`ministrip-line ${status.tone !== 'neutral' ? 'on' : ''}`} />}
          </span>
        );
      })}
    </span>
  );
}

const LEGEND_ITEMS: Array<{ tone: string; label: string }> = [
  { tone: 'neutral', label: 'Not started' },
  { tone: 'warn', label: 'In progress' },
  { tone: 'info', label: 'Running now' },
  { tone: 'ok', label: 'Done' },
];

/** The strip's colour code only means something once — explain it once,
 * here, rather than making every row carry its own key or forcing a hover
 * for the tooltip just to find out what a colour stands for. */
export function MiniStageLegend(): React.ReactElement {
  return (
    <div className="cluster ministrip-legend" role="note" aria-label="Progress colour key">
      {LEGEND_ITEMS.map((item) => (
        <span key={item.tone} className="cluster ministrip-legend-item">
          <span className={`ministrip-legend-swatch ${item.tone}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
