// Application: UC-1..UC-3 orchestrated over a TastePort. No HTTP/framework imports.
import type { LatLon } from '../domain/geo.js';
import { compareLift, type TasteLift } from '../domain/lift.js';
import { classifyVenues } from '../domain/venue.js';
import { OPENER_COMMON_SHARE } from '../domain/constants.js';
import { draftCityPitch, draftPitch, type Artist } from '../domain/pitch.js';
import { planGeneric, planTour, type CandidateCity, type TourPlan, type Venue } from '../domain/planner.js';

export interface TastePort {
  readonly mode: 'live' | 'sample';
  searchArtist(name: string): Promise<Artist | null>;
  rankCities(artist: Artist, take: number): Promise<CandidateCity[]>;
  venuesNear(artist: Artist, city: CandidateCity, take: number): Promise<Venue[]>;
  /** Artists with overlapping fans that over-index near the city (cross-entity taste). */
  openersNear(artist: Artist, city: CandidateCity, take: number): Promise<{ id: string; name: string; affinity: number }[]>;
}

export interface RouteTourInput {
  readonly artistName: string;
  readonly home: LatLon;
  readonly stops?: number;
  readonly maxLegKm?: number;
  readonly mustInclude?: readonly string[];
  readonly exclude?: readonly string[];
}
export interface RouteTourResult {
  readonly dataMode: 'live' | 'sample';
  readonly artist: Artist;
  readonly taste: TourPlan;
  readonly generic: TourPlan;
  readonly lift: TasteLift;
  readonly pitch: string;
  readonly cityPitches: Readonly<Record<string, string>>;
  /** Acts Qloo returned for most stops: shown as region-wide, not as local openers (SPEC S11). */
  readonly regionWideOpeners: readonly string[];
  /** Calls that failed; the plan is still complete without them (SPEC S12). */
  readonly degraded: readonly string[];
}

export class ArtistNotFound extends Error {}

export async function routeTour(port: TastePort, input: RouteTourInput): Promise<RouteTourResult> {
  const artist = await port.searchArtist(input.artistName);
  if (!artist) throw new ArtistNotFound(`No artist found for "${input.artistName}"`);
  const req = { stops: input.stops ?? 8, maxLegKm: input.maxLegKm ?? 650, home: input.home, mustInclude: input.mustInclude };
  const candidates = (await port.rankCities(artist, 30)).filter((c) => !input.exclude?.includes(c.id));
  const first = planTour(candidates, req);
  // Enrich only the chosen stops with venues (bounded API usage), then re-plan with venues attached.
  const degraded: string[] = [];
  const rawVenues = new Map<string, Venue[]>();
  const rawOpeners = new Map<string, { id: string; name: string; affinity: number }[]>();
  for (const s of first.stops) {
    const label = s.city.name.split(',')[0];
    try { rawVenues.set(s.city.id, await port.venuesNear(artist, s.city, 10)); }
    catch (e) { degraded.push(`${label}: venue lookup failed (${(e as Error).message.slice(0, 60)})`); }
    try { rawOpeners.set(s.city.id, await port.openersNear(artist, s.city, 8)); }
    catch (e) { degraded.push(`${label}: opener lookup failed (${(e as Error).message.slice(0, 60)})`); }
  }
  // An act returned for most stops is a region-wide taste neighbour, not a local opener.
  const seen = new Map<string, { name: string; n: number }>();
  for (const list of rawOpeners.values()) for (const o of list) seen.set(o.id, { name: o.name, n: (seen.get(o.id)?.n ?? 0) + 1 });
  const commonIds = new Set(rawOpeners.size >= 3 ? [...seen].filter(([, v]) => v.n / rawOpeners.size > OPENER_COMMON_SHARE).map(([id]) => id) : []);
  const regionWideOpeners = [...commonIds].map((id) => seen.get(id)!.name);
  // A room appears once per plan: the stop with the higher city affinity keeps it.
  const taken = new Set<string>();
  const venues = new Map<string, Venue[]>();
  for (const s of [...first.stops].sort((a, b) => a.affinityRank - b.affinityRank)) {
    const mine = classifyVenues(rawVenues.get(s.city.id) ?? []).filter((v) => !taken.has(v.id)).slice(0, 3);
    mine.forEach((v) => taken.add(v.id));
    if (rawVenues.has(s.city.id)) venues.set(s.city.id, mine);
  }
  const openers = new Map(
    [...rawOpeners].map(([id, list]) => [id, list.filter((o) => !commonIds.has(o.id)).slice(0, 3)] as const),
  );
  const enriched = candidates.map((c) => (rawVenues.has(c.id) || rawOpeners.has(c.id) ? { ...c, venues: venues.get(c.id) ?? [], openers: openers.get(c.id) ?? [] } : c));
  const taste = planTour(enriched, req);
  const generic = planGeneric(enriched, req);
  const cityPitches = Object.fromEntries(taste.stops.map((s) => [s.city.id, draftCityPitch(artist, taste, s.city.id)]));
  return { dataMode: port.mode, artist, taste, generic, lift: compareLift(taste, generic), pitch: draftPitch(artist, taste), cityPitches, regionWideOpeners, degraded };
}
