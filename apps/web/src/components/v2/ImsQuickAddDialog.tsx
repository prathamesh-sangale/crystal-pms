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
import { Chip, InputWithIcon } from '../crystal/Form';
import type { IconName } from '../crystal/Icon';
import { Modal } from '../crystal/Overlay';

// Same small, screen-local pieces ImsStock.tsx keeps for its own Type/Size
// filter row -- not worth sharing a four-line pure function and a three-entry
// lookup table across two files for this.
const TYPE_ICON: Record<string, IconName> = {
  Dry: 'package',
  Reefer: 'snow',
  'ISO Tank': 'drop',
};

/** Toggles `value` into/out of a Set, immutably. */
function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * A quick, search-first way to gate in a container IMS already knows about,
 * droppable onto any screen (Yard Board, by direct request) without sending
 * the admin over to the full IMS Stock page first. One click, nothing
 * asked — an IMS-known container never goes through the full Gate-In form
 * at all, by direct request (that's exclusively for a genuinely new arrival
 * not yet in IMS). A survey can still be run on it afterward, any time, via
 * "Run survey" in its own detail drawer — the two are separate actions now,
 * not one combined "Add & survey" form.
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
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());
  const [quickAddingId, setQuickAddingId] = useState<string | null>(null);

  const navigate = useNavigate();
  const { user } = useAuth();
  const { containers, gateIn } = useV2Data();
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

  // Options are derived from what IMS actually returned, not a hardcoded
  // list -- same reasoning as ImsStock.tsx's own typeOptions/sizeOptions:
  // IMS's raw Type/Size spellings only ever map onto a subset of this app's
  // own vocabulary, so a chip IMS can never produce would just be dead.
  const typeOptions = useMemo(
    () => [...new Set(items.map((i) => i.suggestedTypeCode).filter((t): t is string => t !== null))].sort(),
    [items]
  );
  const sizeOptions = useMemo(
    () => [...new Set(items.map((i) => i.suggestedSize).filter((s): s is string => s !== null))].sort(),
    [items]
  );
  const anyFilter = query.trim() !== '' || selectedTypes.size > 0 || selectedSizes.size > 0;
  const clearFilters = (): void => {
    setQuery('');
    setSelectedTypes(new Set());
    setSelectedSizes(new Set());
  };

  const rows = useMemo(() => {
    const needle = query.trim().toUpperCase();
    return items.filter((i) => {
      if (needle && !i.containerId.toUpperCase().includes(needle)) return false;
      if (selectedTypes.size > 0 && (!i.suggestedTypeCode || !selectedTypes.has(i.suggestedTypeCode))) return false;
      if (selectedSizes.size > 0 && (!i.suggestedSize || !selectedSizes.has(i.suggestedSize))) return false;
      return true;
    });
  }, [items, query, selectedTypes, selectedSizes]);

  const handleGateIn = useCallback(
    async (container: MockContainer): Promise<void> => {
      await gateIn(container);
      toast.ok('Container registered', `${container.id} is ready to move.`);
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
    <Modal open={open} onOpenChange={onOpenChange} title="Add from IMS" size="lg">
      <div className="stack">
        <InputWithIcon
          icon="search"
          placeholder="Search container number…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {(typeOptions.length > 0 || sizeOptions.length > 0) && (
          <div className="cluster" style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'center' }}>
            {typeOptions.length > 0 && (
              <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                <span className="subtle" style={{ fontSize: '12px' }}>
                  Type
                </span>
                {typeOptions.map((type) => (
                  <Chip
                    key={type}
                    pressed={selectedTypes.has(type)}
                    onClick={() => setSelectedTypes(toggled(selectedTypes, type))}
                    icon={TYPE_ICON[type]}
                  >
                    {type}
                  </Chip>
                ))}
              </span>
            )}
            {sizeOptions.length > 0 && (
              <span className="cluster" style={{ gap: 'var(--s-2)' }}>
                <span className="subtle" style={{ fontSize: '12px' }}>
                  Size
                </span>
                {sizeOptions.map((size) => (
                  <Chip key={size} pressed={selectedSizes.has(size)} onClick={() => setSelectedSizes(toggled(selectedSizes, size))}>
                    {size}
                  </Chip>
                ))}
              </span>
            )}
            {anyFilter && (
              <Button variant="ghost" size="sm" icon="x" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>
        )}
        {loading ? (
          <EmptyState icon="package" title="Loading IMS stock…">
            One moment.
          </EmptyState>
        ) : rows.length === 0 ? (
          <EmptyState icon="package" title="Nothing matches">
            {items.length === 0 ? 'IMS has no containers in stock at Crystal Yard right now.' : 'Try a different search or filter.'}
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
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
