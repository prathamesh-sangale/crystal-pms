import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { agingStatus, isReadyToMove, sectionTurnaround, SECTION_LABELS, type SectionKind } from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { Button } from '../../components/crystal/Button';
import { DataPanel, StatCard } from '../../components/crystal/Data';
import { Chip, Field } from '../../components/crystal/Form';

const SECTION_KINDS: SectionKind[] = ['painting', 'pti', 'cleaning', 'all_rounder'];

type RangeKey = '7' | '15' | '30' | 'custom';

const RANGE_DAYS: Record<Exclude<RangeKey, 'custom'>, number> = { '7': 7, '15': 15, '30': 30 };
const RANGE_LABEL: Record<Exclude<RangeKey, 'custom'>, string> = { '7': '7 days', '15': '15 days', '30': '1 month' };

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The *local* calendar date, not `toISOString().slice(0, 10)` -- that
 * converts to UTC first, which quietly rolls "today" back a day in any
 * timezone ahead of UTC (e.g. IST) during the early morning, shifting the
 * whole "last N days" window and silently dropping same-day activity from
 * the count. This report is meant to be a point-in-time record, so a
 * quietly wrong window is a real data bug, not a cosmetic one. */
function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDay(d);
}

/**
 * A dedicated, chrome-free page (no sidebar/topbar — mounted outside
 * AppShell in App.tsx) so the browser's own Print → Save as PDF produces a
 * clean document instead of capturing the app shell around it. Same pattern
 * as the per-container report, one level up — the whole yard instead of
 * one unit.
 *
 * Reports as overall numbers, not a container-by-container list — someone
 * reading this wants "how many," not every single ID enumerated; anyone
 * who needs the detail on one container already has Yard Board/Live Board
 * for that. Gate-in/gate-out activity is scoped to the selected period;
 * the rest (what's actually sitting in the yard right now) is always a
 * live, current snapshot — labeled as such, since it isn't period-bound.
 */
export function YardReport(): React.ReactElement {
  const { containers } = useV2Data();
  const navigate = useNavigate();

  const [range, setRange] = useState<RangeKey>('7');
  const [customFrom, setCustomFrom] = useState(daysAgoISO(7));
  const [customTo, setCustomTo] = useState(daysAgoISO(0));

  const { from, to, periodLabel } = useMemo(() => {
    if (range === 'custom') {
      // Swapped rather than rejected -- a reversed range otherwise silently
      // matches nothing (every count renders as a plausible-looking 0) with
      // no indication anything was wrong, which is worse than just doing
      // what was obviously meant.
      const [lo, hi] = customFrom <= customTo ? [customFrom, customTo] : [customTo, customFrom];
      return { from: lo, to: hi, periodLabel: `${lo} – ${hi}` };
    }
    return { from: daysAgoISO(RANGE_DAYS[range]), to: daysAgoISO(0), periodLabel: `Last ${RANGE_LABEL[range]}` };
  }, [range, customFrom, customTo]);

  const inPeriod = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const day = localDay(new Date(iso));
    return day >= from && day <= to;
  };

  const active = containers.filter((c) => !c.departedAt);
  const gatedIn = containers.filter((c) => inPeriod(c.registeredAt)).length;
  const gatedOut = containers.filter((c) => inPeriod(c.departedAt)).length;

  const total = active.length;
  const awaitingSurvey = active.filter((c) => !c.survey).length;
  const ready = active.filter((c) => c.readyAt || isReadyToMove(c)).length;
  const inProgress = total - awaitingSurvey - ready;
  const fastTracked = active.filter((c) => c.priority).length;
  const needsAttention = active.filter((c) => agingStatus(c) !== null).length;

  const dry = active.filter((c) => !c.typeCode.startsWith('Reefer')).length;
  const reefer = active.filter((c) => c.typeCode.startsWith('Reefer')).length;

  const turnaround = sectionTurnaround(active);
  const generatedAt = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '880px', margin: '0 auto', padding: 'var(--s-6) var(--s-5)' }}>
        <div className="cluster report-no-print" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-4)' }}>
          <Button variant="ghost" icon="chev-left" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button variant="primary" icon="download" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>

        <div className="cluster report-no-print" style={{ gap: 'var(--s-2)', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 'var(--s-5)' }}>
          <Chip pressed={range === '7'} onClick={() => setRange('7')}>
            7 days
          </Chip>
          <Chip pressed={range === '15'} onClick={() => setRange('15')}>
            15 days
          </Chip>
          <Chip pressed={range === '30'} onClick={() => setRange('30')}>
            1 month
          </Chip>
          <Chip pressed={range === 'custom'} onClick={() => setRange('custom')}>
            Custom
          </Chip>
          {range === 'custom' && (
            <>
              <Field label="From">
                {(props) => <input {...props} type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />}
              </Field>
              <Field label="To">
                {(props) => <input {...props} type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} />}
              </Field>
            </>
          )}
        </div>

        <div className="stack stack-loose">
          <div>
            <h2 style={{ fontSize: '20px', margin: '0 0 4px' }}>Yard Report</h2>
            <p className="subtle" style={{ margin: 0, fontSize: '13px' }}>
              Generated {generatedAt} · Period: {periodLabel}
            </p>
          </div>

          <DataPanel title="Activity in this period">
            <div className="cardgrid stagger statrow">
              <StatCard label="Gated in" value={gatedIn} icon="truck" />
              <StatCard label="Gated out" value={gatedOut} icon="door" />
            </div>
          </DataPanel>

          <DataPanel title="Current yard snapshot" meta="As of right now, not tied to the period above">
            <div className="cardgrid stagger statrow">
              <StatCard label="In the yard" value={total} icon="warehouse" />
              <StatCard label="Awaiting survey" value={awaitingSurvey} icon="clock" />
              <StatCard label="In progress" value={inProgress} icon="pulse" />
              <StatCard label="Ready to move" value={ready} icon="check-circle" />
              <StatCard label="Fast-tracked" value={fastTracked} icon="star" />
              <StatCard label="Needs attention" value={needsAttention} icon="alert" />
            </div>
          </DataPanel>

          <DataPanel title="Dry vs Reefer" meta="Current yard">
            <div className="cardgrid stagger statrow">
              <StatCard label="Dry" value={dry} icon="package" />
              <StatCard label="Reefer" value={reefer} icon="snow" />
            </div>
          </DataPanel>

          <DataPanel title="Average turnaround per section" meta="Actual time on completed tasks, not the estimate">
            <div className="stack stack-tight">
              {SECTION_KINDS.map((kind) => {
                const t = turnaround.find((x) => x.kind === kind)!;
                return (
                  <div key={kind} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 600 }}>{SECTION_LABELS[kind]}</span>
                    <span className="subtle" style={{ fontSize: '12px' }}>
                      {t.completedCount > 0 ? `~${t.avgHrs}h avg over ${t.completedCount} completed task(s)` : 'No completed tasks yet'}
                    </span>
                  </div>
                );
              })}
            </div>
          </DataPanel>
        </div>
      </div>
    </div>
  );
}
