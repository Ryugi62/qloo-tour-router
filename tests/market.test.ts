import { describe, expect, it } from 'vitest';
import { marketFor, baselineMarkets, stateAbbrev, isBigMarket, marketLabel } from '../src/domain/market';
import { US_MARKETS } from '../src/domain/data/usMarkets';
import { haversineKm } from '../src/domain/geo';

describe('S20 market data (public Census statistics)', () => {
  it('table is the Census metro table: >= 300 metros, descending population, New York first', () => {
    expect(US_MARKETS.length).toBeGreaterThanOrEqual(300);
    expect(US_MARKETS[0].name).toMatch(/^New York/);
    for (let i = 1; i < US_MARKETS.length; i++) expect(US_MARKETS[i - 1].pop).toBeGreaterThanOrEqual(US_MARKETS[i].pop);
  });
  it('state names map to postal codes', () => {
    expect(stateAbbrev('New York')).toBe('NY');
    expect(stateAbbrev('Maine')).toBe('ME');
    expect(stateAbbrev('Atlantis')).toBeNull();
  });
  it('AC-23 Troy, New York is the Albany-Schenectady-Troy metro', () => {
    const m = marketFor('Troy, New York', { lat: 42.73, lon: -73.69 });
    expect(m?.name).toBe('Albany-Schenectady-Troy, NY');
    expect(m!.pop).toBeGreaterThan(800_000);
  });
  it('same city name in another state does not match (Portland, Oregon is not Portland, Maine)', () => {
    expect(marketFor('Portland, Oregon', { lat: 45.5, lon: -122.7 })?.name).toMatch(/OR-WA|, OR/);
    expect(marketFor('Portland, Maine', { lat: 43.66, lon: -70.26 })?.name).toBe('Portland-South Portland, ME');
  });
  it('a town not named in any metro falls back to the nearest metro within MARKET_NEAR_KM, else null', () => {
    expect(marketFor('Williamstown, Massachusetts', { lat: 42.71, lon: -73.2 })?.name).toBe('Pittsfield, MA');
    expect(marketFor('Bar Harbor, Maine', { lat: 44.39, lon: -68.2 })).toBeNull();
    expect(marketFor('Montreal, Quebec', { lat: 45.5, lon: -73.57 })).toBeNull();
  });
  it('big-market flag follows the population constant', () => {
    expect(isBigMarket(1_000_000)).toBe(true);
    expect(isBigMarket(999_999)).toBe(false);
    expect(isBigMarket(undefined)).toBe(false);
    expect(marketLabel(undefined)).toMatch(/not in the Census table/);
    expect(marketLabel(913485)).toMatch(/0\.91 M/);
  });
  it('AC-24 baseline = largest metros within range of the start, ranked by population', () => {
    const home = { lat: 40.71, lon: -74.01 };
    const b = baselineMarkets(home, 900);
    expect(b.length).toBeGreaterThan(15);
    for (const m of b) expect(haversineKm(home, m)).toBeLessThanOrEqual(900);
    expect(b[0].pop).toBeGreaterThanOrEqual(b[1].pop);
    const names = b.slice(0, 12).map((m) => m.name).join('|');
    expect(names).toMatch(/Philadelphia/);
    expect(names).toMatch(/Boston/);
    expect(names).not.toMatch(/Lancaster|Syracuse/);
  });
});
