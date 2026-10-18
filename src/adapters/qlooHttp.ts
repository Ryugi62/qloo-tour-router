// Adapter: Qloo hackathon API (https://hackathon.api.qloo.com). Key stays server-side (X-Api-Key header).
// Endpoint/parameter names follow docs.qloo.com hackathon guide; exact location filters are verified once a
// key is issued (see SPEC §1 S2 — nothing is invented when the API returns no data).
import type { TastePort } from '../application/routeTour.js';
import type { Artist } from '../domain/pitch.js';
import type { CandidateCity, Venue } from '../domain/planner.js';

export type FetchLike = (url: string, init: { headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export const QLOO_BASE = 'https://hackathon.api.qloo.com';

/** "Portland" is ambiguous; Qloo returns the region in properties.geocode, so show it. */
function cityLabel(e: any): string {
  const region = e?.properties?.geocode?.admin1_region;
  return region && !String(e.name).includes(region) ? `${e.name}, ${region}` : e.name;
}

export class QlooHttp implements TastePort {
  readonly mode = 'live' as const;
  private readonly cache = new Map<string, { at: number; body: any }>();
  private lastStart = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minGapMs: number;
  private readonly ttlMs: number;
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    opts: { sleep?: (ms: number) => Promise<void>; minGapMs?: number; ttlMs?: number } = {},
  ) {
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.minGapMs = opts.minGapMs ?? 230; // hackathon key: 5 req/s
    this.ttlMs = opts.ttlMs ?? 6 * 3600_000; // hackathon key: 10,000 req/month, so identical queries are cached
  }

  private async get(path: string, params: Record<string, string | number>): Promise<any> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    const url = `${QLOO_BASE}${path}?${qs}`;
    const hit = this.cache.get(url);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.body;
    for (let attempt = 0; ; attempt++) {
      const wait = this.lastStart + this.minGapMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = Date.now();
      const res = await this.fetchImpl(url, { headers: { 'X-Api-Key': this.apiKey } });
      if (res.status === 429 && attempt < 3) { await this.sleep(600 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`Qloo ${path} → HTTP ${res.status}`);
      const body = await res.json();
      this.cache.set(url, { at: Date.now(), body });
      return body;
    }
  }

  async searchArtist(name: string): Promise<Artist | null> {
    const j = await this.get('/search', { query: name, types: 'urn:entity:artist', take: 1 });
    const e = j?.results?.[0];
    return e ? { id: e.entity_id, name: e.name } : null;
  }

  async rankCities(artist: Artist, take: number): Promise<CandidateCity[]> {
    const j = await this.get('/v2/insights', {
      'filter.type': 'urn:entity:destination',
      'signal.interests.entities': artist.id,
      take,
    });
    const ents: any[] = j?.results?.entities ?? [];
    return ents
      .filter((e) => typeof e?.location?.lat === 'number' && typeof e?.location?.lon === 'number')
      .map((e) => ({
        id: e.entity_id,
        name: cityLabel(e),
        lat: e.location.lat,
        lon: e.location.lon,
        affinity: typeof e?.query?.affinity === 'number' ? e.query.affinity : 0,
        population: typeof e?.properties?.population === 'number' ? e.properties.population : undefined,
        popularity: typeof e?.popularity === 'number' ? e.popularity : undefined,
      }));
  }

  async venuesNear(artist: Artist, city: CandidateCity, take: number): Promise<Venue[]> {
    const j = await this.get('/v2/insights', {
      'filter.type': 'urn:entity:place',
      'filter.tags': 'urn:tag:genre:place:live_music_venue',
      'signal.interests.entities': artist.id,
      'filter.location': `POINT(${city.lon} ${city.lat})`,
      'filter.location.radius': 15000,
      take,
    });
    const ents: any[] = j?.results?.entities ?? [];
    return ents.map((e) => ({ id: e.entity_id, name: e.name, affinity: typeof e?.query?.affinity === 'number' ? e.query.affinity : 0 }));
  }

  async openersNear(artist: Artist, city: CandidateCity, take: number) {
    const j = await this.get('/v2/insights', {
      'filter.type': 'urn:entity:artist',
      'signal.interests.entities': artist.id,
      'signal.location': `POINT(${city.lon} ${city.lat})`,
      take: take + 1,
    });
    const ents: any[] = j?.results?.entities ?? [];
    return ents
      .filter((e) => e.entity_id !== artist.id)
      .slice(0, take)
      .map((e) => ({ id: e.entity_id, name: e.name, affinity: typeof e?.query?.affinity === 'number' ? e.query.affinity : 0 }));
  }
}
