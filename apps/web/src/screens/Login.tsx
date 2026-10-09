import { loginSchema } from '@pms/shared';
import { useState } from 'react';
import { RequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ADMIN_ACCOUNT, DEV_PASSWORD } from '../lib/devAccounts';
import { Button } from '../components/crystal/Button';
import { Alert } from '../components/crystal/Feedback';
import { Field } from '../components/crystal/Form';
import { Icon } from '../components/crystal/Icon';

export function Login(): React.ReactElement {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quickBusy, setQuickBusy] = useState<string | null>(null);

  // Dev-only: skip typing credentials and sign straight in as any seeded
  // role. Goes through the exact same signIn() as the form below, so
  // permissions are enforced for real, not bypassed.
  const quickSignIn = async (accountEmail: string): Promise<void> => {
    setFormError(null);
    setQuickBusy(accountEmail);
    try {
      await signIn(accountEmail, DEV_PASSWORD);
    } catch (error) {
      setFormError(
        error instanceof RequestError ? error.message : 'Could not sign in. Try again.'
      );
    } finally {
      setQuickBusy(null);
    }
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.');
        if (!next[key]) next[key] = issue.message;
      }
      setErrors(next);
      return;
    }

    setErrors({});
    setBusy(true);
    try {
      await signIn(parsed.data.email, parsed.data.password);
    } catch (error) {
      setFormError(
        error instanceof RequestError ? error.message : 'Could not sign in. Try again.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="loginpage">
      {/* The one navy block on this screen. */}
      <aside className="loginpage-aside">
        <div className="hero-grid" aria-hidden="true" />
        <div style={{ position: 'relative' }}>
          <div className="eyebrow" style={{ color: 'var(--amber-c)' }}>
            CONTAINER READINESS · PMS
          </div>
          <h1
            style={{
              fontFamily: 'var(--f-display)',
              fontWeight: 800,
              fontSize: '32px',
              lineHeight: 1.15,
              letterSpacing: '-1px',
              margin: '0 0 var(--s-4)',
              maxWidth: '13ch',
            }}
          >
            Survey it, section it, <em style={{ fontStyle: 'normal', color: 'var(--amber-c)' }}>ready to move</em>.
          </h1>
          <p style={{ fontSize: '14px', lineHeight: 1.65, opacity: 0.82, maxWidth: '46ch', margin: 0 }}>
            One Admin dashboard for the whole yard — a survey decides what work a container
            actually needs, every task runs on a timer, and nothing ships until it&rsquo;s done.
          </p>
        </div>
      </aside>

      <main className="loginpage-form">
        <div className="loginpage-form-inner stack stack-loose">
          <div className="side-brand" style={{ padding: 0 }}>
            <span className="mark" aria-hidden="true">
              <i />
            </span>
            ReeferReady
          </div>

          <div>
            <h2
              style={{
                fontFamily: 'var(--f-display)',
                fontWeight: 800,
                fontSize: '22px',
                letterSpacing: '-0.4px',
                margin: '0 0 var(--s-1)',
              }}
            >
              Sign in
            </h2>
            <p style={{ fontSize: '13px', color: 'var(--text-2)', margin: 0 }}>
              Use your depot account.
            </p>
          </div>

          <form onSubmit={submit} className="stack" noValidate>
            {formError && (
              <Alert tone="err" title="Could not sign in">
                {formError}
              </Alert>
            )}

            <Field label="Email" required error={errors.email}>
              {(props) => (
                <input
                  {...props}
                  name="email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@reeferready.example"
                />
              )}
            </Field>

            <Field label="Password" required error={errors.password}>
              {(props) => (
                <div className="input-wrap">
                  <Icon name="lock" size="sm" />
                  <input
                    {...props}
                    name="password"
                    style={{ paddingLeft: '34px', paddingRight: '40px' }}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <span className="trail">
                    <button
                      type="button"
                      className="iconbtn bare"
                      style={{ width: '28px', height: '28px' }}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      onClick={() => setShowPassword((v) => !v)}
                    >
                      <Icon name="eye" size="sm" />
                    </button>
                  </span>
                </div>
              )}
            </Field>

            <Button type="submit" variant="primary" block loading={busy}>
              Sign in
            </Button>
          </form>

          {import.meta.env.DEV && (
            <div className="card tint tint-navy">
              <div className="klabel">Quick sign-in · dev only</div>
              <p style={{ fontSize: '12px', color: 'var(--text-2)', margin: 'var(--s-2) 0 var(--s-3)' }}>
                One Admin account runs the whole yard now — one click, no typing.
              </p>
              <Button
                variant="ghost"
                size="sm"
                icon="user"
                loading={quickBusy === ADMIN_ACCOUNT.email}
                disabled={quickBusy !== null && quickBusy !== ADMIN_ACCOUNT.email}
                onClick={() => quickSignIn(ADMIN_ACCOUNT.email)}
              >
                {ADMIN_ACCOUNT.label}
              </Button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
