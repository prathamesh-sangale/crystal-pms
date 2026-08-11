import * as Checkbox from '@radix-ui/react-checkbox';
import * as Switch from '@radix-ui/react-switch';
import { forwardRef, useId } from 'react';
import { cx } from '../../lib/cx';
import { Icon } from './Icon';

/* ------------------------------------------------------------------------ */
/* Field — label, hint, and the validation message that names the fix         */
/* ------------------------------------------------------------------------ */

interface FieldProps {
  label: string;
  /** Rendered under the control, before validation runs. */
  hint?: string;
  /** Design system section 12: name the fix, not just the failure. */
  error?: string;
  success?: string;
  required?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-describedby': string | undefined;
    'aria-invalid': boolean | undefined;
    required: boolean | undefined;
    className: string;
  }) => React.ReactNode;
}

export function Field({
  label,
  hint,
  error,
  success,
  required,
  className,
  children,
}: FieldProps): React.ReactElement {
  const id = useId();
  const hintId = `${id}-hint`;
  const msgId = `${id}-msg`;
  const describedBy = [hint ? hintId : null, error || success ? msgId : null]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cx('field', className)}>
      {/* The asterisk is decoration; `required` on the control is what
          assistive technology actually announces, so the label's accessible
          name stays exactly the words a person reads. */}
      <label htmlFor={id}>
        {label}
        {required && (
          <span className="req" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {children({
        id,
        'aria-describedby': describedBy || undefined,
        'aria-invalid': error ? true : undefined,
        required: required || undefined,
        className: cx('input', error && 'is-error', success && !error && 'is-ok'),
      })}
      {hint && !error && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {error && (
        <span className="msg err" id={msgId}>
          <Icon name="x-circle" size="sm" />
          {error}
        </span>
      )}
      {success && !error && (
        <span className="msg ok" id={msgId}>
          <Icon name="check-circle" size="sm" />
          {success}
        </span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Controls                                                                  */
/* ------------------------------------------------------------------------ */

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return <input {...props} ref={ref} className={cx('input', props.className)} />;
  }
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea(props, ref) {
  return <textarea {...props} ref={ref} className={cx('textarea', props.className)} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select(props, ref) {
    return <select {...props} ref={ref} className={cx('input', props.className)} />;
  }
);

/** Input with a leading icon — search, credentials, anything with a glyph. */
export function InputWithIcon({
  icon,
  trailing,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  icon: React.ComponentProps<typeof Icon>['name'];
  trailing?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="input-wrap">
      <Icon name={icon} size="sm" />
      <input {...props} className={cx('input', props.className)} />
      {trailing && <span className="trail">{trailing}</span>}
    </div>
  );
}

/**
 * Checkbox. Radix supplies the keyboard and ARIA behaviour; the look is the
 * design system's, via the headless bindings section.
 */
export function CheckboxField({
  checked,
  onCheckedChange,
  label,
  disabled,
  id: providedId,
  meta,
  strikeWhenChecked,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
  id?: string;
  /** Right-aligned detail, e.g. an hours estimate. */
  meta?: React.ReactNode;
  strikeWhenChecked?: boolean;
}): React.ReactElement {
  const generated = useId();
  const id = providedId ?? generated;
  return (
    <div className={cx('chkrow', checked && strikeWhenChecked && 'done')}>
      <span className="check">
        <Checkbox.Root
          id={id}
          checked={checked}
          onCheckedChange={(next) => onCheckedChange(next === true)}
          disabled={disabled}
        >
          <Checkbox.Indicator>
            <Icon name="check" size="sm" />
          </Checkbox.Indicator>
        </Checkbox.Root>
      </span>
      <label htmlFor={id}>{label}</label>
      {meta && <span className="hrs">{meta}</span>}
    </div>
  );
}

/** Switch — takes effect immediately, so it never sits next to a Save button. */
export function SwitchField({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  const id = useId();
  return (
    <span className="switch">
      <Switch.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}>
        <Switch.Thumb asChild>
          <span />
        </Switch.Thumb>
      </Switch.Root>
      <label htmlFor={id}>{label}</label>
    </span>
  );
}

/** Filter chip — outline at rest, solid accent when on. */
export function Chip({
  pressed,
  onClick,
  children,
  icon,
}: {
  pressed: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon?: React.ComponentProps<typeof Icon>['name'];
}): React.ReactElement {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {icon && <Icon name={icon} size="sm" />}
      {children}
    </button>
  );
}
