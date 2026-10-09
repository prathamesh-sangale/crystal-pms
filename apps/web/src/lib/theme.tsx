import { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type Theme = 'light' | 'dark';

interface ThemeValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeValue | null>(null);
const STORAGE_KEY = 'pms-theme';

function readInitial(): Theme {
  if (typeof document === 'undefined') return 'light';
  const attr = document.documentElement.getAttribute('data-theme');
  return attr === 'dark' ? 'dark' : 'light';
}

/**
 * The entire theme is one attribute on <html>.
 *
 * The design system defines both palettes as token blocks selected by
 * [data-theme], so nothing below this component knows which theme is active
 * and no component carries a dark-mode branch.
 *
 * Light is the default for every visitor, regardless of OS preference — the
 * app does not follow prefers-color-scheme. Dark is opt-in only, via the
 * toggle, and persists once chosen.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(readInitial);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* private mode — the choice lasts for this tab only */
    }
  }, []);

  const value = useMemo<ThemeValue>(
    () => ({ theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }),
    [theme, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
