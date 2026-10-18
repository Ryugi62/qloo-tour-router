import { describe, expect, it } from 'vitest';
import { routeTour, type TastePort } from '../src/application/routeTour';
import { haversineKm } from '../src/domain/geo';
import type { CandidateCity, Venue } from '../src/domain/planner';

const city = (id: string, name: string, lat: number, lon: number, affinity: number): CandidateCity => ({ id, name, lat, lon, affinity });
const NE: CandidateCity[] = [
  city('wil', 'Williamstown, Massachusetts', 42.71, -73.2, 0.95), city('alb', 'Albany, New York', 42.65, -73.75, 0.93), city('bos', 'Boston, Massachusetts', 42.36, -71.06, 0.9),
  city('bur', 'Burlington, Vermont', 44.48, -73.21, 0.88), city('por', 'Portland, Maine', 43.66, -70.26, 0.86), city('pit', 'Pittsburgh, Pennsylvania', 40.44, -80.0, 0.84),
  city('syr', 'Syracuse, New York', 43.05, -76.15, 0.82), city('lan', 'Lancaster, Pennsylvania', 40.04, -76.3, 0.8), city('har', 'Hartford, Connecticut', 41.76, -72.68, 0.78),
  city('cle', 'Cleveland, Ohio', 41.5, -81.69, 0.76), city('buf', 'Buffalo, New York', 42.89, -78.88, 0.74), city('bal', 'Baltimore, Maryland', 39.29, -76.61, 0.72),
];
const home = { lat: 40.71, lon: -74.01 };
const room = (id: string, extra: Partial<Venue> = {}): Venue => ({ id, name: `Room ${id}`, affinity: 0.8, popularity: 0.95, tags: ['urn:tag:genre:place:concert_hall'], ...extra });
function port(venues: (c: CandidateCity) => Venue[], artistPop = 0.93): TastePort {
  return {
    mode: 'live', searchArtist: async () => ({ id: 'A', name: 'Band', popularity: artistPop }), rankCities: async () => NE,
    venuesNear: async (_a, c) => venues(c), openersNear: async () => [],
  };
}
const troyHall = room('troy', { name: 'Troy Savings Bank Music Hall', lat: 42.7284, lon: -73.6918, city: 'Troy', region: 'New York' });

describe('S22 stop = the room\'s own city (routeTour)', () => {
  it('AC-25 a radius-widened room in Troy moves the Williamstown stop to Troy and Troy counts as the same market as Albany', async () => {
    const r = await routeTour(port((c) => (c.id === 'wil' ? [troyHall] : [room(`r-${c.id}`)])), { artistName: 'Band', home, stops: 6 });
    const troy = r.taste.stops.find((s) => s.city.id === 'wil')!;
    expect(troy.city.name).toBe('Troy, New York');
    expect(troy.city.relocatedFrom).toBe('Williamstown, Massachusetts');
    expect(troy.city.lat).toBeCloseTo(42.7284, 3);
    // Albany is ~10 km from Troy now: only one of them can be a stop.
    expect(r.taste.stops.some((s) => s.city.id === 'alb')).toBe(false);
    expect(r.trace.some((t) => t.cityId === 'wil' && /Troy/.test(t.finding) && /move the stop/.test(t.action))).toBe(true);
    for (let i = 0; i < r.taste.stops.length; i++) for (let j = i + 1; j < r.taste.stops.length; j++) expect(haversineKm(r.taste.stops[i].city, r.taste.stops[j].city)).toBeGreaterThanOrEqual(150);
    expect(r.stopMarkets['wil'].metro).toBe('Albany-Schenectady-Troy, NY');
  });
  it('legs are recomputed on the room coordinates', async () => {
    const r = await routeTour(port((c) => (c.id === 'wil' ? [troyHall] : [room(`r-${c.id}`)])), { artistName: 'Band', home, stops: 6 });
    const sum = r.taste.legs.reduce((a, l) => a + l.km, 0);
    expect(r.taste.totalKm).toBeCloseTo(sum, 6);
    const i = r.taste.stops.findIndex((s) => s.city.id === 'wil');
    if (i > 0) expect(r.taste.legs[i - 1].km).toBeCloseTo(haversineKm(r.taste.stops[i - 1].city, r.taste.stops[i].city), 6);
  });
});

describe('S20/S21 baseline is market size, with a reason for every omitted metro', () => {
  it('AC-24 baseline stops are Census metros chosen by population, none of them a Qloo-popular small city', async () => {
    const r = await routeTour(port((c) => [room(`r-${c.id}`)]), { artistName: 'Band', home, stops: 6 });
    const names = r.generic.stops.map((s) => s.city.name);
    expect(r.generic.stops.every((s) => (s.city.population ?? 0) >= 500_000)).toBe(true);
    expect(names.join('|')).toMatch(/New York|Boston|Washington/);
    expect(names.join('|')).not.toMatch(/Syracuse|Lancaster|Williamstown/);
  });
  it('every baseline stop the taste route does not use has a data reason; a metro Qloo never returned says so', async () => {
    const r = await routeTour(port((c) => [room(`r-${c.id}`)]), { artistName: 'Band', home, stops: 6 });
    expect(r.baselineOmissions).toHaveLength(r.lift.changed.genericOnly.length);
    for (const o of r.baselineOmissions) { expect(o.reason.length).toBeGreaterThan(20); expect(o.pop).toBeGreaterThan(0); }
    expect(r.baselineOmissions.some((o) => o.qlooRank === null && /not among Qloo's top/.test(o.reason))).toBe(true);
  });
  it('big-market labels come from population, not from being a baseline pick', async () => {
    const r = await routeTour(port((c) => [room(`r-${c.id}`)]), { artistName: 'Band', home, stops: 6 });
    for (const s of r.taste.stops) {
      const m = r.stopMarkets[s.city.id];
      expect(m.big).toBe((m.pop ?? 0) >= 1_000_000);
      if (r.stopNotes[s.city.id].kind === 'confirmed') expect(m.big).toBe(true);
    }
  });
});

describe('S23 weight class in the plan', () => {
  it('AC-26 a headline artist whose only rooms are basement clubs gets a size trace and a too-small label', async () => {
    const club = (c: CandidateCity) => [room(`c-${c.id}`, { popularity: 0.5, tags: ['urn:tag:setting:qloo:basement_venue', 'urn:tag:genre:place:live_music_venue'] })];
    const r = await routeTour(port(club, 0.99), { artistName: 'Band', home, stops: 4 });
    expect(r.artistBand).toBe('headline');
    expect(r.trace.some((t) => t.check === 'size' && /small/.test(t.finding))).toBe(true);
    expect(r.taste.stops[0].city.venues![0].fit).toBe('too-small');
  });
  it('a matching room produces no size entry and is ranked before a mismatching one', async () => {
    const mixed = (c: CandidateCity) => [room(`b-${c.id}`, { affinity: 0.95, popularity: 0.5, tags: ['urn:tag:setting:qloo:basement_venue'] }), room(`h-${c.id}`, { affinity: 0.7 })];
    const r = await routeTour(port(mixed, 0.99), { artistName: 'Band', home, stops: 4 });
    expect(r.taste.stops.every((s) => s.city.venues![0].id.startsWith('h-'))).toBe(true);
    expect(r.trace.some((t) => t.check === 'size')).toBe(false);
  });
});

describe('S24 route stats', () => {
  it('plan carries total km, start leg, drive hours and the order gain', async () => {
    const r = await routeTour(port((c) => [room(`r-${c.id}`)]), { artistName: 'Band', home, stops: 6 });
    const st = r.taste.stats;
    expect(st.totalKm).toBeCloseTo(r.taste.totalKm, 6);
    expect(st.driveHours).toBeCloseTo(((st.totalKm + st.homeLegKm) * 1.25) / 80, 6);
    expect(st.longestLegKm).toBeLessThanOrEqual(650 + 1e-6);
    expect(st.orderGainKm).toBeGreaterThanOrEqual(0);
  });
});
