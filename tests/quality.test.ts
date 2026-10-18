import { describe, expect, it } from 'vitest';
import { haversineKm } from '../src/domain/geo';
import { planTour, planGeneric, type CandidateCity } from '../src/domain/planner';
import { compareLift } from '../src/domain/lift';
import { classifyVenue } from '../src/domain/venue';
import { routeTour, type TastePort } from '../src/application/routeTour';
import { MIN_CITY_SEPARATION_KM } from '../src/domain/constants';

const city = (id: string, lat: number, lon: number, affinity: number, popularity = 0.5): CandidateCity => ({ id, name: id, lat, lon, affinity, popularity });
const req = { stops: 4, maxLegKm: 650, home: { lat: 42.36, lon: -71.06 } };

// Boston-area cluster (all within 80 km) plus far-apart markets.
const cluster = [city('Boston', 42.36, -71.06, 0.95), city('Cambridge', 42.37, -71.11, 0.94), city('Salem', 42.52, -70.9, 0.93), city('Worcester', 42.26, -71.8, 0.92)];
const far = [city('NYC', 40.71, -74.0, 0.8), city('Philly', 39.95, -75.17, 0.78), city('DC', 38.9, -77.04, 0.76), city('Pittsburgh', 40.44, -79.99, 0.74), city('Buffalo', 42.89, -78.88, 0.7)];

const tags = (...t: string[]) => t.map((x) => `urn:tag:${x}`);

describe('S9 same-market guard', () => {
  it('AC-10 picks at most one of the cities within one market', () => {
    for (const p of [planTour([...cluster, ...far], req), planGeneric([...cluster, ...far], req)]) {
      for (let i = 0; i < p.stops.length; i++) for (let j = i + 1; j < p.stops.length; j++) {
        expect(haversineKm(p.stops[i].city, p.stops[j].city)).toBeGreaterThanOrEqual(MIN_CITY_SEPARATION_KM);
      }
      expect(p.stops.filter((s) => cluster.some((c) => c.id === s.city.id)).length).toBeLessThanOrEqual(1);
      expect(p.stops).toHaveLength(4);
    }
    expect(planTour([...cluster, ...far], req).stops.map((s) => s.city.id)).toContain('Boston');
    {
    }
  });
  it('warns when the separation leaves fewer markets than stops', () => {
    const p = planTour(cluster, req);
    expect(p.stops).toHaveLength(1);
    expect(p.warnings.join(' ')).toMatch(/same market|separation/);
  });
});

describe('S10 venue class from tags', () => {
  it('AC-11 excludes cafes, restaurants, schools; keeps concert rooms', () => {
    expect(classifyVenue(tags('genre:place:live_music_venue', 'category:place:cafe', 'genre:place:restaurant:coffee_shop'), 0.99).kind).toBe('excluded');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:restaurant:seafood'), 0.97).kind).toBe('excluded');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:music_school'), 0.81).kind).toBe('excluded');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:concert_hall'), 1).kind).toBe('venue');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:restaurant:lounge_bar', 'category:place:night_club', 'setting:qloo:megaclub'), 1).kind).toBe('venue');
  });
  it('real Qloo noise: a restaurant tagged with a music-hall setting is not a room; a bar-only place is unverified', () => {
    expect(classifyVenue(tags('genre:place:restaurant:chinese', 'genre:place:restaurant', 'setting:qloo:music_hall', 'genre:place:live_music_venue'), 0.97).kind).toBe('excluded');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:art_center', 'genre:place:wedding_venue', 'genre:place:performing_arts_theater'), 0.95).kind).toBe('venue');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:pub'), 0.48).kind).toBe('unverified');
    expect(classifyVenue(tags('genre:place:live_music_venue', 'genre:place:wedding_venue', 'genre:place:event_venue'), 0.22).kind).toBe('excluded');
    expect(classifyVenue(tags('genre:place:music_school', 'genre:place:concert_hall'), 0.8).kind).toBe('excluded');
  });
  it('generic tag only → unverified; size band from popularity, never capacity', () => {
    const v = classifyVenue(tags('genre:place:live_music_venue'), undefined);
    expect(v.kind).toBe('unverified');
    expect(v.size).toBe('unknown');
    expect(classifyVenue(tags('genre:place:concert_hall'), 0.95).size).toBe('established');
    expect(classifyVenue(tags('genre:place:concert_hall'), 0.3).size).toBe('smaller');
  });
  it('no tags at all → unverified (never silently a venue)', () => {
    expect(classifyVenue([], 0.9).kind).toBe('unverified');
  });
});

function port(over: Partial<TastePort> = {}): TastePort {
  const cands = [...cluster, ...far];
  return {
    mode: 'live',
    searchArtist: async () => ({ id: 'A', name: 'Band' }),
    rankCities: async () => cands,
    venuesNear: async (_a, c) => [
      { id: 'cafe-' + c.id, name: 'Cafe ' + c.id, affinity: 0.95, popularity: 0.9, tags: tags('category:place:cafe', 'genre:place:live_music_venue') },
      { id: 'hall', name: 'Shared Hall', affinity: 0.9, popularity: 0.95, tags: tags('genre:place:concert_hall') },
      { id: 'room-' + c.id, name: 'Room ' + c.id, affinity: 0.7, popularity: 0.95, tags: tags('genre:place:concert_hall') },
    ],
    openersNear: async (_a, c) => [{ id: 'common', name: 'Everywhere Act', affinity: 0.9 }, { id: 'o-' + c.id, name: 'Local ' + c.id, affinity: 0.6 }],
    ...over,
  };
}

describe('application quality', () => {
  it('drops non-venues and never repeats a venue across stops', async () => {
    const r = await routeTour(port(), { artistName: 'Band', home: req.home, stops: 4 });
    const names = r.taste.stops.flatMap((s) => (s.city.venues ?? []).map((v) => v.name));
    expect(names.some((n) => n.startsWith('Cafe'))).toBe(false);
    expect(names.filter((n) => n === 'Shared Hall').length).toBeLessThanOrEqual(1);
    expect(r.taste.stops.every((s) => (s.city.venues ?? []).length >= 1)).toBe(true);
  });
  it('AC-13 labels an act returned for most stops as region-wide, keeps local ones', async () => {
    const r = await routeTour(port(), { artistName: 'Band', home: req.home, stops: 4 });
    for (const s of r.taste.stops) {
      expect(s.city.openers?.map((o) => o.name)).not.toContain('Everywhere Act');
      expect(s.city.openers?.map((o) => o.name)).toContain('Local ' + s.city.id);
    }
    expect(r.regionWideOpeners).toEqual(['Everywhere Act']);
  });
  it('AC-12 one failing venue call still returns a plan, with degraded notes', async () => {
    const r = await routeTour(port({ venuesNear: async (_a, c) => { if (c.id === 'NYC') throw new Error('boom 502'); return [{ id: 'v' + c.id, name: 'V' + c.id, affinity: 0.8, popularity: 0.95, tags: tags('genre:place:concert_hall') }]; } }), { artistName: 'Band', home: req.home, stops: 4 });
    expect(r.taste.stops.length).toBeGreaterThanOrEqual(3);
    expect(r.degraded.length).toBe(1);
    expect(r.degraded[0]).toMatch(/NYC/);
    expect(r.pitch).toContain('Band');
  });
  it('opener failures degrade too, and a total outage still keeps the route', async () => {
    const r = await routeTour(port({ openersNear: async () => { throw new Error('429'); }, venuesNear: async () => { throw new Error('429'); } }), { artistName: 'Band', home: req.home, stops: 4 });
    expect(r.taste.stops.length).toBe(4);
    expect(r.degraded.length).toBe(8);
  });
});

describe('S13 changed-cities metric', () => {
  it('AC-14 compares only cities that differ', () => {
    const cs = [...far, city('Big', 40.0, -90.0, 0.2, 1), city('Big2', 33.0, -100.0, 0.25, 0.99)];
    const taste = planTour(cs, { ...req, stops: 4 });
    const generic = planGeneric(cs, { ...req, stops: 4 });
    const l = compareLift(taste, generic);
    const tIds = new Set(taste.stops.map((s) => s.city.id));
    const gIds = new Set(generic.stops.map((s) => s.city.id));
    const tOnly = taste.stops.filter((s) => !gIds.has(s.city.id));
    const gOnly = generic.stops.filter((s) => !tIds.has(s.city.id));
    expect(l.changed.count).toBe(tOnly.length);
    expect(l.changed.tasteOnly.length).toBe(tOnly.length);
    if (tOnly.length && gOnly.length) {
      const m = (a: typeof tOnly) => a.reduce((x, s) => x + s.affinity, 0) / a.length;
      expect(l.changed.tasteMeanAffinity).toBeCloseTo(m(tOnly), 9);
      expect(l.changed.genericMeanAffinity).toBeCloseTo(m(gOnly), 9);
      expect(l.changed.affinityDelta).toBeCloseTo(m(tOnly) - m(gOnly), 9);
      expect(l.changed.tasteMeanRank).toBeLessThan(l.changed.genericMeanRank!);
    }
  });
  it('identical plans → zero changed cities, null means', () => {
    const p = planTour(far, { ...req, stops: 3 });
    const l = compareLift(p, p);
    expect(l.changed.count).toBe(0);
    expect(l.changed.affinityDelta).toBeNull();
  });
});
