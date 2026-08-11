/**
 * seed.ts — a deliberately shaped depot, not random data.
 *
 * The concept seeded itself with Math.random(), so no two people ever saw the
 * same board and no screenshot could be compared to the last one. Everything
 * here is fixed: the same three delayed containers, the same two unmatched
 * orders, the same one unit ready for release, every single time.
 *
 * That matters because the visual regression tests and the before/after
 * screenshots both depend on the board being identical between runs.
 */
import { PrismaClient } from '@prisma/client';
import { addDays, checklistFor, toISODate, type ContainerType, type Grade } from '@pms/shared';
import { hashPassword } from '../src/auth.js';

const prisma = new PrismaClient();
const TODAY = toISODate(new Date());
const at = (isoDate: string): Date => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
};

/** Dev credentials. Printed at the end of the seed; change before any deployment. */
const DEV_PASSWORD = 'readiness';

const DEPOTS = [
  { name: 'JNPT Depot (Home)', location: 'Nhava Sheva, Maharashtra', isHome: true },
  { name: 'Mundra Depot', location: 'Mundra, Gujarat', isHome: false },
  { name: 'Nhava Sheva Depot', location: 'Uran, Maharashtra', isHome: false },
  { name: 'Chennai Depot', location: 'Ennore, Tamil Nadu', isHome: false },
];

/** Buddy pairs, so every technician has a named person who covers for them. */
const TECHNICIANS = [
  { name: 'R. Fernandes', trade: 'Refrigeration', backup: 'A. Costa' },
  { name: 'A. Costa', trade: 'Refrigeration', backup: 'R. Fernandes' },
  { name: 'S. Menon', trade: 'Structural / IICL', backup: 'J. Alvares' },
  { name: 'J. Alvares', trade: 'Structural / IICL', backup: 'S. Menon' },
  { name: 'P. Dias', trade: 'Electrical & alarms', backup: 'K. Rao' },
  { name: 'K. Rao', trade: 'Electrical & alarms', backup: 'P. Dias' },
  { name: 'T. Silva', trade: 'Paint & finishing', backup: 'M. Pinto' },
  { name: 'M. Pinto', trade: 'Paint & finishing', backup: 'T. Silva' },
];

interface Scenario {
  id: string;
  size: '20ft Reefer' | '40ft HC Reefer';
  type: ContainerType;
  anteroomVariant: 'internal' | 'external' | null;
  customer: string;
  priority: 'Standard' | 'High' | 'Urgent';
  assignee: string;
  depot: string;
  stage: string;
  /** How far through the current stage's checklist, 0–1. */
  progress: number;
  /** Days already spent in the current stage — this is what makes one late. */
  daysInStage: number;
  receivedDaysAgo: number;
}

/**
 * Ten containers covering every state a screen has to render: on track, due
 * today, delayed, and ready for release; all three container types; the home
 * depot and all three others.
 */
const SCENARIOS: Scenario[] = [
  // Delayed — 2 days in a 1 day stage.
  { id: 'RFCU 445 129-8', size: '40ft HC Reefer', type: 'standard', anteroomVariant: null, customer: 'Maersk Line', priority: 'High', assignee: 'R. Fernandes', depot: 'JNPT Depot (Home)', stage: 'logo', progress: 0.75, daysInStage: 2, receivedDaysAgo: 14 },
  // Due today — 3 days in a 2+1 day stage (anteroom adds a day of electrical).
  { id: 'MSCU 771 004-2', size: '40ft HC Reefer', type: 'anteroom', anteroomVariant: 'internal', customer: 'MSC', priority: 'Urgent', assignee: 'A. Costa', depot: 'JNPT Depot (Home)', stage: 'electrical', progress: 0.5, daysInStage: 3, receivedDaysAgo: 11 },
  { id: 'CMAU 228 815-6', size: '20ft Reefer', type: 'standard', anteroomVariant: null, customer: 'CMA CGM', priority: 'Standard', assignee: 'S. Menon', depot: 'Mundra Depot', stage: 'pti', progress: 1, daysInStage: 1, receivedDaysAgo: 15 },
  { id: 'HLXU 903 442-1', size: '40ft HC Reefer', type: 'double', anteroomVariant: null, customer: 'Hapag-Lloyd', priority: 'Standard', assignee: 'J. Alvares', depot: 'JNPT Depot (Home)', stage: 'structural', progress: 0, daysInStage: 0, receivedDaysAgo: 2 },
  // Ready for release.
  { id: 'ONEU 556 271-9', size: '40ft HC Reefer', type: 'anteroom', anteroomVariant: 'external', customer: 'ONE', priority: 'High', assignee: 'P. Dias', depot: 'Nhava Sheva Depot', stage: 'qc', progress: 1, daysInStage: 1, receivedDaysAgo: 18 },
  { id: 'EGHU 118 903-4', size: '20ft Reefer', type: 'standard', anteroomVariant: null, customer: 'Evergreen Marine', priority: 'Standard', assignee: 'K. Rao', depot: 'Chennai Depot', stage: 'tfloor', progress: 0.3, daysInStage: 1, receivedDaysAgo: 5 },
  // Delayed — 5 days in a 2+1 day stage.
  { id: 'CCLU 340 672-3', size: '40ft HC Reefer', type: 'double', anteroomVariant: null, customer: 'Cool Carriers Ltd', priority: 'Urgent', assignee: 'T. Silva', depot: 'Mundra Depot', stage: 'mechanical', progress: 0.9, daysInStage: 5, receivedDaysAgo: 12 },
  { id: 'SEBU 662 210-7', size: '40ft HC Reefer', type: 'anteroom', anteroomVariant: 'internal', customer: 'Seaboard Marine', priority: 'Standard', assignee: 'M. Pinto', depot: 'JNPT Depot (Home)', stage: 'gatein', progress: 0, daysInStage: 0, receivedDaysAgo: 0 },
  // Delayed — 4 days in a 2 day stage.
  { id: 'MSCU 884 330-5', size: '20ft Reefer', type: 'standard', anteroomVariant: null, customer: 'MSC', priority: 'Standard', assignee: 'R. Fernandes', depot: 'Nhava Sheva Depot', stage: 'paint', progress: 0.4, daysInStage: 4, receivedDaysAgo: 13 },
  { id: 'CMAU 771 552-0', size: '40ft HC Reefer', type: 'double', anteroomVariant: null, customer: 'CMA CGM', priority: 'High', assignee: 'A. Costa', depot: 'Chennai Depot', stage: 'clean', progress: 0.85, daysInStage: 1, receivedDaysAgo: 16 },
];

const STAGE_ORDER = [
  'gatein', 'structural', 'tfloor', 'mechanical', 'electrical',
  'paint', 'logo', 'clean', 'pti', 'qc',
];

/** Redelivered by customers, not yet gated in. */
const OFF_LEASE: Array<{ id: string; customer: string; size: '20ft Reefer' | '40ft HC Reefer'; type: ContainerType; inDays: number; depot: string; grade: Grade; notes: string }> = [
  { id: 'OL-1042', customer: 'Maersk Line', size: '40ft HC Reefer', type: 'standard', inDays: 3, depot: 'JNPT Depot (Home)', grade: 'B', notes: 'Minor door seal wear, exterior paint fade — redelivery survey attached.' },
  { id: 'OL-1043', customer: 'MSC', size: '40ft HC Reefer', type: 'anteroom', inDays: 5, depot: 'JNPT Depot (Home)', grade: 'C', notes: 'Anteroom door dented, mantrap wiring flagged at redelivery inspection.' },
  { id: 'OL-1044', customer: 'CMA CGM', size: '20ft Reefer', type: 'standard', inDays: 2, depot: 'Mundra Depot', grade: 'A', notes: 'Like-new, PTI already current from redelivery port.' },
  { id: 'OL-1045', customer: 'Cool Carriers Ltd', size: '40ft HC Reefer', type: 'double', inDays: 7, depot: 'JNPT Depot (Home)', grade: 'D', notes: 'Compressor #2 reported faulty at redelivery, roof corrosion noted.' },
  { id: 'OL-1046', customer: 'Evergreen Marine', size: '20ft Reefer', type: 'standard', inDays: 4, depot: 'Chennai Depot', grade: 'B', notes: 'T-floor slats worn, cosmetic scratches only.' },
];

/**
 * Five orders shaped so Depot Command shows every matching outcome:
 * two matched in progress, one matched, one unmatched with transfer
 * candidates, one unmatched with nothing in the network.
 */
const ORDERS: Array<{ id: string; customer: string; size: '20ft Reefer' | '40ft HC Reefer'; type: ContainerType; qty: number; inDays: number; requirement: string }> = [
  { id: 'ORD-501', customer: 'Hapag-Lloyd', size: '40ft HC Reefer', type: 'standard', qty: 2, inDays: 5, requirement: 'Full PTI pass and clean interior — cosmetic condition not critical.' },
  { id: 'ORD-502', customer: 'ONE', size: '40ft HC Reefer', type: 'anteroom', qty: 1, inDays: 3, requirement: 'Mantrap alarm certified, anteroom seal tested, logo re-stencilled to ONE livery.' },
  { id: 'ORD-503', customer: 'MSC', size: '20ft Reefer', type: 'standard', qty: 3, inDays: 10, requirement: 'Standard PTI only — cosmetic condition not critical.' },
  { id: 'ORD-504', customer: 'Seaboard Marine', size: '40ft HC Reefer', type: 'double', qty: 1, inDays: 2, requirement: 'Both compressors load-tested and failover verified before release.' },
  { id: 'ORD-505', customer: 'CMA CGM', size: '40ft HC Reefer', type: 'standard', qty: 1, inDays: 1, requirement: 'Urgent — full exterior paint and logo, PTI complete.' },
];

const USERS = [
  { email: 'sitaram@reeferready.example', name: 'Sitaram Bhat', role: 'manager', depot: 'JNPT Depot (Home)' },
  { email: 'supervisor@reeferready.example', name: 'Priya Nair', role: 'supervisor', depot: 'JNPT Depot (Home)' },
  { email: 'tech@reeferready.example', name: 'R. Fernandes', role: 'technician', depot: 'JNPT Depot (Home)' },
  { email: 'viewer@reeferready.example', name: 'Audit Read-only', role: 'viewer', depot: null },
];

async function main(): Promise<void> {
  // Order matters: children before parents.
  await prisma.containerEvent.deleteMany();
  await prisma.containerTask.deleteMany();
  await prisma.container.deleteMany();
  await prisma.customerOrder.deleteMany();
  await prisma.offLeaseUnit.deleteMany();
  await prisma.user.deleteMany();
  await prisma.technician.updateMany({ data: { backupId: null } });
  await prisma.technician.deleteMany();
  await prisma.depot.deleteMany();

  const depots = new Map<string, string>();
  for (const d of DEPOTS) {
    const row = await prisma.depot.create({ data: d });
    depots.set(row.name, row.id);
  }

  const techs = new Map<string, string>();
  for (const t of TECHNICIANS) {
    const row = await prisma.technician.create({ data: { name: t.name, trade: t.trade } });
    techs.set(row.name, row.id);
  }
  for (const t of TECHNICIANS) {
    await prisma.technician.update({
      where: { id: techs.get(t.name)! },
      data: { backupId: techs.get(t.backup)! },
    });
  }

  const passwordHash = hashPassword(DEV_PASSWORD);
  for (const u of USERS) {
    await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        role: u.role,
        passwordHash,
        depotId: u.depot ? depots.get(u.depot)! : null,
      },
    });
  }

  for (const s of SCENARIOS) {
    const stageIdx = STAGE_ORDER.indexOf(s.stage);
    const template = checklistFor(s.type);
    const inStage = template.filter((t) => t.stage === s.stage);
    // Deterministic: the first N of the current stage's tasks are done.
    const doneInStage = Math.round(s.progress * inStage.length);
    const doneKeys = new Set(inStage.slice(0, doneInStage).map((t) => t.key));

    await prisma.container.create({
      data: {
        id: s.id,
        size: s.size,
        type: s.type,
        anteroomVariant: s.anteroomVariant,
        customer: s.customer,
        priority: s.priority,
        notes: '',
        depotId: depots.get(s.depot)!,
        technicianId: techs.get(s.assignee)!,
        stage: s.stage,
        received: at(addDays(TODAY, -s.receivedDaysAgo)),
        stageEntered: at(addDays(TODAY, -s.daysInStage)),
        tasks: {
          create: template.map((t) => {
            const done = STAGE_ORDER.indexOf(t.stage) < stageIdx || doneKeys.has(t.key);
            return {
              key: t.key,
              stage: t.stage,
              label: t.label,
              hrs: t.hrs,
              onlyFor: t.onlyFor ? JSON.stringify(t.onlyFor) : null,
              done,
              doneAt: done ? at(addDays(TODAY, -s.daysInStage)) : null,
              doneBy: done ? s.assignee : null,
            };
          }),
        },
        events: {
          create: [
            {
              kind: 'registered',
              actor: 'seed',
              at: at(addDays(TODAY, -s.receivedDaysAgo)),
              summary: `Gated in at ${s.depot}, assigned to ${s.assignee}.`,
            },
            ...(stageIdx > 0
              ? [
                  {
                    kind: 'stage-advanced',
                    actor: s.assignee,
                    at: at(addDays(TODAY, -s.daysInStage)),
                    summary: `Advanced into ${s.stage}.`,
                  },
                ]
              : []),
          ],
        },
      },
    });
  }

  for (const o of OFF_LEASE) {
    await prisma.offLeaseUnit.create({
      data: {
        id: o.id,
        customer: o.customer,
        size: o.size,
        type: o.type,
        expected: at(addDays(TODAY, o.inDays)),
        depotId: depots.get(o.depot)!,
        grade: o.grade,
        notes: o.notes,
      },
    });
  }

  for (const o of ORDERS) {
    await prisma.customerOrder.create({
      data: {
        id: o.id,
        customer: o.customer,
        size: o.size,
        type: o.type,
        qty: o.qty,
        needBy: at(addDays(TODAY, o.inDays)),
        requirement: o.requirement,
      },
    });
  }

  console.log(`Seeded ${DEPOTS.length} depots, ${TECHNICIANS.length} technicians, ${SCENARIOS.length} containers, ${OFF_LEASE.length} off-lease units, ${ORDERS.length} orders.`);
  console.log('');
  console.log('Sign in with any of these — password is the same for all:');
  for (const u of USERS) console.log(`  ${u.email.padEnd(34)} ${u.role.padEnd(11)} ${DEV_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
