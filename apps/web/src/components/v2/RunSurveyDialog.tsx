import { useEffect, useRef, useState } from 'react';
import {
  buildSurveyFields,
  recommendedSurveySections,
  REPAIR_ITEMS,
  surveySectionTasks,
  type LogoChoice,
  type MockContainer,
  type MockSurveyField,
  type MockTask,
  type SectionKind,
} from '../../lib/mockV2';
import { Button } from '../crystal/Button';
import { useToast } from '../crystal/Feedback';
import { CheckboxField, Field } from '../crystal/Form';
import { Modal } from '../crystal/Overlay';
import { blankFields, RepairFieldRow, type DraftField } from './GateFormDialog';

/** Everything a mid-survey draft needs to resume exactly where it left off
 * — the dialog's own full assessment state, nothing from the container
 * itself (that's re-read fresh from `container` on resume, same as a first
 * open). Saved under the container's own real id in the shared `drafts`
 * table (apps/api/src/routes/v2Drafts.ts) — a plain id a Gate-In draft's
 * generated `draft-<timestamp>` id can never collide with. */
export interface SurveyDraftData {
  step: 'assessment' | 'result';
  paintingRequired: boolean;
  logoChoice: LogoChoice;
  needsPti: boolean;
  repairRequired: boolean;
  repairFields: DraftField[];
  machineIssueFound: boolean;
  machineRepairNote: string;
  cleaningRequired: boolean;
  remarks: string;
  sections: Record<SectionKind, boolean>;
}

const BLANK_SECTIONS: Record<SectionKind, boolean> = { painting: false, pti: false, cleaning: false, all_rounder: false, sailing: false };

/** Whether this is worth keeping as a draft at all — a dialog opened and
 * closed without anything actually entered shouldn't leave a row behind
 * for the "Survey drafted" hint to point at. */
function isDirty(d: Pick<SurveyDraftData, 'step' | 'paintingRequired' | 'logoChoice' | 'needsPti' | 'repairRequired' | 'machineIssueFound' | 'cleaningRequired' | 'remarks'>): boolean {
  return (
    d.step === 'result' ||
    d.paintingRequired ||
    d.logoChoice !== 'na' ||
    d.needsPti ||
    d.repairRequired ||
    d.machineIssueFound ||
    d.cleaningRequired ||
    d.remarks.trim() !== ''
  );
}

const LOGO_LABELS: Record<LogoChoice, string> = {
  na: 'Not required',
  readymade: 'Ready-made (sticker/decal)',
  physical: 'Physical (painted)',
  removal: 'Removal',
};

const SURVEYABLE_SECTIONS = ['painting', 'pti', 'cleaning', 'all_rounder'] as const;

const SECTION_CHECKBOX_LABEL: Record<(typeof SURVEYABLE_SECTIONS)[number], string> = {
  painting: 'Painting',
  pti: 'PTI (Technician)',
  cleaning: 'Cleaning',
  all_rounder: 'Repairment',
};

/**
 * Runs a real survey on a container that skipped one — today, only the IMS
 * "Add to yard" one-click flow produces that (an auto-"no issues" survey,
 * zero sections, straight to Ready to move, by direct request so a fast
 * arrival isn't held up on a full inspection). This is the other half of
 * that flow staying a choice rather than a one-way door: if staff later spot
 * something that fast path assumed away, this is where it gets flagged for
 * real — without the full Gate-In form's ID/Transport/User-Details fields,
 * none of which apply to a container already sitting in the yard.
 */
export function RunSurveyDialog({
  open,
  onOpenChange,
  container,
  draft,
  onRunSurvey,
  onSaveDraft,
  onDiscardDraft,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: MockContainer | null;
  /** This container's own in-progress draft, if the admin started one and
   * left before confirming — found by the caller (`id === container.id`),
   * not looked up here. */
  draft?: { id: string; data: SurveyDraftData } | null;
  onRunSurvey: (
    containerId: string,
    result: { outcome: 'ready' | 'needs-work'; fields: MockSurveyField[]; sections: Array<{ kind: SectionKind; tasks: MockTask[] }> }
  ) => Promise<void>;
  /** Called automatically when this closes with something actually entered
   * but not confirmed — not a button the admin has to remember to press. */
  onSaveDraft: (containerId: string, data: SurveyDraftData) => Promise<void>;
  onDiscardDraft: (draftId: string) => Promise<void>;
}): React.ReactElement {
  const toast = useToast();
  const isReefer = Boolean(container?.typeCode.startsWith('Reefer'));

  const [step, setStep] = useState<'assessment' | 'result'>('assessment');
  const [submitting, setSubmitting] = useState(false);

  const [paintingRequired, setPaintingRequired] = useState(false);
  const [logoChoice, setLogoChoice] = useState<LogoChoice>('na');
  const [needsPti, setNeedsPti] = useState(false);
  const [repairRequired, setRepairRequired] = useState(false);
  const [repairFields, setRepairFields] = useState<DraftField[]>(() => blankFields(REPAIR_ITEMS, 'good'));
  const [machineIssueFound, setMachineIssueFound] = useState(false);
  const [machineRepairNote, setMachineRepairNote] = useState('');
  const [cleaningRequired, setCleaningRequired] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [sections, setSections] = useState<Record<SectionKind, boolean>>(BLANK_SECTIONS);

  // Every open resumes this container's own draft if one exists, otherwise
  // starts fresh — an abandoned assessment for one container should never
  // bleed into a different one, but shouldn't be thrown away either.
  useEffect(() => {
    if (!open) return;
    const d = draft?.data;
    setStep(d?.step ?? 'assessment');
    setSubmitting(false);
    setPaintingRequired(d?.paintingRequired ?? false);
    setLogoChoice(d?.logoChoice ?? 'na');
    setNeedsPti(d?.needsPti ?? false);
    setRepairRequired(d?.repairRequired ?? false);
    setRepairFields(d?.repairFields ?? blankFields(REPAIR_ITEMS, 'good'));
    setMachineIssueFound(d?.machineIssueFound ?? false);
    setMachineRepairNote(d?.machineRepairNote ?? '');
    setCleaningRequired(d?.cleaningRequired ?? false);
    setRemarks(d?.remarks ?? '');
    setSections(d?.sections ?? BLANK_SECTIONS);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a fresh open for a (possibly different) container, not every keystroke; draft is read once here by design, not treated as a live prop afterward.
  }, [open, container?.id]);

  // Kept current every render so the close/unmount handler below always
  // saves the latest values rather than whatever `open` happened to close
  // over -- a plain dependency array on every field would re-run this
  // effect (and its cleanup) on every keystroke, which is exactly what a
  // ref avoids.
  const latestRef = useRef<SurveyDraftData>({ step: 'assessment', paintingRequired: false, logoChoice: 'na', needsPti: false, repairRequired: false, repairFields: [], machineIssueFound: false, machineRepairNote: '', cleaningRequired: false, remarks: '', sections: BLANK_SECTIONS });
  latestRef.current = { step, paintingRequired, logoChoice, needsPti, repairRequired, repairFields, machineIssueFound, machineRepairNote, cleaningRequired, remarks, sections };
  // Set right before a successful confirm() closes the dialog, so the
  // effect below knows not to turn a just-submitted survey back into a
  // leftover draft of itself.
  const justSubmittedRef = useRef(false);

  // The actual auto-save: runs whenever this stops being open for the
  // container it was open for -- a real close (Cancel, the X, clicking
  // outside) or the container changing out from under it, not on every
  // render. Cleanup functions (not the effect body) are what React runs
  // exactly once per close, with access to everything latestRef was
  // carrying at that moment.
  useEffect(() => {
    if (!open || !container) return;
    const containerId = container.id;
    return () => {
      if (justSubmittedRef.current) {
        justSubmittedRef.current = false;
        return;
      }
      if (isDirty(latestRef.current)) void onSaveDraft(containerId, latestRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSaveDraft is a stable callback from the parent; latestRef/justSubmittedRef are refs, read at cleanup time by design, not reactive inputs.
  }, [open, container?.id]);

  const setRepairSeverity = (key: string, severity: DraftField['severity']): void => {
    setRepairFields((cur) => cur.map((f) => (f.key === key ? { ...f, severity, note: severity === 'flagged' ? f.note : '' } : f)));
  };
  const setRepairNote = (key: string, note: string): void => {
    setRepairFields((cur) => cur.map((f) => (f.key === key ? { ...f, note } : f)));
  };

  const assessment = {
    isReefer,
    typeCode: container?.typeCode ?? '',
    paintingRequired,
    logoChoice,
    needsPti,
    repairRequired,
    repairFields,
    machineIssueFound,
    machineRepairNote,
    cleaningRequired,
    remarks,
  };

  const runAssessment = (): void => {
    setSections(recommendedSurveySections(assessment));
    setStep('result');
  };

  const confirm = async (): Promise<void> => {
    if (!container) return;
    setSubmitting(true);
    try {
      const fields = buildSurveyFields(assessment);
      const required = SURVEYABLE_SECTIONS.filter((k) => sections[k]);
      const outcome: 'ready' | 'needs-work' = required.length === 0 ? 'ready' : 'needs-work';
      const payloadSections = required.map((kind) => ({ kind, tasks: surveySectionTasks(kind, assessment, fields) }));
      await onRunSurvey(container.id, { outcome, fields, sections: payloadSections });
      if (draft) await onDiscardDraft(draft.id).catch(() => {});
      toast.ok(
        'Survey recorded',
        outcome === 'ready' ? `${container.id} has no issues — still Ready to move.` : `${container.id} now has ${payloadSections.length} section(s) open.`
      );
      justSubmittedRef.current = true;
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not save this survey', err instanceof Error ? err.message : 'Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={step === 'assessment' ? 'Run survey' : 'Survey result'}
      subtitle={container ? <span className="mono">{container.id}</span> : undefined}
      size="lg"
      footer={
        step === 'assessment' ? (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon="doc" onClick={runAssessment}>
              Run survey
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setStep('assessment')} disabled={submitting}>
              Back
            </Button>
            <Button variant="primary" icon="check-circle" onClick={() => void confirm()} loading={submitting}>
              Confirm
            </Button>
          </>
        )
      }
    >
      {step === 'assessment' ? (
        <div className="stack stack-loose">
          <div className="card">
            <div className="subtle" style={{ fontSize: '11px', fontWeight: 700, marginBottom: 'var(--s-1)' }}>
              Paint
            </div>
            <div className="formgrid">
              <Field label="Painting required?" required>
                {(props) => (
                  <select {...props} value={paintingRequired ? 'Yes' : 'No'} onChange={(e) => setPaintingRequired(e.target.value === 'Yes')}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                )}
              </Field>
              <Field label="Logo">
                {(props) => (
                  <select {...props} value={logoChoice} onChange={(e) => setLogoChoice(e.target.value as LogoChoice)}>
                    {(Object.keys(LOGO_LABELS) as LogoChoice[]).map((k) => (
                      <option key={k} value={k}>
                        {LOGO_LABELS[k]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
            </div>

            <div className="subtle" style={{ fontSize: '11px', fontWeight: 700, margin: 'var(--s-3) 0 var(--s-1)' }}>
              Repairment &amp; other
            </div>
            <div className="formgrid">
              <Field label="Repair required?" required>
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
              <Field label="Cleaning required?" required>
                {(props) => (
                  <select {...props} value={cleaningRequired ? 'Yes' : 'No'} onChange={(e) => setCleaningRequired(e.target.value === 'Yes')}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                )}
              </Field>
              <Field label="Needs a yard PTI check?" hint="Lights, strip &amp; curtain">
                {(props) => (
                  <select {...props} value={needsPti ? 'Yes' : 'No'} onChange={(e) => setNeedsPti(e.target.value === 'Yes')}>
                    <option value="No">No</option>
                    <option value="Yes">Yes</option>
                  </select>
                )}
              </Field>
            </div>
          </div>

          {repairRequired && (
            <>
              <div className="divider-lbl">Container Inspection Checklist</div>
              <p className="subtle" style={{ fontSize: '12px', margin: '0 0 var(--s-2)' }}>
                Mark each part Good or Damage — Damage reveals a box for what&rsquo;s wrong.
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
              <Field label="What repairment is required?" hint="Describe the machine issue — no itemized checklist, just what needs fixing.">
                {(props) => <textarea {...props} rows={3} value={machineRepairNote} onChange={(e) => setMachineRepairNote(e.target.value)} />}
              </Field>
            </>
          )}

          <Field label="Remarks">{(props) => <textarea {...props} rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />}</Field>
        </div>
      ) : (
        <div className="stack">
          {SURVEYABLE_SECTIONS.every((k) => !sections[k]) ? (
            <div className="empty" style={{ padding: 'var(--s-3) 0' }}>
              <Button variant="ghost" style={{ pointerEvents: 'none' }} icon="check-circle" />
              <b>No issues found</b>
              <p>This container stays Ready to move — check a box below if it needs a section anyway.</p>
            </div>
          ) : (
            <p style={{ fontSize: '12.5px', color: 'var(--text-2)' }}>
              The survey flagged the sections below. Adjust before confirming — this is what gets attached to the container.
            </p>
          )}
          <div className="stack stack-tight">
            {SURVEYABLE_SECTIONS.map((kind) => (
              <CheckboxField
                key={kind}
                checked={sections[kind]}
                onCheckedChange={(v) => setSections((cur) => ({ ...cur, [kind]: v }))}
                label={SECTION_CHECKBOX_LABEL[kind]}
              />
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
