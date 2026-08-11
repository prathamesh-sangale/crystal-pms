import { createContainerSchema, type ContainerType } from '@pms/shared';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { RequestError } from '../../lib/api';
import { useCreateContainer, useReference } from '../../lib/queries';
import { Button } from '../crystal/Button';
import { Alert, Skeleton, useToast } from '../crystal/Feedback';
import { Field } from '../crystal/Form';
import { Modal } from '../crystal/Overlay';

interface FormState {
  id: string;
  size: string;
  type: ContainerType;
  anteroomVariant: string;
  customer: string;
  priority: string;
  assignee: string;
  depot: string;
}

const EMPTY: FormState = {
  id: '',
  size: '40ft HC Reefer',
  type: 'standard',
  anteroomVariant: 'internal',
  customer: '',
  priority: 'Standard',
  assignee: '',
  depot: '',
};

export function AddContainerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const reference = useReference();
  const create = useCreateContainer();
  const toast = useToast();
  const [, setParams] = useSearchParams();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Reset on every open so a cancelled draft never reappears half-filled.
  useEffect(() => {
    if (!open) return;
    setErrors({});
    setFormError(null);
    setForm({
      ...EMPTY,
      depot: reference.data?.homeDepot ?? '',
      assignee: reference.data?.technicians[0]?.name ?? '',
    });
  }, [open, reference.data]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  };

  /**
   * The form carries `noValidate`: the browser's own bubbles would fire before
   * this runs, and they cannot say "the mantrap checklist differs between the
   * two configurations". The schema is the only validator.
   */
  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    setFormError(null);

    const payload = {
      ...form,
      anteroomVariant: form.type === 'anteroom' ? form.anteroomVariant : null,
      notes: '',
    };

    // Validated with the same schema the API uses, so the two can never
    // disagree about what a valid registration looks like.
    const parsed = createContainerSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || '_';
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }

    create.mutate(parsed.data, {
      onSuccess: ({ container }) => {
        onOpenChange(false);
        toast.ok('Container registered', `${container.id} is in Gate-In & Intake.`);
        // Land the person on the thing they just made.
        setParams(
          (params) => {
            params.set('container', container.id);
            return params;
          },
          { replace: false }
        );
      },
      onError: (error) => {
        if (error instanceof RequestError) {
          setErrors(error.fields);
          setFormError(Object.keys(error.fields).length ? null : error.message);
        }
      },
    });
  };

  const typeHint = reference.data?.types.find((t) => t.value === form.type)?.hint;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Register a container for readiness"
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" icon="plus" type="submit" form="add-container" loading={create.isPending}>
            Add to pipeline
          </Button>
        </>
      }
    >
      {reference.isLoading ? (
        <div className="stack">
          <Skeleton height={44} radius={6} />
          <Skeleton height={44} radius={6} />
          <Skeleton height={44} radius={6} />
        </div>
      ) : (
        <form id="add-container" onSubmit={submit} className="stack" noValidate>
          {formError && <Alert tone="err" title="That could not be saved">{formError}</Alert>}

          <Field
            label="Container ID"
            required
            hint="ISO 6346 unit number, e.g. RFCU 445 129-8"
            error={errors.id}
          >
            {(props) => (
              <input
                {...props}
                value={form.id}
                onChange={(e) => set('id', e.target.value)}
                placeholder="RFCU 445 129-8"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>

          <Field label="Size" required error={errors.size}>
            {(props) => (
              <select {...props} value={form.size} onChange={(e) => set('size', e.target.value)}>
                {reference.data?.sizes.map((size) => (
                  <option key={size}>{size}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Container type" required hint={typeHint} error={errors.type}>
            {(props) => (
              <select
                {...props}
                value={form.type}
                onChange={(e) => set('type', e.target.value as ContainerType)}
              >
                {reference.data?.types.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {form.type === 'anteroom' && (
            <Field
              label="Anteroom configuration"
              required
              hint="The mantrap checklist differs between the two."
              error={errors.anteroomVariant}
            >
              {(props) => (
                <select
                  {...props}
                  value={form.anteroomVariant}
                  onChange={(e) => set('anteroomVariant', e.target.value)}
                >
                  <option value="internal">Internal anteroom</option>
                  <option value="external">External anteroom</option>
                </select>
              )}
            </Field>
          )}

          <Field label="Customer / lessee" required error={errors.customer}>
            {(props) => (
              <input
                {...props}
                value={form.customer}
                onChange={(e) => set('customer', e.target.value)}
                placeholder="Maersk Line"
              />
            )}
          </Field>

          <Field label="Priority" error={errors.priority}>
            {(props) => (
              <select {...props} value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                {reference.data?.priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Depot" required error={errors.depot}>
            {(props) => (
              <select {...props} value={form.depot} onChange={(e) => set('depot', e.target.value)}>
                {reference.data?.depots.map((depot) => (
                  <option key={depot.id} value={depot.name}>
                    {depot.name}
                  </option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label="Assigned technician"
            required
            hint="Their named cover picks the work up if they are unavailable."
            error={errors.assignee}
          >
            {(props) => (
              <select {...props} value={form.assignee} onChange={(e) => set('assignee', e.target.value)}>
                {reference.data?.technicians.map((tech) => (
                  <option key={tech.name} value={tech.name}>
                    {tech.name} — {tech.trade}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </form>
      )}
    </Modal>
  );
}
