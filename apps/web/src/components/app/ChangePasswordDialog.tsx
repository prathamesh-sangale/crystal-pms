import { useState } from 'react';
import { RequestError } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { Button } from '../crystal/Button';
import { useToast } from '../crystal/Feedback';
import { Field } from '../crystal/Form';
import { Modal } from '../crystal/Overlay';

const EMPTY = { current: '', next: '', confirm: '' };

/** Self-service password change, reachable from the Account menu — the only
 * way to change your own password before this was asking a manager to do
 * it for you in Access Management. */
export function ChangePasswordDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { changePassword } = useAuth();
  const [draft, setDraft] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const close = (): void => {
    onOpenChange(false);
    setDraft(EMPTY);
  };

  const handleSave = async (): Promise<void> => {
    if (draft.next.length < 8) {
      toast.error('Could not change password', 'New password must be at least 8 characters.');
      return;
    }
    if (draft.next !== draft.confirm) {
      toast.error('Could not change password', "New password and confirmation don't match.");
      return;
    }
    setSaving(true);
    try {
      await changePassword(draft.current, draft.next);
      toast.ok('Password changed', 'Use your new password next time you sign in.');
      close();
    } catch (err) {
      toast.error('Could not change password', err instanceof RequestError ? err.message : 'Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && close()}
      title="Change password"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" icon="check" onClick={() => void handleSave()} loading={saving} disabled={saving}>
            Save
          </Button>
        </>
      }
    >
      <div className="stack">
        <Field label="Current password" required>
          {(props) => (
            <input {...props} type="password" value={draft.current} onChange={(e) => setDraft((d) => ({ ...d, current: e.target.value }))} autoComplete="current-password" />
          )}
        </Field>
        <Field label="New password" required hint="At least 8 characters.">
          {(props) => (
            <input {...props} type="password" value={draft.next} onChange={(e) => setDraft((d) => ({ ...d, next: e.target.value }))} autoComplete="new-password" />
          )}
        </Field>
        <Field label="Confirm new password" required>
          {(props) => (
            <input {...props} type="password" value={draft.confirm} onChange={(e) => setDraft((d) => ({ ...d, confirm: e.target.value }))} autoComplete="new-password" />
          )}
        </Field>
      </div>
    </Modal>
  );
}
