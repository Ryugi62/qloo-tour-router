// Market size baseline from public Census metro statistics (SPEC S20, S21). Pure: no I/O.
import { haversineKm, type LatLon } from './geo.js';
import { BIG_MARKET_POP, MARKET_NEAR_KM } from './constants.js';
import { US_MARKETS, type MarketRow } from './data/usMarkets.js';

export type Market = MarketRow;
const STATES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI',
  Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
export const stateAbbrev = (region: string): string | null => (/^[A-Z]{2}$/.test(region) ? region : STATES[region] ?? null);

/** "Troy, New York" → the metro that names Troy in that state; else the nearest metro within MARKET_NEAR_KM; else null (Canada, small towns). */
export function marketFor(label: string, at: LatLon): Market | null {
  const [city, region] = label.split(',').map((x) => x.trim());
  const st = region ? stateAbbrev(region) : null;
  const want = city.toLowerCase();
  if (st) {
    const hit = US_MARKETS.find((m) => m.states.includes(st) && m.cities.some((c) => c.toLowerCase() === want));
    if (hit) return hit;
  }
  let best: Market | null = null;
  let bestKm = MARKET_NEAR_KM;
  for (const m of US_MARKETS) { const d = haversineKm(at, m); if (d < bestKm) { best = m; bestKm = d; } }
  return best;
}
export const isBigMarket = (pop: number | undefined) => typeof pop === 'number' && pop >= BIG_MARKET_POP;
export const marketLabel = (pop: number | undefined) => (typeof pop !== 'number' ? 'metro population not in the Census table' : `metro ${(pop / 1e6).toFixed(pop >= 1e6 ? 1 : 2)} M people`);
/** Largest US metros within `radiusKm` of the start, biggest first. */
export const baselineMarkets = (home: LatLon, radiusKm: number): Market[] => US_MARKETS.filter((m) => haversineKm(home, m) <= radiusKm);
/** Short city label for a metro: first principal city + state. */
export const marketCityName = (m: Market): string => `${m.name.split(', ')[0].split('--')[0].split('-')[0]}, ${m.states[0]}`;
