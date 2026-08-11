import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setUnauthorizedHandler, token, type SessionUser } from './api';

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
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const queryClient = useQueryClient();

  const signOut = useCallback(() => {
    token.set(null);
    setUser(null);
    setStatus('signed-out');
    queryClient.clear();
  }, [queryClient]);

  // A token that expires mid-session lands here rather than in a failed render.
  useEffect(() => {
    setUnauthorizedHandler(() => {
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
    let cancelled = false;
    api
      .me()
      .then(({ user: me }) => {
        if (cancelled) return;
        setUser(me);
        setStatus('signed-in');
      })
      .catch(() => {
        if (cancelled) return;
        token.set(null);
        setStatus('signed-out');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password);
      token.set(result.token);
      setUser(result.user);
      setStatus('signed-in');
      await queryClient.invalidateQueries();
    },
    [queryClient]
  );

  const value = useMemo<AuthValue>(
    () => ({
      user,
      status,
      signIn,
      signOut,
      can: (permission) => (user ? PERMISSIONS[user.role].includes(permission) : false),
    }),
    [user, status, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
