import { useNavigate, useParams } from 'react-router-dom';
import { isReadyToMove } from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { ContainerReportContent } from '../../components/v2/ContainerReportContent';
import { Button } from '../../components/crystal/Button';
import { EmptyState } from '../../components/crystal/Feedback';
import { StatusPill } from '../../components/crystal/Data';

/**
 * A dedicated, chrome-free page (no sidebar/topbar — mounted outside
 * AppShell in App.tsx) so the browser's own Print → Save as PDF produces a
 * clean document instead of capturing the app shell around it.
 */
export function ContainerReport(): React.ReactElement {
  const { id } = useParams<{ id: string }>();
  const { containers, workers } = useV2Data();
  const navigate = useNavigate();
  const container = containers.find((c) => c.id === decodeURIComponent(id ?? ''));

  if (!container) {
    return (
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <EmptyState
          icon="pin"
          title="Container not found"
          action={
            <Button variant="secondary" onClick={() => navigate('/yard')}>
              Back to Yard Board
            </Button>
          }
        >
          The link may be out of date.
        </EmptyState>
      </div>
    );
  }

  const isReady = Boolean(container.readyAt) || isReadyToMove(container);

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)' }}>
      <div style={{ maxWidth: '820px', margin: '0 auto', padding: 'var(--s-6) var(--s-5)' }}>
        <div className="cluster report-no-print" style={{ justifyContent: 'space-between', marginBottom: 'var(--s-5)' }}>
          <Button variant="ghost" icon="chev-left" onClick={() => navigate(-1)}>
            Back
          </Button>
          <Button variant="primary" icon="download" onClick={() => window.print()} disabled={!isReady}>
            Print / Save as PDF
          </Button>
        </div>
        {!isReady && (
          <div className="report-no-print" style={{ marginBottom: 'var(--s-5)' }}>
            <StatusPill
              status={{
                tone: 'warn',
                icon: 'alert',
                label: 'Not ready to move yet',
                detail: 'The report is meant to be generated once work is finished.',
              }}
            />
          </div>
        )}
        <ContainerReportContent container={container} workers={workers} />
      </div>
    </div>
  );
}
