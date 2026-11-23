import type { ImsMatch } from './api';
import { istDay } from './istDate';
import { GATE_PHOTO_SLOTS, STANDARD_COLORS, surveyFields, type GateLogEntry, type GatePhotoKey, type MockContainer } from './mockV2';

/** The Type/Size this app actually registers an IMS item under — its mapped
 * suggestion when IMS's raw spelling confidently maps onto this depot's own
 * vocabulary, IMS's own raw text otherwise. "Add to yard" must work for
 * every item IMS shows in stock at our own yard, not just the ones whose
 * raw spelling happens to match a known pattern (e.g. ISO Tank sizes like
 * "T11" aren't in `mapSize`'s list at all, and "Machine" has no
 * `suggestedTypeCode` — both are still real units sitting at the yard).
 * Yard Board's own grouping already falls back to a container's raw
 * typeCode the same way (`productOf(c.typeCode) ?? c.typeCode`), so a
 * container registered under IMS's raw text is never orphaned from the UI. */
export function resolvedTypeCode(item: ImsMatch): string | null {
  return item.suggestedTypeCode ?? (item.imsType.trim() || null);
}
export function resolvedSize(item: ImsMatch): string | null {
  return item.suggestedSize ?? (item.imsSize.trim() || null);
}

/** The container a one-click "Add to yard" registers — shared by
 * `ImsStock.tsx` and `ImsQuickAddDialog.tsx` so both build exactly the same
 * shape (a clean, nothing-flagged Gate-In, no transport/vehicle details, by
 * direct request). Returns null only when IMS's own sheet has no Type/Size
 * text at all for this row — the caller is expected to disable its
 * one-click button in that case rather than call this at all. */
export function buildQuickAddContainer(item: ImsMatch, loggedBy: string): MockContainer | null {
  const typeCode = resolvedTypeCode(item);
  const size = resolvedSize(item);
  if (!typeCode || !size) return null;
  const isReefer = typeCode.startsWith('Reefer');
  const now = new Date();
  const emptyPhotos = Object.fromEntries(GATE_PHOTO_SLOTS.map((s) => [s.key, ''])) as Record<GatePhotoKey, string>;
  const entry: GateLogEntry = {
    kind: 'in',
    loggedAt: now.toISOString(),
    loggedBy,
    movementDate: istDay(now),
    indentRef: '',
    orderNumber: '',
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
    typeCode,
    size,
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
