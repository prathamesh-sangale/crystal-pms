import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app/AppShell';
import { Icon } from './components/crystal/Icon';
import { useAuth } from './lib/auth';
import { V2DataProvider } from './lib/v2Store';
import { Login } from './screens/Login';
import { ContainerReport } from './screens/v2/ContainerReport';
import { DashboardsV2 } from './screens/v2/DashboardsV2';
import { Hydra } from './screens/v2/Hydra';
import { LiveBoard } from './screens/v2/LiveBoard';
import { WorkerRoster } from './screens/v2/WorkerRoster';
import { YardBoard } from './screens/v2/YardBoard';
import { YardReport } from './screens/v2/YardReport';

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
        <div className="ring" aria-hidden="true" />
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
      <Routes>
        {/* Chrome-free: no sidebar/topbar, so Print captures only the report. */}
        <Route path="/containers/:id/report" element={<ContainerReport />} />
        <Route path="/reports/yard" element={<YardReport />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/live" replace />} />
          <Route path="/yard" element={<YardBoard />} />
          <Route path="/live" element={<LiveBoard />} />
          <Route path="/workers" element={<WorkerRoster />} />
          <Route path="/dashboards" element={<DashboardsV2 />} />
          <Route path="/hydra" element={<Hydra />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </V2DataProvider>
  );
}
