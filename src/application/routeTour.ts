// Application: UC-1..UC-3 orchestrated over a TastePort. No HTTP/framework imports.
import type { LatLon } from '../domain/geo';
import { compareLift, type TasteLift } from '../domain/lift';
import { draftCityPitch, draftPitch, type Artist } from '../domain/pitch';
import { planGeneric, planTour, type CandidateCity, type TourPlan, type Venue } from '../domain/planner';

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
}

export class ArtistNotFound extends Error {}

export async function routeTour(port: TastePort, input: RouteTourInput): Promise<RouteTourResult> {
  const artist = await port.searchArtist(input.artistName);
  if (!artist) throw new ArtistNotFound(`No artist found for "${input.artistName}"`);
  const req = { stops: input.stops ?? 8, maxLegKm: input.maxLegKm ?? 650, home: input.home, mustInclude: input.mustInclude };
  const candidates = (await port.rankCities(artist, 30)).filter((c) => !input.exclude?.includes(c.id));
  const first = planTour(candidates, req);
  // Enrich only the chosen stops with venues (bounded API usage), then re-plan with venues attached.
  const venues = new Map<string, Venue[]>();
  const openers = new Map<string, { id: string; name: string; affinity: number }[]>();
  for (const s of first.stops) {
    venues.set(s.city.id, await port.venuesNear(artist, s.city, 3));
    openers.set(s.city.id, await port.openersNear(artist, s.city, 3));
  }
  const enriched = candidates.map((c) => (venues.has(c.id) ? { ...c, venues: venues.get(c.id)!, openers: openers.get(c.id)! } : c));
  const taste = planTour(enriched, req);
  const generic = planGeneric(enriched, req);
  const cityPitches = Object.fromEntries(taste.stops.map((s) => [s.city.id, draftCityPitch(artist, taste, s.city.id)]));
  return { dataMode: port.mode, artist, taste, generic, lift: compareLift(taste, generic), pitch: draftPitch(artist, taste), cityPitches };
}
