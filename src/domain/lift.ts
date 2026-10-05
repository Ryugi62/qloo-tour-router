// UC-2: what taste data changed versus the generic plan.
import type { TourPlan } from './planner';

export interface TasteLift {
  readonly jaccard: number;
  readonly added: readonly string[];
  readonly dropped: readonly string[];
  readonly meanAffinityTaste: number;
  readonly meanAffinityGeneric: number;
  readonly kmTaste: number;
  readonly kmGeneric: number;
}
const mean = (p: TourPlan) => (p.stops.length ? p.stops.reduce((a, s) => a + s.city.affinity, 0) / p.stops.length : 0);

export function compareLift(taste: TourPlan, generic: TourPlan): TasteLift {
  const a = new Set(taste.stops.map((s) => s.city.id));
  const b = new Set(generic.stops.map((s) => s.city.id));
  const inter = [...a].filter((x) => b.has(x));
  const union = new Set([...a, ...b]);
  return {
    jaccard: union.size ? inter.length / union.size : 1,
    added: taste.stops.filter((s) => !b.has(s.city.id)).map((s) => s.city.name),
    dropped: generic.stops.filter((s) => !a.has(s.city.id)).map((s) => s.city.name),
    meanAffinityTaste: mean(taste),
    meanAffinityGeneric: mean(generic),
    kmTaste: taste.totalKm,
    kmGeneric: generic.totalKm,
  };
}
