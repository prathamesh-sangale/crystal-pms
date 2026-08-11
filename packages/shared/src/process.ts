/**
 * process.ts — the readiness process itself.
 *
 * Ten stages, a day budget per stage, and a task template per stage. Two
 * container variants add work: a double-compressor unit adds a day of
 * mechanical, a unit with an anteroom adds a day of electrical.
 *
 * These definitions are the product, not styling. They are carried over from
 * the concept unchanged — same stages, same day budgets, same task lists,
 * same hour estimates, same `onlyFor` restrictions.
 */

export const CONTAINER_TYPES = ['standard', 'double', 'anteroom'] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const ANTEROOM_VARIANTS = ['internal', 'external'] as const;
export type AnteroomVariant = (typeof ANTEROOM_VARIANTS)[number];

export const PRIORITIES = ['Standard', 'High', 'Urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CONTAINER_SIZES = ['20ft Reefer', '40ft HC Reefer'] as const;
export type ContainerSize = (typeof CONTAINER_SIZES)[number];

/** IICL-style A–D condition grading for off-lease units returning to the depot. */
export const GRADES = ['A', 'B', 'C', 'D'] as const;
export type Grade = (typeof GRADES)[number];

export const TYPE_LABELS: Record<ContainerType, string> = {
  standard: 'Standard Reefer',
  double: 'Double Compressor',
  anteroom: 'Reefer + Anteroom',
};

export const GRADE_LABELS: Record<Grade, string> = {
  A: 'A — Like new',
  B: 'B — Minor cosmetic',
  C: 'C — Repairable damage',
  D: 'D — Major / structural',
};

export const TYPE_HINTS: Record<ContainerType, string> = {
  standard:
    'Full base checklist: lights, casing paint, alarm, light switch, T-floor, strip curtains, ISO plugs, logo, painting, PTI.',
  double:
    'Everything in the standard checklist, plus a second compressor: function test, refrigerant/leak test and dual-compressor failover test.',
  anteroom:
    'Everything in the standard checklist, plus anteroom access/seal check, mantrap alarm test and mantrap interlock test.',
};

export interface Stage {
  readonly id: StageId;
  readonly name: string;
  /** Planned working days in this stage for a standard unit. */
  readonly days: number;
  readonly desc: string;
}

export const STAGE_IDS = [
  'gatein',
  'structural',
  'tfloor',
  'mechanical',
  'electrical',
  'paint',
  'logo',
  'clean',
  'pti',
  'qc',
] as const;
export type StageId = (typeof STAGE_IDS)[number];

export const STAGES: readonly Stage[] = [
  {
    id: 'gatein',
    name: 'Gate-In & Intake',
    days: 1,
    desc: 'Off-hire survey, damage report, CSC plate check, job card issued.',
  },
  {
    id: 'structural',
    name: 'Structural & IICL Repair',
    days: 3,
    desc: 'Corner post, panel, roof, frame repair and strip curtain fitting.',
  },
  {
    id: 'tfloor',
    name: 'T-Floor Repair',
    days: 2,
    desc: 'T-bar aluminum flooring inspection, slat replacement, drain clearing.',
  },
  {
    id: 'mechanical',
    name: 'Refrigeration & Mechanical',
    days: 2,
    desc: 'Compressor(s), coil, fan, genset and light fixture testing.',
  },
  {
    id: 'electrical',
    name: 'Electrical, Alarm & CA Systems',
    days: 2,
    desc: 'Alarm, light switch, ISO plugs, door switch, mantrap/anteroom systems.',
  },
  {
    id: 'paint',
    name: 'Sandblast & Painting',
    days: 2,
    desc: 'Surface prep, anti-corrosion primer, casing paint, exterior topcoat.',
  },
  {
    id: 'logo',
    name: 'Logo, Stencil & Decals',
    days: 1,
    desc: 'CSC plate re-stencil, owner livery, unit ID and weight markings.',
  },
  {
    id: 'clean',
    name: 'Cleaning & Sanitization',
    days: 1,
    desc: 'Interior wash, machinery chamber clean, odor removal, fumigation.',
  },
  {
    id: 'pti',
    name: 'PTI — Pre-Trip Inspection',
    days: 1,
    desc: 'Pull-down test, door seal test, recorder verification, PTI decal.',
  },
  {
    id: 'qc',
    name: 'Final QC & Release',
    days: 1,
    desc: 'Final visual/operational QC, sign-off, gate pass issued.',
  },
] as const;

export const STAGE_BY_ID: Record<StageId, Stage> = Object.fromEntries(
  STAGES.map((s) => [s.id, s])
) as Record<StageId, Stage>;

export interface TaskTemplate {
  /** Stable identifier, e.g. `mechanical.07`. Survives label edits. */
  readonly key: string;
  readonly stage: StageId;
  readonly label: string;
  /** Average hours this task takes. */
  readonly hrs: number;
  /** When present, the task only applies to these container types. */
  readonly onlyFor: readonly ContainerType[] | null;
}

type RawTask = readonly [label: string, hrs: number, onlyFor?: readonly ContainerType[]];

const RAW_TASKS: Record<StageId, readonly RawTask[]> = {
  gatein: [
    ['Off-hire / gate-in survey photos', 0.5],
    ['CSC safety approval plate verified', 0.5],
    ['Unit ID & size/type confirmed', 0.3],
    ['Job card / work order opened', 0.3],
  ],
  structural: [
    ['Corner post & casting repair (IICL-5)', 6],
    ['Corrugated side panel dent repair', 5],
    ['Roof panel repair', 4],
    ['Door frame & hinge repair', 3],
    ['Underfloor cross-member repair', 4],
    ['Door strip curtains fitted & inspected', 1],
  ],
  tfloor: [
    ['T-bar flooring inspection', 1],
    ['Damaged T-floor slat replacement', 6],
    ['Floor drain channel clearing', 1.5],
    ['Anti-slip floor coating touch-up', 2],
  ],
  mechanical: [
    ['Compressor function test', 2],
    ['Condenser & evaporator coil cleaning', 1.5],
    ['Refrigerant charge & leak test', 2],
    ['Condenser/evaporator fan motor test', 1.5],
    ['Genset fuel level & function test', 2],
    ['Insulation & wall panel integrity check', 1.5],
    ['Interior & exterior light fixture check', 1],
    ['Compressor #2 function test', 2, ['double']],
    ['Compressor #2 refrigerant charge & leak test', 2, ['double']],
    ['Dual compressor synchronization / failover test', 1.5, ['double']],
  ],
  electrical: [
    ['Door micro-switch / reefer plug alarm test', 1],
    ['High/low temperature alarm system test', 1.5],
    ['Interior light switch function test', 0.5],
    ['ISO standard power plug & socket test', 1],
    ['Data logger / temp recorder calibration', 1],
    ['Wiring harness & plug inspection', 1],
    ['Anteroom access door & seal check', 1.5, ['anteroom']],
    ['Mantrap alarm system test', 1.5, ['anteroom']],
    ['Mantrap interlock function test', 1, ['anteroom']],
  ],
  paint: [
    ['Surface prep & sandblasting', 4],
    ['Anti-corrosion primer coat', 3],
    ['Exterior container body painting', 4],
    ['Machinery casing paint touch-up', 1],
    ['Touch-up & finish inspection', 1],
  ],
  logo: [
    ['CSC / safety plate re-stencil', 1],
    ['Owner logo & livery decal application', 2],
    ['Door numbering & unit ID stencil', 1],
    ['Max gross / tare weight markings', 0.5],
  ],
  clean: [
    ['Interior box wash & sanitization', 1.5],
    ['Machinery chamber cleaning', 1],
    ['Odor / residue removal', 1],
    ['Fumigation certificate (if required)', 1],
  ],
  pti: [
    ['Pull-down temperature test', 3],
    ['Door seal air-tightness test', 1],
    ['Recorder & sensor verification', 1],
    ['PTI decal issued (30-180 day validity)', 0.3],
  ],
  qc: [
    ['Final visual & operational QC', 1],
    ['Release photos captured', 0.3],
    ['Job card sign-off', 0.3],
    ['Ready-for-release gate pass issued', 0.3],
  ],
};

/** Every task in the library, flattened, with a stable key. */
export const TASK_TEMPLATES: readonly TaskTemplate[] = STAGE_IDS.flatMap((stage) =>
  RAW_TASKS[stage].map((task, i) => ({
    key: `${stage}.${String(i).padStart(2, '0')}`,
    stage,
    label: task[0],
    hrs: task[1],
    onlyFor: task[2] ?? null,
  }))
);

export const TASKS_BY_STAGE: Record<StageId, readonly TaskTemplate[]> = Object.fromEntries(
  STAGE_IDS.map((s) => [s, TASK_TEMPLATES.filter((t) => t.stage === s)])
) as Record<StageId, readonly TaskTemplate[]>;

/** The task list a container of this type actually carries. */
export function checklistFor(type: ContainerType): readonly TaskTemplate[] {
  return TASK_TEMPLATES.filter((t) => !t.onlyFor || t.onlyFor.includes(type));
}

/**
 * Variant work that lands on a specific stage.
 * A second compressor adds a day of mechanical; an anteroom adds a day of
 * electrical for the mantrap and interlock systems.
 */
export function extraDaysForStage(type: ContainerType, stage: StageId): number {
  if (type === 'double' && stage === 'mechanical') return 1;
  if (type === 'anteroom' && stage === 'electrical') return 1;
  return 0;
}

/** Days allowed in a stage before the container counts as delayed. */
export function stageBudget(type: ContainerType, stage: StageId): number {
  return STAGE_BY_ID[stage].days + extraDaysForStage(type, stage);
}

/** Planned gate-in to gate-out days for this container type. */
export function totalPlanDays(type: ContainerType): number {
  return STAGES.reduce((total, s) => total + s.days + extraDaysForStage(type, s.id), 0);
}

export const stageIndex = (stage: StageId): number => STAGE_IDS.indexOf(stage);

export function nextStage(stage: StageId): StageId | null {
  const i = stageIndex(stage);
  return i >= 0 && i < STAGE_IDS.length - 1 ? (STAGE_IDS[i + 1] as StageId) : null;
}

export const FINAL_STAGE: StageId = 'qc';
