import { GRADE_LABELS, TYPE_LABELS, containerStatus, gradeStatus } from '@pms/shared';
import { useSearchParams } from 'react-router-dom';
import { ContainerGauge } from '../components/app/ContainerGauge';
import { DataPanel, Progress, StatCard, StatusPill } from '../components/crystal/Data';
import { AsyncRegion, EmptyState, Skeleton } from '../components/crystal/Feedback';
import { Icon } from '../components/crystal/Icon';
import { formatDateShort, plural, relativeDays } from '../lib/format';
import { useOverview } from '../lib/queries';

/**
 * Depot Command — the screen the depot manager keeps open.
 *
 * Four counts across the top, then four panels: what is here, what the rest of
 * the network looks like, what is arriving off-lease, and which orders have
 * something to fill them.
 */
export function DepotCommand(): React.ReactElement {
  const query = useOverview();
  const [, setParams] = useSearchParams();
  const open = (id: string): void =>
    setParams((params) => {
      params.set('container', id);
      return params;
    });

  const o = query.data;

  return (
    <AsyncRegion
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton={
        <div className="stack stack-loose">
          <div className="cardgrid stagger">
            {[0, 1, 2, 3].map((i) => (
              <StatCard key={i} label="" value="" loading />
            ))}
          </div>
          <div className="quadgrid stagger">
            {[0, 1, 2, 3].map((i) => (
              <div className="datapanel" key={i} style={{ height: '340px', padding: 'var(--s-4)' }}>
                <Skeleton height={14} width={160} />
                <div style={{ height: 'var(--s-4)' }} />
                <Skeleton height={12} />
                <div style={{ height: 'var(--s-3)' }} />
                <Skeleton height={12} />
                <div style={{ height: 'var(--s-3)' }} />
                <Skeleton height={12} />
              </div>
            ))}
          </div>
        </div>
      }
    >
      {o && (
        <>
          <div className="cardgrid stagger">
            <StatCard
              icon="warehouse"
              label="Home depot fleet"
              value={o.totals.home}
              foot={`${o.totals.homeReady} ready · ${o.totals.homeLate} delayed`}
            />
            <StatCard
              icon="container"
              label="Network fleet"
              value={o.totals.fleet}
              foot={`across ${o.depots.length} depots`}
            />
            <StatCard
              icon="truck"
              label="Off-lease incoming"
              value={o.totals.offLeaseIncoming}
              foot={`${o.totals.offLeaseHeavy} graded C or D — plan repair capacity`}
            />
            <StatCard
              icon="inbox"
              label="Orders to cover"
              value={o.totals.orders}
              foot={`${o.totals.ordersReady} ready now · ${o.totals.ordersUnmatched} unmatched at home`}
            />
          </div>

          <div className="quadgrid stagger">
            {/* Panel 1 — what is physically here */}
            <DataPanel title={o.homeDepot} meta={plural(o.totals.home, 'unit')}>
              {o.containers.filter((c) => c.depot === o.homeDepot).length === 0 ? (
                  <EmptyState icon="container" title="Nothing at the home depot">
                    Containers appear here once they are gated in.
                  </EmptyState>
                ) : (
                  o.containers
                    .filter((c) => c.depot === o.homeDepot)
                    .map((container) => (
                      <button
                        key={container.id}
                        type="button"
                        // One line: unit, customer, readiness, status. Stacking
                        // the gauge under the customer left a dead strip
                        // beneath the unit number and made the row 76px tall.
                        className="listrow single"
                        onClick={() => open(container.id)}
                      >
                        <span className="listrow-id">{container.id}</span>
                        <span className="grow truncate">{container.customer}</span>
                        <ContainerGauge container={container} size="sm" />
                        <span className="listrow-end">
                          <StatusPill status={containerStatus(container, o.today)} />
                        </span>
                      </button>
                    ))
              )}
            </DataPanel>

            {/* Panel 2 — the rest of the network, read only */}
            <DataPanel title="Rest of the network" meta="read-only">
              {o.depots
                  .filter((depot) => !depot.isHome)
                  .map((depot) => (
                    <div className="listrow" key={depot.name}>
                      <span className="listrow-main">
                        <span>{depot.name}</span>
                        <span className="listrow-note">
                          {plural(depot.total, 'unit')} · {depot.averageProgress}% average readiness
                        </span>
                        <Progress
                          value={depot.averageProgress}
                          label={`${depot.name} average readiness`}
                        />
                      </span>
                      <span className="listrow-end">
                        {depot.late > 0 ? (
                          <StatusPill
                            status={{
                              tone: 'bad',
                              icon: 'alert',
                              label: `${depot.late} delayed`,
                              detail: `${depot.late} of ${depot.total} containers at ${depot.name} are past their stage budget.`,
                            }}
                          />
                        ) : (
                          <StatusPill
                            status={{
                              tone: 'ok',
                              icon: 'check-circle',
                              label: 'On track',
                              detail: `Nothing at ${depot.name} is past its stage budget.`,
                            }}
                          />
                        )}
                      </span>
                  </div>
                ))}
            </DataPanel>

            {/* Panel 3 — what is coming back, and in what condition */}
            <DataPanel title="Off-lease incoming" meta="IICL grade A–D">
              {o.offLease.length === 0 ? (
                  <EmptyState icon="truck" title="Nothing redelivered">
                    Units customers are handing back appear here before they arrive.
                  </EmptyState>
                ) : (
                  o.offLease.map((unit) => (
                    <div className="listrow" key={unit.id}>
                      <span className="listrow-id">{unit.id}</span>
                      <span className="listrow-main">
                        <span className="truncate">
                          {unit.customer} — {unit.size}
                          {unit.type !== 'standard' && ` · ${TYPE_LABELS[unit.type]}`}
                        </span>
                        <span className="listrow-note">{unit.notes}</span>
                        <span className="listrow-meta">{unit.depot}</span>
                      </span>
                      <span className="listrow-end">
                        <StatusPill
                          status={{
                            ...gradeStatus(unit.grade),
                            detail: `${GRADE_LABELS[unit.grade]}. ${unit.notes}`,
                          }}
                        />
                        <span className="listrow-meta">
                          {formatDateShort(unit.expected)} · {relativeDays(unit.expected, o.today)}
                        </span>
                      </span>
                  </div>
                ))
              )}
            </DataPanel>

            {/* Panel 4 — what each order can be filled from */}
            <DataPanel
              title="Orders mapped to inventory"
              meta={`${o.totals.ordersUnmatched} unmatched`}
            >
              {o.matches.length === 0 ? (
                  <EmptyState icon="inbox" title="No open orders">
                    Orders waiting on a container appear here.
                  </EmptyState>
                ) : (
                  o.matches.map((match) => {
                    const body = (
                      <>
                        <span className="listrow-id">{match.order.id}</span>
                        <span className="listrow-main">
                          <span className="truncate">
                            {match.order.customer} — {match.order.qty}× {match.order.size}
                            {match.order.type !== 'standard' && ` · ${TYPE_LABELS[match.order.type]}`}
                          </span>
                          <span className="listrow-note">{match.order.requirement}</span>
                          <span className="listrow-meta">
                            {match.containerId
                              ? `${match.containerId} · ${plural(match.remaining ?? 0, 'task')} left`
                              : match.status.detail}
                          </span>
                        </span>
                        <span className="listrow-end">
                          <StatusPill status={match.status} />
                          <span className="listrow-meta">
                            <Icon name="clock" size="sm" /> {relativeDays(match.order.needBy, o.today)}
                          </span>
                        </span>
                      </>
                    );

                    // An unmatched order has nothing to open, so it is not a button.
                    return match.containerId ? (
                      <button
                        key={match.order.id}
                        type="button"
                        className="listrow"
                        onClick={() => open(match.containerId as string)}
                      >
                        {body}
                      </button>
                    ) : (
                      <div key={match.order.id} className="listrow">
                        {body}
                    </div>
                  );
                })
              )}
            </DataPanel>
          </div>
        </>
      )}
    </AsyncRegion>
  );
}
