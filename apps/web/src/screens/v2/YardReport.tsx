import { useNavigate } from 'react-router-dom';
import {
  agingDays,
  agingStatus,
  formatSurveyDate,
  isReadyToMove,
  overallStatus,
  SECTION_LABELS,
  sectionTurnaround,
  taskSettled,
  type MockContainer,
  type SectionKind,
} from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { Button } from '../../components/crystal/Button';
import { CategoryBadge, DataPanel, StatusPill } from '../../components/crystal/Data';
import { Icon } from '../../components/crystal/Icon';

const SECTION_KINDS: SectionKind[] = ['painting', 'pti', 'cleaning', 'all_rounder'];

function sectionsSummary(container: MockContainer): string {
  if (container.sections.length === 0) return '—';
  const done = container.sections.filter((s) => s.tasks.length > 0 && s.tasks.every(taskSettled)).length;
  return `${done}/${container.sections.length}`;
}

/**
 * A dedicated, chrome-free page (no sidebar/topbar — mounted outside
 * AppShell in App.tsx) so the browser's own Print → Save as PDF produces a
 * clean document instead of capturing the app shell around it. Same pattern
 * as the per-container report, one level up — the whole yard instead of
 * one unit.
 */
export function YardReport(): React.ReactElement {
  const { containers } = useV2Data();
  const navigate = useNavigate();

  // The headline panels describe what's actually in the yard right now —
  // departed containers would otherwise permanently inflate every count.
  // The Full manifest table below is the exception: it's the historical
  // record, so it stays built from every container, departed included.
  const active = containers.filter((c) => !c.departedAt);

  const total = active.length;
  const awaitingSurvey = active.filter((c) => !c.survey).length;
  const ready = active.filter((c) => c.readyAt || isReadyToMove(c)).length;
  const inProgress = total - awaitingSurvey - ready;
  const turnaround = sectionTurnaround(active);
  const generatedAt = new Date().toISOString().slice(0, 10);

  const dry = active.filter((c) => !c.typeCode.startsWith('Reefer'));
  const reefer = active.filter((c) => c.typeCode.startsWith('Reefer'));
  const countReady = (list: MockContainer[]): number => list.filter((c) => c.readyAt || isReadyToMove(c)).length;
  const countInProgress = (list: MockContainer[]): number =>
    list.filter((c) => c.survey && !c.readyAt && !isReadyToMove(c)).length;

  const fastTracked = active.filter((c) => c.priority);

  const aging = active
    .map((c) => ({ container: c, status: agingStatus(c) }))
    .filter((x): x is { container: MockContainer; status: NonNullable<ReturnType<typeof agingStatus>> } => x.status !== null)
    .sort((a, b) => agingDays(b.container) - agingDays(a.container));

  const departed = containers
    .filter((c) => c.departedAt)
    .sort((a, b) => new Date(b.departedAt!).getTime() - new Date(a.departedAt!).getTime());

  const manifest = [...containers].sort((a, b) => Number(b.priority) - Number(a.priority) || a.id.localeCompare(b.id));

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto', padding: 'var(--s-6) var(--s-5)' }}>
        <div className="cluster report-no-print" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-5)' }}>
          <Button variant="ghost" icon="chev-left" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button variant="primary" icon="download" onClick={() => window.print()}>
            Print / Save as PDF
          </Button>
        </div>

        <div className="stack stack-loose">
          <div>
            <h2 style={{ fontSize: '20px', margin: '0 0 4px' }}>Yard Report</h2>
            <p className="subtle" style={{ margin: 0, fontSize: '13px' }}>Generated {generatedAt} · {total} container(s) in the yard</p>
          </div>

          <DataPanel title="Containers by status">
            <div className="infogrid">
              <div>
                <dt>In the yard</dt>
                <dd>{total}</dd>
              </div>
              <div>
                <dt>Awaiting survey</dt>
                <dd>{awaitingSurvey}</dd>
              </div>
              <div>
                <dt>In progress</dt>
                <dd>{inProgress}</dd>
              </div>
              <div>
                <dt>Ready to move</dt>
                <dd>{ready}</dd>
              </div>
            </div>
          </DataPanel>

          <DataPanel title="Dry vs Reefer">
            <div className="infogrid">
              <div>
                <dt>Dry — total</dt>
                <dd>{dry.length}</dd>
              </div>
              <div>
                <dt>Dry — ready / in progress</dt>
                <dd>{countReady(dry)} / {countInProgress(dry)}</dd>
              </div>
              <div>
                <dt>Reefer — total</dt>
                <dd>{reefer.length}</dd>
              </div>
              <div>
                <dt>Reefer — ready / in progress</dt>
                <dd>{countReady(reefer)} / {countInProgress(reefer)}</dd>
              </div>
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

          <DataPanel title="Fast-tracked" meta={`${fastTracked.length} container(s)`}>
            {fastTracked.length === 0 ? (
              <p className="subtle" style={{ margin: 0, fontSize: '12.5px' }}>None right now.</p>
            ) : (
              <div className="stack stack-tight">
                {fastTracked.map((c) => (
                  <div key={c.id} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: '12.5px' }}>{c.id}</span>
                      <span className="subtle" style={{ fontSize: '12px' }}>{c.typeCode}</span>
                    </span>
                    <StatusPill status={overallStatus(c)} />
                  </div>
                ))}
              </div>
            )}
          </DataPanel>

          <DataPanel title="Needs attention" meta={`${aging.length} container(s) past 3 days in their current stage`}>
            {aging.length === 0 ? (
              <p className="subtle" style={{ margin: 0, fontSize: '12.5px' }}>Nothing aging right now.</p>
            ) : (
              <div className="stack stack-tight">
                {aging.map(({ container: c, status }) => (
                  <div key={c.id} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: '12.5px' }}>{c.id}</span>
                      <span className="subtle" style={{ fontSize: '12px' }}>{c.typeCode}</span>
                    </span>
                    <StatusPill status={status} />
                  </div>
                ))}
              </div>
            )}
          </DataPanel>

          <DataPanel title="Departed" meta={`${departed.length} container(s), most recent first`}>
            {departed.length === 0 ? (
              <p className="subtle" style={{ margin: 0, fontSize: '12.5px' }}>None yet.</p>
            ) : (
              <div className="stack stack-tight">
                {departed.map((c) => (
                  <div key={c.id} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: '12.5px' }}>{c.id}</span>
                      <span className="subtle" style={{ fontSize: '12px' }}>{c.typeCode}</span>
                    </span>
                    <span className="subtle" style={{ fontSize: '12px' }}>{formatSurveyDate(c.departedAt!)}</span>
                  </div>
                ))}
              </div>
            )}
          </DataPanel>

          <DataPanel title="Full manifest" meta={`${manifest.length} container(s), fast-tracked first`}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
              <thead>
                <tr>
                  {['Container', 'Type', 'Status', 'Sections'].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px',
                        borderBottom: '1.5px solid var(--line-strong)',
                        fontFamily: 'var(--f-mono)',
                        fontSize: '9.5px',
                        letterSpacing: '0.6px',
                        textTransform: 'uppercase',
                        color: 'var(--text-3)',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {manifest.map((c) => (
                  <tr key={c.id} style={{ breakInside: 'avoid' }}>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--f-mono)', fontWeight: 700 }}>
                      {c.id}
                      {c.priority && (
                        <Icon name="alert" size="sm" />
                      )}
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                      <CategoryBadge>{c.typeCode}</CategoryBadge>
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)' }}>
                      <StatusPill status={overallStatus(c)} />
                    </td>
                    <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--line)', fontFamily: 'var(--f-mono)', color: 'var(--text-2)' }}>
                      {sectionsSummary(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataPanel>
        </div>
      </div>
    </div>
  );
}
