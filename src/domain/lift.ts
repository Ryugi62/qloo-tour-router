// UC-2: what taste data changed versus the generic plan.
import type { TourPlan } from './planner.js';

export interface TasteLift {
  readonly jaccard: number;
  readonly added: readonly string[];
  readonly dropped: readonly string[];
  readonly meanAffinityTaste: number;
  readonly meanAffinityGeneric: number;
  readonly kmTaste: number;
  readonly kmGeneric: number;
  /** Only the cities that differ between the two plans (SPEC S13). */
  readonly changed: ChangedCities;
}
export interface ChangedCities {
  readonly count: number;
  readonly tasteOnly: readonly { readonly name: string; readonly affinity: number; readonly rank: number }[];
  readonly genericOnly: readonly { readonly name: string; readonly affinity: number; readonly rank: number }[];
  readonly tasteMeanAffinity: number | null;
  readonly genericMeanAffinity: number | null;
  readonly affinityDelta: number | null;
  readonly tasteMeanRank: number | null;
  readonly genericMeanRank: number | null;
}
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const mean = (p: TourPlan) => (p.stops.length ? p.stops.reduce((a, s) => a + s.city.affinity, 0) / p.stops.length : 0);

export function compareLift(taste: TourPlan, generic: TourPlan): TasteLift {
  const a = new Set(taste.stops.map((s) => s.city.id));
  const b = new Set(generic.stops.map((s) => s.city.id));
  const inter = [...a].filter((x) => b.has(x));
  const union = new Set([...a, ...b]);
  const tOnly = taste.stops.filter((s) => !b.has(s.city.id)).map((s) => ({ name: s.city.name, affinity: s.affinity, rank: s.affinityRank }));
  const gOnly = generic.stops.filter((s) => !a.has(s.city.id)).map((s) => ({ name: s.city.name, affinity: s.affinity, rank: s.affinityRank }));
  const tm = avg(tOnly.map((x) => x.affinity));
  const gm = avg(gOnly.map((x) => x.affinity));
  return {
    changed: {
      count: tOnly.length, tasteOnly: tOnly, genericOnly: gOnly,
      tasteMeanAffinity: tm, genericMeanAffinity: gm, affinityDelta: tm !== null && gm !== null ? tm - gm : null,
      tasteMeanRank: avg(tOnly.map((x) => x.rank)), genericMeanRank: avg(gOnly.map((x) => x.rank)),
    },
    jaccard: union.size ? inter.length / union.size : 1,
    added: taste.stops.filter((s) => !b.has(s.city.id)).map((s) => s.city.name),
    dropped: generic.stops.filter((s) => !a.has(s.city.id)).map((s) => s.city.name),
    meanAffinityTaste: mean(taste),
    meanAffinityGeneric: mean(generic),
    kmTaste: taste.totalKm,
    kmGeneric: generic.totalKm,
  };
}
