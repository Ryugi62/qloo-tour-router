// Application: UC-1..UC-3 orchestrated over a TastePort. No HTTP/framework imports.
import type { LatLon } from '../domain/geo';
import { compareLift, type TasteLift } from '../domain/lift';
import { draftPitch, type Artist } from '../domain/pitch';
import { planGeneric, planTour, type CandidateCity, type TourPlan, type Venue } from '../domain/planner';

export interface TastePort {
  readonly mode: 'live' | 'sample';
  searchArtist(name: string): Promise<Artist | null>;
  rankCities(artist: Artist, take: number): Promise<CandidateCity[]>;
  venuesNear(artist: Artist, city: CandidateCity, take: number): Promise<Venue[]>;
}

export interface RouteTourInput { readonly artistName: string; readonly home: LatLon; readonly stops?: number; readonly maxLegKm?: number }
export interface RouteTourResult {
  readonly dataMode: 'live' | 'sample';
  readonly artist: Artist;
  readonly taste: TourPlan;
  readonly generic: TourPlan;
  readonly lift: TasteLift;
  readonly pitch: string;
}

export class ArtistNotFound extends Error {}

export async function routeTour(port: TastePort, input: RouteTourInput): Promise<RouteTourResult> {
  const artist = await port.searchArtist(input.artistName);
  if (!artist) throw new ArtistNotFound(`No artist found for "${input.artistName}"`);
  const req = { stops: input.stops ?? 8, maxLegKm: input.maxLegKm ?? 650, home: input.home };
  const candidates = await port.rankCities(artist, 30);
  const first = planTour(candidates, req);
  // Enrich only the chosen stops with venues (bounded API usage), then re-plan with venues attached.
  const venues = new Map<string, Venue[]>();
  for (const s of first.stops) venues.set(s.city.id, await port.venuesNear(artist, s.city, 3));
  const enriched = candidates.map((c) => (venues.has(c.id) ? { ...c, venues: venues.get(c.id)! } : c));
  const taste = planTour(enriched, req);
  const generic = planGeneric(enriched, req);
  return { dataMode: port.mode, artist, taste, generic, lift: compareLift(taste, generic), pitch: draftPitch(artist, taste) };
}
