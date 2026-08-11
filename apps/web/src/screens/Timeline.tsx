import { totalPlanDays } from '@pms/shared';
import { StatCard } from '../components/crystal/Data';
import { AsyncRegion, Skeleton } from '../components/crystal/Feedback';
import { plural } from '../lib/format';
import { useOverview } from '../lib/queries';

/**
 * How long each stage is allowed, and how many containers each is holding.
 * Bars are the accent colour only — a stage is not a status, so nothing here
 * turns red (rule 2).
 */
export function Timeline(): React.ReactElement {
  const query = useOverview();
  const o = query.data;
  const maxDays = o ? Math.max(...o.stages.map((s) => s.days)) : 1;

  return (
    <AsyncRegion
      loading={query.isLoading}
      error={query.error}
      onRetry={() => void query.refetch()}
      skeleton={
        <div className="stack stack-loose">
          <div className="cardgrid stagger">
            {[0, 1, 2].map((i) => (
              <StatCard key={i} label="" value="" loading />
            ))}
          </div>
          <Skeleton height={320} radius={10} />
        </div>
      }
    >
      {o && (
        <>
          <div className="cardgrid stagger">
            <StatCard
              icon="container"
              label="Standard reefer"
              value={`${totalPlanDays('standard')}d`}
              foot="gate-in through release"
            />
            <StatCard
              icon="snow"
              label="Double compressor"
              value={`${totalPlanDays('double')}d`}
              foot="+1d for the second compressor and failover test"
            />
            <StatCard
              icon="door"
              label="Reefer with anteroom"
              value={`${totalPlanDays('anteroom')}d`}
              foot="+1d for the mantrap and interlock systems"
            />
          </div>

          <section className="card">
            <h2
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 700,
                fontSize: '13px',
                margin: '0 0 var(--s-4)',
              }}
            >
              Planned duration per stage
            </h2>
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {o.stages.map((stage) => (
                <li className="stagebar" key={stage.id}>
                  <span className="stagebar-name">{stage.name}</span>
                  <div
                    className="stagebar-track"
                    role="img"
                    aria-label={`${stage.name}: ${stage.days} day budget, currently holding ${plural(stage.count, 'container')}`}
                  >
                    <div
                      className="stagebar-fill"
                      style={{ width: `${Math.max(12, (stage.days / maxDays) * 100)}%` }}
                    >
                      <span>{stage.days}d</span>
                    </div>
                  </div>
                  <span className="stagebar-count">{plural(stage.count, 'container')}</span>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </AsyncRegion>
  );
}
