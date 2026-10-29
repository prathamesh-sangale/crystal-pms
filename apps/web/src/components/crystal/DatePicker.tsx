import * as Popover from '@radix-ui/react-popover';
import { useMemo, useState } from 'react';
import { formatDMY, istDay, istToday } from '../../lib/istDate';
import { Icon } from './Icon';

/**
 * A from-scratch, date-only popover -- the date-only sibling of
 * DateTimePicker.tsx, same reasoning (no CSS hook reaches a native
 * control's own browser/OS-drawn popup). Replaces every plain
 * `<input type="date">` in the app: that native control's *displayed*
 * format follows the browser/OS locale, not anything the page controls,
 * so depending on the device it could show mm/dd/yyyy just as easily as
 * dd/mm/yyyy -- this one always shows dd/mm/yyyy, by direct request.
 *
 * Value format matches the native control exactly ('YYYY-MM-DD'), so it's
 * a drop-in replacement wherever that format is already expected.
 */

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
];

function parseValue(value: string): { year: number; month: number; day: number } | null {
  if (!value) return null;
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return null;
  return { year: y, month: m - 1, day: d };
}

function compose(year: number, month: number, day: number): string {
  const d = new Date(year, month, day);
  return istDay(d);
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Pick a date',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}): React.ReactElement {
  const parsed = parseValue(value);
  const today = parseValue(istToday())!;
  const [viewYear, setViewYear] = useState(parsed?.year ?? today.year);
  const [viewMonth, setViewMonth] = useState(parsed?.month ?? today.month);

  const selectDay = (day: number): void => onChange(compose(viewYear, viewMonth, day));
  const goToday = (): void => {
    setViewYear(today.year);
    setViewMonth(today.month);
    onChange(istToday());
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
    inMonth && Boolean(parsed) && parsed!.year === viewYear && parsed!.month === viewMonth && parsed!.day === day;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="input"
          style={{
            width: '140px',
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
          <span className="truncate">{value ? formatDMY(value) : placeholder}</span>
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

          <div className="cluster" style={{ justifyContent: 'space-between', marginTop: 'var(--s-2)', paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line)' }}>
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
