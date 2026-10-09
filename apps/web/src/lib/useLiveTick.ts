import { useEffect, useState } from 'react';

/** Re-renders every second while `active`, so a live elapsed-time display
 * actually ticks without every row owning its own interval. */
export function useLiveTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    // `now` can be stale by however long the drawer sat open with nothing
    // running — resync immediately, don't wait for the first interval tick,
    // or a task started right then briefly shows a negative elapsed time.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}
