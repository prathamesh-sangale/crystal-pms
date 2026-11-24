/**
 * Pure-function tests for the IMS-based Gate In / Gate Out rules. No network,
 * no database: rows are built in memory, so this file is always safe to run.
 */
import { describe, expect, it } from 'vitest';
import { evaluateGateIn, evaluateGateOut, imsUnavailableDecision, rowsForType, type ImsStatusRow } from '../gateRules.js';

const row = (over: Partial<ImsStatusRow>): ImsStatusRow => ({
  containerNo: 'CXRU1040451',
  productType: 'Reefer',
  depot: 'Crystal Yard New',
  current: 'Stock',
  status: 'Stock',
  ...over,
});

describe('Gate In rule', () => {
  it('refuses when IMS shows Stock at our yard, whatever the depot spelling', () => {
    for (const depot of ['Crystal Yard', 'Crystal Yard New', 'CRYSTAL YARD', 'Crystal yard new', 'Crystal Yard New - Offce']) {
      const d = evaluateGateIn([row({ depot })]);
      expect(d.allowed, depot).toBe(false);
      expect(d.reason).toMatch(/already shows this container in stock/);
    }
  });

  it('allows "STOCK - Crystal Use" at our yard, with a warning', () => {
    const d = evaluateGateIn([row({ current: 'STOCK - Crystal Use' })]);
    expect(d.allowed).toBe(true);
    expect(d.warnings.join(' ')).toMatch(/STOCK - Crystal Use/);
  });

  it('allows every non-stock status at our yard', () => {
    for (const current of ['WIP', 'In Transit', 'Offlease', 'OFFLEASE', 'LEASE', 'SALE', 'Blocked', 'MACHINE BLOCKED']) {
      expect(evaluateGateIn([row({ current })]).allowed, current).toBe(true);
    }
  });

  it('allows Stock at another depot, with a transfer warning', () => {
    const d = evaluateGateIn([row({ depot: 'BCT Depot' })]);
    expect(d.allowed).toBe(true);
    expect(d.warnings.join(' ')).toMatch(/another depot/);
  });

  it('allows a container IMS has never heard of, with a warning', () => {
    const d = evaluateGateIn([]);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toHaveLength(1);
  });

  it('falls back to Status when Current is blank', () => {
    expect(evaluateGateIn([row({ current: '', status: 'STOCK' })]).allowed).toBe(false);
    expect(evaluateGateIn([row({ current: '  ', status: 'WIP' })]).allowed).toBe(true);
  });

  it('only counts the row of the same type when one number sits on two IMS rows', () => {
    const rows = [row({ productType: 'Dry', current: 'Stock' }), row({ productType: 'Reefer', current: 'OFFLEASE' })];
    expect(evaluateGateIn(rows, 'Reefer').allowed).toBe(true);
    expect(evaluateGateIn(rows, 'Dry').allowed).toBe(false);
    // Type unknown, or matching neither row: every row counts, so the Stock row still blocks.
    expect(evaluateGateIn(rows).allowed).toBe(false);
    expect(evaluateGateIn(rows, 'ISO Tank').allowed).toBe(false);
  });

  it('matches IMS cabin code CCCS to Porta Cabin', () => {
    const rows = [row({ productType: 'CCCS', current: 'Stock' }), row({ productType: 'Dry', current: 'SALE' })];
    expect(rowsForType(rows, 'Porta Cabin')).toEqual([rows[0]]);
  });
});

describe('Gate Out rule', () => {
  it('allows Stock, Blocked, LEASE, SALE and TRADING, including OMS setting LEASE before the container leaves', () => {
    for (const current of ['Stock', 'STOCK', 'STOCK - Crystal Use', 'Blocked', 'MACHINE BLOCKED', 'LEASE', 'Lease ', 'SALE', 'TRADING']) {
      expect(evaluateGateOut([row({ current })]).allowed, current).toBe(true);
    }
  });

  it('refuses statuses that mean the container is not at the yard to leave', () => {
    for (const current of ['WIP', 'In Transit', 'Scrap', 'Machine Consumed']) {
      const d = evaluateGateOut([row({ current })]);
      expect(d.allowed, current).toBe(false);
      expect(d.reason).toMatch(/Gate-out needs IMS to show/);
    }
  });

  it('allows Offlease with a warning (IMS often lags the physical return)', () => {
    for (const current of ['Offlease', 'OFFLEASE', 'Offlease ']) {
      const d = evaluateGateOut([row({ current })]);
      expect(d.allowed, current).toBe(true);
      expect(d.warnings.join(' ')).toMatch(/may need updating/);
    }
  });

  it('allows a container IMS has never heard of, with a warning (never blocks real work on missing IMS data)', () => {
    const d = evaluateGateOut([]);
    expect(d.allowed).toBe(true);
    expect(d.warnings).toHaveLength(1);
  });
});

describe('IMS unavailable', () => {
  it('fails open for both directions', () => {
    expect(imsUnavailableDecision('in').allowed).toBe(true);
    expect(imsUnavailableDecision('out').allowed).toBe(true);
  });
});
