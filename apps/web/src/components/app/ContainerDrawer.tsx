import {
  STAGES,
  STAGE_BY_ID,
  TYPE_LABELS,
  budgetFor,
  containerStatus,
  daysInStage,
  overallProgress,
  priorityStatus,
  totalPlanDaysFor,
  type ChecklistItem,
  type Container,
} from '@pms/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { isStageIncomplete, RequestError, type ContainerEvent } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { formatDate, formatDateTime, formatHours } from '../../lib/format';
import {
  useAdvanceStage,
  useContainer,
  useRemoveContainer,
  useToggleTask,
  useUpdateContainer,
} from '../../lib/queries';
import { Button } from '../crystal/Button';
import { CategoryBadge, Progress, StatusPill } from '../crystal/Data';
import { AsyncRegion, Skeleton, useToast } from '../crystal/Feedback';
import { CheckboxField } from '../crystal/Form';
import { Icon } from '../crystal/Icon';
import { ConfirmDialog, Drawer } from '../crystal/Overlay';
import { RichText } from '../crystal/RichText';

/** Opens whenever `?container=<id>` is in the URL, so a unit is linkable. */
export function ContainerDrawer(): React.ReactElement | null {
  const [params, setParams] = useSearchParams();
  const id = params.get('container');
  const query = useContainer(id);
  const toast = useToast();
  const { can } = useAuth();

  const toggleTask = useToggleTask();
  const advance = useAdvanceStage();
  const remove = useRemoveContainer();

  const [confirmAdvance, setConfirmAdvance] = useState<{ open: string[]; next: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  /**
   * This drawer opens from a URL parameter rather than from a trigger element,
   * so there is nothing for the dialog primitive to hand focus back to. Record
   * whatever had focus when it opened and restore it on close, so closing from
   * a table row puts the caret back on that row.
   */
  const returnFocusTo = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!id) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body) returnFocusTo.current = active;
  }, [id]);

  const close = useCallback(() => {
    setParams(
      (current) => {
        current.delete('container');
        return current;
      },
      { replace: true }
    );
  }, [setParams]);

  /**
   * Hands focus back to whatever opened the drawer. The remembered node may
   * have been replaced by a re-render while the drawer was open, so fall back
   * to finding the control that opens this same container.
   */
  const restoreFocus = useCallback(
    (event: Event) => {
      const remembered = returnFocusTo.current;
      const target =
        remembered?.isConnected === true
          ? remembered
          : id
            ? document.querySelector<HTMLElement>(`[data-row-open="${CSS.escape(id)}"]`)
            : null;
      if (!target) return;
      event.preventDefault();
      target.focus();
    },
    [id]
  );

  if (!id) return null;

  const detail = query.data;
  const container = detail?.container;
  const today = detail?.today ?? '';

  const onToggle = (task: ChecklistItem, next: boolean): void => {
    toggleTask.mutate(
      { id, key: task.key, done: next },
      {
        onError: (error) => toast.error('Could not save that', error.message),
      }
    );
  };

  const doAdvance = (force: boolean): void => {
    advance.mutate(
      { id, force },
      {
        onSuccess: ({ container: updated }) => {
          setConfirmAdvance(null);
          toast.ok('Stage advanced', `${updated.id} is now in ${STAGE_BY_ID[updated.stage].name}.`);
        },
        onError: (error) => {
          if (isStageIncomplete(error)) {
            setConfirmAdvance({ open: error.payload.openTasks, next: error.payload.nextStage });
            return;
          }
          toast.error('Could not advance', (error as RequestError).message);
        },
      }
    );
  };

  return (
    <>
      <Drawer
        open
        onOpenChange={(next) => !next && close()}
        onCloseAutoFocus={restoreFocus}
        title={<span className="mono">{container?.id ?? id}</span>}
        subtitle={container ? `${container.size} · ${container.depot}` : undefined}
        badges={
          container && (
            <>
              <StatusPill status={containerStatus(container, today)} />
              <CategoryBadge variant="brand">{STAGE_BY_ID[container.stage].name}</CategoryBadge>
              <CategoryBadge variant={container.type === 'standard' ? 'neutral' : 'accent'}>
                {TYPE_LABELS[container.type]}
                {container.anteroomVariant ? ` · ${container.anteroomVariant}` : ''}
              </CategoryBadge>
              {container.priority !== 'Standard' && (
                <StatusPill status={priorityStatus(container.priority)} />
              )}
            </>
          )
        }
        footer={
          container && (
            <>
              <span className="mono subtle" style={{ fontSize: '11px', marginRight: 'auto' }}>
                {overallProgress(container)}% · {container.checklist.filter((t) => t.done).length}/
                {container.checklist.length} tasks
              </span>
              {can('container:delete') && (
                <Button variant="ghost" icon="trash" onClick={() => setConfirmRemove(true)}>
                  Remove
                </Button>
              )}
              {can('container:advance') && (
                <Button
                  variant="primary"
                  trailingIcon="arrow-right"
                  loading={advance.isPending}
                  disabled={container.stage === 'qc'}
                  onClick={() => doAdvance(false)}
                >
                  {container.stage === 'qc' ? 'Final stage' : 'Advance stage'}
                </Button>
              )}
            </>
          )
        }
      >
        <AsyncRegion
          loading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          skeleton={
            <div className="stack stack-loose">
              <Skeleton height={64} radius={10} />
              <Skeleton height={18} />
              <Skeleton height={180} radius={10} />
            </div>
          }
        >
          {container && detail && (
            <DrawerBody
              container={container}
              today={today}
              events={detail.events}
              backup={detail.backup}
              onToggle={onToggle}
              canEdit={can('container:task')}
              canWriteNotes={can('container:update')}
            />
          )}
        </AsyncRegion>
      </Drawer>

      {confirmAdvance && container && (
        <ConfirmDialog
          open
          onOpenChange={(next) => !next && setConfirmAdvance(null)}
          title={`Advance with ${confirmAdvance.open.length} task${confirmAdvance.open.length === 1 ? '' : 's'} still open?`}
          confirmLabel={`Advance to ${confirmAdvance.next}`}
          cancelLabel="Stay in this stage"
          busy={advance.isPending}
          onConfirm={() => doAdvance(true)}
          body={
            <>
              <p style={{ marginTop: 0 }}>
                {container.id} moves to <b>{confirmAdvance.next}</b>. These items stay open and
                will keep showing in Tomorrow&rsquo;s Work:
              </p>
              <ul style={{ margin: '0 0 0 18px', padding: 0, lineHeight: 1.7 }}>
                {confirmAdvance.open.slice(0, 6).map((label) => (
                  <li key={label}>{label}</li>
                ))}
                {confirmAdvance.open.length > 6 && (
                  <li className="subtle">and {confirmAdvance.open.length - 6} more</li>
                )}
              </ul>
            </>
          }
        />
      )}

      {confirmRemove && container && (
        <ConfirmDialog
          open
          destructive
          onOpenChange={setConfirmRemove}
          title={`Remove ${container.id} from the pipeline?`}
          confirmLabel={`Remove ${container.id}`}
          cancelLabel="Keep container"
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate(container.id, {
              onSuccess: () => {
                setConfirmRemove(false);
                close();
                toast.ok('Container removed', `${container.id} is no longer in the pipeline.`);
              },
              onError: (error) => toast.error('Could not remove', error.message),
            })
          }
          body={
            <>
              Its {container.checklist.length} checklist items and full event history are deleted
              permanently. {container.customer} is not notified. This cannot be undone.
            </>
          }
        />
      )}
    </>
  );
}

function DrawerBody({
  container,
  today,
  events,
  backup,
  onToggle,
  canEdit,
  canWriteNotes,
}: {
  container: Container;
  today: string;
  events: ContainerEvent[];
  backup: string | null;
  onToggle: (task: ChecklistItem, next: boolean) => void;
  canEdit: boolean;
  canWriteNotes: boolean;
}): React.ReactElement {
  const progress = overallProgress(container);
  const saveNote = useUpdateContainer();
  const toast = useToast();

  return (
    <div className="stack stack-loose">
      <dl className="infogrid">
        <div>
          <dt>Customer</dt>
          <dd>{container.customer}</dd>
        </div>
        <div>
          <dt>Depot</dt>
          <dd>{container.depot}</dd>
        </div>
        <div>
          <dt>Technician</dt>
          <dd>
            {container.assignee}
            {backup && <span className="subtle"> · cover {backup}</span>}
          </dd>
        </div>
        <div>
          <dt>Gated in</dt>
          <dd>{formatDate(container.received)}</dd>
        </div>
        <div>
          <dt>Days in this stage</dt>
          <dd>
            {daysInStage(container, today)} of {budgetFor(container)} budgeted
          </dd>
        </div>
        <div>
          <dt>Planned turnaround</dt>
          <dd>{totalPlanDaysFor(container)} days</dd>
        </div>
      </dl>

      <div className="stack stack-tight">
        <div className="cluster" style={{ justifyContent: 'space-between' }}>
          <span className="lbl" style={{ marginBottom: 0 }}>
            Overall readiness
          </span>
          <span className="mono" style={{ fontSize: '11.5px' }}>
            {progress}%
          </span>
        </div>
        <Progress value={progress} label={`${container.id} overall readiness`} />
      </div>

      <div className="stack stack-tight">
        <span className="lbl">Checklist</span>
        {STAGES.map((stage) => {
          const items = container.checklist.filter((t) => t.stage === stage.id);
          if (!items.length) return null;
          const done = items.filter((t) => t.done).length;
          const isCurrent = stage.id === container.stage;
          return (
            <section
              key={stage.id}
              className="accordion"
              style={isCurrent ? { borderColor: 'var(--accent)' } : undefined}
            >
              <h3 className="acc-head" style={{ cursor: 'default' }}>
                {isCurrent && <Icon name="pin" size="sm" />}
                {stage.name}
                <span className="kbd" style={{ marginLeft: 'auto' }}>
                  {done}/{items.length}
                </span>
              </h3>
              <div style={{ padding: 'var(--s-1) var(--s-2) var(--s-2)' }}>
                {items.map((task) => (
                  <CheckboxField
                    key={task.key}
                    id={`task-${container.id}-${task.key}`}
                    checked={task.done}
                    disabled={!canEdit}
                    strikeWhenChecked
                    onCheckedChange={(next) => onToggle(task, next)}
                    label={
                      <>
                        {task.label}
                        {task.onlyFor && (
                          <>
                            {' '}
                            <CategoryBadge variant="accent">
                              {task.onlyFor.join(', ')} only
                            </CategoryBadge>
                          </>
                        )}
                      </>
                    }
                    meta={formatHours(task.hrs)}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      <div className="stack stack-tight">
        <span className="lbl">Handover note</span>
        <RichText
          label={`Handover note for ${container.id}`}
          value={container.notes}
          readOnly={!canWriteNotes}
          saving={saveNote.isPending}
          placeholder="What should the next shift know about this unit?"
          onSave={(html) =>
            saveNote.mutate(
              { id: container.id, input: { notes: html } },
              {
                onSuccess: () => toast.ok('Note saved', `Recorded against ${container.id}.`),
                onError: (error) => toast.error('Could not save the note', error.message),
              }
            )
          }
        />
      </div>

      <div className="stack stack-tight">
        <span className="lbl">History</span>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {events.length === 0 && (
            <p style={{ padding: 'var(--s-4)', margin: 0, color: 'var(--text-3)', fontSize: '12px' }}>
              Nothing recorded yet.
            </p>
          )}
          {events.map((event, i) => (
            <div key={event.id}>
              {i > 0 && <div className="divider" style={{ margin: 0 }} />}
              <div style={{ padding: 'var(--s-3) var(--s-4)' }}>
                <div style={{ fontSize: '12px' }}>{event.summary}</div>
                <div className="mono subtle" style={{ fontSize: '10.5px', marginTop: '2px' }}>
                  {formatDateTime(event.at)} · {event.actor}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
