import * as Accordion from '@radix-ui/react-accordion';
import { TYPE_LABELS, type ContainerType } from '@pms/shared';
import { CategoryBadge, StatCard } from '../components/crystal/Data';
import { AsyncRegion, Skeleton } from '../components/crystal/Feedback';
import { Icon } from '../components/crystal/Icon';
import { formatHours, plural } from '../lib/format';
import { useChecklistLibrary } from '../lib/queries';

/**
 * The task template, not any one container. Reference content someone scans
 * and opens a single item of — so an accordion, per section 35.
 */
export function ChecklistLibrary(): React.ReactElement {
  const query = useChecklistLibrary();
  const library = query.data;

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
          <Skeleton height={420} radius={10} />
        </div>
      }
    >
      {library && (
        <>
          <div className="cardgrid stagger">
            <StatCard
              icon="doc"
              label="Tasks in the library"
              value={library.stages.reduce((a, s) => a + s.tasks.length, 0)}
              foot={`across ${plural(library.stages.length, 'stage')}`}
            />
            <StatCard
              icon="clock"
              label="Standard reefer"
              value={`${library.totals.standard}d`}
              foot="planned gate-in to release"
            />
            <StatCard
              icon="snow"
              label="Each variant"
              value={`${library.totals.double}d`}
              foot="a day longer than standard"
            />
          </div>

          <Accordion.Root
            type="multiple"
            className="accordion"
            defaultValue={[library.stages[0]?.id ?? '']}
          >
            {library.stages.map((stage) => (
              <Accordion.Item value={stage.id} key={stage.id} className="acc-item">
                <Accordion.Header style={{ margin: 0 }}>
                  <Accordion.Trigger className="acc-head">
                    {stage.name}
                    <span className="kbd" style={{ marginLeft: 'var(--s-3)' }}>
                      {plural(stage.tasks.length, 'task')}
                    </span>
                    <span className="kbd">{stage.days}d</span>
                    <Icon name="chev-down" size="sm" className="caret" />
                  </Accordion.Trigger>
                </Accordion.Header>
                <Accordion.Content className="acc-body">
                  <p style={{ margin: '0 0 var(--s-3)' }}>{stage.desc}</p>
                  <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                    {stage.tasks.map((task) => (
                      <li
                        key={task.key}
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 'var(--s-3)',
                          padding: 'var(--s-2) 0',
                          borderBottom: '1px solid var(--line)',
                        }}
                      >
                        <span className="grow">
                          {task.label}
                          {task.onlyFor && (
                            <>
                              {' '}
                              <CategoryBadge variant="accent">
                                {task.onlyFor
                                  .map((t) => TYPE_LABELS[t as ContainerType])
                                  .join(' / ')}{' '}
                                only
                              </CategoryBadge>
                            </>
                          )}
                        </span>
                        <span className="mono subtle">{formatHours(task.hrs)}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="subtle" style={{ margin: 'var(--s-3) 0 0', fontSize: '11.5px' }}>
                    Day budget — standard {stage.budget.standard}d · double compressor{' '}
                    {stage.budget.double}d · with anteroom {stage.budget.anteroom}d
                  </p>
                </Accordion.Content>
              </Accordion.Item>
            ))}
          </Accordion.Root>
        </>
      )}
    </AsyncRegion>
  );
}
