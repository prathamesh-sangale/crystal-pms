import * as Tooltip from '@radix-ui/react-tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ToastProvider } from './components/crystal/Feedback';
import { AuthProvider } from './lib/auth';
import { ThemeProvider } from './lib/theme';
import { DevLogs } from './screens/dev/DevLogs';

// Order matters: the token blocks must load before anything that reads them,
// and app.css last so its two body overrides win.
import './styles/tokens.css';
import './styles/crystal.css';
import './styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Depot data changes as people work, but not second to second.
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => {
        // Never retry a rejection the server meant — only transport failures.
        const status = (error as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

// Checked here, above every provider, rather than inside App(): reached only
// by typing this exact URL (never an in-app navigation), so a plain
// window.location check on initial render is enough, and it keeps this path
// from ever mounting AuthProvider -- which fires a real /api/auth/me call
// with the normal user's own bearer token, if one happens to be sitting in
// localStorage, the moment it mounts. ThemeProvider is still wrapped around
// it for the page's CSS variables; it makes no network calls of its own.
const isDevLogs = window.location.pathname.startsWith('/dev/logs');

createRoot(root).render(
  <StrictMode>
    <ThemeProvider>
      {isDevLogs ? (
        <DevLogs />
      ) : (
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Tooltip.Provider delayDuration={300} skipDelayDuration={300}>
              <ToastProvider>
                <BrowserRouter>
                  <App />
                </BrowserRouter>
              </ToastProvider>
            </Tooltip.Provider>
          </AuthProvider>
        </QueryClientProvider>
      )}
    </ThemeProvider>
  </StrictMode>
);
