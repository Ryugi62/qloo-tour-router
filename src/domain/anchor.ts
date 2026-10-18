// A stop lives where its room is (SPEC S22): the room's own city and coordinates come from the Qloo response.
import { haversineKm } from './geo.js';
import { VENUE_RELOCATE_MIN_KM } from './constants.js';
import type { CandidateCity, Venue } from './planner.js';

const norm = (s: string) => s.trim().toLowerCase();
/** The stop re-anchored to the room, or null when the room is in the same city / near the centre / has no coordinates. Same id, so ranks and notes stay attached. */
export function venueAnchor(city: CandidateCity, venue: Venue | undefined): CandidateCity | null {
  if (!venue || typeof venue.lat !== 'number' || typeof venue.lon !== 'number' || !venue.city) return null;
  const km = haversineKm(city, { lat: venue.lat, lon: venue.lon });
  if (km < VENUE_RELOCATE_MIN_KM) return null;
  if (norm(venue.city) === norm(city.name.split(',')[0])) return null;
  const name = venue.region ? `${venue.city}, ${venue.region}` : venue.city;
  return { ...city, name, lat: venue.lat, lon: venue.lon, relocatedFrom: city.relocatedFrom ?? city.name };
}
