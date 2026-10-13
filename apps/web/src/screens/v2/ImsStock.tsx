import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { api, type ImsMatch } from '../../lib/api';
import { Button, Segmented } from '../../components/crystal/Button';
import { CategoryBadge, StatCard } from '../../components/crystal/Data';
import { Chip, InputWithIcon } from '../../components/crystal/Form';
import { DataTable } from '../../components/crystal/DataTable';
import { EmptyState } from '../../components/crystal/Feedback';
import type { IconName } from '../../components/crystal/Icon';

type DisplayMode = 'cards' | 'list';

const TYPE_ICON: Record<string, IconName> = {
  Dry: 'package',
  Reefer: 'snow',
  'ISO Tank': 'drop',
};

const columnHelper = createColumnHelper<ImsMatch>();

/** Toggles `value` into/out of a Set, immutably — the multi-select building
 * block for the Type/Size filter rows below, since the design system has no
 * multi-select component of its own (see the Chip usage further down). */
function toggled(set: Set<string>, value: string): Set<string> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/**
 * Browse-all-inventory view of IMS's own "Stock" containers at Crystal
 * Yard — the counterpart to the single-container "Check IMS" lookup at
 * Gate-In. Strictly read-only: this screen only ever calls `api.v2ImsStock`
 * (a GET), never writes anything back to IMS, by explicit standing
 * instruction. All filtering (search/type/size) happens client-side on one
 * fetched snapshot, same convention as Yard Board, since the result set is
 * small enough that a server round-trip per filter change isn't worth it.
 */
export function ImsStock(): React.ReactElement {
  const [items, setItems] = useState<ImsMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('cards');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [selectedSizes, setSelectedSizes] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  // Options are derived from what IMS actually returned, not a hardcoded
  // list — IMS's raw Type/Size spellings only ever map onto a subset of this
  // app's own vocabulary (mapType/mapSize in imsLookup.ts), so offering a
  // chip IMS can never produce would just be a dead end.
  const typeOptions = useMemo(
    () => [...new Set(items.map((i) => i.suggestedTypeCode).filter((t): t is string => t !== null))].sort(),
    [items]
  );
  const sizeOptions = useMemo(
    () => [...new Set(items.map((i) => i.suggestedSize).filter((s): s is string => s !== null))].sort(),
    [items]
  );

  const anyFilter = searchQuery.trim() !== '' || selectedTypes.size > 0 || selectedSizes.size > 0;
  const clearFilters = (): void => {
    setSearchQuery('');
    setSelectedTypes(new Set());
    setSelectedSizes(new Set());
  };

  const rows = useMemo(() => {
    const needle = searchQuery.trim().toUpperCase();
    return items.filter((i) => {
      if (needle && !i.containerId.toUpperCase().includes(needle)) return false;
      if (selectedTypes.size > 0 && (!i.suggestedTypeCode || !selectedTypes.has(i.suggestedTypeCode))) return false;
      if (selectedSizes.size > 0 && (!i.suggestedSize || !selectedSizes.has(i.suggestedSize))) return false;
      return true;
    });
  }, [items, searchQuery, selectedTypes, selectedSizes]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('containerId', {
        header: 'Container',
        meta: { label: 'Container', lead: true },
        cell: (ctx) => <span className="mono">{ctx.getValue()}</span>,
      }),
      columnHelper.display({
        id: 'type',
        header: 'Type',
        meta: { label: 'Type' },
        cell: (ctx) => <CategoryBadge>{ctx.row.original.suggestedTypeCode ?? ctx.row.original.imsType}</CategoryBadge>,
      }),
      columnHelper.display({
        id: 'size',
        header: 'Size',
        meta: { label: 'Size' },
        cell: (ctx) => ctx.row.original.suggestedSize ?? ctx.row.original.imsSize,
      }),
      columnHelper.accessor('grade', {
        header: 'Grade',
        meta: { label: 'Grade', secondary: true },
        cell: (ctx) => ctx.getValue() || '—',
      }),
      columnHelper.accessor('location', {
        header: 'Location',
        meta: { label: 'Location', secondary: true },
        cell: (ctx) => ctx.getValue() || '—',
      }),
      columnHelper.accessor('yom', {
        header: 'YOM',
        meta: { label: 'YOM', secondary: true },
        cell: (ctx) => ctx.getValue() || '—',
      }),
      columnHelper.accessor('reeferUnit', {
        header: 'Reefer unit',
        meta: { label: 'Reefer unit', secondary: true },
        cell: (ctx) => ctx.getValue() || '—',
      }),
    ],
    []
  );

  return (
    <div className="stack stack-loose">
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <StatCard label="Available at Crystal Yard" value={loading ? '—' : rows.length} icon="warehouse" />
        <Segmented
          value={displayMode}
          onChange={setDisplayMode}
          label="Display as"
          options={[
            { value: 'cards', label: 'Cards' },
            { value: 'list', label: 'List' },
          ]}
        />
      </div>

      <div
        className="cluster"
        style={{
          gap: 'var(--s-3)',
          flexWrap: 'wrap',
          alignItems: 'center',
          padding: 'var(--s-3)',
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 'var(--r-md)',
        }}
      >
        <InputWithIcon
          icon="search"
          placeholder="Search container number…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: '220px' }}
        />
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

      {loading ? (
        <EmptyState icon="package" title="Loading IMS stock…">
          One moment.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState icon="package" title="Nothing matches">
          {items.length === 0 ? 'IMS has no containers in stock at Crystal Yard right now.' : 'Try a different filter.'}
        </EmptyState>
      ) : displayMode === 'list' ? (
        <DataTable
          data={rows}
          columns={columns}
          getRowId={(i) => i.containerId}
          caption="Available IMS stock at Crystal Yard"
          pageSize={15}
          rowLabel={(i) => i.containerId}
          empty={<EmptyState icon="package" title="Nothing matches">Try a different filter.</EmptyState>}
        />
      ) : (
        // Same CSS multi-column choice as Yard Board's card grid, and for the
        // same reason — card heights vary (a reefer's unit line vs. a dry
        // container with none), and CSS Grid would row-lock them to the
        // tallest card instead of letting each column pack independently.
        <div style={{ columnWidth: '280px', columnGap: 'var(--s-4)' }}>
          {rows.map((i) => (
            <div
              key={i.containerId}
              className="card"
              style={{ breakInside: 'avoid', marginBottom: 'var(--s-4)' }}
            >
              <div className="cluster" style={{ justifyContent: 'space-between' }}>
                <span
                  className="mono"
                  style={{
                    fontWeight: 700,
                    fontSize: '13px',
                    color: 'var(--text)',
                    padding: '3px 8px',
                    background: 'var(--surface)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--r-sm)',
                  }}
                >
                  {i.containerId}
                </span>
                <CategoryBadge>{i.suggestedTypeCode ?? i.imsType}</CategoryBadge>
              </div>
              <div className="cluster" style={{ gap: 'var(--s-2)', margin: 'var(--s-2) 0' }}>
                <span className="subtle" style={{ fontSize: '12.5px' }}>
                  {i.suggestedSize ?? i.imsSize}
                </span>
                {i.grade && (
                  <span className="subtle" style={{ fontSize: '12.5px' }}>
                    · Grade {i.grade}
                  </span>
                )}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-3)', display: 'grid', gap: '4px' }}>
                {i.location && <div>Location: {i.location}</div>}
                {i.yom && <div>YOM: {i.yom}</div>}
                {i.reeferUnit && <div>Reefer unit: {i.reeferUnit}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
