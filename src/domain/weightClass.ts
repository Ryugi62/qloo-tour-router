// Weight class (SPEC S23): an ESTIMATE of how well an artist's draw matches a room. Qloo returns no capacity; nothing here is a capacity or a sales number.
import { ARTIST_BAND_HEADLINE, ARTIST_BAND_MID } from './constants.js';
import type { SizeFit, Venue, VenueTier } from './planner.js';

export type ArtistBand = 'emerging' | 'mid' | 'headline' | 'unknown';
export const artistBand = (popularity: number | undefined): ArtistBand =>
  typeof popularity !== 'number' ? 'unknown' : popularity >= ARTIST_BAND_HEADLINE ? 'headline' : popularity >= ARTIST_BAND_MID ? 'mid' : 'emerging';

const LARGE = ['amphitheater', 'arena', 'stadium', 'megaclub', 'outdoor_music_venue', 'open_air_venue', 'open_air_pavilion'];
const MID = ['concert_hall', 'music_hall', 'performing_arts_theater', 'theater', 'auditorium', 'night_club', 'nightclub', 'ballroom'];
const SMALL = ['basement_venue', 'intimate', 'dive_bar', 'pub_like', 'brewpub', 'pub', 'bar'];
const last = (id: string) => id.split(':').slice(-1)[0];

export function venueTier(tagIds: readonly string[], popularity: number | undefined): { tier: VenueTier; basis: 'tags' | 'popularity' | 'none' } {
  const names = new Set(tagIds.map(last));
  const has = (xs: readonly string[]) => xs.some((x) => names.has(x));
  if (has(LARGE)) return { tier: 'large', basis: 'tags' };
  if (has(MID)) return { tier: 'mid', basis: 'tags' };
  if (has(SMALL)) return { tier: 'small', basis: 'tags' };
  if (typeof popularity === 'number') {
    if (popularity >= 0.95) return { tier: 'mid', basis: 'popularity' };
    if (popularity < 0.8) return { tier: 'small', basis: 'popularity' };
  }
  return { tier: 'unknown', basis: 'none' };
}

export function sizeFit(band: ArtistBand, tier: VenueTier): SizeFit {
  if (band === 'unknown' || tier === 'unknown') return 'unknown';
  if (band === 'headline') return tier === 'small' ? 'too-small' : 'match';
  if (band === 'mid') return tier === 'large' ? 'too-big' : 'match';
  return tier === 'small' ? 'match' : 'too-big';
}

const rankFit = (f: SizeFit | undefined) => (f === 'match' ? 0 : f === 'unknown' || f === undefined ? 1 : 2);
/** Confirmed rooms first, then size match, then unknown size, then mismatch; ties by affinity. Adds tier/fit/sizeBasis to each room. */
export function rankRoomsByFit(rooms: readonly Venue[], band: ArtistBand): Venue[] {
  return rooms
    .map((v) => { const t = venueTier(v.tags ?? [], v.popularity); return { ...v, tier: t.tier, sizeBasis: t.basis, fit: sizeFit(band, t.tier) }; })
    .sort((a, b) => Number(b.kind === 'venue') - Number(a.kind === 'venue') || rankFit(a.fit) - rankFit(b.fit) || b.affinity - a.affinity || a.id.localeCompare(b.id));
}
