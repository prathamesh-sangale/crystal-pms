import * as Tooltip from '@radix-ui/react-tooltip';
import { forwardRef } from 'react';
import { cx } from '../../lib/cx';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'lg';

const VARIANT: Record<Variant, string> = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  accent: 'btn-accent',
  danger: 'btn-danger',
};

const SIZE: Record<Size, string> = { sm: 'btn-sm', md: '', lg: 'btn-lg' };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  /** Design system section 10: the label stays in place so nothing reflows. */
  loading?: boolean;
  block?: boolean;
  icon?: IconName;
  trailingIcon?: IconName;
}

/**
 * Every state the design system draws is reachable here: rest, hover, press,
 * focus, disabled and loading. Hover and press come from CSS; the two this
 * component owns are `disabled` and `loading`, and loading implies disabled so
 * a double submit is impossible.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, block, icon, trailingIcon, className, children, disabled, type, ...rest },
  ref
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('btn', VARIANT[variant], SIZE[size], block && 'btn-block', loading && 'loading', className)}
    >
      {icon && <Icon name={icon} size={size === 'lg' ? 'md' : 'sm'} />}
      {children}
      {trailingIcon && <Icon name={trailingIcon} size={size === 'lg' ? 'md' : 'sm'} />}
    </button>
  );
});

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required. An icon-only control always needs a name and a tooltip. */
  label: string;
  bare?: boolean;
  pressed?: boolean;
  /** Unread count, rendered as the design system's badge dot. */
  badge?: number;
  size?: IconSize;
}

type IconSize = 'sm' | 'md';

/**
 * Icon-only button. The design system is explicit that these always carry a
 * tooltip, so the tooltip is not optional here — `label` supplies both the
 * accessible name and the bubble.
 */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, bare, pressed, badge, className, size = 'md', type, ...rest },
  ref
) {
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      aria-pressed={pressed}
      className={cx('iconbtn', bare && 'bare', pressed && 'on', className)}
    >
      <Icon name={icon} size={size} />
      {badge !== undefined && badge > 0 && (
        <span className="badge-dot" aria-hidden="true">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{button}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="bubble" sideOffset={8} collisionPadding={8}>
          {label}
          <Tooltip.Arrow className="tip-arrow" width={10} height={5} />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
});

/** Segmented control — the selected segment is a raised chip, never a navy block. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string; icon?: IconName }>;
  label: string;
}): React.ReactElement {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.icon && <Icon name={option.icon} size="sm" />}
          {option.label}
        </button>
      ))}
    </div>
  );
}
