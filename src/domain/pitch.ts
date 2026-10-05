// UC-3: pitch drafted only from evidence in the plan (no invented numbers, no sales claims).
import type { CandidateCity, TourPlan, Venue } from './planner';

export interface Artist { readonly id: string; readonly name: string }
/** Venues below this affinity are not presented as a fit (mock round 1: 0.31 was called "fits"). */
export const VENUE_FIT_MIN = 0.5;

export const fittingVenue = (c: CandidateCity): Venue | null => {
  const v = [...(c.venues ?? [])].sort((a, b) => b.affinity - a.affinity)[0];
  return v && v.affinity >= VENUE_FIT_MIN ? v : null;
};

/** One short email per city — promoters are city-specific. */
export function draftCityPitch(artist: Artist, plan: TourPlan, cityId: string): string {
  const i = plan.stops.findIndex((s) => s.city.id === cityId);
  if (i < 0) return '';
  const s = plan.stops[i];
  const v = fittingVenue(s.city);
  const acts = s.city.openers?.slice(0, 2).map((a) => a.name) ?? [];
  return [
    `Subject: ${artist.name} — ${s.city.name.split(',')[0]} date on a ${plan.stops.length}-city run`,
    ``,
    `Hi — I'm booking ${artist.name}'s ${plan.stops.length}-city run and ${s.city.name.split(',')[0]} is stop ${i + 1}.`,
    `Taste data puts this city at #${s.affinityRank} of the markets we checked for ${artist.name}'s audience (affinity ${s.affinity.toFixed(2)}).`,
    v ? `${v.name} looks like the right room for that crowd (venue affinity ${v.affinity.toFixed(2)}).` : `We haven't found a room with a strong audience match yet — open to your suggestion.`,
    acts.length ? `Local acts whose fans overlap: ${acts.join(', ')} — possible openers.` : ``,
    `Affinity measures audience taste overlap, not a sales forecast. Would a date in your calendar work?`,
  ].filter((l) => l !== ``).join('\n');
}

export function draftPitch(artist: Artist, plan: TourPlan): string {
  const top = [...plan.stops].sort((a, b) => a.affinityRank - b.affinityRank).slice(0, 3);
  return [
    `${artist.name} — ${plan.stops.length}-city routing (${Math.round(plan.totalKm)} km).`,
    `Route: ${plan.stops.map((s) => `${s.city.name.split(',')[0]} (#${s.affinityRank})`).join(' → ')}.`,
    `Strongest audience markets on this run: ${top.map((s) => `${s.city.name} (#${s.affinityRank}, affinity ${s.affinity.toFixed(2)})`).join('; ')}.`,
    `Affinity measures audience taste overlap, not a sales forecast.`,
  ].join('\n');
}
