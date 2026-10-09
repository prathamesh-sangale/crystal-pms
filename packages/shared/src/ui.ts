/**
 * ui.ts — the few small, genuinely generic helpers both apps still share.
 *
 * What used to live here (the v1 pipeline's Container/OffLeaseUnit/Order
 * shapes and every function derived from them) was removed along with the
 * rest of v1 — these four are what was left over because nothing about them
 * was pipeline-specific to begin with.
 */

/** `YYYY-MM-DD` for a Date, in local time — never UTC-shifted. */
export function toISODate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function initials(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

/**
 * Every status badge in the product resolves through this shape, so a screen
 * physically cannot render a bare coloured dot or a red number — it gets a
 * tone, an icon and a word, or it gets nothing.
 *
 * `tone` maps to the design system's pill modifiers (section 26).
 */
export type StatusTone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'brand';

export interface Status {
  tone: StatusTone;
  /** Icon name from the design system sprite. */
  icon: string;
  label: string;
  /** Long form for screen readers and tooltips. */
  detail: string;
}
