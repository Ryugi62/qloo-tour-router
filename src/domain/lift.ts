// UC-2: what taste data changed versus the generic plan.
import { LIFT_MATCH_KM } from './constants.js';
import { haversineKm } from './geo.js';
import type { Stop, TourPlan } from './planner.js';

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
  /** Baseline cities Qloo did not return among its top candidates (rank 0): excluded from the mean rank, counted here. */
  readonly genericNotReturned: number;
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
/** Same market = same id, or closer than LIFT_MATCH_KM (the two plans use different id spaces: Qloo destinations vs Census metros). */
const sameMarket = (a: Stop, b: Stop) => a.city.id === b.city.id || haversineKm(a.city, b.city) < LIFT_MATCH_KM;

export function compareLift(taste: TourPlan, generic: TourPlan): TasteLift {
  const inGeneric = (s: Stop) => generic.stops.some((g) => sameMarket(s, g));
  const inTaste = (s: Stop) => taste.stops.some((t) => sameMarket(s, t));
  const shared = taste.stops.filter(inGeneric).length;
  const unionSize = taste.stops.length + generic.stops.length - shared;
  const tOnly = taste.stops.filter((s) => !inGeneric(s)).map((s) => ({ name: s.city.name, affinity: s.affinity, rank: s.affinityRank }));
  const gOnlyStops = generic.stops.filter((s) => !inTaste(s));
  const gOnly = gOnlyStops.map((s) => ({ name: s.city.name, affinity: s.affinity, rank: s.affinityRank }));
  const gRanked = gOnly.filter((x) => x.rank > 0);
  const tm = avg(tOnly.map((x) => x.affinity));
  const gm = avg(gRanked.map((x) => x.affinity));
  return {
    changed: {
      count: tOnly.length, genericNotReturned: gOnly.length - gRanked.length, tasteOnly: tOnly, genericOnly: gOnly,
      tasteMeanAffinity: tm, genericMeanAffinity: gm, affinityDelta: tm !== null && gm !== null ? tm - gm : null,
      tasteMeanRank: avg(tOnly.map((x) => x.rank)), genericMeanRank: avg(gRanked.map((x) => x.rank)),
    },
    jaccard: unionSize ? shared / unionSize : 1,
    added: taste.stops.filter((s) => !inGeneric(s)).map((s) => s.city.name),
    dropped: gOnlyStops.map((s) => s.city.name),
    meanAffinityTaste: mean(taste),
    meanAffinityGeneric: mean(generic),
    kmTaste: taste.totalKm,
    kmGeneric: generic.totalKm,
  };
}
