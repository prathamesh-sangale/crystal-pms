/**
 * These tests pin the behaviour that must survive the redesign. The brief was
 * explicit: how it looks changes, what it does does not. If one of these fails,
 * a visual change has leaked into the logic.
 */
import { describe, expect, it } from 'vitest';
import {
  CONTAINER_TYPES,
  STAGES,
  STAGE_IDS,
  TASK_TEMPLATES,
  checklistFor,
  extraDaysForStage,
  nextStage,
  stageBudget,
  totalPlanDays,
} from './process.js';
import {
  addDays,
  containerStatus,
  daysBetween,
  isLate,
  isReady,
  matchOrders,
  overallProgress,
  stageProgress,
  toISODate,
  tomorrowTasks,
  type Container,
  type Order,
} from './readiness.js';

const TODAY = '2026-08-11';

function makeContainer(over: Partial<Container> = {}): Container {
  const type = over.type ?? 'standard';
  return {
    id: 'RFCU 445 129-8',
    size: '40ft HC Reefer',
    type,
    anteroomVariant: type === 'anteroom' ? 'internal' : null,
    customer: 'Maersk Line',
    priority: 'Standard',
    assignee: 'R. Fernandes',
    depot: 'JNPT Depot (Home)',
    stage: 'gatein',
    received: '2026-08-01',
    stageEntered: TODAY,
    notes: '',
    checklist: checklistFor(type).map((t) => ({
      key: t.key,
      stage: t.stage,
      label: t.label,
      hrs: t.hrs,
      onlyFor: t.onlyFor ? [...t.onlyFor] : null,
      done: false,
      doneAt: null,
      doneBy: null,
    })),
    ...over,
  };
}

describe('process definition', () => {
  it('has ten stages in a fixed order', () => {
    expect(STAGES).toHaveLength(10);
    expect(STAGE_IDS[0]).toBe('gatein');
    expect(STAGE_IDS.at(-1)).toBe('qc');
  });

  it('gives every task a unique stable key', () => {
    const keys = TASK_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('adds variant work only to the stage that carries it', () => {
    expect(extraDaysForStage('double', 'mechanical')).toBe(1);
    expect(extraDaysForStage('double', 'electrical')).toBe(0);
    expect(extraDaysForStage('anteroom', 'electrical')).toBe(1);
    expect(extraDaysForStage('anteroom', 'mechanical')).toBe(0);
    expect(extraDaysForStage('standard', 'mechanical')).toBe(0);
  });

  it('plans 16 days standard, 17 for each variant', () => {
    expect(totalPlanDays('standard')).toBe(16);
    expect(totalPlanDays('double')).toBe(17);
    expect(totalPlanDays('anteroom')).toBe(17);
  });

  it('gives a double compressor three extra mechanical tasks', () => {
    const std = checklistFor('standard').filter((t) => t.stage === 'mechanical');
    const dbl = checklistFor('double').filter((t) => t.stage === 'mechanical');
    expect(dbl.length - std.length).toBe(3);
  });

  it('gives an anteroom three extra electrical tasks', () => {
    const std = checklistFor('standard').filter((t) => t.stage === 'electrical');
    const ante = checklistFor('anteroom').filter((t) => t.stage === 'electrical');
    expect(ante.length - std.length).toBe(3);
  });

  it('never gives one variant the other variant tasks', () => {
    for (const type of CONTAINER_TYPES) {
      for (const task of checklistFor(type)) {
        if (task.onlyFor) expect(task.onlyFor).toContain(type);
      }
    }
  });

  it('runs out of stages after final QC', () => {
    expect(nextStage('pti')).toBe('qc');
    expect(nextStage('qc')).toBeNull();
  });
});

describe('dates', () => {
  it('formats local dates without a UTC shift', () => {
    // 00:30 local on the 11th must not report the 10th.
    expect(toISODate(new Date(2026, 7, 11, 0, 30))).toBe('2026-08-11');
    expect(toISODate(new Date(2026, 7, 11, 23, 30))).toBe('2026-08-11');
  });

  it('counts days across a month boundary', () => {
    expect(daysBetween('2026-07-30', '2026-08-02')).toBe(3);
    expect(addDays('2026-08-30', 3)).toBe('2026-09-02');
  });
});

describe('progress', () => {
  it('reports 0% with nothing done and 100% with everything done', () => {
    const c = makeContainer();
    expect(overallProgress(c)).toBe(0);
    c.checklist.forEach((t) => (t.done = true));
    expect(overallProgress(c)).toBe(100);
  });

  it('scopes stage progress to the current stage only', () => {
    const c = makeContainer({ stage: 'gatein' });
    c.checklist.filter((t) => t.stage === 'gatein').forEach((t) => (t.done = true));
    expect(stageProgress(c)).toBe(100);
    expect(overallProgress(c)).toBeLessThan(100);
  });
});

describe('lateness', () => {
  it('is late once past the stage budget', () => {
    const budget = stageBudget('standard', 'structural'); // 3
    const onTime = makeContainer({ stage: 'structural', stageEntered: addDays(TODAY, -budget) });
    const late = makeContainer({ stage: 'structural', stageEntered: addDays(TODAY, -(budget + 1)) });
    expect(isLate(onTime, TODAY)).toBe(false);
    expect(isLate(late, TODAY)).toBe(true);
  });

  it('gives a double compressor the extra mechanical day before calling it late', () => {
    const entered = addDays(TODAY, -3); // 3 days in; standard budget is 2, double is 3
    expect(isLate(makeContainer({ type: 'standard', stage: 'mechanical', stageEntered: entered }), TODAY)).toBe(true);
    expect(isLate(makeContainer({ type: 'double', stage: 'mechanical', stageEntered: entered }), TODAY)).toBe(false);
  });

  it('never calls a container in final QC delayed', () => {
    const c = makeContainer({ stage: 'qc', stageEntered: addDays(TODAY, -30) });
    expect(isLate(c, TODAY)).toBe(false);
  });

  it('is only ready at 100% in final QC', () => {
    const c = makeContainer({ stage: 'qc' });
    expect(isReady(c)).toBe(false);
    c.checklist.forEach((t) => (t.done = true));
    expect(isReady(c)).toBe(true);
  });
});

describe('status never travels as colour alone (design system rule 12)', () => {
  it('always returns a tone, an icon and a word together', () => {
    const cases: Container[] = [
      makeContainer(),
      makeContainer({ stage: 'structural', stageEntered: addDays(TODAY, -9) }),
      makeContainer({ stage: 'gatein', stageEntered: addDays(TODAY, -1) }),
    ];
    for (const c of cases) {
      const s = containerStatus(c, TODAY);
      expect(s.tone).toBeTruthy();
      expect(s.icon).toBeTruthy();
      expect(s.label.trim().length).toBeGreaterThan(0);
      expect(s.detail.trim().length).toBeGreaterThan(0);
    }
  });

  it('flags the last day of the budget before it becomes a delay', () => {
    const c = makeContainer({ stage: 'structural', stageEntered: addDays(TODAY, -3) });
    expect(containerStatus(c, TODAY).label).toBe('Due today');
  });
});

describe("tomorrow's work", () => {
  it('lists only open tasks in the current stage', () => {
    const c = makeContainer({ stage: 'tfloor' });
    const queued = tomorrowTasks([c], TODAY);
    expect(queued.every((q) => q.task.stage === 'tfloor')).toBe(true);
    expect(queued.every((q) => !q.task.done)).toBe(true);
  });

  it('skips containers that are already ready', () => {
    const ready = makeContainer({ id: 'DONE', stage: 'qc' });
    ready.checklist.forEach((t) => (t.done = true));
    expect(tomorrowTasks([ready], TODAY)).toHaveLength(0);
  });

  it('puts delayed containers ahead of urgent ones that are on time', () => {
    const urgentOnTime = makeContainer({ id: 'ON-TIME', priority: 'Urgent', stage: 'gatein' });
    const lateStandard = makeContainer({
      id: 'LATE',
      priority: 'Standard',
      stage: 'structural',
      stageEntered: addDays(TODAY, -9),
    });
    const queue = tomorrowTasks([urgentOnTime, lateStandard], TODAY);
    expect(queue[0]?.container.id).toBe('LATE');
  });
});

describe('order matching', () => {
  const HOME = 'JNPT Depot (Home)';
  const order: Order = {
    id: 'ORD-501',
    customer: 'Hapag-Lloyd',
    size: '40ft HC Reefer',
    type: 'standard',
    qty: 1,
    needBy: addDays(TODAY, 5),
    requirement: 'Full PTI pass and clean interior.',
  };

  it('prefers the home-depot container that is furthest along', () => {
    const behind = makeContainer({ id: 'BEHIND', depot: HOME });
    const ahead = makeContainer({ id: 'AHEAD', depot: HOME });
    ahead.checklist.forEach((t, i) => (t.done = i < 20));
    const [match] = matchOrders([order], [behind, ahead], HOME);
    expect(match?.container?.id).toBe('AHEAD');
    expect(match?.status.tone).toBe('brand');
  });

  it('never matches the same container to two orders', () => {
    const only = makeContainer({ id: 'ONLY', depot: HOME });
    const matches = matchOrders([order, { ...order, id: 'ORD-502' }], [only], HOME);
    expect(matches[0]?.container?.id).toBe('ONLY');
    expect(matches[1]?.container).toBeNull();
  });

  it('counts transfer candidates when nothing is at home', () => {
    const away = makeContainer({ id: 'AWAY', depot: 'Mundra Depot' });
    const [match] = matchOrders([order], [away], HOME);
    expect(match?.container).toBeNull();
    expect(match?.elsewhereCount).toBe(1);
    expect(match?.status.label).toBe('Unmatched');
    expect(match?.status.detail).toContain('transfer');
  });

  it('will not match a container of the wrong type or size', () => {
    const wrongType = makeContainer({ id: 'WRONG-TYPE', depot: HOME, type: 'double' });
    const wrongSize = makeContainer({ id: 'WRONG-SIZE', depot: HOME, size: '20ft Reefer' });
    const [match] = matchOrders([order], [wrongType, wrongSize], HOME);
    expect(match?.container).toBeNull();
    expect(match?.elsewhereCount).toBe(0);
  });
});
