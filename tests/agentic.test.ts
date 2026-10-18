import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { routeTour, type TastePort } from '../src/application/routeTour';
import { QlooHttp, type FetchLike } from '../src/adapters/qlooHttp';
import { makeMcp } from '../src/web/mcp';
import { TASTE_RANK_CAP, SELF_CHECK_MAX_ROUNDS, OPENER_POPULARITY_MARGIN } from '../src/domain/constants';
import type { CandidateCity, Venue } from '../src/domain/planner';

// 30 cities on a coarse grid, >150 km apart, affinity strictly decreasing with the index (C1 = best).
const grid: CandidateCity[] = Array.from({ length: 30 }, (_, i) => ({
  id: `C${i + 1}`, name: `C${i + 1}, XX`, lat: 36 + (i % 6) * 1.6, lon: -100 + Math.floor(i / 6) * 2.2, affinity: 0.99 - i * 0.01, popularity: 0.5,
}));
const home = { lat: 36, lon: -100 };
const hall = (id: string): Venue => ({ id: `v-${id}`, name: `Hall ${id}`, affinity: 0.8, popularity: 0.95, tags: ['urn:tag:genre:place:concert_hall'] });

type VCall = { id: string; radiusM?: number; tag?: string };
function port(opts: { noRoom?: string[]; wideOnly?: string[]; altTagOnly?: string[]; openers?: (c: CandidateCity) => any[]; baseline?: any[] | 'fail'; headlinerPop?: number; calls?: VCall[] } = {}): TastePort {
  const noRoom = new Set(opts.noRoom ?? []);
  return {
    mode: 'live',
    searchArtist: async () => ({ id: 'A', name: 'Band', popularity: opts.headlinerPop }),
    rankCities: async () => grid,
    venuesNear: async (_a, c, _t, o) => {
      opts.calls?.push({ id: c.id, radiusM: o?.radiusM, tag: o?.tag });
      if (noRoom.has(c.id)) return [];
      if (opts.wideOnly?.includes(c.id) && (o?.radiusM ?? 15000) <= 15000) return [];
      if (opts.altTagOnly?.includes(c.id) && !o?.tag) return [];
      return [hall(c.id)];
    },
    openersNear: async (_a, c) => opts.openers?.(c) ?? [{ id: 'o-' + c.id, name: 'Local ' + c.id, affinity: 0.6, popularity: 0.5 }],
    ...(opts.baseline ? { openersBaseline: async () => { if (opts.baseline === 'fail') throw new Error('boom'); return opts.baseline as any[]; } } : {}),
  };
}
const run = (p: TastePort, stops = 4) => routeTour(p, { artistName: 'Band', home, stops });

describe('self-check loop: venue exists', () => {
  it('drops a city with no qualifying room and fills from the next taste-ranked city', async () => {
    const r = await run(port({ noRoom: ['C1', 'C2'] }));
    const ids = r.taste.stops.map((s) => s.city.id);
    expect(ids).not.toContain('C1'); expect(ids).not.toContain('C2');
    expect(r.taste.stops).toHaveLength(4);
    expect(r.taste.stops.every((s) => (s.city.venues ?? []).length >= 1)).toBe(true);
    const drops = r.trace.filter((t) => /drop/i.test(t.action));
    expect(drops.map((t) => t.city).sort()).toEqual(['C1, XX', 'C2, XX']);
    expect(r.selfCheck.retries).toBeGreaterThanOrEqual(2);
    expect(r.selfCheck.rounds).toBeLessThanOrEqual(SELF_CHECK_MAX_ROUNDS);
  });
  it('a wider search radius can rescue a city (condition changed, not dropped)', async () => {
    const calls: VCall[] = [];
    const r = await run(port({ wideOnly: ['C1'], calls }));
    expect(r.taste.stops.map((s) => s.city.id)).toContain('C1');
    expect(calls.some((c) => c.id === 'C1' && (c.radiusM ?? 0) > 15000)).toBe(true);
    expect(r.trace.some((t) => t.city === 'C1, XX' && /radius/i.test(t.action) && /found/i.test(t.outcome))).toBe(true);
  });
  it('another venue tag can rescue a city after the radius failed', async () => {
    const calls: VCall[] = [];
    const r = await run(port({ altTagOnly: ['C1'], calls }));
    expect(r.taste.stops.map((s) => s.city.id)).toContain('C1');
    expect(calls.some((c) => c.id === 'C1' && c.tag)).toBe(true);
  });
  it('when nothing can fill the route it shrinks and says why; the loop is bounded', async () => {
    const calls: VCall[] = [];
    const ok = ['C3', 'C9'];
    const r = await run(port({ noRoom: grid.map((c) => c.id).filter((id) => !ok.includes(id)), calls }));
    expect(r.taste.stops.length).toBeLessThan(4);
    expect(r.taste.stops.every((s) => ok.includes(s.city.id))).toBe(true);
    expect(r.unfilled.join(' ')).toMatch(/no qualifying room/i);
    expect(r.selfCheck.rounds).toBeLessThanOrEqual(SELF_CHECK_MAX_ROUNDS);
    expect(calls.length).toBeLessThan(60);
  });
});

describe('unconfirmed rooms', () => {
  it('a city with only unverified rooms gets the retries, then stays labelled instead of being dropped', async () => {
    const calls: VCall[] = [];
    const p: TastePort = { ...port({ calls }), venuesNear: async (_a, c, _t, o) => { calls.push({ id: c.id, radiusM: o?.radiusM, tag: o?.tag }); return [{ id: 'u' + c.id, name: 'Maybe ' + c.id, affinity: 0.8, popularity: 0.5, tags: ['urn:tag:genre:place:live_music_venue'] }]; } };
    const r = await run(p, 3);
    expect(r.taste.stops).toHaveLength(3);
    expect(r.taste.stops.every((s) => s.city.venues![0].kind === 'unverified')).toBe(true);
    expect(r.trace.some((t) => /unverified/.test(t.action))).toBe(true);
    expect(r.selfCheck.rounds).toBeLessThanOrEqual(SELF_CHECK_MAX_ROUNDS);
  });
});

describe('rank cap', () => {
  it('never picks outside the taste top N', async () => {
    const r = await run(port({ noRoom: grid.slice(0, 12).map((c) => c.id) }), 6);
    for (const s of r.taste.stops) expect(s.affinityRank).toBeLessThanOrEqual(TASTE_RANK_CAP);
    expect(r.taste.stops.length).toBeLessThan(6);
  });
  it('a stop outside the top-stops ranks carries a one-line reason', async () => {
    const r = await run(port({ noRoom: ['C1', 'C2'] }));
    const low = r.taste.stops.filter((s) => s.affinityRank > 4);
    expect(low.length).toBeGreaterThan(0);
    for (const s of low) expect(r.stopNotes[s.city.id].rankNote).toMatch(/no qualifying room/);
  });
});

describe('opener weight class and local signal', () => {
  const openers = (c: CandidateCity) => [
    { id: 'big-' + c.id, name: 'Huge Pop Star', affinity: 0.9, popularity: 0.99 },
    { id: 'near-' + c.id, name: 'Same Tier', affinity: 0.8, popularity: 0.92 },
    { id: 'small-' + c.id, name: 'Small Act', affinity: 0.7, popularity: 0.6 },
    { id: 'localsmall-' + c.id, name: 'Local Small', affinity: 0.7, popularity: 0.55 },
  ];
  it('only acts below the headliner by the margin are offered', async () => {
    const r = await run(port({ openers, headlinerPop: 0.92 }));
    expect(OPENER_POPULARITY_MARGIN).toBeGreaterThan(0);
    for (const s of r.taste.stops) {
      const names = (s.city.openers ?? []).map((o) => o.name);
      expect(names).not.toContain('Huge Pop Star'); expect(names).not.toContain('Same Tier');
      expect(names).toContain('Small Act');
    }
  });
  it('"local" only when the location signal moved the act vs. the no-location baseline', async () => {
    const r = await run(port({ openers, headlinerPop: 0.92, baseline: [{ id: 'small-C1', affinity: 0.7 }] }));
    const o = r.taste.stops.find((s) => s.city.id === 'C1')!.city.openers!;
    expect(o.find((x) => x.name === 'Small Act')!.scope).toBe('region');
    expect(o.find((x) => x.name === 'Local Small')!.scope).toBe('local');
  });
  it('a failing baseline call is degraded and nothing is claimed as local', async () => {
    const r = await run(port({ openers, headlinerPop: 0.92, baseline: 'fail' }));
    expect(r.degraded.join(' ')).toMatch(/baseline/);
    expect(r.taste.stops[0].city.openers!.every((x) => x.scope === 'region')).toBe(true);
  });
});

describe('decision trace and per-stop reasons', () => {
  it('every stop has a short reason; changed stops name the generic city they replaced', async () => {
    const r = await run(port());
    for (const s of r.taste.stops) expect(r.stopNotes[s.city.id].summary.length).toBeGreaterThan(5);
    expect(Object.values(r.stopNotes).some((n) => n.kind === 'added')).toBe(true);
  });
});

describe('MCP tools by role', () => {
  it('plan_tour returns degraded, venues, openers, trace; explain_stop explains one stop', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await makeMcp(port({ noRoom: ['C1'] })).connect(a);
    const client = new Client({ name: 't', version: '0' });
    await client.connect(b);
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['plan_tour', 'explain_stop']));
    const r: any = await client.callTool({ name: 'plan_tour', arguments: { artist: 'Band', home_lat: 36, home_lon: -100, stops: 4 } });
    const sc = r.structuredContent;
    expect(sc.degraded).toEqual([]);
    expect(sc.route[0].venues.length).toBeGreaterThan(0);
    expect(sc.route[0].openers).toBeDefined();
    expect(sc.trace.length).toBeGreaterThan(0);
    expect(sc.selfCheck.maxRounds).toBe(SELF_CHECK_MAX_ROUNDS);
    const id = sc.route[1].id;
    const e: any = await client.callTool({ name: 'explain_stop', arguments: { artist: 'Band', home_lat: 36, home_lon: -100, stops: 4, city_id: id } });
    expect(e.structuredContent.city).toBe(sc.route[1].city);
    expect(e.structuredContent.why.length).toBeGreaterThan(5);
    expect(e.structuredContent.email).toContain('Subject:');
    const dropped: any = await client.callTool({ name: 'explain_stop', arguments: { artist: 'Band', home_lat: 36, home_lon: -100, stops: 4, city_id: 'C1' } });
    expect(dropped.structuredContent.trace.some((t: any) => /drop/i.test(t.action))).toBe(true);
    await client.close();
  });
});

describe('Qloo adapter depth', () => {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  it('audience profile comes from urn:demographics (artist-level age and gender)', async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(u); return ok({ results: { demographics: [{ query: { age: { '24_and_younger': 0.29, '25_to_29': 0.33, '35_to_44': -0.63 }, gender: { male: -0.47, female: 0.47 } } }] } }); };
    const q = new QlooHttp('K', f, { minGapMs: 0 });
    const p = await q.audienceProfile!({ id: 'A', name: 'B' });
    expect(decodeURIComponent(urls[0])).toContain('filter.type=urn:demographics');
    expect(p!.topAge).toEqual({ band: '25_to_29', index: 0.33 });
    expect(p!.gender).toEqual({ group: 'female', index: 0.47 });
  });
  it('audience profile is null when Qloo returns no demographics', async () => {
    const q = new QlooHttp('K', async () => ok({ results: {} }), { minGapMs: 0 });
    expect(await q.audienceProfile!({ id: 'A', name: 'B' })).toBeNull();
  });
  it('venue radius and tag overrides reach the request; openers carry popularity; baseline has no location', async () => {
    const urls: string[] = [];
    const f: FetchLike = async (u) => { urls.push(decodeURIComponent(u)); return ok({ results: { entities: [{ entity_id: 'X', name: 'X', popularity: 0.4, query: { affinity: 0.7 } }] } }); };
    const q = new QlooHttp('K', f, { minGapMs: 0 });
    const c = { id: 'c', name: 'c', lat: 1, lon: 2, affinity: 0.5 };
    await q.venuesNear({ id: 'A', name: 'B' }, c, 5, { radiusM: 40000, tag: 'urn:tag:genre:place:concert_hall' });
    expect(urls[0]).toContain('filter.location.radius=40000');
    expect(urls[0]).toContain('filter.tags=urn:tag:genre:place:concert_hall');
    const o = await q.openersNear({ id: 'A', name: 'B' }, c, 3);
    expect(o[0].popularity).toBe(0.4);
    const base = await q.openersBaseline!({ id: 'A', name: 'B' }, 20);
    expect(urls[2]).not.toContain('signal.location');
    expect(base[0]).toEqual({ id: 'X', affinity: 0.7 });
  });
  it('city tags and artist popularity are mapped from real-shaped responses', async () => {
    const f: FetchLike = async (u) => ok(u.includes('/search')
      ? { results: [{ entity_id: 'A', name: 'B', popularity: 0.91 }] }
      : { results: { entities: [{ entity_id: 'D', name: 'Portland', location: { lat: 1, lon: 2 }, query: { affinity: 0.9 }, tags: [{ id: 't', name: 'Foodie Destination' }] }] } });
    const q = new QlooHttp('K', f, { minGapMs: 0 });
    const a = await q.searchArtist('B');
    expect(a!.popularity).toBe(0.91);
    expect((await q.rankCities(a!, 5))[0].tags).toEqual(['Foodie Destination']);
  });
  it('audience reaches the result and a failing audience call is degraded, not fatal', async () => {
    const p = port();
    const good = await routeTour({ ...p, audienceProfile: async () => ({ topAge: { band: '25_to_29', index: 0.33 }, gender: { group: 'female', index: 0.47 } }) }, { artistName: 'Band', home, stops: 3 });
    expect(good.audience!.text).toMatch(/25.29/);
    const bad = await routeTour({ ...p, audienceProfile: async () => { throw new Error('x'); } }, { artistName: 'Band', home, stops: 3 });
    expect(bad.audience).toBeNull();
    expect(bad.degraded.join(' ')).toMatch(/audience/);
  });
});
