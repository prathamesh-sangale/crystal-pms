import { initials, type Status, type StatusTone } from '@pms/shared';
import { useId } from 'react';
import { cx } from '../../lib/cx';
import { Icon, type IconName } from './Icon';

/* ------------------------------------------------------------------------ */
/* Status — the only way this product renders a status                        */
/* ------------------------------------------------------------------------ */

/**
 * Design system rule 12, made structural: a status can only be rendered from a
 * `Status` object, and a `Status` always carries a tone, an icon and a word.
 * There is no prop here that would let a caller render a bare coloured dot.
 *
 * The long-form `detail` goes to assistive technology and to the tooltip, so
 * "Delayed 2d" can be read out as the full explanation.
 */
export function StatusPill({
  status,
  size = 'sm',
  className,
}: {
  status: Status;
  size?: 'sm' | 'lg';
  className?: string;
}): React.ReactElement {
  return (
    <span
      className={cx('pill', status.tone, size === 'lg' && 'lg', className)}
      title={status.detail}
    >
      <Icon name={status.icon as IconName} />
      {status.label}
      <span className="sr-only"> — {status.detail}</span>
    </span>
  );
}

/** A pill. Reserved for statuses, so an icon is not optional. */
export function Pill({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: StatusTone | 'outline';
  icon: IconName;
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <span className={cx('pill', tone, className)}>
      <Icon name={icon} />
      {children}
    </span>
  );
}

/**
 * A category, not a status.
 *
 * Design system section 26: categories take the 6px badge, never the full
 * radius of a pill, "and must not be mistaken for one". A container being a
 * double-compressor unit says nothing about whether it is on schedule, so it
 * must not look like something that does.
 */
export function CategoryBadge({
  variant = 'neutral',
  children,
}: {
  variant?: 'neutral' | 'brand' | 'accent';
  children: React.ReactNode;
}): React.ReactElement {
  const cls = variant === 'brand' ? 't-existing' : variant === 'accent' ? 't-priority' : 't-new';
  return <span className={cx('tierbadge', cls)}>{children}</span>;
}

/* ------------------------------------------------------------------------ */
/* Cards                                                                     */
/* ------------------------------------------------------------------------ */

export function StatCard({
  label,
  value,
  foot,
  icon,
  onClick,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  foot?: React.ReactNode;
  icon?: IconName;
  onClick?: () => void;
  loading?: boolean;
}): React.ReactElement {
  if (loading) {
    return (
      <div className="card">
        <div className="skel" style={{ width: '64px', height: '9px' }} />
        <div className="skel" style={{ width: '100px', height: '22px', margin: '10px 0 8px' }} />
        <div className="skel" style={{ width: '80px', height: '9px' }} />
      </div>
    );
  }

  const body = (
    <>
      <span className="klabel">
        {icon && <Icon name={icon} size="sm" />}
        {label}
      </span>
      <span className="kval">{value}</span>
      {foot && <span className="kfoot">{foot}</span>}
    </>
  );

  // Only cards that actually navigate somewhere get the hover lift.
  return onClick ? (
    <button type="button" className="card hoverable" onClick={onClick} style={{ textAlign: 'left' }}>
      {body}
    </button>
  ) : (
    <div className="card">{body}</div>
  );
}

/**
 * The one bold block on a screen. Rule 4: exactly one per screen, so this is
 * deliberately awkward to use twice — it is only ever rendered by a page
 * header, never inside a list.
 */
export function HeroCard({
  label,
  value,
  children,
  actions,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="herocard">
      <div className="glow" aria-hidden="true" />
      <div className="klabel">{label}</div>
      <div className="kval">{value}</div>
      {children}
      {actions && <div className="hero-actions">{actions}</div>}
    </div>
  );
}

/**
 * A card that owns a scrolling list.
 *
 * The body is a focusable, labelled region: a pane that scrolls but cannot be
 * reached by keyboard is unusable for anyone not holding a mouse, and axe
 * flags it as a serious violation.
 */
export function DataPanel({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
}): React.ReactElement {
  const headingId = useId();
  return (
    <section className="datapanel" aria-labelledby={headingId}>
      <header className="datapanel-head">
        <h3 id={headingId}>{title}</h3>
        {meta && <span className="sub">{meta}</span>}
      </header>
      <div className="datapanel-body" tabIndex={0} role="group" aria-labelledby={headingId}>
        {children}
      </div>
    </section>
  );
}

/** A trend, always with a direction word as well as a colour and an arrow. */
export function Trend({
  direction,
  children,
}: {
  direction: 'up' | 'down' | 'flat';
  children: React.ReactNode;
}): React.ReactElement {
  const icon: IconName | null =
    direction === 'up' ? 'arrow-up' : direction === 'down' ? 'arrow-down' : null;
  return (
    <span className={cx('trend', direction)}>
      {icon && <Icon name={icon} size="sm" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Small pieces                                                              */
/* ------------------------------------------------------------------------ */

export function Avatar({
  name,
  size = 'md',
  tone,
}: {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'amber' | 'ghost';
}): React.ReactElement {
  return (
    <span
      className={cx('avatar', size === 'sm' && 'sm', size === 'lg' && 'lg', tone)}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

/** Person chip — avatar plus name, so the avatar is never the only identifier. */
export function Person({
  name,
  detail,
}: {
  name: string;
  detail?: string;
}): React.ReactElement {
  return (
    <span className="cluster" style={{ gap: 'var(--s-2)', flexWrap: 'nowrap' }}>
      <Avatar name={name} size="sm" />
      <span className="truncate">
        {name}
        {detail && <span className="subtle"> · {detail}</span>}
      </span>
    </span>
  );
}

export function Progress({
  value,
  label,
  tone = 'accent',
}: {
  value: number;
  /** Named for screen readers — a bare bar announces nothing useful. */
  label: string;
  tone?: 'accent' | 'amber';
}): React.ReactElement {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cx('progress', tone === 'amber' && 'amber')}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${label}: ${pct}% complete`}
    >
      <div className="fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A labelled progress row: caption, percentage, bar. */
export function ProgressRow({
  label,
  value,
  caption,
}: {
  label: string;
  value: number;
  caption?: React.ReactNode;
}): React.ReactElement {
  const pct = Math.round(value);
  return (
    <div className="stack-tight stack">
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <span style={{ fontSize: '11.5px', color: 'var(--text-2)' }}>{label}</span>
        <span className="mono" style={{ fontSize: '11.5px', color: 'var(--text-2)' }}>
          {caption ?? `${pct}%`}
        </span>
      </div>
      <Progress value={value} label={label} />
    </div>
  );
}
