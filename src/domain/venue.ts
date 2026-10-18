// Venue class from Qloo tag ids only (SPEC S10). Nothing is inferred beyond the tags and the popularity number Qloo returned.
import { VENUE_ESTABLISHED_POPULARITY } from './constants.js';
import type { Venue, VenueKind, VenueSize } from './planner.js';

// Qloo tag ids look like urn:tag:genre:place:concert_hall (place type) or urn:tag:setting:qloo:basement_venue (setting).
const PLACE_ROOM = ['concert_hall', 'amphitheater', 'night_club', 'performing_arts_theater', 'auditorium'];
const SETTING_ROOM = ['music_venue', 'basement_venue', 'megaclub', 'nightclub', 'music_hall', 'open_air_venue'];
const HARD_NOT_ROOM = ['music_school', 'school', 'cafe', 'coffee_shop', 'bakery', 'drive_in_theater', 'restaurant'];
const SOFT_NOT_ROOM = ['wedding_venue', 'banquet_hall', 'comedy_club', 'art_studio', 'pizza_takeout'];

const placeTypes = (ids: readonly string[]) => new Set(ids.filter((t) => t.includes(':place:')).flatMap((t) => t.split(':place:')[1].split(':')));
const settings = (ids: readonly string[]) => new Set(ids.filter((t) => t.includes(':setting:qloo:')).map((t) => t.split(':').slice(-1)[0]));
const any = (set: Set<string>, names: readonly string[]) => names.some((n) => set.has(n));

export function classifyVenue(tagIds: readonly string[], popularity?: number): { kind: VenueKind | 'excluded'; size: VenueSize; reason: string } {
  const size: VenueSize = typeof popularity !== 'number' ? 'unknown' : popularity >= VENUE_ESTABLISHED_POPULARITY ? 'established' : 'smaller';
  const place = placeTypes(tagIds);
  const setting = settings(tagIds);
  if (place.has('music_school') || place.has('school')) return { kind: 'excluded', size, reason: 'school' };
  if (any(place, PLACE_ROOM)) return { kind: 'venue', size, reason: 'concert-room place type' };
  if (any(place, HARD_NOT_ROOM)) return { kind: 'excluded', size, reason: 'restaurant, cafe or similar' };
  if (any(setting, SETTING_ROOM)) return any(place, SOFT_NOT_ROOM) ? { kind: 'excluded', size, reason: 'event or banquet place' } : { kind: 'venue', size, reason: 'music-venue setting' };
  if (any(place, SOFT_NOT_ROOM)) return { kind: 'excluded', size, reason: 'event or banquet place' };
  return { kind: 'unverified', size, reason: 'Qloo gives only the generic live-music tag' };
}

/** Drop non-rooms, mark the rest with class and size band. Confirmed rooms first, then by affinity. */
export function classifyVenues(vs: readonly Venue[]): Venue[] {
  return vs
    .map((v) => ({ v, c: classifyVenue(v.tags ?? [], v.popularity) }))
    .filter((x) => x.c.kind !== 'excluded')
    .map((x) => ({ ...x.v, kind: x.c.kind as VenueKind, size: x.c.size }))
    .sort((a, b) => Number(b.kind === 'venue') - Number(a.kind === 'venue') || b.affinity - a.affinity || a.id.localeCompare(b.id));
}
