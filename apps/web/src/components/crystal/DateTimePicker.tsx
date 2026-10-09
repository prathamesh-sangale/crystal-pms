import * as Popover from '@radix-ui/react-popover';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * A from-scratch date + time popover, standing in for `<input
 * type="datetime-local">`. The native control's own popup is drawn by the
 * browser/OS, not by us — no CSS hook of any kind (border-radius included)
 * reaches it. This one is plain DOM, so every pixel is ours: Crystal tokens
 * throughout, `.pop-panel`'s rounded corners, both themes for free.
 *
 * Value format matches the native control exactly ('YYYY-MM-DDTHH:mm'), so
 * it's a drop-in replacement wherever that format is already expected.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];
const MINUTE_STEP = 5;
const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => h);
const MINUTE_OPTIONS = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parseValue(value: string): { date: Date | null; hour: number; minute: number } {
  if (!value) return { date: null, hour: 0, minute: 0 };
  const [datePart, timePart] = value.split('T');
  const [y, m, d] = (datePart ?? '').split('-').map(Number);
  const [h, min] = (timePart ?? '00:00').split(':').map(Number);
  if (!y || !m || !d) return { date: null, hour: 0, minute: 0 };
  return { date: new Date(y, m - 1, d), hour: h || 0, minute: min || 0 };
}

function compose(date: Date, hour: number, minute: number): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(hour)}:${pad(minute)}`;
}

function formatDisplay(value: string): string {
  const { date, hour, minute } = parseValue(value);
  if (!date) return '';
  return `${pad(date.getDate())} ${MONTH_NAMES[date.getMonth()]!.slice(0, 3)} ${date.getFullYear()}, ${pad(hour)}:${pad(minute)}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/** The hour/minute equivalent of the day grid above — own compact, scrolled
 * dropdown instead of a native `<select>`, whose open listbox is exactly as
 * unstylable (and, with 24 hours in it, exactly as unwieldy) as the native
 * date popup was. Height-capped and auto-scrolled to the current value, so
 * picking an hour never means scrolling through two dozen rows by hand. */
function CompactSelect({ value, options, onChange }: { value: number; options: number[]; onChange: (v: number) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>('[data-selected="true"]');
    el?.scrollIntoView({ block: 'center' });
  }, [open]);

  // Deliberately not a nested Radix Popover: this already lives inside
  // DateTimePicker's own Popover.Content, and a second Popover.Root in
  // there fights the outer one's outside-click dismissal — opening the
  // hour dropdown was closing the whole calendar instead. Plain local state
  // sidesteps that entirely; this listener is the only piece it has to
  // re-implement (close when a click lands outside this control).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <span ref={rootRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className="input"
        style={{ width: '60px', height: '36px', padding: '8px 6px', fontSize: '12px', textAlign: 'center' }}
        onClick={() => setOpen((o) => !o)}
      >
        {pad(value)}
      </button>
      {open && (
        <div
          className="pop-panel"
          style={{
            display: 'block',
            position: 'absolute',
            // Opens upward: this trigger sits near the bottom of the
            // calendar popup, so a downward dropdown would spill past its
            // edge. There's open room above (the day grid) to grow into
            // instead. `.pop-panel`'s own class already sets `top`, so it
            // has to be cancelled here — left in place, `top` and `bottom`
            // both resolving would stretch the element *between* them
            // instead of positioning it off one edge.
            top: 'auto',
            bottom: 'calc(100% + 4px)',
            left: 0,
            width: '60px',
            padding: '4px',
            maxHeight: '204px',
            overflowY: 'auto',
          }}
        >
          <div ref={listRef} className="stack stack-tight" style={{ gap: '2px' }}>
            {options.map((o) => {
              const selected = o === value;
              return (
                <button
                  key={o}
                  type="button"
                  data-selected={selected}
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    padding: '10px 0',
                    fontSize: '12.5px',
                    textAlign: 'center',
                    border: 'none',
                    borderRadius: 'var(--r-sm)',
                    cursor: 'pointer',
                    background: selected ? 'var(--accent)' : 'transparent',
                    color: selected ? 'var(--on-accent)' : 'var(--text)',
                    fontWeight: selected ? 700 : 400,
                  }}
                >
                  {pad(o)}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </span>
  );
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = 'Pick date & time',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const parsed = parseValue(value);
  const today = new Date();
  const [viewYear, setViewYear] = useState(parsed.date?.getFullYear() ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(parsed.date?.getMonth() ?? today.getMonth());

  const selectDay = (day: number): void => onChange(compose(new Date(viewYear, viewMonth, day), parsed.hour, parsed.minute));
  const setHour = (h: number): void => onChange(compose(parsed.date ?? new Date(viewYear, viewMonth, 1), h, parsed.minute));
  const setMinute = (m: number): void => onChange(compose(parsed.date ?? new Date(viewYear, viewMonth, 1), parsed.hour, m));
  const goToday = (): void => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    onChange(compose(today, today.getHours(), today.getMinutes()));
  };
  const prevMonth = (): void => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else setViewMonth((m) => m - 1);
  };
  const nextMonth = (): void => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else setViewMonth((m) => m + 1);
  };

  const cells = useMemo(() => {
    const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
    const total = daysInMonth(viewYear, viewMonth);
    const prevMonthTotal = daysInMonth(viewYear, viewMonth === 0 ? 11 : viewMonth - 1);
    const out: Array<{ day: number; inMonth: boolean }> = [];
    for (let i = firstWeekday - 1; i >= 0; i--) out.push({ day: prevMonthTotal - i, inMonth: false });
    for (let d = 1; d <= total; d++) out.push({ day: d, inMonth: true });
    let trailing = 1;
    while (out.length < 42) out.push({ day: trailing++, inMonth: false });
    return out;
  }, [viewYear, viewMonth]);

  const isSelected = (day: number, inMonth: boolean): boolean =>
    inMonth && Boolean(parsed.date) && parsed.date!.getFullYear() === viewYear && parsed.date!.getMonth() === viewMonth && parsed.date!.getDate() === day;

  const minuteStep = parsed.minute - (parsed.minute % MINUTE_STEP);

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="input"
          style={{
            width: '200px',
            height: '40px',
            padding: '8px 10px',
            fontSize: '12.5px',
            borderRadius: 'var(--r-md)',
            textAlign: 'left',
            color: value ? 'var(--text)' : 'var(--text-3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--s-2)',
          }}
        >
          <span className="truncate">{value ? formatDisplay(value) : placeholder}</span>
          <Icon name="calendar" size="sm" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="pop-panel" style={{ width: 'auto', padding: 'var(--s-3)' }} sideOffset={6} collisionPadding={8} align="start">
          <div className="cluster" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-2)' }}>
            <b style={{ fontSize: '12.5px' }}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </b>
            <span className="cluster" style={{ gap: 'var(--s-1)' }}>
              <button type="button" className="iconbtn bare" onClick={prevMonth} aria-label="Previous month">
                <Icon name="chev-left" size="sm" />
              </button>
              <button type="button" className="iconbtn bare" onClick={nextMonth} aria-label="Next month">
                <Icon name="chev-right" size="sm" />
              </button>
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 36px)', gap: '2px', marginBottom: 'var(--s-1)' }}>
            {WEEKDAYS.map((w) => (
              <div key={w} style={{ fontSize: '10px', color: 'var(--text-3)', textAlign: 'center', fontWeight: 700 }}>
                {w}
              </div>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 36px)', gap: '2px' }}>
            {cells.map((c, i) => {
              const selected = isSelected(c.day, c.inMonth);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => c.inMonth && selectDay(c.day)}
                  disabled={!c.inMonth}
                  style={{
                    width: '36px',
                    height: '36px',
                    fontSize: '12px',
                    border: 'none',
                    borderRadius: 'var(--r-sm)',
                    background: selected ? 'var(--accent)' : 'transparent',
                    color: selected ? 'var(--on-accent)' : c.inMonth ? 'var(--text)' : 'var(--text-3)',
                    cursor: c.inMonth ? 'pointer' : 'default',
                    fontWeight: selected ? 700 : 400,
                  }}
                >
                  {c.day}
                </button>
              );
            })}
          </div>

          <div className="cluster" style={{ gap: 'var(--s-2)', marginTop: 'var(--s-3)', paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line)' }}>
            <CompactSelect value={parsed.hour} options={HOUR_OPTIONS} onChange={setHour} />
            <span className="subtle">:</span>
            <CompactSelect value={minuteStep} options={MINUTE_OPTIONS} onChange={setMinute} />
          </div>

          <div className="cluster" style={{ justifyContent: 'space-between', marginTop: 'var(--s-2)' }}>
            <button
              type="button"
              onClick={() => onChange('')}
              style={{ fontSize: '11.5px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={goToday}
              style={{ fontSize: '11.5px', color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              Today
            </button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
