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
  });
  it('throws ArtistNotFound when search is empty', async () => {
    const port: TastePort = { mode: 'live', searchArtist: async () => null, rankCities: async () => [], venuesNear: async () => [] };
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
