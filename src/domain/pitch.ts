// UC-3: promoter pitch drafted only from evidence in the plan (no invented numbers, no sales claims).
import type { TourPlan } from './planner';

export interface Artist { readonly id: string; readonly name: string }

export function draftPitch(artist: Artist, plan: TourPlan): string {
  const lines = plan.stops.map((s, i) => {
    const v = s.city.venues?.[0];
    const venue = v ? ` — room that fits this audience: ${v.name} (venue affinity ${v.affinity.toFixed(2)})` : '';
    return `${i + 1}. ${s.city.name}: audience affinity ${s.affinity.toFixed(2)}, #${s.affinityRank} of the cities we checked${venue}`;
  });
  return [
    `Hi — I'm routing ${artist.name} through ${plan.stops.length} cities (${Math.round(plan.totalKm)} km total).`,
    `We picked these markets because taste data shows ${artist.name}'s audience is concentrated there:`,
    ...lines,
    `Affinity is a measure of audience taste overlap, not a sales forecast. Happy to share the full breakdown.`,
  ].join('\n');
}
