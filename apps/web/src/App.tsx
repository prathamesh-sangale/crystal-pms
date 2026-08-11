import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/app/AppShell';
import { Icon } from './components/crystal/Icon';
import { useAuth } from './lib/auth';
import { ChecklistLibrary } from './screens/ChecklistLibrary';
import { Dashboard } from './screens/Dashboard';
import { Delayed } from './screens/Delayed';
import { DepotCommand } from './screens/DepotCommand';
import { Fleet } from './screens/Fleet';
import { Login } from './screens/Login';
import { Pipeline } from './screens/Pipeline';
import { Timeline } from './screens/Timeline';
import { Tomorrow } from './screens/Tomorrow';

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
      <a className="btn btn-secondary btn-sm" href="/depot">
        Back to Depot Command
      </a>
    </div>
  );
}

export function App(): React.ReactElement {
  const { status } = useAuth();

  if (status === 'loading') return <Booting />;
  if (status === 'signed-out') return <Login />;

  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/depot" replace />} />
        <Route path="/depot" element={<DepotCommand />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tomorrow" element={<Tomorrow />} />
        <Route path="/pipeline" element={<Pipeline />} />
        <Route path="/timeline" element={<Timeline />} />
        <Route path="/fleet" element={<Fleet />} />
        <Route path="/checklist" element={<ChecklistLibrary />} />
        <Route path="/delayed" element={<Delayed />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
