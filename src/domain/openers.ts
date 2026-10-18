// Opener selection: a support act must be less well known than the headliner, and "local" needs a real location signal (SPEC §11).
import { LOCAL_SIGNAL_MIN_DELTA, OPENER_POPULARITY_MARGIN } from './constants.js';
import type { Opener } from './planner.js';

export type Baseline = ReadonlyMap<string, number> | 'unavailable' | null;

/** @param baseline affinity per act with NO location signal; null = this source gives no baseline (acts are taken as city-specific); 'unavailable' = the lookup failed. */
export function selectOpeners(raw: readonly Opener[], headlinerPopularity: number | undefined, baseline: Baseline, take: number): Opener[] {
  const ceiling = typeof headlinerPopularity === 'number' ? headlinerPopularity - OPENER_POPULARITY_MARGIN : Infinity;
  return raw
    .filter((o) => typeof o.popularity !== 'number' || o.popularity <= ceiling)
    .map((o): Opener => {
      let scope: 'local' | 'region' = 'local';
      if (baseline === 'unavailable') scope = 'region';
      else if (baseline) {
        const b = baseline.get(o.id);
        scope = b === undefined || o.affinity - b >= LOCAL_SIGNAL_MIN_DELTA ? 'local' : 'region';
      }
      return { ...o, scope };
    })
    .sort((a, b) => Number(b.scope === 'local') - Number(a.scope === 'local') || b.affinity - a.affinity || a.id.localeCompare(b.id))
    .slice(0, take);
}
