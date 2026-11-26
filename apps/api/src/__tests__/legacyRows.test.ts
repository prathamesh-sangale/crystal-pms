/** Pure-function tests for the legacy-sheet formats and safeguards. No network, no database. */
import { describe, expect, it } from 'vitest';
import {
  buildLedgerRow,
  chooseRepoRow,
  decideAutoClose,
  decideImsStockWrite,
  dmyTextToMs,
  istDateTime,
  istDmy,
  parseLedgerRow,
  planImport,
  safeCell,
  serialToMs,
  type ImsRowFull,
  type RepoRow,
} from '../legacyRows.js';

const ims = (over: Partial<ImsRowFull>): ImsRowFull => ({ rowNumber: 10, containerNo: 'CXRU1040451', productType: 'Reefer', depot: 'Crystal Yard New', status: 'WIP', current: 'WIP', ...over });
const repo = (over: Partial<RepoRow>): RepoRow => ({ rowNumber: 5, indentId: 'IND-1', containerNo: 'CXRU1040451', status: '', ...over });

describe('dates', () => {
  it('formats IST like the ledger and IMS', () => {
    expect(istDateTime('2026-11-24T11:30:40.000Z')).toBe('24/11/2026 17:00:40');
    expect(istDmy('2026-11-23T20:00:00.000Z')).toBe('24-11-2026');
  });
  it('reads sheet serials and TMS text timestamps as the same instant', () => {
    const fromText = dmyTextToMs('24/11/2026 17:00:40');
    expect(fromText).toBe(Date.parse('2026-11-24T11:30:40.000Z'));
    // 24/11/2026 17:00:40 IST as a sheet serial
    expect(Math.abs(serialToMs(46350.70879629629) - fromText!)).toBeLessThan(1000);
  });
});

describe('buildLedgerRow', () => {
  const links = { photos: { leftSide: 'L', closeUp: 'C' }, additional: ['A1', 'A2'], lrCopy: 'LR', ptiVideo: '', pdf: 'PDF' };
  const entry = { kind: 'out' as const, loggedAt: '2026-11-24T11:30:40.000Z', loggedBy: '', movementDate: '2026-11-24', orderNumber: 'OR640', orderType: 'Lease', customerName: 'Acme', location: 'JNPT', transporterName: 'T', transporterNumber: '9', vehicleNumber: 'MH01', remarks: 'ok' };
  const row = buildLedgerRow({ id: 'CXRU1040451', typeCode: 'Reefer', size: '20 Feet' }, entry, links, 'gate@crystalgroup.in');

  it('has the legacy 32 columns in order', () => {
    expect(row).toHaveLength(32);
    expect(row.slice(0, 5)).toEqual(['24/11/2026 17:00:40', 'gate@crystalgroup.in', 'Outward (Gate-Out)', '2026-11-24', 'CXRU1040451']);
    expect(row[12]).toBe('LR');
    expect(row[13]).toBe('L');
    expect(row[21]).toBe('C');
    expect(row[24]).toBe('ok | Order: OR640 (Lease)');
    expect(row[25]).toBe('PDF');
    expect(row[28]).toBe('A1, A2');
    expect(row[29]).toBe('JNPT Yard');
  });

  it('never lets user text become a formula', () => {
    expect(safeCell('=IMPORTRANGE("x")')).toBe(`'=IMPORTRANGE("x")`);
    expect(safeCell('+91 98')).toBe(`'+91 98`);
    expect(safeCell('normal')).toBe('normal');
  });
});

describe('IMS Stock write safeguards', () => {
  it('writes from arriving statuses', () => {
    for (const current of ['WIP', 'In Transit', 'Offlease', 'OFFLEASE', '']) {
      expect(decideImsStockWrite([ims({ current, status: current })], 'CXRU 1040451', 'Reefer').write, current).toBe(true);
    }
  });
  it('writes over Stock at another depot (a transfer in)', () => {
    expect(decideImsStockWrite([ims({ current: 'STOCK', depot: 'Refrac Consultancy' })], 'CXRU1040451', 'Reefer').write).toBe(true);
  });
  it('never overwrites a hold or committed status', () => {
    for (const current of ['Blocked', 'MACHINE BLOCKED', 'SALE', 'LEASE', 'TRADING', 'HELD BY ACCOUNTS', 'Dispute', 'Scrap', 'Machine Consumed', 'CRYSTAL OFFICE', 'STOCK - Crystal Use']) {
      const d = decideImsStockWrite([ims({ current })], 'CXRU1040451', 'Reefer');
      expect(d.write, current).toBe(false);
      if (!d.write) expect(d.outcome, current).toBe('hold');
    }
  });
  it('leaves Stock at Crystal Yard alone', () => {
    const d = decideImsStockWrite([ims({ current: 'Stock' })], 'CXRU1040451', 'Reefer');
    expect(d.write).toBe(false);
  });
  it('writes nothing when rows are ambiguous, and picks by type when it can', () => {
    const two = [ims({ rowNumber: 3, productType: 'Dry' }), ims({ rowNumber: 9, productType: 'Reefer' })];
    const byType = decideImsStockWrite(two, 'CXRU1040451', 'Reefer');
    expect(byType.write && byType.row.rowNumber).toBe(9);
    expect(decideImsStockWrite([ims({ rowNumber: 3 }), ims({ rowNumber: 9 })], 'CXRU1040451', 'Reefer').write).toBe(false);
    expect(decideImsStockWrite([], 'CXRU1040451', 'Reefer').write).toBe(false);
  });
});

describe('Container_Repository row choice', () => {
  it('gate-in marks an unmarked row, preferring the typed indent', () => {
    const rows = [repo({ rowNumber: 2, indentId: 'OLD', status: 'MARKED GATE-OUT' }), repo({ rowNumber: 3, indentId: 'A' }), repo({ rowNumber: 4, indentId: 'B' })];
    const c = chooseRepoRow(rows, 'CXRU 1040451', 'in', 'B');
    expect(c.row?.rowNumber).toBe(4);
    expect(chooseRepoRow(rows, 'CXRU1040451', 'in').row?.rowNumber).toBe(3);
  });
  it('never overwrites a direct delivery or re-marks an already marked container', () => {
    expect(chooseRepoRow([repo({ status: 'STOCK - DIRECT DELIVERY' })], 'CXRU1040451', 'in').row).toBeNull();
    expect(chooseRepoRow([repo({ status: 'MARKED GATE-IN' })], 'CXRU1040451', 'in').row).toBeNull();
  });
  it('gate-out marks the MARKED GATE-IN row only', () => {
    expect(chooseRepoRow([repo({ status: 'MARKED GATE-IN', rowNumber: 7 })], 'CXRU1040451', 'out')).toMatchObject({ row: { rowNumber: 7 }, newStatus: 'MARKED GATE-OUT' });
    expect(chooseRepoRow([repo({ status: '' })], 'CXRU1040451', 'out').row).toBeNull();
  });
  it('ignores placeholder rows', () => {
    expect(chooseRepoRow([repo({ containerNo: '[WIP]-IND-1-01' })], '[WIP]-IND-1-01', 'in').row).toBeNull();
  });
});

describe('auto-close', () => {
  const marked = [repo({ status: 'MARKED GATE-IN' }), repo({ rowNumber: 6, containerNo: 'TGHU1', status: 'STOCK - DIRECT DELIVERY' }), repo({ rowNumber: 8, containerNo: '[WIP]-X' })];
  it('posts once when this gate-in completes a full indent', () => {
    expect(decideAutoClose(marked, [{ status: 'Arrived at Depot', quantity: '2' }], true)).toEqual({ post: true, totalCount: 2 });
  });
  it('does not post when not complete, already closed, under quantity, duplicated, or not newly marked', () => {
    expect(decideAutoClose([...marked, repo({ rowNumber: 9, containerNo: 'ZZZU1' })], [{ status: 'x', quantity: '3' }], true).post).toBe(false);
    expect(decideAutoClose(marked, [{ status: 'Pipeline Complete', quantity: '2' }], true).post).toBe(false);
    expect(decideAutoClose(marked, [{ status: 'x', quantity: '5' }], true).post).toBe(false);
    expect(decideAutoClose(marked, [{ status: 'x', quantity: '2' }, { status: 'x', quantity: '2' }], true).post).toBe(false);
    expect(decideAutoClose(marked, [{ status: 'x', quantity: '2' }], false).post).toBe(false);
  });
});

describe('old portal -> PMS import', () => {
  const values = (status: string, no = 'TGHU 1234567', remarks = '') => {
    const v: unknown[] = new Array(32).fill('');
    v[0] = 46350.5; v[1] = 'mum.depot@crystalgroup.in'; v[2] = status; v[3] = 46350; v[4] = no; v[5] = 'Dry'; v[6] = '20 Feet'; v[13] = 'https://drive.google.com/file/d/abc/view'; v[24] = remarks;
    return v;
  };
  it('parses a ledger row', () => {
    const r = parseLedgerRow(values('Inward (Gate-In)'), 606);
    expect(r).toMatchObject({ rowNumber: 606, status: 'Inward (Gate-In)', containerNo: 'TGHU 1234567', date: '2026-11-24', photos: { leftSide: 'https://drive.google.com/file/d/abc/view' } });
    expect(r.timestampMs).not.toBeNull();
  });
  it('creates, gates out or skips based on PMS state', () => {
    const active = new Map([['TGHU1234567', 'TGHU1234567']]);
    const none = new Map<string, string>();
    expect(planImport(parseLedgerRow(values('Inward (Gate-In)'), 2), none, none)).toEqual({ action: 'create' });
    expect(planImport(parseLedgerRow(values('Inward (Gate-In)'), 2), active, none).action).toBe('skip');
    expect(planImport(parseLedgerRow(values('Outward (Gate-Out)'), 2), active, none)).toEqual({ action: 'gate-out', containerId: 'TGHU1234567' });
    expect(planImport(parseLedgerRow(values('Outward (Gate-Out)'), 2), none, none).action).toBe('skip');
    expect(planImport(parseLedgerRow(values('Inward (Gate-In)'), 2), none, active).action).toBe('skip');
  });
  it('skips TMS synthetic rows', () => {
    expect(planImport(parseLedgerRow(values('Inward (Gate-In)', 'TGHU1234567', 'Auto gate-in by TMS'), 2), new Map(), new Map()).action).toBe('skip');
  });
});
