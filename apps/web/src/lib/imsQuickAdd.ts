import type { ImsMatch } from './api';
import { GATE_PHOTO_SLOTS, STANDARD_COLORS, surveyFields, type GateLogEntry, type GatePhotoKey, type MockContainer } from './mockV2';

/** The container a one-click "Add to yard" registers — shared by
 * `ImsStock.tsx` and `ImsQuickAddDialog.tsx` so both build exactly the same
 * shape (a clean, nothing-flagged Gate-In, no transport/vehicle details, by
 * direct request). Returns null when IMS's own data doesn't map to a real
 * type/size this app recognizes ("Machine"/"NA"-style raw IMS entries) —
 * there's nothing valid to register it as; the caller is expected to
 * disable its one-click button in that case rather than call this at all. */
export function buildQuickAddContainer(item: ImsMatch, loggedBy: string): MockContainer | null {
  if (!item.suggestedTypeCode || !item.suggestedSize) return null;
  const isReefer = item.suggestedTypeCode.startsWith('Reefer');
  const now = new Date();
  const emptyPhotos = Object.fromEntries(GATE_PHOTO_SLOTS.map((s) => [s.key, ''])) as Record<GatePhotoKey, string>;
  const entry: GateLogEntry = {
    kind: 'in',
    loggedAt: now.toISOString(),
    loggedBy,
    movementDate: now.toISOString().slice(0, 10),
    indentRef: '',
    customerName: '',
    location: '',
    transporterName: '',
    transporterNumber: '',
    vehicleNumber: '',
    lrCopyName: null,
    ptiCheck: 'No',
    ptiVideoName: null,
    ptiVideoUrl: null,
    photos: { ...emptyPhotos, additional: [] },
    paintingRequired: false,
    repairRequired: false,
    repairFields: [],
    machineIssueFound: false,
    machineRepairNote: '',
    cleaningRequired: false,
    estBudget: '',
    remarks: 'Added directly from IMS — no inspection run, nothing flagged.',
  };
  return {
    id: item.containerId,
    typeCode: item.suggestedTypeCode,
    size: item.suggestedSize,
    color: isReefer ? 'White' : STANDARD_COLORS[0]!,
    survey: { performedAt: now.toISOString(), fields: surveyFields(), outcome: 'ready' },
    priority: false,
    registeredAt: now.toISOString(),
    sections: [],
    readyAt: null,
    readyPhotoUrls: [],
    currentSite: null,
    gateIn: entry,
    gateOut: null,
    departedAt: null,
  };
}
