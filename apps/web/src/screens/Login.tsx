import { loginSchema, otpRequestSchema, otpVerifySchema } from '@pms/shared';
import { useEffect, useRef, useState } from 'react';
import { api, RequestError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ADMIN_ACCOUNT } from '../lib/devAccounts';
import { Button } from '../components/crystal/Button';
import { Alert } from '../components/crystal/Feedback';
import { Field } from '../components/crystal/Form';
import { Icon } from '../components/crystal/Icon';

const RESEND_COOLDOWN_S = 30;

/** Same behavior as OMS's own login screen (app/login/page.tsx), by direct
 * request: once an "@" is typed, suggest this app's real domains instead of
 * making everyone type the whole thing out. */
const EMAIL_DOMAINS = ['@crystalgroup.in', '@crystalpms.com', '@gmail.com'];

function emailDomainSuggestions(email: string): string[] {
  const atIdx = email.indexOf('@');
  if (atIdx === -1) return [];
  const typed = email.slice(atIdx);
  return EMAIL_DOMAINS.filter((d) => d.startsWith(typed) && d !== typed);
}

/** Wraps a plain email `<input>` (still fed the `Field` render-prop's own
 * `props`) with OMS's suggestion dropdown: Tab or Enter applies the first
 * suggestion instead of leaving the field/submitting the form, and clicking
 * one fills in the rest. Local to this file -- the only two email inputs
 * that need it are both on this screen. */
function EmailInput({
  inputProps,
  value,
  onChange,
}: {
  inputProps: Record<string, unknown>;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  const suggestions = emailDomainSuggestions(value);
  const atIdx = value.indexOf('@');
  const applySuggestion = (domain: string): void => onChange(value.slice(0, atIdx) + domain);

  return (
    <div style={{ position: 'relative' }}>
      <input
        {...inputProps}
        type="email"
        autoComplete="username"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.key === 'Tab' || e.key === 'Enter') && suggestions.length > 0) {
            e.preventDefault();
            applySuggestion(suggestions[0]!);
          }
        }}
        placeholder="name@crystalgroup.in"
      />
      {suggestions.length > 0 && (
        <div className="card" style={{ position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 10, padding: 'var(--s-1)' }}>
          <div className="stack" style={{ gap: '2px' }}>
            {suggestions.map((domain) => (
              <button
                key={domain}
                type="button"
                className="chip"
                style={{ justifyContent: 'flex-start', textAlign: 'left', width: '100%' }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySuggestion(domain);
                }}
              >
                {value.slice(0, atIdx)}
                <strong>{domain}</strong>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** The email-code alternative to the password form below -- entirely
 * additive and off by default (see `mode` in `Login`), by direct request:
 * the existing password sign-in stays the default, untouched path. Its own
 * small component so its three-states-in-one (email step, code step,
 * in-flight/error) don't tangle with the password form's. */
function OtpSignIn({ onBack }: { onBack: () => void }): React.ReactElement {
  const { signInWithOtp } = useAuth();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  const startCooldown = (): void => {
    setCooldown(RESEND_COOLDOWN_S);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((s) => {
        if (s <= 1 && timerRef.current) clearInterval(timerRef.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
  };

  const sendCode = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    const parsed = otpRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setErrors({ email: parsed.error.issues[0]?.message ?? 'Enter your email' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const result = await api.requestOtp(parsed.data.email);
      setNotice(result.message);
      setStep('code');
      startCooldown();
    } catch (error) {
      setFormError(error instanceof RequestError ? error.message : 'Could not send the code. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    setFormError(null);
    const parsed = otpVerifySchema.safeParse({ email, code });
    if (!parsed.success) {
      setErrors({ code: parsed.error.issues.find((i) => i.path[0] === 'code')?.message ?? 'Enter the 6-digit code' });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await signInWithOtp(parsed.data.email, parsed.data.code);
    } catch (error) {
      setFormError(error instanceof RequestError ? error.message : 'Could not sign in. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      {formError && (
        <Alert tone="err" title="Could not sign in">
          {formError}
        </Alert>
      )}
      {step === 'email' ? (
        <form onSubmit={(e) => void sendCode(e)} className="stack" noValidate>
          <Field label="Email" required error={errors.email}>
            {(props) => <EmailInput inputProps={props} value={email} onChange={setEmail} />}
          </Field>
          <Button type="submit" variant="primary" block loading={busy}>
            Send code
          </Button>
        </form>
      ) : (
        <form onSubmit={(e) => void verifyCode(e)} className="stack" noValidate>
          {notice && (
            <p style={{ fontSize: '12.5px', color: 'var(--text-2)', margin: 0 }}>
              {notice} Sent to <strong>{email}</strong>.
            </p>
          )}
          <Field label="6-digit code" required error={errors.code}>
            {(props) => (
              <input
                {...props}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" block loading={busy} disabled={code.length !== 6}>
            Verify &amp; sign in
          </Button>
          <div className="cluster" style={{ justifyContent: 'space-between' }}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep('email');
                setCode('');
                setNotice(null);
              }}
            >
              Use a different email
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={cooldown > 0 || busy} onClick={() => void sendCode({ preventDefault: () => {} } as React.FormEvent)}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
            </Button>
          </div>
        </form>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        Back to password sign-in
      </Button>
    </div>
  );
}

export function Login(): React.ReactElement {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'password' | 'otp'>('password');
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
  const quickSignIn = async (accountEmail: string, accountPassword: string): Promise<void> => {
    setFormError(null);
    setQuickBusy(accountEmail);
    try {
      await signIn(accountEmail, accountPassword);
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
            Crystal PMS
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

          {mode === 'password' ? (
            <>
              <form onSubmit={submit} className="stack" noValidate>
                {formError && (
                  <Alert tone="err" title="Could not sign in">
                    {formError}
                  </Alert>
                )}

                <Field label="Email" required error={errors.email}>
                  {(props) => <EmailInput inputProps={{ ...props, name: 'email' }} value={email} onChange={setEmail} />}
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
              <Button type="button" variant="ghost" size="sm" onClick={() => setMode('otp')}>
                Sign in with an emailed code instead
              </Button>
            </>
          ) : (
            <OtpSignIn onBack={() => setMode('password')} />
          )}

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
                onClick={() => quickSignIn(ADMIN_ACCOUNT.email, ADMIN_ACCOUNT.password)}
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
