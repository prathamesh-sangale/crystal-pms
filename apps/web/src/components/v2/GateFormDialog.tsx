import { useEffect, useId, useMemo, useState } from 'react';
import {
  formatSurveyDate,
  GATE_PHOTO_SLOTS,
  offsetDate,
  SIZE_OPTIONS,
  STANDARD_COLORS,
  TYPE_CODES,
  type ContainerDraft,
  type ContainerDraftData,
  type FieldSeverity,
  type GateLogEntry,
  type GatePhotoKey,
  type GatePhotos,
  type MockContainer,
  type MockSurveyField,
} from '../../lib/mockV2';
import { api, type ImsMatch } from '../../lib/api';
import { cx } from '../../lib/cx';
import { istDay } from '../../lib/istDate';
import { Button } from '../crystal/Button';
import { useToast } from '../crystal/Feedback';
import { CheckboxField, Field } from '../crystal/Form';
import { Icon, type IconName } from '../crystal/Icon';
import { Modal } from '../crystal/Overlay';

const CUSTOM_COLOR = 'Custom…';

export interface DraftField extends MockSurveyField {
  key: string;
}

export function blankFields(labels: string[], defaultSeverity: FieldSeverity = 'unassessed'): DraftField[] {
  return labels.map((label) => ({ key: label, label, severity: defaultSeverity, note: '' }));
}

/** Plain Good/Damage — the Repair checklist doesn't need a minor/major
 * severity grade,
 * and grading it invited a real bug: an admin could tap through every item
 * as "Good" (or leave them unassessed) and silently end up with "Repair
 * Required? Yes" producing zero actual repair work, with nothing on screen
 * flagging the contradiction. A plain two-way toggle with the description
 * required right under it removes that gap — either an item is damaged and
 * says how, or it isn't. (Labelled "Good"/"Damage" rather than "No"/"Yes",
 * by direct request — reads as a condition, not a question's answer.) */
export function RepairToggle({ value, onChange }: { value: FieldSeverity; onChange: (severity: FieldSeverity) => void }): React.ReactElement {
  const isDamaged = value === 'flagged';
  return (
    <span className="cluster" style={{ gap: '6px', flex: 'none' }} role="group" aria-label="Condition">
      <button type="button" className="chip" aria-pressed={!isDamaged} onClick={() => onChange('good')}>
        Good
      </button>
      <button type="button" className="chip" aria-pressed={isDamaged} onClick={() => onChange('flagged')}>
        Damage
      </button>
    </span>
  );
}

export function RepairFieldRow({
  field,
  onSeverity,
  onNote,
}: {
  field: DraftField;
  onSeverity: (severity: FieldSeverity) => void;
  onNote: (note: string) => void;
}): React.ReactElement {
  const flagged = field.severity === 'flagged';
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <div className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-2)' }}>
        <span style={{ fontSize: '12.5px', flex: 1, minWidth: 0 }}>{field.label}</span>
        <RepairToggle value={field.severity} onChange={onSeverity} />
      </div>
      {flagged && (
        <input
          className="input"
          style={{ height: '38px', padding: '8px 10px', fontSize: '12.5px' }}
          value={field.note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="What needs to be repaired?"
        />
      )}
    </div>
  );
}

const NOTE_COLOR: Record<'dim' | 'warn' | 'ok', string> = {
  dim: 'var(--text-3)',
  warn: 'var(--warn)',
  ok: 'var(--success)',
};

/** A small icon+text status line, styled inline rather than via the
 * `.field .msg`/`.field .hint` crystal.css rules — those are scoped to
 * render only inside a `.field` wrapper, which this panel isn't one of. */
function Note({ tone, icon, children }: { tone: 'dim' | 'warn' | 'ok'; icon: IconName; children: React.ReactNode }): React.ReactElement {
  return (
    <span style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', fontSize: '11px', color: NOTE_COLOR[tone] }}>
      <Icon name={icon} size="sm" />
      {children}
    </span>
  );
}

/** The "Check IMS" control under the Container ID field — a read-only
 * lookup against IMS's own data, never a write, and scoped to this one
 * yard: a match at a different depot (`elsewhere`) is never offered for
 * pre-fill, only flagged. Outcomes: no match anywhere (FYI, nothing
 * changes); a match only at another depot (flagged, not applied — see
 * `checkIms`'s own toast for the popup half of that); exactly one match at
 * our yard (its Type/Size suggestion pre-fills, still fully editable); or
 * more than one at our yard (IMS's own data has real cases of the same
 * container number covering two different physical units — shown as a
 * picker so the admin disambiguates by type/size rather than one being
 * guessed). */
function ImsLookupPanel({
  status,
  matches,
  elsewhere,
  applied,
  disabled,
  onCheck,
  onApply,
  onDismiss,
}: {
  status: 'idle' | 'loading' | 'none' | 'elsewhere' | 'found';
  matches: ImsMatch[];
  elsewhere: ImsMatch[];
  applied: ImsMatch | null;
  disabled: boolean;
  onCheck: () => void;
  onApply: (match: ImsMatch) => void;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <Button type="button" variant="secondary" size="sm" icon="search" loading={status === 'loading'} disabled={disabled} onClick={onCheck}>
        Check IMS
      </Button>
      {status === 'none' && (
        <Note tone="dim" icon="info">Not found in IMS — continuing as new.</Note>
      )}
      {status === 'elsewhere' && (
        <Note tone="warn" icon="alert">
          Found in IMS at {[...new Set(elsewhere.map((m) => m.depot || 'an unnamed depot'))].join(', ')}, not Crystal Yard — likely unrelated, continuing as new.
        </Note>
      )}
      {status === 'found' && matches.length === 1 && applied && (
        <Note tone="ok" icon="check-circle">
          {applied.suggestedTypeCode || applied.suggestedSize
            ? 'Matched in IMS — Type/Size filled in below.'
            : `Matched in IMS (${applied.imsType || '?'} · ${applied.imsSize || '?'}) — set Type/Size manually.`}
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>Undo</Button>
        </Note>
      )}
      {status === 'found' && matches.length > 1 && (
        <div className="card" style={{ padding: 'var(--s-2)' }}>
          <div style={{ fontSize: '11px', color: 'var(--text-3)', marginBottom: 'var(--s-1)' }}>
            {matches.length} containers in IMS share this number — pick the matching one by type/size:
          </div>
          <div className="stack" style={{ gap: 'var(--s-1)' }}>
            {matches.map((m, i) => (
              <button
                key={i}
                type="button"
                className="chip"
                aria-pressed={applied === m}
                style={{ justifyContent: 'flex-start', textAlign: 'left' }}
                onClick={() => onApply(m)}
              >
                {m.imsType || '?'} · {m.imsSize || '?'}{m.depot ? ` · ${m.depot}` : ''}
              </button>
            ))}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss} style={{ marginTop: 'var(--s-1)' }}>
            None of these — treat as new
          </Button>
        </div>
      )}
    </div>
  );
}

/** One required (or optional "additional") photo tile — shows an upload
 * prompt until a photo's picked, then a real thumbnail via an object URL.
 * Mock-only: nothing here is ever actually uploaded anywhere. */
function PhotoSlot({
  label,
  required,
  file,
  onPick,
  onClear,
}: {
  label: string;
  required?: boolean;
  file: File | null;
  onPick: (file: File) => void;
  onClear: () => void;
}): React.ReactElement {
  const cameraId = useId();
  const galleryId = useId();
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  if (file) {
    return (
      <div className={cx('photo-tile', 'has-photo')}>
        {previewUrl && <img src={previewUrl} alt="" />}
        <span className="photo-tile-label">
          {label}
          {required && <span className="req" aria-hidden="true">*</span>}
        </span>
        <button type="button" className="iconbtn bare photo-tile-remove" aria-label={`Remove ${label} photo`} onClick={onClear}>
          <Icon name="x" size="sm" />
        </button>
      </div>
    );
  }

  // Two explicit choices rather than one big tap target depending on
  // whatever the device's own file picker happens to offer -- not every
  // browser surfaces both a camera and a gallery option from a single
  // <input>, and it isn't obvious either way which one tapping the tile
  // would open.
  return (
    <div className="photo-tile photo-tile-empty">
      <span className="photo-tile-label">
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </span>
      <span className="photo-tile-choices">
        <label htmlFor={cameraId} className="photo-tile-choice">
          <Icon name="camera" size="sm" />
          Camera
        </label>
        <label htmlFor={galleryId} className="photo-tile-choice">
          <Icon name="gallery" size="sm" />
          Gallery
        </label>
      </span>
      <input
        id={cameraId}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          e.target.value = '';
        }}
      />
      <input
        id={galleryId}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const picked = e.target.files?.[0];
          if (picked) onPick(picked);
          e.target.value = '';
        }}
      />
    </div>
  );
}

const emptyPhotos = (): Record<GatePhotoKey, File | null> =>
  Object.fromEntries(GATE_PHOTO_SLOTS.map((s) => [s.key, null])) as Record<GatePhotoKey, File | null>;

export function GateFormDialog({
  open,
  onOpenChange,
  mode,
  container,
  onGateIn,
  onGateOut,
  existingIds,
  resumeDraft,
  onSaveDraft,
  onDiscardDraft,
  loggedInEmail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: 'in' | 'out';
  /** Required for `mode === 'out'` — the container being released. */
  container?: MockContainer | null;
  onGateIn?: (container: MockContainer) => Promise<void>;
  onGateOut?: (containerId: string, entry: GateLogEntry) => Promise<void>;
  /** `mode === 'in'` only — container/tank IDs already in the yard. */
  existingIds?: string[];
  resumeDraft?: ContainerDraft | null;
  onSaveDraft?: (data: ContainerDraftData) => void;
  onDiscardDraft?: (draftId: string) => void;
  loggedInEmail?: string;
}): React.ReactElement {
  const isOut = mode === 'out';
  // True while photos are uploading to Drive and the record is being saved
  // — can take a few seconds for several files, so the confirm button
  // needs its own loading state rather than looking frozen.
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  // User Details + Logistics Movement
  const [loggedBy, setLoggedBy] = useState(loggedInEmail ?? '');

  // Container Specs
  const [id, setId] = useState('');
  const [idError, setIdError] = useState<string | null>(null);
  // Read-only IMS lookup state — never writes anything back to IMS.
  // 'idle' until "Check IMS" is clicked; cleared whenever the ID is edited
  // afterward, since a stale match from a different ID shouldn't linger.
  // 'elsewhere' means: nothing at our own yard, but IMS has this number at
  // a different depot — never pre-filled from, just flagged.
  const [imsStatus, setImsStatus] = useState<'idle' | 'loading' | 'none' | 'elsewhere' | 'found'>('idle');
  const [imsMatches, setImsMatches] = useState<ImsMatch[]>([]);
  const [imsElsewhere, setImsElsewhere] = useState<ImsMatch[]>([]);
  const [imsApplied, setImsApplied] = useState<ImsMatch | null>(null);
  const [typeCode, setTypeCode] = useState(TYPE_CODES[0]!);
  const [size, setSize] = useState(SIZE_OPTIONS[0]!);
  const [indentRef, setIndentRef] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [color, setColor] = useState(STANDARD_COLORS[0]!);
  const [customColor, setCustomColor] = useState('');
  const [priority, setPriority] = useState(false);

  // Transport Details
  const [location, setLocation] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [transporterNumber, setTransporterNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrCopyName, setLrCopyName] = useState<string | null>(null);

  // Inspection Photos
  const [photos, setPhotos] = useState<Record<GatePhotoKey, File | null>>(emptyPhotos);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);

  const [remarks, setRemarks] = useState('');

  const isReefer = isOut ? Boolean(container?.typeCode.startsWith('Reefer')) : typeCode.startsWith('Reefer');

  // Applies one IMS candidate's Type/Size suggestion — fully editable
  // afterward, same as any other field; this only ever pre-fills, never
  // locks anything in. A candidate missing a confident suggestion (IMS's
  // own Type/Size values are inconsistent — "CONTAINER", "CCCS", etc.)
  // still gets marked "applied" so its reference details show, it just
  // leaves the dropdowns as they were.
  const applyImsMatch = (match: ImsMatch): void => {
    if (match.suggestedTypeCode) setTypeCode(match.suggestedTypeCode);
    if (match.suggestedSize) setSize(match.suggestedSize);
    setImsApplied(match);
  };

  const checkIms = async (overrideId?: string): Promise<void> => {
    const trimmed = (overrideId ?? id).trim();
    if (!trimmed) return;
    setImsStatus('loading');
    setImsApplied(null);
    try {
      const { matches, elsewhere } = await api.v2ImsLookup(trimmed);
      setImsMatches(matches);
      setImsElsewhere(elsewhere);
      if (matches.length > 0) {
        setImsStatus('found');
        if (matches.length === 1) applyImsMatch(matches[0]!);
      } else if (elsewhere.length > 0) {
        setImsStatus('elsewhere');
        const depots = [...new Set(elsewhere.map((m) => m.depot || 'an unnamed depot'))].join(', ');
        toast.toast('warn', 'Found in IMS, but not at Crystal Yard', `Listed at ${depots} — likely unrelated. Continuing as new.`);
      } else {
        setImsStatus('none');
      }
    } catch {
      setImsStatus('none');
      setImsMatches([]);
      setImsElsewhere([]);
      toast.error('Could not reach IMS right now — continuing without it.');
    }
  };

  // Pre-fill from a draft the moment it's opened to resume — 'in' mode only.
  // Intake-only, matching ContainerDraftData's own shape now that Gate-In
  // no longer collects anything assessment-shaped.
  useEffect(() => {
    if (!open || isOut || !resumeDraft) return;
    const d = resumeDraft.data;
    setId(d.id);
    setTypeCode(d.typeCode);
    setSize(d.size);
    setColor(d.color);
    setCustomColor(d.customColor);
    setPriority(d.priority);
    setLoggedBy(d.loggedBy);
    setIndentRef(d.indentRef);
    setCustomerName(d.customerName);
    setLocation(d.location);
    setTransporterName(d.transporterName);
    setTransporterNumber(d.transporterNumber);
    setVehicleNumber(d.vehicleNumber);
    setRemarks(d.remarks);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only on open/draft-id change.
  }, [open, isOut, resumeDraft?.id]);

  const reset = (): void => {
    setLoggedBy(loggedInEmail ?? '');
    setId('');
    setIdError(null);
    setImsStatus('idle');
    setImsMatches([]);
    setImsElsewhere([]);
    setImsApplied(null);
    setTypeCode(TYPE_CODES[0]!);
    setSize(SIZE_OPTIONS[0]!);
    setIndentRef('');
    setCustomerName('');
    setColor(STANDARD_COLORS[0]!);
    setCustomColor('');
    setPriority(false);
    setLocation('');
    setTransporterName('');
    setTransporterNumber('');
    setVehicleNumber('');
    setLrCopyName(null);
    setPhotos(emptyPhotos());
    setAdditionalFiles([]);
    setRemarks('');
  };

  /** Uploads a picked file to the PMS Shared Drive, returning its real link
   * — or '' for an empty slot, same as the old blob-URL version did, so
   * every caller that checks "is this photo filled in" by truthiness still
   * works unchanged. */
  const uploadIfPresent = async (file: File | null, containerId: string): Promise<string> => {
    if (!file) return '';
    const { url } = await api.v2Upload(file, isOut ? 'gate-out' : 'gate-in', containerId);
    return url;
  };

  /** Uploads every picked photo to Drive in parallel and returns real,
   * permanent links — replacing `URL.createObjectURL()`, which only ever
   * worked inside the current browser tab and never survived a reload.
   * `containerId` must already be the final one — Gate-In resolves its
   * placeholder id before calling this, specifically so every one of this
   * container's photos lands in the same Drive subfolder together. */
  const buildPhotos = async (containerId: string): Promise<GatePhotos> => {
    const entries = await Promise.all(GATE_PHOTO_SLOTS.map(async (s) => [s.key, await uploadIfPresent(photos[s.key], containerId)] as const));
    const additional = await Promise.all(additionalFiles.map((f) => uploadIfPresent(f, containerId)));
    return { ...(Object.fromEntries(entries) as Record<GatePhotoKey, string>), additional };
  };

  const confirmGateIn = async (): Promise<void> => {
    const trimmedId = id.trim();
    if (trimmedId && existingIds?.includes(trimmedId)) {
      setIdError(`${trimmedId} is already in the yard — use a different ID.`);
      return;
    }
    setIdError(null);
    setSubmitting(true);
    try {
      const finalId = trimmedId || `NEW ${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9)}`;
      const photosResult = await buildPhotos(finalId);
      const now = new Date();
      const entry: GateLogEntry = {
        kind: 'in',
        loggedAt: now.toISOString(),
        loggedBy,
        movementDate: istDay(now),
        indentRef,
        customerName,
        location,
        transporterName,
        transporterNumber,
        vehicleNumber,
        lrCopyName,
        ptiCheck: 'No',
        ptiVideoName: null,
        ptiVideoUrl: null,
        photos: photosResult,
        paintingRequired: null,
        repairRequired: null,
        repairFields: [],
        machineIssueFound: null,
        machineRepairNote: '',
        cleaningRequired: null,
        estBudget: '',
        remarks,
      };

      const container: MockContainer = {
        id: finalId,
        typeCode,
        size,
        color: isReefer ? 'White' : color === CUSTOM_COLOR ? customColor.trim() || 'Unspecified' : color,
        // No survey yet -- Gate-In is intake only now, by direct request:
        // the survey is a genuinely separate step, run afterward via
        // ContainerDetailDrawer's "Run survey" (RunSurveyDialog), same as
        // every other container that starts without one today (the IMS
        // one-click "Add to yard" path).
        survey: null,
        priority,
        registeredAt: new Date().toISOString(),
        sections: [],
        readyAt: null,
        readyPhotoUrls: [],
        currentSite: null,
        gateIn: entry,
        gateOut: null,
        departedAt: null,
      };
      await onGateIn?.(container);
      if (resumeDraft) onDiscardDraft?.(resumeDraft.id);
      onOpenChange(false);
      reset();
    } catch (err) {
      console.error('Gate-in failed:', err);
      toast.error('Could not complete gate-in', 'Photos or the record itself didn’t save — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const confirmGateOut = async (): Promise<void> => {
    if (!container) return;
    setSubmitting(true);
    try {
      const photosResult = await buildPhotos(container.id);
      const now = new Date();
      const entry: GateLogEntry = {
        kind: 'out',
        loggedAt: now.toISOString(),
        loggedBy,
        movementDate: istDay(now),
        indentRef,
        customerName,
        location,
        transporterName,
        transporterNumber,
        vehicleNumber,
        lrCopyName,
        ptiCheck: 'No',
        ptiVideoName: null,
        ptiVideoUrl: null,
        photos: photosResult,
        paintingRequired: null,
        repairRequired: null,
        repairFields: [],
        machineIssueFound: null,
        machineRepairNote: '',
        cleaningRequired: null,
        estBudget: '',
        remarks,
      };
      await onGateOut?.(container.id, entry);
      onOpenChange(false);
      reset();
    } catch (err) {
      console.error('Gate-out failed:', err);
      toast.error('Could not complete gate-out', 'Photos or the record itself didn’t save — check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveDraft = (): void => {
    const isEmpty =
      !id.trim() && !loggedBy.trim() && !indentRef.trim() && !customerName.trim() && !location.trim() &&
      !transporterName.trim() && !vehicleNumber.trim() && !priority && !remarks.trim();
    if (!isEmpty) {
      onSaveDraft?.({
        id, typeCode, size, color, customColor, priority,
        loggedBy, indentRef, customerName, location, transporterName, transporterNumber, vehicleNumber,
        remarks,
      });
    }
    if (resumeDraft) onDiscardDraft?.(resumeDraft.id);
    onOpenChange(false);
    reset();
  };

  const photoGrid = (
    <div>
      <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-2)' }}>
        Inspection Photos
      </div>
      <div className="photo-grid">
        {GATE_PHOTO_SLOTS.map((slot) => (
          <PhotoSlot
            key={slot.key}
            label={slot.label}
            required
            file={photos[slot.key]}
            onPick={(file) => setPhotos((cur) => ({ ...cur, [slot.key]: file }))}
            onClear={() => setPhotos((cur) => ({ ...cur, [slot.key]: null }))}
          />
        ))}
        {additionalFiles.map((file, i) => (
          <PhotoSlot
            key={`additional-${i}`}
            label={`Additional ${i + 1}`}
            file={file}
            onPick={() => {}}
            onClear={() => setAdditionalFiles((cur) => cur.filter((_, idx) => idx !== i))}
          />
        ))}
        <PhotoSlot
          label="Additional Photos"
          file={null}
          onPick={(file) => setAdditionalFiles((cur) => [...cur, file])}
          onClear={() => {}}
        />
      </div>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
      title={isOut ? 'Gate out' : 'New arrival — gate in'}
      subtitle={isOut && container ? <span className="mono">{container.id}</span> : undefined}
      size="lg"
      footer={
        isOut ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" icon="truck" onClick={confirmGateOut} loading={submitting}>
              Confirm &amp; gate out
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="secondary" icon="doc" onClick={handleSaveDraft} disabled={submitting}>
              Save as draft
            </Button>
            <Button variant="primary" icon="check-circle" onClick={confirmGateIn} loading={submitting}>
              Confirm &amp; gate in
            </Button>
          </>
        )
      }
    >
      <div className="stack stack-loose">
          <div className="formgrid">
            <div className="stack">
              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-1)' }}>
                Container Specs
              </div>
              {isOut ? (
                <>
                  <Field label="Container Number" required>
                    {(props) => <input {...props} value={container?.id ?? ''} disabled />}
                  </Field>
                  <Field label="Type">{(props) => <input {...props} value={container?.typeCode ?? ''} disabled />}</Field>
                  <Field label="Size">{(props) => <input {...props} value={container?.size ?? ''} disabled />}</Field>
                </>
              ) : (
                <>
                  <Field label="Container / tank ID" hint="Leave blank to auto-generate a placeholder ID" error={idError ?? undefined}>
                    {(props) => (
                      <input
                        {...props}
                        value={id}
                        onChange={(e) => {
                          setId(e.target.value);
                          setIdError(null);
                          setImsStatus('idle');
                          setImsMatches([]);
                          setImsElsewhere([]);
                          setImsApplied(null);
                        }}
                        placeholder="RFCU 445 129-8"
                        autoComplete="off"
                        spellCheck={false}
                      />
                    )}
                  </Field>
                  <ImsLookupPanel
                    status={imsStatus}
                    matches={imsMatches}
                    elsewhere={imsElsewhere}
                    applied={imsApplied}
                    disabled={!id.trim()}
                    onCheck={checkIms}
                    onApply={applyImsMatch}
                    onDismiss={() => { setImsStatus('idle'); setImsMatches([]); setImsElsewhere([]); setImsApplied(null); }}
                  />
                  <Field label="Type / product code">
                    {(props) => (
                      <select {...props} value={typeCode} onChange={(e) => setTypeCode(e.target.value)}>
                        {TYPE_CODES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    )}
                  </Field>
                  <Field label="Size">{(props) => <select {...props} value={size} onChange={(e) => setSize(e.target.value)}>{SIZE_OPTIONS.map((s) => <option key={s}>{s}</option>)}</select>}</Field>
                  {isReefer ? (
                    <Field label="Paint colour" hint="Reefers default to white">
                      {(props) => <input {...props} value="White" disabled />}
                    </Field>
                  ) : (
                    <>
                      <Field label="Paint colour">
                        {(props) => (
                          <select {...props} value={color} onChange={(e) => setColor(e.target.value)}>
                            {[...STANDARD_COLORS, CUSTOM_COLOR].map((c) => <option key={c}>{c}</option>)}
                          </select>
                        )}
                      </Field>
                      {color === CUSTOM_COLOR && (
                        <Field label="Custom colour">
                          {(props) => <input {...props} value={customColor} onChange={(e) => setCustomColor(e.target.value)} placeholder="e.g. Traffic Red" />}
                        </Field>
                      )}
                    </>
                  )}
                </>
              )}
              <Field label="Indent Reference">
                {(props) => <input {...props} value={indentRef} onChange={(e) => setIndentRef(e.target.value)} />}
              </Field>
              <Field label="Customer Name">
                {(props) => <input {...props} value={customerName} onChange={(e) => setCustomerName(e.target.value)} />}
              </Field>
              {!isOut && (
                <CheckboxField checked={priority} onCheckedChange={setPriority} label="Fast-track this container" />
              )}

              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', margin: 'var(--s-2) 0 var(--s-1)' }}>
                User Details
              </div>
              <Field label="Email / Name" required>
                {(props) => <input {...props} value={loggedBy} onChange={(e) => setLoggedBy(e.target.value)} placeholder="Enter your email" autoComplete="off" />}
              </Field>

              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', margin: 'var(--s-2) 0 var(--s-1)' }}>
                Logistics Movement
              </div>
              <Field label="Status" required>
                {(props) => <input {...props} value={isOut ? 'Outward (Gate-Out)' : 'Inward (Gate-In)'} disabled />}
              </Field>
              <Field label="Date" hint="Recorded automatically the moment this is confirmed — not editable.">
                {(props) => <input {...props} value={formatSurveyDate(offsetDate(0))} disabled />}
              </Field>
            </div>

            <div className="stack">
              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', marginBottom: 'var(--s-1)' }}>
                Transport Details
              </div>
              <Field label="Location" required>
                {(props) => <input {...props} value={location} onChange={(e) => setLocation(e.target.value)} />}
              </Field>
              <Field label="Transporter Name" required>
                {(props) => <input {...props} value={transporterName} onChange={(e) => setTransporterName(e.target.value)} />}
              </Field>
              <Field label="Transporter Number">
                {(props) => <input {...props} value={transporterNumber} onChange={(e) => setTransporterNumber(e.target.value)} />}
              </Field>
              <Field label="Vehicle Number" required>
                {(props) => <input {...props} value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value)} />}
              </Field>
              <Field label="LR Copy" hint={lrCopyName ?? 'No file chosen'}>
                {(props) => (
                  <input
                    {...props}
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setLrCopyName(e.target.files?.[0]?.name ?? null)}
                  />
                )}
              </Field>

              <Field label="Remarks">
                {(props) => <textarea {...props} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
              </Field>
            </div>
          </div>

          {photoGrid}
      </div>
    </Modal>
  );
}
