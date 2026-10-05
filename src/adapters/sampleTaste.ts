// Adapter: SAMPLE data for demo mode (no API key). Affinities are synthetic and labelled as such in the UI.
import type { TastePort } from '../application/routeTour';
import type { Artist } from '../domain/pitch';
import type { CandidateCity, Venue } from '../domain/planner';

const CITIES: Omit<CandidateCity, 'affinity'>[] = [
  ['nyc', 'New York, NY', 40.71, -74.01, 8336000], ['la', 'Los Angeles, CA', 34.05, -118.24, 3822000],
  ['chi', 'Chicago, IL', 41.88, -87.63, 2665000], ['hou', 'Houston, TX', 29.76, -95.37, 2303000],
  ['phx', 'Phoenix, AZ', 33.45, -112.07, 1644000], ['phl', 'Philadelphia, PA', 39.95, -75.17, 1567000],
  ['sa', 'San Antonio, TX', 29.42, -98.49, 1472000], ['sd', 'San Diego, CA', 32.72, -117.16, 1381000],
  ['dal', 'Dallas, TX', 32.78, -96.8, 1300000], ['atx', 'Austin, TX', 30.27, -97.74, 975000],
  ['sea', 'Seattle, WA', 47.61, -122.33, 749000], ['den', 'Denver, CO', 39.74, -104.99, 713000],
  ['nash', 'Nashville, TN', 36.16, -86.78, 684000], ['pdx', 'Portland, OR', 45.52, -122.68, 635000],
  ['atl', 'Atlanta, GA', 33.75, -84.39, 499000], ['sf', 'San Francisco, CA', 37.77, -122.42, 808000],
  ['bos', 'Boston, MA', 42.36, -71.06, 650000], ['msp', 'Minneapolis, MN', 44.98, -93.27, 425000],
  ['nola', 'New Orleans, LA', 29.95, -90.07, 364000], ['slc', 'Salt Lake City, UT', 40.76, -111.89, 200000],
  ['ash', 'Asheville, NC', 35.6, -82.55, 94000], ['ath', 'Athens, GA', 33.96, -83.38, 128000],
  ['mad', 'Madison, WI', 43.07, -89.4, 272000], ['boi', 'Boise, ID', 43.62, -116.2, 237000],
  ['tuc', 'Tucson, AZ', 32.22, -110.97, 546000], ['rva', 'Richmond, VA', 37.54, -77.44, 229000],
].map(([id, name, lat, lon, population]) => ({ id, name, lat, lon, population } as Omit<CandidateCity, 'affinity'>));

// Deterministic synthetic affinity per (artist, city) so demo plans are stable.
function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) / 4294967295;
}

export const SAMPLE_ARTISTS: Artist[] = [
  { id: 'sample-indie-folk', name: 'Sample Indie Folk Act' },
  { id: 'sample-synth-pop', name: 'Sample Synth-Pop Duo' },
  { id: 'sample-jazz-trio', name: 'Sample Jazz Trio' },
];

export class SampleTaste implements TastePort {
  readonly mode = 'sample' as const;
  async searchArtist(name: string): Promise<Artist | null> {
    const q = name.trim().toLowerCase();
    return SAMPLE_ARTISTS.find((a) => a.name.toLowerCase().includes(q) || a.id.includes(q)) ?? SAMPLE_ARTISTS[0];
  }
  async rankCities(artist: Artist, take: number): Promise<CandidateCity[]> {
    return CITIES.map((c) => ({ ...c, affinity: Math.round((0.2 + 0.8 * hash(artist.id + c.id)) * 1000) / 1000 }))
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, take);
  }
  async venuesNear(artist: Artist, city: CandidateCity, take: number): Promise<Venue[]> {
    return Array.from({ length: take }, (_, i) => ({
      id: `${city.id}-v${i}`,
      name: `Sample Venue ${i + 1} (${city.name.split(',')[0]})`,
      affinity: Math.round((0.3 + 0.7 * hash(artist.id + city.id + i)) * 100) / 100,
    })).sort((a, b) => b.affinity - a.affinity);
  }
}
