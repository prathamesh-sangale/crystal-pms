import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, setUnauthorizedHandler, token, type Screen, type SessionUser } from './api';

/**
 * The manager role reads as "Admin" everywhere it's shown — the product is
 * moving to a single Admin account (SPEC.md); the other three roles keep
 * their real names since they still work exactly as before.
 */
export function roleDisplayLabel(role: SessionUser['role']): string {
  return role === 'manager' ? 'Admin' : role;
}

type Permission =
  | 'container:read'
  | 'container:create'
  | 'container:update'
  | 'container:advance'
  | 'container:task'
  | 'container:delete';

/**
 * Mirrors the server's permission table so the UI can hide a control the API
 * would refuse. The server is still the authority — this only prevents
 * offering an action that would come back 403.
 */
const PERMISSIONS: Record<SessionUser['role'], Permission[]> = {
  manager: [
    'container:read',
    'container:create',
    'container:update',
    'container:advance',
    'container:task',
    'container:delete',
  ],
  supervisor: [
    'container:read',
    'container:create',
    'container:update',
    'container:advance',
    'container:task',
  ],
  technician: ['container:read', 'container:task'],
  viewer: ['container:read'],
};

interface AuthValue {
  user: SessionUser | null;
  status: 'loading' | 'signed-in' | 'signed-out';
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  /** Self-service password change for whoever's currently signed in -- the
   * server bumps `token_version` on success (so any other open session
   * using the old password stops working), which would also invalidate the
   * token this very call is using, so the fresh one that comes back
   * replaces it here rather than forcing an immediate re-login. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  can: (permission: Permission) => boolean;
  /** Access management's own gate — unrelated to `can` above. `manager`
   * always passes (can never be locked out of their own system); everyone
   * else needs the screen in their admin-granted `allowedScreens`. Mirrored
   * for real server-side by `requireScreen` (apps/api/src/auth.ts) on every
   * route that matters — this only decides what the UI itself offers. */
  hasScreenAccess: (screen: Screen) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const queryClient = useQueryClient();

  // Bumped on every sign-out/sign-in/forced-unauthorized so a slower,
  // already-in-flight call from a *previous* session (the mount-time `me()`
  // check below, or logout's own fire-and-forget request) can tell its
  // result is stale and skip applying it -- otherwise either one landing
  // late could silently resurrect a session the user just explicitly ended,
  // or tear down an unrelated new one that started in the meantime.
  const sessionEpoch = useRef(0);

  const signOut = useCallback(() => {
    sessionEpoch.current += 1;
    // Fire-and-forget, and sent before the token is cleared -- it needs to
    // still be attached to count as this user's own request. silentAuth
    // skips the shared 401 handler: this call's own 401 (expected once the
    // token it's using is no longer valid) must never clear whatever token
    // a next sign-in has set by the time this resolves.
    void api.logout().catch(() => {});
    token.set(null);
    setUser(null);
    setStatus('signed-out');
    queryClient.clear();
  }, [queryClient]);

  // A token that expires mid-session lands here rather than in a failed render.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      sessionEpoch.current += 1;
      setUser(null);
      setStatus('signed-out');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!token.get()) {
      setStatus('signed-out');
      return;
    }
    const epoch = sessionEpoch.current;
    let cancelled = false;
    api
      .me()
      .then(({ user: me }) => {
        if (cancelled || sessionEpoch.current !== epoch) return;
        setUser(me);
        setStatus('signed-in');
      })
      .catch(() => {
        if (cancelled || sessionEpoch.current !== epoch) return;
        token.set(null);
        setStatus('signed-out');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      sessionEpoch.current += 1;
      const result = await api.login(email, password);
      token.set(result.token);
      setUser(result.user);
      setStatus('signed-in');
      await queryClient.invalidateQueries();
    },
    [queryClient]
  );

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const result = await api.changePassword(currentPassword, newPassword);
    token.set(result.token);
    setUser(result.user);
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      signIn,
      signOut,
      changePassword,
      can: (permission) => (user ? PERMISSIONS[user.role].includes(permission) : false),
      hasScreenAccess: (screen) => (user ? user.role === 'manager' || user.allowedScreens.includes(screen) : false),
    }),
    [user, status, signIn, signOut, changePassword]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
