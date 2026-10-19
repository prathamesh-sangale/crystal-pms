import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ImsMatch } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { buildQuickAddContainer } from '../../lib/imsQuickAdd';
import type { MockContainer } from '../../lib/mockV2';
import { useV2Data } from '../../lib/v2Store';
import { useToast } from '../crystal/Feedback';
import { Button } from '../crystal/Button';
import { CategoryBadge } from '../crystal/Data';
import { EmptyState } from '../crystal/Feedback';
import { InputWithIcon } from '../crystal/Form';
import { Modal } from '../crystal/Overlay';
import { GateFormDialog } from './GateFormDialog';

/**
 * A quick, search-first way to gate in a container IMS already knows about,
 * droppable onto any screen (Yard Board, by direct request) without sending
 * the admin over to the full IMS Stock page first. Same two actions IMS
 * Stock itself offers per item — "Add to yard" (one click, nothing asked)
 * and "Add & survey" (the trimmed Gate-In form) — just in a compact list
 * instead of a full card/filter grid, since the point here is speed: find
 * the one container you're after and go.
 */
export function ImsQuickAddDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const [items, setItems] = useState<ImsMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [quickAddingId, setQuickAddingId] = useState<string | null>(null);
  const [surveyId, setSurveyId] = useState<string | null>(null);

  const navigate = useNavigate();
  const { user } = useAuth();
  const { containers, gateIn, saveDraft, discardDraft } = useV2Data();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    api
      .v2ImsStock()
      .then(({ items: fetched }) => {
        if (!cancelled) setItems(fetched);
      })
      .catch((err: unknown) => console.error('Failed to load IMS stock:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const activeIds = useMemo(() => new Set(containers.map((c) => c.id)), [containers]);

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    if (!needle) return items;
    return items.filter((i) => i.containerId.toUpperCase().includes(needle));
  }, [items, query]);

  const handleGateIn = useCallback(
    async (container: MockContainer): Promise<void> => {
      await gateIn(container);
      toast.ok('Container registered', `${container.id} ${container.sections.length ? `has ${container.sections.length} section(s) open.` : 'is ready to move.'}`);
      onOpenChange(false);
      navigate('/yard');
    },
    [gateIn, navigate, onOpenChange, toast]
  );

  const handleQuickAdd = useCallback(
    async (item: ImsMatch): Promise<void> => {
      const container = buildQuickAddContainer(item, user?.email ?? '');
      if (!container) return;
      setQuickAddingId(item.containerId);
      try {
        await handleGateIn(container);
      } catch (err) {
        toast.error('Could not add to yard', err instanceof Error ? err.message : 'Try again.');
      } finally {
        setQuickAddingId(null);
      }
    },
    [handleGateIn, toast, user?.email]
  );

  return (
    <>
      <Modal open={open} onOpenChange={onOpenChange} title="Add from IMS" size="lg">
        <div className="stack">
          <InputWithIcon
            icon="search"
            placeholder="Search container number…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {loading ? (
            <EmptyState icon="package" title="Loading IMS stock…">
              One moment.
            </EmptyState>
          ) : rows.length === 0 ? (
            <EmptyState icon="package" title="Nothing matches">
              {items.length === 0 ? 'IMS has no containers in stock at Crystal Yard right now.' : 'Try a different search.'}
            </EmptyState>
          ) : (
            <div className="stack stack-tight" style={{ maxHeight: '420px', overflowY: 'auto' }}>
              {rows.map((i) => {
                const already = activeIds.has(i.containerId);
                return (
                  <div
                    key={i.containerId}
                    className="cluster"
                    style={{ justifyContent: 'space-between', padding: 'var(--s-2) 0', borderBottom: '1px solid var(--line)' }}
                  >
                    <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                      <span className="mono" style={{ fontWeight: 700, fontSize: '13px' }}>
                        {i.containerId}
                      </span>
                      <CategoryBadge>{i.suggestedTypeCode ?? i.imsType}</CategoryBadge>
                      <span className="subtle" style={{ fontSize: '12.5px' }}>
                        {i.suggestedSize ?? i.imsSize}
                      </span>
                    </span>
                    {already ? (
                      <Button variant="secondary" size="sm" icon="check" disabled>
                        Already in yard
                      </Button>
                    ) : (
                      <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon="plus"
                          disabled={!i.suggestedTypeCode || !i.suggestedSize || quickAddingId !== null}
                          loading={quickAddingId === i.containerId}
                          onClick={() => void handleQuickAdd(i)}
                        >
                          Add to yard
                        </Button>
                        <Button variant="ghost" size="sm" icon="doc" disabled={quickAddingId !== null} onClick={() => setSurveyId(i.containerId)}>
                          Add &amp; survey
                        </Button>
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Modal>

      <GateFormDialog
        mode="in"
        open={surveyId !== null}
        onOpenChange={(next) => {
          if (!next) setSurveyId(null);
        }}
        prefillId={surveyId}
        fast
        onGateIn={handleGateIn}
        existingIds={[...activeIds]}
        onSaveDraft={saveDraft}
        onDiscardDraft={discardDraft}
        loggedInEmail={user?.email}
      />
    </>
  );
}
