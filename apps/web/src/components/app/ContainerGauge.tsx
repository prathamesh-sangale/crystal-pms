import { STAGES, isReady, overallProgress, type Container } from '@pms/shared';
import { useId, useMemo } from 'react';
import { cx } from '../../lib/cx';

/*
 * The geometry, in the SVG's own units. The body is the fill track; the
 * machinery unit hangs off the right-hand end and is never filled — filling an
 * irregular silhouette would mean 50% no longer looks like 50%.
 */
const BOX = { w: 104, h: 40 };
const BODY = { x: 1.5, y: 6, w: 74, h: 28, r: 2.5 };
const UNIT = { x: 78, y: 2.5, w: 24, h: 35, r: 2.5 };
const TRACK = { x: BODY.x + 1.2, y: BODY.y + 1.2, w: BODY.w - 2.4, h: BODY.h - 2.4 };

interface GaugeProps {
  container: Container;
  size?: 'sm' | 'md';
  /** Hide the number only where it is already printed alongside. */
  showValue?: boolean;
  className?: string;
}

/**
 * Readiness, drawn as the container itself.
 *
 * One continuous linear fill, so it equals the printed percentage exactly.
 * The ribs are placed at cumulative task counts rather than evenly, so the
 * boundary between two ribs is a real stage boundary and a heavier stage is
 * visibly wider. Where the fill lands therefore reads as the stage, without
 * introducing a second number that could disagree with the first.
 */
export function ContainerGauge({
  container,
  size = 'md',
  showValue = true,
  className,
}: GaugeProps): React.ReactElement {
  // useId returns values containing colons (`:r7:`), which are legal in an
  // `id` attribute but not inside a `url(#…)` reference. Strip them, or the
  // clip path silently fails to resolve and the fill spills past the shell.
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const titleId = `${uid}-t`;
  const clipId = `${uid}-clip`;
  const percent = overallProgress(container);
  const ready = isReady(container);

  const ribs = useMemo(() => {
    const total = container.checklist.length;
    if (!total) return [];
    let seen = 0;
    const positions: number[] = [];
    // One rib per stage boundary — the last stage needs no closing rib, the
    // shell already draws that edge.
    for (const stage of STAGES.slice(0, -1)) {
      seen += container.checklist.filter((t) => t.stage === stage.id).length;
      positions.push(TRACK.x + (seen / total) * TRACK.w);
    }
    return positions;
  }, [container.checklist]);

  // Small enough for a board card, large enough that ten ribs still resolve.
  const width = size === 'sm' ? 78 : 130;
  const height = size === 'sm' ? 30 : 50;
  const label = ready
    ? `${container.id} is ready for release, all ${container.checklist.length} tasks complete`
    : `${container.id} readiness: ${percent} per cent, ${container.checklist.filter((t) => t.done).length} of ${container.checklist.length} tasks complete`;

  return (
    <span className={cx('cgauge', size === 'sm' && 'sm', ready && 'is-ready', className)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${BOX.w} ${BOX.h}`}
        role="img"
        aria-labelledby={titleId}
      >
        <title id={titleId}>{label}</title>

        <clipPath id={clipId}>
          <rect x={TRACK.x} y={TRACK.y} width={TRACK.w} height={TRACK.h} rx={1.5} />
        </clipPath>

        <rect
          className="cg-track"
          x={TRACK.x}
          y={TRACK.y}
          width={TRACK.w}
          height={TRACK.h}
          rx={1.5}
        />
        <rect
          className="cg-fill"
          x={TRACK.x}
          y={TRACK.y}
          width={(TRACK.w * Math.max(0, Math.min(100, percent))) / 100}
          height={TRACK.h}
          clipPath={`url(#${clipId})`}
        />

        <g className="cg-rib" clipPath={`url(#${clipId})`}>
          {ribs.map((x) => (
            <line key={x} x1={x} y1={TRACK.y} x2={x} y2={TRACK.y + TRACK.h} />
          ))}
        </g>

        <rect className="cg-shell" x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} />

        {/* The refrigeration unit. Outline only — it is not part of the track. */}
        <rect className="cg-unit" x={UNIT.x} y={UNIT.y} width={UNIT.w} height={UNIT.h} rx={UNIT.r} />
        <g className="cg-grille">
          <line x1={UNIT.x + 5} y1={UNIT.y + 9} x2={UNIT.x + UNIT.w - 5} y2={UNIT.y + 9} />
          <line x1={UNIT.x + 5} y1={UNIT.y + 15} x2={UNIT.x + UNIT.w - 5} y2={UNIT.y + 15} />
          <line x1={UNIT.x + 5} y1={UNIT.y + 21} x2={UNIT.x + UNIT.w - 5} y2={UNIT.y + 21} />
          <line x1={UNIT.x + 5} y1={UNIT.y + 27} x2={UNIT.x + UNIT.w - 5} y2={UNIT.y + 27} />
        </g>
      </svg>

      {showValue && (
        <span className="cg-value">
          {percent}%
          {/* The graphic is a quantity, never the only carrier of it. */}
        </span>
      )}
    </span>
  );
}
