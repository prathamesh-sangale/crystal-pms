import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import {
  budgetExposure,
  gateActivityToday,
  idleWorkersToday,
  ptiBreakdown,
  readyNotGatedOut,
  SECTION_LABELS,
  sectionContainerCounts,
  sectionLoad,
  sectionTurnaround,
  topPerformers,
  WORKER_TYPE_LABELS,
} from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { Button } from '../../components/crystal/Button';
import { DataPanel, HeroCard, Person, StatCard, StatusPill } from '../../components/crystal/Data';
import { EmptyState, useToast } from '../../components/crystal/Feedback';

function formatINR(n: number): string {
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

export function DashboardsV2(): React.ReactElement {
  // Dashboards describe the active yard, not the full historical record —
  // departed containers would otherwise skew every stat here.
  const { activeContainers: containers, workers } = useV2Data();
  const navigate = useNavigate();
  const toast = useToast();
  const [exporting, setExporting] = useState(false);

  // On-demand, not automatic -- same shape as every other export in this
  // app (Hydra's CSV, the yard report). Refreshes every tab of the
  // client's own "PMS" Google Sheet from current data.
  const handleExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const { tabs } = await api.v2ExportToSheet();
      toast.ok('Sheet updated', `Refreshed: ${tabs.join(', ')}.`);
    } catch {
      toast.error('Could not sync', 'The sheet was not updated. Try again.');
    } finally {
      setExporting(false);
    }
  };

  const pti = useMemo(() => ptiBreakdown(containers), [containers]);
  const stageCounts = useMemo(() => sectionContainerCounts(containers), [containers]);
  const gateActivity = useMemo(() => gateActivityToday(containers), [containers]);
  const budget = useMemo(() => budgetExposure(containers), [containers]);
  const exitQueue = useMemo(() => readyNotGatedOut(containers), [containers]);
  const idleCrew = useMemo(() => idleWorkersToday(containers, workers), [containers, workers]);
  const topCrew = useMemo(() => topPerformers(containers, workers, 7), [containers, workers]);

  // sectionLoad (estimate) and sectionTurnaround (actual) are both keyed by
  // the same four SectionKinds — zipped together here so the panel can show
  // "what we guessed" beside "what it actually took" instead of two
  // separate per-section panels repeating the same row shape.
  const load = useMemo(() => sectionLoad(containers), [containers]);
  const turnaround = useMemo(() => sectionTurnaround(containers), [containers]);
  const sectionStats = useMemo(
    () => load.map((l) => ({ ...l, ...turnaround.find((t) => t.kind === l.kind)! })),
    [load, turnaround]
  );

  return (
    <div className="stack stack-loose">
      <HeroCard
        label="Containers in the yard"
        value={containers.length}
        actions={
          <>
            <Button variant="secondary" size="sm" icon="refresh" loading={exporting} disabled={exporting} onClick={() => void handleExport()}>
              Sync to PMS Sheet
            </Button>
            <Button variant="secondary" size="sm" icon="download" onClick={() => navigate('/reports/yard')}>
              Download yard report
            </Button>
          </>
        }
      >
        <p style={{ margin: 'var(--s-2) 0 0', fontSize: '13px', opacity: 0.85 }}>
          {gateActivity.gatedInToday} gated in today · {gateActivity.gatedOutToday} gated out today
        </p>
      </HeroCard>

      <div className="cardgrid stagger statrow">
        <StatCard label="PTI pending" value={pti.ptiPending} icon="clock" foot="Neither lights nor curtain done" />
        <StatCard label="PTI ok, lights pending" value={pti.lightsPendingOnly} icon="drop" />
        <StatCard label="PTI ok, curtain pending" value={pti.curtainPendingOnly} icon="alert" />
        <StatCard label="Fully OK / no PTI needed" value={pti.fullyOk} icon="check-circle" />
      </div>

      {/* Six panels stacked full-height each made this screen scroll far
         more than its content actually needed — .quadgrid (already in
         app.css, previously unused anywhere in the app) pairs them two-up
         with a capped height and its own internal scroll per panel, so the
         page itself stays about half as tall. */}
      <div className="quadgrid">
        <DataPanel title="Estimated repair budget exposure" meta="From the admin's own estimate at gate-in">
          {budget.estimatedCount === 0 ? (
            <EmptyState icon="doc" title="No estimates on record yet">
              Figures appear here once containers carrying an Est. Budget are registered through the New Container form.
            </EmptyState>
          ) : (
            <>
              <div className="infogrid">
                <div>
                  <dt>Still in progress</dt>
                  <dd>{formatINR(budget.totalInProgress)}</dd>
                </div>
                <div>
                  <dt>Ready, awaiting gate-out</dt>
                  <dd>{formatINR(budget.totalReady)}</dd>
                </div>
              </div>
              <p className="subtle" style={{ fontSize: '11.5px', margin: 'var(--s-3) 0 0' }}>
                Based on {budget.estimatedCount} of {containers.length} container(s) with a recorded estimate.
              </p>
            </>
          )}
        </DataPanel>

        <DataPanel title="Containers by stage" meta="How many containers sit at each stage right now">
          <div className="stack">
            {stageCounts.map((s) => (
              <div
                key={s.kind}
                className="cluster"
                style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}
              >
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text)' }}>{SECTION_LABELS[s.kind]}</span>
                <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                  <StatusPill
                    status={{ tone: 'info', icon: 'clock', label: `${s.inProcess} in process`, detail: `${SECTION_LABELS[s.kind]}: a task is running on ${s.inProcess} container(s).` }}
                  />
                  <StatusPill
                    status={{ tone: 'neutral', icon: 'clock', label: `${s.inLine} in line`, detail: `${SECTION_LABELS[s.kind]}: ${s.inLine} container(s) waiting their turn, nothing running.` }}
                  />
                  <StatusPill
                    status={{ tone: 'ok', icon: 'check-circle', label: `${s.done} done`, detail: `${SECTION_LABELS[s.kind]}: ${s.done} container(s) have this section fully complete.` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Estimate vs. actual, by section" meta="Open tasks' average estimate, beside completed tasks' average real time">
          <div className="stack">
            {sectionStats.map((s) => (
              <div key={s.kind} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                <span style={{ fontSize: '12.5px', fontWeight: 600 }}>
                  {SECTION_LABELS[s.kind]}
                  <span className="subtle"> · {s.pendingTasks} open task{s.pendingTasks === 1 ? '' : 's'}</span>
                </span>
                <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-2)' }}>
                  {s.pendingTasks ? `~${s.avgEstHrs}h est.` : 'clear'}
                  {s.completedCount > 0 && <span> · {s.avgHrs}h actual avg ({s.completedCount} done)</span>}
                </span>
              </div>
            ))}
          </div>
        </DataPanel>

        <DataPanel title="Ready, not yet gated out" meta={`${exitQueue.length} container(s) cleared and still in the yard`}>
          {exitQueue.length === 0 ? (
            <EmptyState icon="check-circle" title="Nothing waiting on gate-out">Every ready container has already left.</EmptyState>
          ) : (
            <div className="stack stack-tight">
              {exitQueue.map(({ container, daysSinceReady }) => (
                <div key={container.id} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                    <span className="mono" style={{ fontWeight: 700, fontSize: '12.5px' }}>{container.id}</span>
                    <span className="subtle" style={{ fontSize: '12px' }}>{container.typeCode}</span>
                  </span>
                  <StatusPill
                    status={{
                      tone: daysSinceReady >= 3 ? 'bad' : daysSinceReady >= 1 ? 'warn' : 'ok',
                      icon: 'truck',
                      label: daysSinceReady === 0 ? 'Ready today' : `${daysSinceReady}d since ready`,
                      detail: `${container.id} has been cleared for release for ${daysSinceReady} day(s) and hasn't gated out yet.`,
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </DataPanel>

        <DataPanel title="Idle right now" meta={`${idleCrew.length} active worker(s) with nothing running or scheduled today`}>
          {idleCrew.length === 0 ? (
            <EmptyState icon="user" title="Nobody's idle">Every active worker has something running or scheduled today.</EmptyState>
          ) : (
            <div className="stack stack-tight">
              {idleCrew.map((w) => (
                <div key={w.id} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                  <Person name={w.name} detail={WORKER_TYPE_LABELS[w.type]} />
                  <Button variant="ghost" size="sm" icon="plus" onClick={() => navigate('/workers')}>
                    Assign work
                  </Button>
                </div>
              ))}
            </div>
          )}
        </DataPanel>

        <DataPanel title="This week's top performers" meta="Tasks completed in the last 7 days">
          {topCrew.length === 0 ? (
            <EmptyState icon="check-circle" title="Nothing completed yet this week">Completions will rank here as tasks finish.</EmptyState>
          ) : (
            <div className="stack stack-tight">
              {topCrew.slice(0, 8).map(({ worker, completedCount }, i) => (
                <div key={worker.id} className="cluster" style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}>
                  <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                    <span className="subtle mono" style={{ fontSize: '11.5px', width: '16px' }}>{i + 1}</span>
                    <Person name={worker.name} detail={WORKER_TYPE_LABELS[worker.type]} />
                  </span>
                  <span className="mono" style={{ fontSize: '12.5px', fontWeight: 700 }}>{completedCount} done</span>
                </div>
              ))}
            </div>
          )}
        </DataPanel>
      </div>
    </div>
  );
}
