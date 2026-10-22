import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app/AppShell';
import { Icon } from './components/crystal/Icon';
import { useAuth } from './lib/auth';
import type { Screen } from './lib/api';
import { navItemsForUser } from './lib/nav';
import { V2DataProvider } from './lib/v2Store';
import { Login } from './screens/Login';

// Lazy, not eager: every one of these used to ship in the single ~720KB
// bundle every visitor downloaded before the app was even interactive,
// regardless of which one screen they actually opened (flagged directly —
// "too much loading time"; Vite's own build output already warned about a
// chunk over 500KB). Each now becomes its own chunk, fetched only the first
// time its route is actually visited.
const AccessManagement = lazy(() => import('./screens/v2/AccessManagement').then((m) => ({ default: m.AccessManagement })));
const ContainerReport = lazy(() => import('./screens/v2/ContainerReport').then((m) => ({ default: m.ContainerReport })));
const DashboardsV2 = lazy(() => import('./screens/v2/DashboardsV2').then((m) => ({ default: m.DashboardsV2 })));
const Guide = lazy(() => import('./screens/v2/Guide').then((m) => ({ default: m.Guide })));
const Hydra = lazy(() => import('./screens/v2/Hydra').then((m) => ({ default: m.Hydra })));
const ImsStock = lazy(() => import('./screens/v2/ImsStock').then((m) => ({ default: m.ImsStock })));
const LiveBoard = lazy(() => import('./screens/v2/LiveBoard').then((m) => ({ default: m.LiveBoard })));
const WorkerRoster = lazy(() => import('./screens/v2/WorkerRoster').then((m) => ({ default: m.WorkerRoster })));
const YardBoard = lazy(() => import('./screens/v2/YardBoard').then((m) => ({ default: m.YardBoard })));
const YardReport = lazy(() => import('./screens/v2/YardReport').then((m) => ({ default: m.YardReport })));

function Booting(): React.ReactElement {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--bg)',
        color: 'var(--text-2)',
      }}
    >
      <div className="stack" style={{ alignItems: 'center' }}>
        <span className="bootmark" aria-hidden="true">
          <i />
          <span className="bootmark-sweep" />
        </span>
        <p role="status" style={{ fontSize: '12.5px', margin: 0 }}>
          Checking your session…
        </p>
      </div>
    </div>
  );
}

function NotFound(): React.ReactElement {
  return (
    <div className="empty">
      <Icon name="pin" size="xl" />
      <b>That screen does not exist</b>
      <p>The link may be out of date. Everything the app can show is in the sidebar.</p>
      <a className="btn btn-secondary btn-sm" href="/yard">
        Back to Yard Board
      </a>
    </div>
  );
}

/** Guards one route against access management's real permission — renders a
 * screen only when this signed-in user can actually reach it, otherwise
 * sends them to the first screen they *do* have (falling back to the
 * System Guide, always open to everyone) instead of a dead page whose own
 * API calls would just come back 403 anyway. */
function Guarded({ screen, managerOnly, children }: { screen?: Screen; managerOnly?: boolean; children: React.ReactElement }): React.ReactElement {
  const { user, hasScreenAccess } = useAuth();
  const allowed = managerOnly ? user?.role === 'manager' : screen ? hasScreenAccess(screen) : true;
  if (allowed) return children;
  const fallback = navItemsForUser(user)[0]?.to ?? '/guide';
  return <Navigate to={fallback} replace />;
}

export function App(): React.ReactElement {
  const { status } = useAuth();

  if (status === 'loading') return <Booting />;
  if (status === 'signed-out') return <Login />;

  return (
    // Wrapped above AppShell, not inside one of its routes: AppShell keys its
    // <main> by pathname to replay each page's entrance animation, which would
    // otherwise remount this provider (and wipe every timer) on every nav
    // between screens — the shared store needs to outlive that.
    <V2DataProvider>
      <Suspense fallback={<Booting />}>
        <Routes>
          {/* Chrome-free: no sidebar/topbar, so Print captures only the report. */}
          <Route path="/containers/:id/report" element={<ContainerReport />} />
          <Route path="/reports/yard" element={<YardReport />} />
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/live" replace />} />
            <Route path="/yard" element={<Guarded screen="yard"><YardBoard /></Guarded>} />
            <Route path="/live" element={<Guarded screen="live"><LiveBoard /></Guarded>} />
            <Route path="/workers" element={<Guarded screen="workers"><WorkerRoster /></Guarded>} />
            <Route path="/dashboards" element={<Guarded screen="dashboards"><DashboardsV2 /></Guarded>} />
            <Route path="/hydra" element={<Guarded screen="hydra"><Hydra /></Guarded>} />
            <Route path="/ims-stock" element={<Guarded screen="ims-stock"><ImsStock /></Guarded>} />
            <Route path="/access" element={<Guarded managerOnly><AccessManagement /></Guarded>} />
            <Route path="/guide" element={<Guide />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </Suspense>
    </V2DataProvider>
  );
}
