// Copied from inara-next lib/ile/hotspot.ts @ 85883f1f9ce9 by scripts/sync-inara-player.mjs.
// Don't edit: re-run the script to update.
// @ts-nocheck
/**
 * Find-the-hidden-spots hit test: the hidden spot nearest to a click, if the click landed
 * within `radiusPx` of it. Spot positions are percentages of the rendered image.
 */
export function nearestHiddenSpot<T extends { id: string; x: number; y: number }>(
  spots: readonly T[],
  found: ReadonlySet<string>,
  click: { x: number; y: number },
  size: { width: number; height: number },
  radiusPx: number,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;
  for (const spot of spots) {
    if (found.has(spot.id)) continue;
    const d = Math.hypot((spot.x / 100) * size.width - click.x, (spot.y / 100) * size.height - click.y);
    if (d <= radiusPx && d < bestDistance) {
      best = spot;
      bestDistance = d;
    }
  }
  return best;
}
