import {
  STAGES,
  budgetFor,
  containerStatus,
  daysInStage,
  overallProgress,
  type Container,
} from '@pms/shared';
import { useSearchParams } from 'react-router-dom';
import { cx } from '../../lib/cx';
import { plural } from '../../lib/format';
import { StatusPill } from '../crystal/Data';
import { Icon } from '../crystal/Icon';
import { ContainerGauge } from './ContainerGauge';

/**
 * The readiness pipeline.
 *
 * Ten stages at a readable size, scrolling sideways. The concept fitted all
 * ten on one screen by dropping the column headings to 7.8px, which the design
 * system forbids below 12px and which disappears entirely at 200% zoom. Legal
 * type and a scrollbar is the plainer trade.
 */
export function KanbanBoard({
  containers,
  today,
}: {
  containers: Container[];
  today: string;
}): React.ReactElement {
  const [, setParams] = useSearchParams();

  const open = (id: string): void =>
    setParams((params) => {
      params.set('container', id);
      return params;
    });

  return (
    <>
      <p className="kanban-hint">
        <Icon name="arrow-right" size="sm" />
        Ten stages, gate-in to release — scroll sideways for the later stages.
      </p>
      <div className="kanban" role="list" aria-label="Readiness pipeline by stage">
        {STAGES.map((stage) => {
          const inStage = containers.filter((c) => c.stage === stage.id);
          return (
            <section className="kcol" key={stage.id} role="listitem" aria-label={stage.name}>
              <header className="kcol-head">
                <h4>{stage.name}</h4>
                <div className="kmeta">
                  <span>{stage.days}d budget</span>
                  <span className="kcount">
                    {inStage.length}
                    <span className="sr-only"> {plural(inStage.length, 'container')}</span>
                  </span>
                </div>
              </header>
              <div className="kcol-body">
                {inStage.length === 0 && <p className="kcol-empty">Nothing here</p>}
                {inStage.map((container) => (
                  <KanbanCard
                    key={container.id}
                    container={container}
                    today={today}
                    onOpen={() => open(container.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function KanbanCard({
  container,
  today,
  onOpen,
}: {
  container: Container;
  today: string;
  onOpen: () => void;
}): React.ReactElement {
  const status = containerStatus(container, today);
  const days = daysInStage(container, today);
  const budget = budgetFor(container);

  return (
    <button
      type="button"
      className={cx('kcard', container.type !== 'standard' && `is-${container.type}`)}
      data-row-open={container.id}
      onClick={onOpen}
    >
      <span className="kcard-id">{container.id}</span>
      <span className="kcard-sub truncate">{container.customer}</span>

      {/* Overall readiness, not stage progress: the gauge already shows where
          in the ten stages it sits, so the stage number was the redundant one. */}
      <div style={{ marginTop: 'var(--s-2)' }}>
        <ContainerGauge container={container} size="sm" />
      </div>

      <div className="kcard-row">
        <StatusPill status={status} />
        <span className="kcard-days">
          {days}/{budget}d
          <span className="sr-only">
            {' '}
            days in stage, of {budget} budgeted. {overallProgress(container)} per cent complete
            overall.
          </span>
        </span>
      </div>
    </button>
  );
}
