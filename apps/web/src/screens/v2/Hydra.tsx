import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useMemo, useState } from 'react';
import { api, type HydraMovement } from '../../lib/api';
import { Button, Segmented } from '../../components/crystal/Button';
import { DataTable } from '../../components/crystal/DataTable';
import { EmptyState, useToast } from '../../components/crystal/Feedback';
import { Field } from '../../components/crystal/Form';
import { Icon } from '../../components/crystal/Icon';

/** Hydra's own Type/Size lists — deliberately not the main app's trimmed
 * TYPE_CODES/SIZE_OPTIONS. Hydra is an independent movement log, not part
 * of the reefer-intake workflow, and its own source spec names this exact
 * set (including Machine/Other, which the main app's list doesn't have). */
const HYDRA_TYPES = ['Dry', 'Reefer', 'ISO Tank', 'Porta Cabin', 'Machine', 'Other'];
const HYDRA_SIZES = ['10 Feet', '20 Feet', '40 Feet', 'Other'];
const MOVEMENT_TYPES = ['Loading', 'Unloading', 'Shifting'] as const;

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_DRAFT = {
  movementDate: today(),
  containerNo: '',
  type: HYDRA_TYPES[0]!,
  size: HYDRA_SIZES[0]!,
  movementType: 'Loading' as (typeof MOVEMENT_TYPES)[number],
  direction: 'IN' as 'IN' | 'OUT',
  file: null as File | null,
};

const helper = createColumnHelper<HydraMovement>();

export function Hydra(): React.ReactElement {
  const [view, setView] = useState<'log' | 'reports'>('log');
  const [movements, setMovements] = useState<HydraMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [month, setMonth] = useState('');
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    api
      .hydraMovements()
      .then(({ movements: fetched }) => {
        if (!cancelled) setMovements(fetched);
      })
      .catch((err: unknown) => console.error('Failed to load Hydra movements:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isShifting = draft.movementType === 'Shifting';

  const handleSubmit = async (): Promise<void> => {
    if (!draft.containerNo.trim()) return;
    setSubmitting(true);
    try {
      let fileId: string | null = null;
      let fileUrl: string | null = null;
      if (draft.file) {
        const uploaded = await api.v2Upload(draft.file);
        fileId = uploaded.id;
        fileUrl = uploaded.url;
      }
      const { movement } = await api.hydraCreateMovement({
        movementDate: draft.movementDate,
        containerNo: draft.containerNo.trim(),
        type: draft.type,
        size: draft.size,
        movementType: draft.movementType,
        direction: isShifting ? null : draft.direction,
        fileId,
        fileUrl,
      });
      setMovements((cur) => [movement, ...cur]);
      toast.ok('Movement logged', `${movement.containerNo} — ${movement.movementType}.`);
      setDraft({ ...EMPTY_DRAFT, movementDate: today() });
    } catch {
      toast.error('Could not save this movement', 'Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredMovements = useMemo(
    () => (month ? movements.filter((m) => m.movementDate.startsWith(month)) : movements),
    [movements, month]
  );

  const exportCsv = (): void => {
    const header = ['Date', 'Container No', 'Type', 'Size', 'Movement Type', 'Direction', 'Logged By', 'File'];
    const rows = filteredMovements.map((m) => [
      m.movementDate,
      m.containerNo,
      m.type,
      m.size,
      m.movementType,
      m.direction ?? 'N/A',
      m.loggedBy ?? '',
      m.fileUrl ?? '',
    ]);
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hydra-movements${month ? `-${month}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const columns = useMemo(
    () => [
      helper.accessor('movementDate', { header: 'Date', meta: { label: 'Date', lead: true } }),
      helper.accessor('containerNo', { header: 'Container No', meta: { label: 'Container No' }, cell: (ctx) => <span className="mono">{ctx.getValue()}</span> }),
      helper.accessor('type', { header: 'Type', meta: { label: 'Type', secondary: true } }),
      helper.accessor('size', { header: 'Size', meta: { label: 'Size', secondary: true } }),
      helper.accessor('movementType', { header: 'Movement', meta: { label: 'Movement' } }),
      helper.accessor('direction', { header: 'In/Out', meta: { label: 'In/Out' }, cell: (ctx) => ctx.getValue() ?? 'N/A' }),
      helper.display({
        id: 'file',
        header: 'File',
        meta: { label: 'File', secondary: true },
        cell: (ctx) =>
          ctx.row.original.fileUrl ? (
            <a href={ctx.row.original.fileUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              <Icon name="external" size="sm" />
              View
            </a>
          ) : (
            <span className="subtle">—</span>
          ),
      }),
    ],
    []
  );

  return (
    <div className="stack stack-loose">
      <div className="cluster" style={{ justifyContent: 'space-between' }}>
        <Segmented
          value={view}
          onChange={setView}
          label="Hydra view"
          options={[
            { value: 'log', label: 'Log Movement', icon: 'plus' },
            { value: 'reports', label: 'Reports', icon: 'doc' },
          ]}
        />
      </div>

      {view === 'log' ? (
        <div className="card" style={{ maxWidth: '560px' }}>
          <div className="stack">
            <Field label="Date" required>
              {(props) => <input {...props} type="date" value={draft.movementDate} onChange={(e) => setDraft((d) => ({ ...d, movementDate: e.target.value }))} />}
            </Field>
            <Field label="Container No." required>
              {(props) => (
                <input
                  {...props}
                  value={draft.containerNo}
                  onChange={(e) => setDraft((d) => ({ ...d, containerNo: e.target.value }))}
                  placeholder="Enter container number"
                  autoComplete="off"
                  spellCheck={false}
                />
              )}
            </Field>
            <Field label="Type" required>
              {(props) => (
                <select {...props} value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
                  {HYDRA_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
            </Field>
            <Field label="Size" required>
              {(props) => (
                <select {...props} value={draft.size} onChange={(e) => setDraft((d) => ({ ...d, size: e.target.value }))}>
                  {HYDRA_SIZES.map((s) => <option key={s}>{s}</option>)}
                </select>
              )}
            </Field>
            <Field label="Movement Type" required>
              {(props) => (
                <select
                  {...props}
                  value={draft.movementType}
                  onChange={(e) => setDraft((d) => ({ ...d, movementType: e.target.value as typeof d.movementType }))}
                >
                  {MOVEMENT_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              )}
            </Field>
            <Field label="IN / OUT" hint={isShifting ? 'Not applicable for Shifting.' : undefined}>
              {() =>
                isShifting ? (
                  <span className="subtle" style={{ fontSize: '12.5px' }}>N/A — shifting within the yard</span>
                ) : (
                  <Segmented
                    value={draft.direction}
                    onChange={(v) => setDraft((d) => ({ ...d, direction: v }))}
                    label="In or out"
                    options={[
                      { value: 'IN', label: 'IN' },
                      { value: 'OUT', label: 'OUT' },
                    ]}
                  />
                )
              }
            </Field>
            <Field label="Upload Document/Image" hint={draft.file?.name ?? 'Optional — no file chosen'}>
              {(props) => (
                <input
                  {...props}
                  type="file"
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={(e) => setDraft((d) => ({ ...d, file: e.target.files?.[0] ?? null }))}
                />
              )}
            </Field>
            <Button variant="primary" icon="check-circle" onClick={handleSubmit} loading={submitting} disabled={!draft.containerNo.trim()}>
              Submit
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="cluster" style={{ justifyContent: 'space-between', gap: 'var(--s-2)' }}>
            <div className="cluster" style={{ gap: 'var(--s-2)' }}>
              <input className="input" type="month" style={{ width: 'auto', height: '36px' }} value={month} onChange={(e) => setMonth(e.target.value)} />
              {month && (
                <Button variant="ghost" size="sm" onClick={() => setMonth('')}>
                  Clear filter
                </Button>
              )}
            </div>
            <Button variant="secondary" size="sm" icon="download" onClick={exportCsv} disabled={filteredMovements.length === 0}>
              Export CSV
            </Button>
          </div>

          {loading ? (
            <EmptyState icon="truck" title="Loading movements…">One moment.</EmptyState>
          ) : (
            <DataTable
              data={filteredMovements}
              columns={columns}
              getRowId={(m) => m.id}
              caption="Hydra movement log"
              pageSize={15}
              rowLabel={(m) => `${m.containerNo}, ${m.movementType}`}
              empty={<EmptyState icon="truck" title="No movements logged">{month ? 'Nothing for this month — try clearing the filter.' : 'Log one from the Log Movement tab.'}</EmptyState>}
            />
          )}
        </div>
      )}
    </div>
  );
}
