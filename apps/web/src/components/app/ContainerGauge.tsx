import { STAGES, isReady, overallProgress, type Container } from '@pms/shared';
import { useId, useMemo } from 'react';
import { cx } from '../../lib/cx';

/*
 * Geometry, in the SVG's own units. A 40ft container's proportions, and
 * nothing else: no machinery unit, no door furniture. The design system's
 * `i-container` icon is a rounded rectangle with vertical ribs, and this is
 * the same drawing at a different size — one container shape in the system,
 * not two.
 */
const BOX = { w: 96, h: 30 };
const BODY = { x: 1.5, y: 1.5, w: 93, h: 27, r: 3 };
const INSET = 1.5;
const TRACK = {
  x: BODY.x + INSET,
  y: BODY.y + INSET,
  w: BODY.w - INSET * 2,
  h: BODY.h - INSET * 2,
};

const SIZES = {
  sm: { w: 84, h: 26 },
  md: { w: 132, h: 41 },
} as const;

interface GaugeProps {
  container: Container;
  size?: keyof typeof SIZES;
  /** Hide the number only where it is already printed alongside. */
  showValue?: boolean;
  className?: string;
}

/**
 * Readiness, drawn as the container itself.
 *
 * One continuous linear fill, so it equals the printed percentage exactly.
 * The ribs are placed at cumulative task counts rather than evenly, so the
 * span between two ribs is a real stage and a heavier stage is visibly wider.
 * Where the fill lands therefore reads as the stage, without a second number
 * that could disagree with the first.
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
  const done = container.checklist.filter((t) => t.done).length;

  const ribs = useMemo(() => {
    const total = container.checklist.length;
    if (!total) return [];
    let seen = 0;
    const positions: number[] = [];
    // One rib per stage boundary. The last stage needs no closing rib — the
    // shell already draws that edge.
    for (const stage of STAGES.slice(0, -1)) {
      seen += container.checklist.filter((t) => t.stage === stage.id).length;
      positions.push(TRACK.x + (seen / total) * TRACK.w);
    }
    return positions;
  }, [container.checklist]);

  const { w, h } = SIZES[size];
  const label = ready
    ? `${container.id} is ready for release, all ${container.checklist.length} tasks complete`
    : `${container.id} readiness: ${percent} per cent, ${done} of ${container.checklist.length} tasks complete`;

  return (
    <span className={cx('cgauge', size === 'sm' && 'sm', ready && 'is-ready', className)}>
      <svg width={w} height={h} viewBox={`0 0 ${BOX.w} ${BOX.h}`} role="img" aria-labelledby={titleId}>
        <title id={titleId}>{label}</title>

        <clipPath id={clipId}>
          <rect x={TRACK.x} y={TRACK.y} width={TRACK.w} height={TRACK.h} rx={1.6} />
        </clipPath>

        <rect className="cg-track" x={TRACK.x} y={TRACK.y} width={TRACK.w} height={TRACK.h} rx={1.6} />
        <rect
          className="cg-fill"
          x={TRACK.x}
          y={TRACK.y}
          width={(TRACK.w * Math.max(0, Math.min(100, percent))) / 100}
          height={TRACK.h}
          clipPath={`url(#${clipId})`}
        />

        {/* Corrugations, at the real stage boundaries. */}
        <g className="cg-rib" clipPath={`url(#${clipId})`}>
          {ribs.map((x) => (
            <line key={x} x1={x} y1={TRACK.y} x2={x} y2={TRACK.y + TRACK.h} />
          ))}
        </g>

        <rect className="cg-shell" x={BODY.x} y={BODY.y} width={BODY.w} height={BODY.h} rx={BODY.r} />
      </svg>

      {/* The drawing is never the only carrier of the value. */}
      {showValue && <span className="cg-value">{percent}%</span>}
    </span>
  );
}
