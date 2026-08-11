import { KanbanBoard } from '../components/app/KanbanBoard';
import { StatCard } from '../components/crystal/Data';
import { AsyncRegion, EmptyState, Skeleton } from '../components/crystal/Feedback';
import { plural } from '../lib/format';
import { useOverview } from '../lib/queries';

/**
 * The board on its own. No hero here — the Dashboard already carries the one
 * navy block, and two competing ones is rule 4.
 */
export function Pipeline(): React.ReactElement {
  const query = useOverview();
  const o = query.data;
  const busiest = o?.stages.reduce((a, b) => (b.count > a.count ? b : a), o.stages[0]!);

  return (
    <AsyncRegion
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton={<Skeleton height={420} radius={10} />}
    >
      {o &&
        busiest &&
        (o.containers.length === 0 ? (
          <EmptyState icon="container" title="The pipeline is empty">
            Every container that has been gated in appears here, in the stage it is currently in.
          </EmptyState>
        ) : (
          <>
            <div className="cardgrid">
              <StatCard label="In the pipeline" value={o.totals.active} foot="not yet released" />
              <StatCard
                label="Busiest stage"
                value={busiest.name}
                foot={`holding ${plural(busiest.count, 'container')}`}
              />
              <StatCard label="Delayed" value={o.totals.late} foot="past the stage budget" />
              <StatCard label="Ready" value={o.totals.ready} foot="cleared for gate-out" />
            </div>
            <KanbanBoard containers={o.containers} today={o.today} />
          </>
        ))}
    </AsyncRegion>
  );
}
