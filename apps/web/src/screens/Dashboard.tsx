import { useNavigate } from 'react-router-dom';
import { KanbanBoard } from '../components/app/KanbanBoard';
import { Button } from '../components/crystal/Button';
import { HeroCard, StatCard } from '../components/crystal/Data';
import { AsyncRegion, EmptyState, Skeleton } from '../components/crystal/Feedback';
import { plural } from '../lib/format';
import { useOverview } from '../lib/queries';

/**
 * The one screen with a hero card (rule 4). Everything else on it is white.
 */
export function Dashboard(): React.ReactElement {
  const query = useOverview();
  const navigate = useNavigate();
  const o = query.data;

  return (
    <AsyncRegion
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton={
        <div className="stack stack-loose">
          <Skeleton height={168} radius={14} />
          <div className="cardgrid">
            {[0, 1, 2, 3].map((i) => (
              <StatCard key={i} label="" value="" loading />
            ))}
          </div>
        </div>
      }
    >
      {o && (
        <>
          <HeroCard
            label="Containers in the pipeline"
            value={o.totals.active}
            actions={
              <>
                <Button variant="accent" size="sm" onClick={() => navigate('/tomorrow')}>
                  See tomorrow&rsquo;s work
                </Button>
                <Button variant="ghost" size="sm" onClick={() => navigate('/delayed')}>
                  {plural(o.totals.late, 'delayed container')}
                </Button>
              </>
            }
          >
            <p style={{ position: 'relative', margin: 'var(--s-2) 0 0', fontSize: '12.5px', opacity: 0.8 }}>
              {o.totals.ready} ready for release · {o.totals.averagePlannedTurnaround} day average
              planned turnaround
            </p>
          </HeroCard>

          <div className="cardgrid">
            <StatCard
              icon="alert"
              label="Delayed / at risk"
              value={o.totals.late}
              foot="past the stage day budget"
              onClick={() => navigate('/delayed')}
            />
            <StatCard
              icon="check-circle"
              label="Ready for release"
              value={o.totals.ready}
              foot="final QC complete"
            />
            <StatCard
              icon="snow"
              label="Double compressor"
              value={o.totals.double}
              foot="+1 day of mechanical each"
            />
            <StatCard
              icon="door"
              label="With anteroom"
              value={o.totals.anteroom}
              foot="+1 day of electrical each"
            />
          </div>

          {o.containers.length === 0 ? (
            <EmptyState icon="container" title="No containers in the pipeline">
              Register a container and it starts at Gate-In &amp; Intake with its full checklist.
            </EmptyState>
          ) : (
            <KanbanBoard containers={o.containers} today={o.today} />
          )}
        </>
      )}
    </AsyncRegion>
  );
}
