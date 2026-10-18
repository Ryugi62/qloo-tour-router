import { describe, expect, it } from 'vitest';
import { routeTour, ArtistNotFound, type TastePort } from '../src/application/routeTour';
import { SampleTaste } from '../src/adapters/sampleTaste';
import { QlooHttp, QLOO_BASE, type FetchLike } from '../src/adapters/qlooHttp';

describe('application routeTour', () => {
  it('sample mode returns a complete, labelled result', async () => {
    const r = await routeTour(new SampleTaste(), { artistName: 'folk', home: { lat: 40.7, lon: -74 } });
    expect(r.dataMode).toBe('sample');
    expect(r.taste.stops).toHaveLength(8);
    expect(r.taste.stops.every((s) => (s.city.venues?.length ?? 0) === 3)).toBe(true);
    expect(r.pitch).toContain(r.artist.name);
    expect(r.lift.meanAffinityTaste).toBeGreaterThanOrEqual(r.lift.meanAffinityGeneric);
    for (const s of r.taste.stops) expect(r.cityPitches[s.city.id]).toContain(s.city.name.split(',')[0]);
  });
  it('follow-up constraints: exclude drops a city, mustInclude keeps one', async () => {
    const base = await routeTour(new SampleTaste(), { artistName: 'folk', home: { lat: 40.7, lon: -74 } });
    const dropped = base.taste.stops[0].city.id;
    const r = await routeTour(new SampleTaste(), { artistName: 'folk', home: { lat: 40.7, lon: -74 }, exclude: [dropped], mustInclude: ['atx'] });
    const ids = r.taste.stops.map((s) => s.city.id);
    expect(ids).not.toContain(dropped);
    expect(ids).toContain('atx');
  });
  it('throws ArtistNotFound when search is empty', async () => {
    const port: TastePort = { mode: 'live', searchArtist: async () => null, rankCities: async () => [], venuesNear: async () => [], openersNear: async () => [] };
    await expect(routeTour(port, { artistName: 'x', home: { lat: 0, lon: 0 } })).rejects.toBeInstanceOf(ArtistNotFound);
  });
});

describe('adapter contract: QlooHttp', () => {
  it('sends the key only as X-Api-Key to the hackathon base URL and maps entities', async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fake: FetchLike = async (url, init) => {
      calls.push({ url, headers: init.headers });
      const body = url.includes('/search')
        ? { results: [{ entity_id: 'A1', name: 'Band' }] }
        : { results: { entities: [{ entity_id: 'D1', name: 'Austin', location: { lat: 30.27, lon: -97.74 }, query: { affinity: 0.91 } }, { entity_id: 'D2', name: 'NoGeo' }] } };
      return { ok: true, status: 200, json: async () => body };
    };
    const q = new QlooHttp('SECRET', fake);
    const a = await q.searchArtist('Band');
    const cities = await q.rankCities(a!, 5);
    expect(cities).toEqual([{ id: 'D1', name: 'Austin', lat: 30.27, lon: -97.74, affinity: 0.91, population: undefined }]);
    for (const c of calls) {
      expect(c.url.startsWith(QLOO_BASE)).toBe(true);
      expect(c.url).not.toContain('SECRET');
      expect(c.headers['X-Api-Key']).toBe('SECRET');
    }
    expect(calls[1].url).toContain('filter.type=urn%3Aentity%3Adestination');
  });
  it('surfaces HTTP errors instead of inventing data', async () => {
    const q = new QlooHttp('K', async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(q.searchArtist('x')).rejects.toThrow(/401/);
  });
});

describe('adapter contract: real Qloo response shape', () => {
  const real = { entity_id: 'P1', name: 'Portland', properties: { geocode: { name: 'Portland', admin1_region: 'Maine', country_code: 'US' } },
    popularity: 0.83, location: { lat: 43.66, lon: -70.27 }, query: { affinity: 0.93 } };
  it('disambiguates the city with its region and keeps Qloo popularity as the market proxy', async () => {
    const q = new QlooHttp('K', async () => ({ ok: true, status: 200, json: async () => ({ results: { entities: [real] } }) }));
    const [c] = await q.rankCities({ id: 'A', name: 'x' }, 5);
    expect(c.name).toBe('Portland, Maine');
    expect(c.popularity).toBe(0.83);
    expect(c.population).toBeUndefined();
  });
  it('generic plan ranks by popularity when no population is returned (not all-zero ties)', async () => {
    const mk = (id: string, affinity: number, popularity: number, lon: number) => ({ id, name: id, lat: 40, lon, affinity, popularity });
    const { planGeneric } = await import('../src/domain/planner');
    const p = planGeneric([mk('a', 0.9, 0.1, -100), mk('b', 0.5, 0.9, -99.9), mk('c', 0.4, 0.5, -99.8)], { stops: 1, maxLegKm: 650, home: { lat: 40, lon: -100 } });
    expect(p.stops[0].city.id).toBe('b');
  });
});

// Real-key contract: runs only when QLOO_API_KEY is set (never in CI/hosting build).
describe.skipIf(!process.env.QLOO_API_KEY)('LIVE Qloo hackathon API', () => {
  it('searches an artist and returns real cities with affinity in 0..1 and lat/lon', async () => {
    const q = new QlooHttp(process.env.QLOO_API_KEY!);
    const a = await q.searchArtist('Phoebe Bridgers');
    expect(a?.name).toBe('Phoebe Bridgers');
    const cities = await q.rankCities(a!, 30);
    expect(cities.length).toBeGreaterThanOrEqual(20);
    for (const c of cities) {
      expect(c.affinity).toBeGreaterThan(0);
      expect(c.affinity).toBeLessThanOrEqual(1);
      expect(typeof c.lat).toBe('number');
    }
    const v = await q.venuesNear(a!, cities[0], 3);
    expect(v.length).toBeGreaterThan(0);
  }, 30000);
});

describe('venues are music venues, not any place', () => {
  it('venuesNear asks Qloo for live_music_venue only', async () => {
    const urls: string[] = [];
    const q = new QlooHttp('K', async (url) => { urls.push(url); return { ok: true, status: 200, json: async () => ({ results: { entities: [] } }) }; });
    await q.venuesNear({ id: 'A', name: 'x' }, { id: 'c', name: 'c', lat: 41.3, lon: -72.9, affinity: 0.9 }, 3);
    expect(decodeURIComponent(urls[0])).toContain('filter.tags=urn:tag:genre:place:live_music_venue');
  });
});

describe('Qloo quota discipline (5 req/s, 10k/month)', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  it('retries a 429 after backing off, then succeeds', async () => {
    let n = 0;
    const sleeps: number[] = [];
    const q = new QlooHttp('K', async () => (++n === 1 ? { ok: false, status: 429, json: async () => ({}) } : ok({ results: [{ entity_id: 'A', name: 'x' }] })), { sleep: async (ms) => { sleeps.push(ms); }, minGapMs: 0 });
    expect((await q.searchArtist('x'))?.id).toBe('A');
    expect(n).toBe(2);
    expect(sleeps.some((s) => s >= 500)).toBe(true);
  });
  it('gives up after bounded retries instead of looping', async () => {
    let n = 0;
    const q = new QlooHttp('K', async () => { n++; return { ok: false, status: 429, json: async () => ({}) }; }, { sleep: async () => {}, minGapMs: 0 });
    await expect(q.searchArtist('x')).rejects.toThrow(/429/);
    expect(n).toBeLessThanOrEqual(4);
  });
  it('serves a repeated identical request from cache (saves monthly quota)', async () => {
    let n = 0;
    const q = new QlooHttp('K', async () => { n++; return ok({ results: [{ entity_id: 'A', name: 'x' }] }); }, { sleep: async () => {}, minGapMs: 0 });
    await q.searchArtist('x'); await q.searchArtist('x');
    expect(n).toBe(1);
  });
});
