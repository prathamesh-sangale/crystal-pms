import {
  CONTAINER_INSPECTION_FIELDS,
  FIELD_SEVERITY_LABELS,
  formatElapsed,
  formatSurveyDate,
  GATE_PHOTO_SLOTS,
  isReadyToMove,
  SECTION_LABELS,
  taskSettled,
  WORKER_TYPE_LABELS,
  type FieldSeverity,
  type GateLogEntry,
  type MockContainer,
  type MockSurveyField,
  type MockWorker,
} from '../../lib/mockV2';
import { DataPanel, Person, StatusPill } from '../crystal/Data';
import { Icon } from '../crystal/Icon';

const SEVERITY_DOT: Record<FieldSeverity, string> = {
  unassessed: 'var(--text-3)',
  good: 'var(--success)',
  minor: 'var(--warn)',
  major: 'var(--error)',
  flagged: 'var(--error)',
};

function SeverityRow({ field }: { field: MockSurveyField }): React.ReactElement {
  return (
    <li style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'baseline', padding: '3px 0' }}>
      <span
        aria-hidden="true"
        style={{ width: '7px', height: '7px', borderRadius: '50%', background: SEVERITY_DOT[field.severity], flex: 'none', marginTop: '3px' }}
      />
      <span>
        <b style={{ fontWeight: 600 }}>{field.label}</b> — {FIELD_SEVERITY_LABELS[field.severity]}
        {field.note && <span className="subtle"> · {field.note}</span>}
      </span>
    </li>
  );
}

/** One Gate In or Gate Out submission — every field the form captured, plus
 * the nine required inspection photos (and any additional ones) as actual
 * thumbnails, since they're what the real gate portal treats as the primary
 * evidence of condition at that movement. */
/** A real Drive link (https://drive.google.com/...) is a viewer *page*, not
 * raw image bytes — embedding it directly as an <img src> shows a broken
 * image, not the photo. Only a `blob:` URL (the old, pre-upload, in-tab-only
 * representation — shouldn't occur going forward, kept only so an
 * already-open draft from before this change doesn't render broken) can
 * actually be inlined; anything else opens in Drive instead. */
function PhotoThumb({ url, label }: { url: string; label: string }): React.ReactElement {
  if (url.startsWith('blob:')) {
    return <img src={url} alt={label} className="photo-thumb" />;
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="photo-thumb"
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--s-1)', color: 'var(--text-2)', textDecoration: 'none' }}
    >
      <Icon name="external" size="md" />
      <span style={{ fontSize: '10.5px', fontWeight: 600 }}>View photo</span>
    </a>
  );
}

function GateLogPanel({ title, entry }: { title: string; entry: GateLogEntry }): React.ReactElement {
  const photoEntries = [
    ...GATE_PHOTO_SLOTS.map((slot) => ({ label: slot.label, url: entry.photos[slot.key] })).filter((p) => p.url),
    ...entry.photos.additional.map((url, i) => ({ label: `Additional ${i + 1}`, url })),
  ];
  return (
    <DataPanel title={title} meta={`${formatSurveyDate(entry.movementDate)} · logged by ${entry.loggedBy || 'unspecified'}`}>
      <div className="stack stack-tight">
        <div className="infogrid">
          <div>
            <dt>Indent reference</dt>
            <dd>{entry.indentRef || '—'}</dd>
          </div>
          <div>
            <dt>Customer</dt>
            <dd>{entry.customerName || '—'}</dd>
          </div>
          <div>
            <dt>Location</dt>
            <dd>{entry.location || '—'}</dd>
          </div>
          <div>
            <dt>Transporter</dt>
            <dd>{entry.transporterName || '—'}{entry.transporterNumber && ` (${entry.transporterNumber})`}</dd>
          </div>
          <div>
            <dt>Vehicle number</dt>
            <dd>{entry.vehicleNumber || '—'}</dd>
          </div>
          <div>
            <dt>LR copy</dt>
            <dd>{entry.lrCopyName ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>PTI check</dt>
            <dd>
              {entry.ptiCheck}
              {entry.ptiVideoName &&
                (entry.ptiVideoUrl ? (
                  <>
                    {' · '}
                    <a href={entry.ptiVideoUrl} target="_blank" rel="noreferrer">
                      {entry.ptiVideoName}
                    </a>
                  </>
                ) : (
                  ` · ${entry.ptiVideoName}`
                ))}
            </dd>
          </div>
          {entry.repairRequired !== null && (
            <div>
              <dt>Repair required</dt>
              <dd>{entry.repairRequired ? 'Yes' : 'No'}</dd>
            </div>
          )}
          {entry.cleaningRequired !== null && (
            <div>
              <dt>Cleaning required</dt>
              <dd>{entry.cleaningRequired ? 'Yes' : 'No'}</dd>
            </div>
          )}
          {entry.estBudget && (
            <div>
              <dt>Est. budget</dt>
              <dd>{entry.estBudget}</dd>
            </div>
          )}
        </div>

        {entry.remarks && (
          <p style={{ margin: 0, fontSize: '12.5px' }}>
            <b style={{ fontWeight: 600 }}>Remarks</b> — {entry.remarks}
          </p>
        )}

        {entry.repairFields.length > 0 && (
          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-2)', margin: 'var(--s-2) 0 2px' }}>
              Repair items flagged
            </div>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: '12.5px' }}>
              {entry.repairFields.map((f) => <SeverityRow key={f.label} field={f} />)}
            </ul>
          </div>
        )}
        {entry.machineFields.length > 0 && (
          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-2)', margin: 'var(--s-2) 0 2px' }}>
              Machine issues flagged
            </div>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: '12.5px' }}>
              {entry.machineFields.map((f) => <SeverityRow key={f.label} field={f} />)}
            </ul>
          </div>
        )}

        {photoEntries.length > 0 && (
          <div>
            <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-2)', margin: 'var(--s-2) 0 2px' }}>
              Photos
            </div>
            <div className="photo-grid">
              {photoEntries.map((p, i) => (
                <figure key={i} style={{ margin: 0 }}>
                  <PhotoThumb url={p.url} label={p.label} />
                  <figcaption className="subtle" style={{ fontSize: '10.5px', marginTop: '4px' }}>{p.label}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
      </div>
    </DataPanel>
  );
}

/**
 * The full record for one container, from gate-in to ready-to-move — the
 * same content the printable report (`ContainerReport.tsx`) renders, kept
 * in one place so the two can never drift apart.
 */
export function ContainerReportContent({
  container,
  workers,
}: {
  container: MockContainer;
  workers: MockWorker[];
}): React.ReactElement {
  const workerFor = (id: string | null): MockWorker | undefined => workers.find((w) => w.id === id);
  const ready = Boolean(container.readyAt) || isReadyToMove(container);

  const inspectionFields = container.survey?.fields.slice(0, CONTAINER_INSPECTION_FIELDS.length) ?? [];
  const machineFields = container.survey?.fields.slice(CONTAINER_INSPECTION_FIELDS.length) ?? [];

  return (
    <div className="stack stack-loose">
      <div>
        <span className="cluster" style={{ gap: 'var(--s-2)' }}>
          <h2 className="mono" style={{ fontSize: '20px', margin: '0 0 4px' }}>
            {container.id}
          </h2>
          {container.priority && (
            <StatusPill status={{ tone: 'bad', icon: 'alert', label: 'Fast-track', detail: 'Flagged to handle ahead of normal work.' }} />
          )}
        </span>
        <p className="subtle" style={{ margin: 0, fontSize: '13px' }}>
          {container.typeCode} · {container.size}
          {container.color && ` · ${container.color}`}
        </p>
      </div>

      <DataPanel title="Timeline">
        <div className="infogrid">
          <div>
            <dt>Gated in</dt>
            <dd>{formatSurveyDate(container.registeredAt)}</dd>
          </div>
          <div>
            <dt>Surveyed</dt>
            <dd>{container.survey ? formatSurveyDate(container.survey.performedAt) : '—'}</dd>
          </div>
          <div>
            <dt>Ready to move</dt>
            <dd>{container.readyAt ? formatSurveyDate(container.readyAt) : ready ? 'Complete, not yet marked' : '—'}</dd>
          </div>
          <div>
            <dt>Departed</dt>
            <dd>{container.departedAt ? formatSurveyDate(container.departedAt) : '—'}</dd>
          </div>
        </div>
      </DataPanel>

      {container.gateIn && <GateLogPanel title="Gate In" entry={container.gateIn} />}
      {container.gateOut && <GateLogPanel title="Gate Out" entry={container.gateOut} />}

      <DataPanel title="Survey">
        {container.survey ? (
          <div className="stack stack-tight">
            <p style={{ margin: 0, fontSize: '13px' }}>
              Performed {formatSurveyDate(container.survey.performedAt)} —{' '}
              {container.survey.outcome === 'ready' ? 'no issues found' : 'repair / prep required'}
            </p>

            {inspectionFields.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-2)', margin: 'var(--s-2) 0 2px' }}>
                  Container Inspection Checklist
                </div>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: '12.5px' }}>
                  {inspectionFields.map((f) => (
                    <SeverityRow key={f.label} field={f} />
                  ))}
                </ul>
              </div>
            )}

            {machineFields.length > 0 && (
              <div>
                <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11px', color: 'var(--text-2)', margin: 'var(--s-2) 0 2px' }}>
                  Machine Check
                </div>
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', fontSize: '12.5px' }}>
                  {machineFields.map((f) => (
                    <SeverityRow key={f.label} field={f} />
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="subtle" style={{ margin: 0, fontSize: '12.5px' }}>
            No survey on record.
          </p>
        )}
      </DataPanel>

      {container.sections.map((section) => {
        const done = section.tasks.filter(taskSettled).length;
        const total = section.tasks.length;
        const totalSec = section.tasks.reduce((sum, t) => sum + t.elapsedSec, 0);
        return (
          <DataPanel
            key={section.kind}
            title={SECTION_LABELS[section.kind]}
            meta={`${done}/${total} done${totalSec > 0 ? ` · ${formatElapsed(totalSec)} logged` : ''}`}
          >
            <div className="stack stack-tight">
              {section.tasks.map((task) => {
                const worker = workerFor(task.workerId);
                return (
                  <div
                    key={task.key}
                    className="cluster"
                    style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}
                  >
                    <span
                      style={{
                        fontSize: '12.5px',
                        fontWeight: 600,
                        textDecoration: task.state === 'na' ? 'line-through' : 'none',
                        color: task.state === 'na' ? 'var(--text-3)' : 'var(--text)',
                      }}
                    >
                      {task.label}
                    </span>
                    <span className="cluster" style={{ gap: 'var(--s-3)' }}>
                      {worker ? <Person name={worker.name} detail={WORKER_TYPE_LABELS[worker.type]} /> : <span className="subtle">Unassigned</span>}
                      <span className="mono subtle" style={{ fontSize: '11.5px', minWidth: '48px', textAlign: 'right' }}>
                        {task.state === 'na' ? 'N/A' : formatElapsed(task.elapsedSec)}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </DataPanel>
        );
      })}

      <DataPanel title="Outcome">
        {container.departedAt ? (
          <StatusPill
            size="lg"
            status={{ tone: 'neutral', icon: 'truck', label: `Departed — ${formatSurveyDate(container.departedAt)}`, detail: 'Gated out of the yard.' }}
          />
        ) : container.readyAt ? (
          <StatusPill
            size="lg"
            status={{ tone: 'ok', icon: 'check-circle', label: `Ready to move — ${formatSurveyDate(container.readyAt)}`, detail: 'Cleared for release.' }}
          />
        ) : ready ? (
          <StatusPill
            size="lg"
            status={{ tone: 'ok', icon: 'check-circle', label: 'All work complete', detail: 'Not yet marked ready to move.' }}
          />
        ) : (
          <StatusPill size="lg" status={{ tone: 'warn', icon: 'clock', label: 'Not yet ready to move', detail: 'Work is still open.' }} />
        )}
      </DataPanel>
    </div>
  );
}
