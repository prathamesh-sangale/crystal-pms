import { describe, expect, it } from 'vitest';
import { initials, toISODate } from './ui.js';

describe('toISODate', () => {
  it('formats a date as YYYY-MM-DD in local time', () => {
    expect(toISODate(new Date(2026, 9, 9))).toBe('2026-10-09');
  });

  it('pads single-digit months and days', () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('initials', () => {
  it('takes the first letter of up to two words, uppercased', () => {
    expect(initials('Suresh Patil')).toBe('SP');
  });

  it('handles a single name', () => {
    expect(initials('Admin')).toBe('A');
  });

  it('ignores extra words past the second', () => {
    expect(initials('Audit Read Only')).toBe('AR');
  });
});
