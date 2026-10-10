import { useEffect, useId, useMemo, useState } from 'react';
import {
  cleaningTasks,
  fieldNeedsAttention,
  FIELD_SEVERITY_LABELS,
  formatSurveyDate,
  GATE_PHOTO_SLOTS,
  MACHINE_CHECK_FIELDS,
  offsetDate,
  ptiTasks,
  REPAIR_ITEMS,
  repairTasksFor,
  SIZE_OPTIONS,
  STANDARD_COLORS,
  surveyFieldNames,
  TYPE_CODES,
  type ContainerDraft,
  type ContainerDraftData,
  type FieldSeverity,
  type GateLogEntry,
  type GatePhotoKey,
  type GatePhotos,
  type LogoChoice,
  type MockContainer,
  type MockSurveyField,
  type MockTask,
  type PtiCheckAnswer,
  type SectionKind,
} from '../../lib/mockV2';
import { api, type ImsMatch } from '../../lib/api';
import { cx } from '../../lib/cx';
import { Button } from '../crystal/Button';
import { useToast } from '../crystal/Feedback';
import { CheckboxField, Field } from '../crystal/Form';
import { Icon, type IconName } from '../crystal/Icon';
import { Modal } from '../crystal/Overlay';

const CUSTOM_COLOR = 'Custom…';

const LOGO_LABELS: Record<LogoChoice, string> = {
  na: 'Not required',
  readymade: 'Ready-made (sticker/decal)',
  physical: 'Physical (painted)',
  removal: 'Removal',
};

/** The actual task created at Gate-In once a Logo choice other than "Not
 * required" is picked — kept as an explicit lookup (not a ternary) so a new
 * LogoChoice value can't silently fall through into the wrong label. */
const LOGO_TASK: Record<Exclude<LogoChoice, 'na'>, { label: string; estHrs: number }> = {
  readymade: { label: 'Logo (ready-made)', estHrs: 0.25 },
  physical: { label: 'Logo (painted)', estHrs: 0.75 },
  removal: { label: 'Logo removal', estHrs: 0.5 },
};

interface DraftField extends MockSurveyField {
  key: string;
}

function blankFields(labels: string[], defaultSeverity: FieldSeverity = 'unassessed'): DraftField[] {
  return labels.map((label) => ({ key: label, label, severity: defaultSeverity, note: '' }));
}

const SEVERITY_TONE: Record<'good' | 'minor' | 'major', { icon: IconName; color: string; bg: string }> = {
  good: { icon: 'check', color: 'var(--success)', bg: 'var(--success-bg)' },
  minor: { icon: 'alert', color: 'var(--warn)', bg: 'var(--warn-bg)' },
  major: { icon: 'x-circle', color: 'var(--error)', bg: 'var(--error-bg)' },
};

/** Tap to set, tap the same one again to undo back to unassessed. Carried
 * over from the old SurveyIntakeDialog unchanged — still the fastest way to
 * work through a checklist once "Repair Required?"/"Machine issue found?"
 * reveals one. */
function SeverityToggle({ value, onChange }: { value: FieldSeverity; onChange: (severity: FieldSeverity) => void }): React.ReactElement {
  return (
    <span className="cluster" style={{ gap: '6px', flex: 'none' }} role="group" aria-label="Severity">
      {(['good', 'minor', 'major'] as const).map((s) => {
        const active = value === s;
        const tone = SEVERITY_TONE[s];
        return (
          <button
            key={s}
            type="button"
            className="sev-btn"
            title={FIELD_SEVERITY_LABELS[s]}
            aria-label={FIELD_SEVERITY_LABELS[s]}
            aria-pressed={active}
            onClick={() => onChange(active ? 'unassessed' : s)}
            style={{ '--sev-color': tone.color, '--sev-bg': tone.bg } as React.CSSProperties}
          >
            <Icon name={tone.icon} size="md" />
          </button>
        );
      })}
    </span>
  );
}

function FieldRow({
  field,
  onSeverity,
  onNote,
}: {
  field: DraftField;
  onSeverity: (severity: FieldSeverity) => void;
  onNote: (note: string) => void;
}): React.ReactElement {
  const flagged = field.severity === 'minor' || field.severity === 'major';
  return (
    <div className="stack" style={{ gap: 'var(--s-1)' }}>
      <div className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-2)' }}>
        <span style={{ fontSize: '12.5px', flex: 1, minWidth: 0 }}>{field.label}</span>
        <SeverityToggle value={field.severity} onChange={onSeverity} />
      </div>
      {flagged && (
        <input
          className="input"
          style={{ height: '38px', padding: '8px 10px', fontSize: '12.5px' }}
          value={field.note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="What's wrong?"
        />
      )}
    </div>
  );
}

/** Plain Yes/No, not the three-way SeverityToggle Machine Check still uses
 * — the Repair checklist doesn't need a minor/major severity grade, and
 * grading it invited a real bug: an admin could tap through every item as
 * "Good" (or leave them unassessed) and silently end up with "Repair
 * Required? Yes" producing zero actual repair work, with nothing on screen
 * flagging the contradiction. A plain Yes/No with the description required
 * right under it removes that gap — either an item needs repair and says
 * what, or it doesn't. */
function RepairToggle({ value, onChange }: { value: FieldSeverity; onChange: (severity: FieldSeverity) => void }): React.ReactElement {
  const isYes = value === 'flagged';
  return (
    <span className="cluster" style={{ gap: '6px', flex: 'none' }} role="group" aria-label="Needs repair">
      <button type="button" className="chip" aria-pressed={!isYes} onClick={() => onChange('good')}>
        No
      </button>
      <button type="button" className="chip" aria-pressed={isYes} onClick={() => onChange('flagged')}>
        Yes
      </button>
    </span>
  );
}

function RepairFieldRow({
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
  const inputId = useId();
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  return (
    <label htmlFor={inputId} className={cx('photo-tile', file && 'has-photo')}>
      {previewUrl ? <img src={previewUrl} alt="" /> : <Icon name="upload" />}
      <span className="photo-tile-label">
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </span>
      <input
        id={inputId}
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
      {file && (
        <button
          type="button"
          className="iconbtn bare photo-tile-remove"
          aria-label={`Remove ${label} photo`}
          onClick={(e) => {
            e.preventDefault();
            onClear();
          }}
        >
          <Icon name="x" size="sm" />
        </button>
      )}
    </label>
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
  const [step, setStep] = useState<'intake' | 'result'>('intake');
  // True while photos/the PTI video are uploading to Drive and the record
  // is being saved — can take a few seconds for several files, so the
  // confirm button needs its own loading state rather than looking frozen.
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
  const [logoChoice, setLogoChoice] = useState<LogoChoice>('na');
  const [priority, setPriority] = useState(false);

  // Transport Details
  const [location, setLocation] = useState('');
  const [transporterName, setTransporterName] = useState('');
  const [transporterNumber, setTransporterNumber] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [lrCopyName, setLrCopyName] = useState<string | null>(null);

  // PTI Check
  const [ptiCheck, setPtiCheck] = useState<PtiCheckAnswer>('No');
  const [ptiVideoName, setPtiVideoName] = useState<string | null>(null);
  // The actual picked file — `ptiVideoName` alone used to be the only thing
  // kept (the input's onChange only ever read `.name`), so there was
  // nothing to upload even once Drive was wired up. Kept separately from
  // `ptiVideoName` since the name still needs to display after upload,
  // once this is cleared back to null post-submit.
  const [ptiVideoFile, setPtiVideoFile] = useState<File | null>(null);

  // Inspection Photos
  const [photos, setPhotos] = useState<Record<GatePhotoKey, File | null>>(emptyPhotos);
  const [additionalFiles, setAdditionalFiles] = useState<File[]>([]);

  // Assessment
  const [repairRequired, setRepairRequired] = useState(false);
  // 'good' (not 'unassessed') — the Repair checklist's Yes/No toggle has no
  // third "not yet checked" state to represent, so an untouched item must
  // already read as "No" both visually and in `fieldNeedsAttention`.
  const [repairFields, setRepairFields] = useState<DraftField[]>(() => blankFields(REPAIR_ITEMS, 'good'));
  const [machineIssueFound, setMachineIssueFound] = useState(false);
  const [machineFields, setMachineFields] = useState<DraftField[]>(() => blankFields(MACHINE_CHECK_FIELDS));
  const [cleaningRequired, setCleaningRequired] = useState(false);
  const [estBudget, setEstBudget] = useState('');
  const [remarks, setRemarks] = useState('');

  const [sections, setSections] = useState<Record<SectionKind, boolean>>({ painting: false, pti: false, cleaning: false, all_rounder: false, sailing: false });

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

  const checkIms = async (): Promise<void> => {
    const trimmed = id.trim();
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
  useEffect(() => {
    if (!open || isOut || !resumeDraft) return;
    const d = resumeDraft.data;
    setId(d.id);
    setTypeCode(d.typeCode);
    setSize(d.size);
    setColor(d.color);
    setCustomColor(d.customColor);
    setLogoChoice(d.logoChoice);
    setPriority(d.priority);
    setLoggedBy(d.loggedBy);
    setIndentRef(d.indentRef);
    setCustomerName(d.customerName);
    setLocation(d.location);
    setTransporterName(d.transporterName);
    setTransporterNumber(d.transporterNumber);
    setVehicleNumber(d.vehicleNumber);
    setPtiCheck(d.ptiCheck);
    setRepairRequired(d.repairRequired);
    setMachineIssueFound(d.machineIssueFound);
    setCleaningRequired(d.cleaningRequired);
    setEstBudget(d.estBudget);
    setRemarks(d.remarks);
    const byLabel = new Map(d.fields.map((f) => [f.label, f]));
    const restore = (label: string, defaultSeverity: FieldSeverity): DraftField => {
      const found = byLabel.get(label);
      return { key: label, label, severity: found?.severity ?? defaultSeverity, note: found?.note ?? '' };
    };
    // A draft saved before the Repair checklist moved to plain Yes/No could
    // still carry 'minor'/'major'/'unassessed' from the old three-way
    // severity toggle — anything that isn't already 'good' reads as "Yes"
    // under the new model, matching `fieldNeedsAttention`'s own rule.
    setRepairFields(REPAIR_ITEMS.map((label) => {
      const f = restore(label, 'good');
      return f.severity === 'good' ? f : { ...f, severity: 'flagged' };
    }));
    setMachineFields(MACHINE_CHECK_FIELDS.map((label) => restore(label, 'unassessed')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only on open/draft-id change.
  }, [open, isOut, resumeDraft?.id]);

  const reset = (): void => {
    setStep('intake');
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
    setLogoChoice('na');
    setPriority(false);
    setLocation('');
    setTransporterName('');
    setTransporterNumber('');
    setVehicleNumber('');
    setLrCopyName(null);
    setPtiCheck('No');
    setPtiVideoName(null);
    setPtiVideoFile(null);
    setPhotos(emptyPhotos());
    setAdditionalFiles([]);
    setRepairRequired(false);
    setRepairFields(blankFields(REPAIR_ITEMS, 'good'));
    setMachineIssueFound(false);
    setMachineFields(blankFields(MACHINE_CHECK_FIELDS));
    setCleaningRequired(false);
    setEstBudget('');
    setRemarks('');
  };

  const setRepairSeverity = (key: string, severity: FieldSeverity): void => {
    setRepairFields((cur) => cur.map((f) => (f.key === key ? { ...f, severity, note: severity === 'flagged' ? f.note : '' } : f)));
  };
  const setRepairNote = (key: string, note: string): void => {
    setRepairFields((cur) => cur.map((f) => (f.key === key ? { ...f, note } : f)));
  };
  const setMachineSeverity = (key: string, severity: FieldSeverity): void => {
    setMachineFields((cur) => cur.map((f) => (f.key === key ? { ...f, severity, note: severity === 'minor' || severity === 'major' ? f.note : '' } : f)));
  };
  const setMachineNote = (key: string, note: string): void => {
    setMachineFields((cur) => cur.map((f) => (f.key === key ? { ...f, note } : f)));
  };

  /** The full fixed-order checklist `container.survey` expects — built from
   * whichever conditional checklists the admin actually saw and touched, so
   * `ContainerReportContent`'s positional slicing (inspection vs. machine
   * fields) keeps working unchanged. Curtain/Tube Light/Mantrap (and either
   * checklist when its Yes/No gate stayed No) default to "good" — this new
   * form never asks about them directly. */
  function buildSurveyFields(): MockSurveyField[] {
    const repairByLabel = new Map(repairFields.map((f) => [f.label, f]));
    const machineByLabel = new Map(machineFields.map((f) => [f.label, f]));
    return surveyFieldNames(isReefer).map((label) => {
      if (label === 'Contamination') {
        return cleaningRequired
          ? { label, severity: 'minor', note: remarks.trim() || 'Flagged for cleaning at gate-in.' }
          : { label, severity: 'good', note: '' };
      }
      if (repairRequired && repairByLabel.has(label)) {
        const f = repairByLabel.get(label)!;
        return { label, severity: f.severity, note: f.note };
      }
      if (machineIssueFound && machineByLabel.has(label)) {
        const f = machineByLabel.get(label)!;
        return { label, severity: f.severity, note: f.note };
      }
      return { label, severity: 'good', note: '' };
    });
  }

  const runSurvey = (): void => {
    const trimmedId = id.trim();
    if (trimmedId && existingIds?.includes(trimmedId)) {
      setIdError(`${trimmedId} is already in the yard — use a different ID.`);
      return;
    }
    setIdError(null);
    const needsRepair = repairRequired && repairFields.some(fieldNeedsAttention);
    setSections({
      painting: needsRepair || logoChoice !== 'na',
      // "PTI Check: Yes" + video means a Pre-Trip Inspection walkthrough
      // already happened as part of this gate-in, so the yard's own PTI
      // section (Lights, Strip & Curtain) would be redoing work already on
      // record — only needed when the answer is still "No". Previously
      // hardcoded `true` unconditionally, which meant a container could
      // never actually reach "no issues found" through the real form (every
      // arrival got a PTI section regardless), blocking the one path a
      // genuinely clean container should take straight to Ready to Move.
      pti: ptiCheck === 'No',
      cleaning: cleaningRequired,
      all_rounder: needsRepair,
      // Sailing Crew work is never generated at Gate-In -- it's only ever
      // added afterward, via the ad-hoc "Add a new task" flow in
      // AssignWorkDialog.
      sailing: false,
    });
    setStep('result');
  };

  /** Uploads a picked file to the PMS Shared Drive, returning its real link
   * — or '' for an empty slot, same as the old blob-URL version did, so
   * every caller that checks "is this photo filled in" by truthiness still
   * works unchanged. */
  const uploadIfPresent = async (file: File | null): Promise<string> => {
    if (!file) return '';
    const { url } = await api.v2Upload(file);
    return url;
  };

  /** Uploads every picked photo to Drive in parallel and returns real,
   * permanent links — replacing `URL.createObjectURL()`, which only ever
   * worked inside the current browser tab and never survived a reload. */
  const buildPhotos = async (): Promise<GatePhotos> => {
    const entries = await Promise.all(GATE_PHOTO_SLOTS.map(async (s) => [s.key, await uploadIfPresent(photos[s.key])] as const));
    const additional = await Promise.all(additionalFiles.map((f) => uploadIfPresent(f)));
    return { ...(Object.fromEntries(entries) as Record<GatePhotoKey, string>), additional };
  };

  const confirmGateIn = async (): Promise<void> => {
    const required = (Object.keys(sections) as SectionKind[]).filter((k) => sections[k]);
    const outcome: 'ready' | 'needs-work' = required.length === 0 ? 'ready' : 'needs-work';
    const surveyFieldsArr = buildSurveyFields();
    const needsRepair = repairRequired && repairFields.some(fieldNeedsAttention);
    // SPEC.md §4.3 "Painter Helper": tape display + gasket before any spray
    // work; paint the compressor + display as its own step after the main
    // coats — only needed when paint is actually sprayed, not for a
    // ready-made logo sticker with nothing else wrong.
    const paintingNeedsSpray = needsRepair || logoChoice === 'physical';
    const lastMainPaintKey = needsRepair ? 'coat2' : paintingNeedsSpray ? 'tape_display' : null;
    const paintingTaskList: MockTask[] = [
      ...(paintingNeedsSpray
        ? [
            {
              key: 'tape_display',
              label: 'Tape display + gasket',
              workerId: null,
              state: 'pending' as const,
              startedAt: null,
              elapsedSec: 0,
              estHrs: 0,
              site: 'Painting site' as const,
              ownerType: 'painter_helper' as const,
              dependsOn: [],
            },
          ]
        : []),
      ...(needsRepair
        ? [
            { key: 'primer', label: 'Primer', workerId: null, state: 'pending' as const, startedAt: null, elapsedSec: 0, estHrs: 1.5, site: 'Painting site' as const, dependsOn: ['tape_display'] },
            { key: 'coat1', label: '1st coat', workerId: null, state: 'pending' as const, startedAt: null, elapsedSec: 0, estHrs: 1.5, site: 'Painting site' as const, dependsOn: ['primer'] },
            { key: 'coat2', label: '2nd coat', workerId: null, state: 'pending' as const, startedAt: null, elapsedSec: 0, optional: true, estHrs: 1.5, site: 'Painting site' as const, dependsOn: ['coat1'] },
          ]
        : []),
      ...(logoChoice !== 'na'
        ? [
            {
              key: 'logo',
              label: LOGO_TASK[logoChoice].label,
              workerId: null,
              state: 'pending' as const,
              startedAt: null,
              elapsedSec: 0,
              estHrs: LOGO_TASK[logoChoice].estHrs,
              site: 'Painting site' as const,
              dependsOn: lastMainPaintKey ? [lastMainPaintKey] : [],
            },
          ]
        : []),
      ...(paintingNeedsSpray
        ? [
            {
              key: 'paint_compressor',
              label: 'Paint compressor + display',
              workerId: null,
              state: 'pending' as const,
              startedAt: null,
              elapsedSec: 0,
              estHrs: 0,
              site: 'Painting site' as const,
              ownerType: 'painter_helper' as const,
              dependsOn: lastMainPaintKey ? [lastMainPaintKey] : [],
            },
          ]
        : []),
    ];
    if (paintingTaskList.length === 0) {
      paintingTaskList.push({
        key: 'other',
        label: 'Painting (reason not specified)',
        workerId: null,
        state: 'pending',
        startedAt: null,
        elapsedSec: 0,
        estHrs: 0,
        site: 'Painting site',
      });
    }
    const allRounderTasks: MockTask[] = repairTasksFor(surveyFieldsArr, REPAIR_ITEMS, 'Painting site');
    if (allRounderTasks.length === 0) {
      allRounderTasks.push({
        key: 'other',
        label: 'Repairment (reason not specified)',
        workerId: null,
        state: 'pending',
        startedAt: null,
        elapsedSec: 0,
        estHrs: 2,
        site: null,
      });
    }

    setSubmitting(true);
    try {
      const [photosResult, ptiVideoUrl] = await Promise.all([buildPhotos(), uploadIfPresent(ptiVideoFile).then((u) => u || null)]);

      const now = new Date();
      const entry: GateLogEntry = {
        kind: 'in',
        loggedAt: now.toISOString(),
        loggedBy,
        movementDate: now.toISOString().slice(0, 10),
        indentRef,
        customerName,
        location,
        transporterName,
        transporterNumber,
        vehicleNumber,
        lrCopyName,
        ptiCheck,
        ptiVideoName,
        ptiVideoUrl,
        photos: photosResult,
        repairRequired,
        repairFields: repairRequired ? repairFields.filter(fieldNeedsAttention) : [],
        machineIssueFound,
        machineFields: machineIssueFound ? machineFields.filter(fieldNeedsAttention) : [],
        cleaningRequired,
        estBudget,
        remarks,
      };

      const container: MockContainer = {
        id: id.trim() || `NEW ${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9)}`,
        typeCode,
        size,
        color: isReefer ? 'White' : color === CUSTOM_COLOR ? customColor.trim() || 'Unspecified' : color,
        survey: { performedAt: new Date().toISOString(), fields: surveyFieldsArr, outcome },
        priority,
        registeredAt: new Date().toISOString(),
        sections: required.map((kind) => ({
          kind,
          tasks:
            kind === 'painting'
              ? paintingTaskList
              : kind === 'pti'
                ? [...ptiTasks(null, typeCode.includes('Anteroom')), ...repairTasksFor(surveyFieldsArr, MACHINE_CHECK_FIELDS, 'Light site')]
                : kind === 'cleaning'
                  ? cleaningTasks(null)
                  : allRounderTasks,
        })),
        // Even a container with nothing flagged now needs a completion photo
        // before it's genuinely "ready to move" (client request) -- readyAt
        // is never set until that photo is uploaded, so this no longer
        // short-circuits straight to ready for a clean survey outcome.
        readyAt: null,
        readyPhotoUrl: null,
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
      const [photosResult, ptiVideoUrl] = await Promise.all([buildPhotos(), uploadIfPresent(ptiVideoFile).then((u) => u || null)]);
      const now = new Date();
      const entry: GateLogEntry = {
        kind: 'out',
        loggedAt: now.toISOString(),
        loggedBy,
        movementDate: now.toISOString().slice(0, 10),
        indentRef,
        customerName,
        location,
        transporterName,
        transporterNumber,
        vehicleNumber,
        lrCopyName,
        ptiCheck,
        ptiVideoName,
        ptiVideoUrl,
        photos: photosResult,
        repairRequired: null,
        repairFields: [],
        machineIssueFound: null,
        machineFields: [],
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
      !transporterName.trim() && !vehicleNumber.trim() && logoChoice === 'na' && !priority && !repairRequired &&
      !machineIssueFound && !cleaningRequired && !estBudget.trim() && !remarks.trim();
    if (!isEmpty) {
      onSaveDraft?.({
        id, typeCode, size, color, customColor, logoChoice, priority,
        fields: [...repairFields, ...machineFields],
        loggedBy, indentRef, customerName, location, transporterName, transporterNumber, vehicleNumber,
        ptiCheck, repairRequired, machineIssueFound, cleaningRequired, estBudget, remarks,
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
      title={isOut ? 'Gate out' : step === 'intake' ? 'New arrival — gate in' : 'Survey result'}
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
        ) : step === 'intake' ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="secondary" icon="doc" onClick={handleSaveDraft}>
              Save as draft
            </Button>
            <Button variant="primary" icon="doc" onClick={runSurvey}>
              Run survey
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('intake')} disabled={submitting}>
              Back
            </Button>
            <Button variant="primary" icon="check-circle" onClick={confirmGateIn} loading={submitting}>
              Confirm &amp; gate in
            </Button>
          </>
        )
      }
    >
      {(isOut || step === 'intake') ? (
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

              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)', margin: 'var(--s-2) 0 var(--s-1)' }}>
                PTI Check
              </div>
              <Field label="PTI Check" required>
                {(props) => (
                  <select
                    {...props}
                    value={ptiCheck}
                    onChange={(e) => {
                      const next = e.target.value as PtiCheckAnswer;
                      setPtiCheck(next);
                      if (next === 'No') {
                        setPtiVideoName(null);
                        setPtiVideoFile(null);
                      }
                    }}
                  >
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                )}
              </Field>
              {ptiCheck === 'Yes' && (
                <Field label="PTI Video" required hint={ptiVideoName ?? 'No file chosen'}>
                  {(props) => (
                    <input
                      {...props}
                      type="file"
                      accept="video/*"
                      onChange={(e) => {
                        const picked = e.target.files?.[0] ?? null;
                        setPtiVideoFile(picked);
                        setPtiVideoName(picked?.name ?? null);
                      }}
                    />
                  )}
                </Field>
              )}

              <Field label="Remarks">
                {(props) => <textarea {...props} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}
              </Field>
            </div>
          </div>

          {/* Assessment runs full-width below the two columns, and the two
             itemized checklists sit right after the toggle that reveals them
             — not detached at the end of the form — so "what does this
             container need" reads as one continuous decision, not two
             unrelated spots on the page. The simple yes/no questions (Logo,
             Color, Repair Required, Machine issue, Cleaning, Budget) are
             boxed together in their own .card, kept visually separate from
             the itemized checklist that follows — one is a handful of
             quick calls, the other is a 12/14-item inspection list, and
             they shouldn't read as the same kind of thing. */}
          {!isOut && (
            <div className="stack" style={{ marginTop: 'var(--s-3)' }}>
              <div style={{ fontFamily: 'var(--f-display)', fontWeight: 700, fontSize: '11.5px', color: 'var(--text)' }}>
                Assessment
              </div>
              <div className="card">
                <div className="formgrid">
                  <Field label="Logo">
                    {(props) => (
                      <select {...props} value={logoChoice} onChange={(e) => setLogoChoice(e.target.value as LogoChoice)}>
                        {(Object.keys(LOGO_LABELS) as LogoChoice[]).map((k) => <option key={k} value={k}>{LOGO_LABELS[k]}</option>)}
                      </select>
                    )}
                  </Field>
                  <div className="stack" style={{ gap: 'var(--s-1)' }}>
                    <div className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-2)' }}>
                      <span style={{ fontSize: '12.5px', flex: 1, minWidth: 0 }}>Color</span>
                      {isReefer ? (
                        <input className="input" style={{ width: '150px', height: '38px', padding: '8px 10px', fontSize: '12.5px', flex: 'none' }} value="White" disabled />
                      ) : (
                        <select
                          className="input"
                          style={{ width: '150px', height: '38px', padding: '8px 10px', fontSize: '12.5px', flex: 'none' }}
                          value={color}
                          onChange={(e) => setColor(e.target.value)}
                        >
                          {[...STANDARD_COLORS, CUSTOM_COLOR].map((c) => <option key={c}>{c}</option>)}
                        </select>
                      )}
                    </div>
                    {!isReefer && color === CUSTOM_COLOR && (
                      <input className="input" style={{ height: '38px', padding: '8px 10px', fontSize: '12.5px' }} value={customColor} onChange={(e) => setCustomColor(e.target.value)} placeholder="e.g. Traffic Red" />
                    )}
                  </div>
                  <Field label="Repair Required?" required>
                    {(props) => (
                      <select {...props} value={repairRequired ? 'Yes' : 'No'} onChange={(e) => setRepairRequired(e.target.value === 'Yes')}>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    )}
                  </Field>
                  {isReefer && (
                    <Field label="Machine issue found?">
                      {(props) => (
                        <select {...props} value={machineIssueFound ? 'Yes' : 'No'} onChange={(e) => setMachineIssueFound(e.target.value === 'Yes')}>
                          <option value="No">No</option>
                          <option value="Yes">Yes</option>
                        </select>
                      )}
                    </Field>
                  )}
                  <Field label="Cleaning required?">
                    {(props) => (
                      <select {...props} value={cleaningRequired ? 'Yes' : 'No'} onChange={(e) => setCleaningRequired(e.target.value === 'Yes')}>
                        <option value="No">No</option>
                        <option value="Yes">Yes</option>
                      </select>
                    )}
                  </Field>
                  <Field label="Est. Budget">
                    {(props) => <input {...props} value={estBudget} onChange={(e) => setEstBudget(e.target.value)} placeholder="e.g. ₹8,000" />}
                  </Field>
                </div>
              </div>

              {repairRequired && (
                <>
                  <div className="divider-lbl">Container Inspection Checklist</div>
                  <p className="subtle" style={{ fontSize: '12px', margin: '0 0 var(--s-2)' }}>
                    Does this need repair? Yes reveals a box for what's wrong.
                  </p>
                  <div className="checklist-grid" style={{ paddingLeft: 'var(--s-2)', borderLeft: '2px solid var(--line)' }}>
                    {repairFields.map((f) => (
                      <RepairFieldRow key={f.key} field={f} onSeverity={(s) => setRepairSeverity(f.key, s)} onNote={(n) => setRepairNote(f.key, n)} />
                    ))}
                  </div>
                </>
              )}
              {isReefer && machineIssueFound && (
                <>
                  <div className="divider-lbl">Machine Check</div>
                  <div className="checklist-grid" style={{ paddingLeft: 'var(--s-2)', borderLeft: '2px solid var(--line)' }}>
                    {machineFields.map((f) => (
                      <FieldRow key={f.key} field={f} onSeverity={(s) => setMachineSeverity(f.key, s)} onNote={(n) => setMachineNote(f.key, n)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {photoGrid}
        </div>
      ) : (
        <div className="stack">
          {Object.values(sections).every((v) => !v) ? (
            <div className="empty" style={{ padding: 'var(--s-3) 0' }}>
              <Button variant="ghost" style={{ pointerEvents: 'none' }} icon="check-circle" />
              <b>No issues found</b>
              <p>This unit can go straight to Ready to Move — check a box below if it needs a section anyway.</p>
            </div>
          ) : (
            <p style={{ fontSize: '12.5px', color: 'var(--text-2)' }}>
              Survey flagged the sections below. Adjust before confirming — this is what gets attached at gate-in.
            </p>
          )}
          <div className="stack stack-tight">
            {(Object.keys(sections) as SectionKind[]).map((kind) => (
              <CheckboxField
                key={kind}
                checked={sections[kind]}
                onCheckedChange={(v) => setSections((cur) => ({ ...cur, [kind]: v }))}
                label={kind === 'painting' ? 'Painting' : kind === 'pti' ? 'PTI (Technician)' : kind === 'cleaning' ? 'Cleaning' : 'Repairment'}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
