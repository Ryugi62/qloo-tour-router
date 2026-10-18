// Web adapter: static UI + JSON API. Key read server-side only (SPEC S4).
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { routeTour, ArtistNotFound, type TastePort } from '../application/routeTour.js';
import { chatTurn, type LlmPort, type PlanState } from '../application/agent.js';
import { AVG_SPEED_KMH, LLM_HOURLY_CAP, ROAD_FACTOR } from '../domain/constants.js';
import { SAMPLE_ARTISTS } from '../adapters/sampleTaste.js';
import { portFromEnv, llmFromEnv } from './portFromEnv.js';
export { portFromEnv, llmFromEnv };

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(join(here, 'index.html'), 'utf8');


class TooLarge extends Error {}
/** Reads at most `max` characters; a bigger body is drained (not stored) and rejected so the client still gets an answer. */
const readBody = (req: import('node:http').IncomingMessage, max = 8192) => new Promise<string>((resolve, reject) => {
  let buf = ''; let big = false;
  req.on('data', (d) => { if (big) return; buf += d; if (buf.length > max) { big = true; buf = ''; } });
  req.on('end', () => (big ? reject(new TooLarge('body too large')) : resolve(buf)));
  req.on('error', reject);
});
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const strs = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 80)).slice(0, 12) : []);
/** Browser-supplied plan state, validated: nothing from the body reaches the model or Qloo unclamped. */
function stateFromBody(b: any): PlanState | null {
  const lat = num(b?.home?.lat); const lon = num(b?.home?.lon);
  const artist = typeof b?.artist === 'string' ? b.artist.slice(0, 120) : '';
  if (!artist || lat === null || lon === null) return null;
  const extra = (Array.isArray(b?.state?.extra) ? b.state.extra : []).slice(0, 3).flatMap((c: any) => {
    const clat = num(c?.lat); const clon = num(c?.lon);
    return typeof c?.id === 'string' && typeof c?.name === 'string' && clat !== null && clon !== null ? [{ id: c.id.slice(0, 64), name: c.name.slice(0, 80), lat: clat, lon: clon, affinity: 0 }] : [];
  });
  return {
    artist, home: { lat, lon }, extra,
    stops: Math.max(2, Math.min(12, Math.round(num(b?.state?.stops) ?? 8))),
    maxLegKm: Math.max(100, Math.min(2000, Math.round(num(b?.state?.maxLegKm) ?? 650))),
    exclude: strs(b?.state?.exclude), must: strs(b?.state?.must),
  };
}

export interface ServerOptions { /** A fresh LlmPort per chat turn, or null when no Gemini key is configured. */ llm?: () => LlmPort | null }
export function makeServer(port: TastePort, opts: ServerOptions = {}): Server {
  const stamps: number[] = [];
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      if (url.pathname === '/api/chat' && req.method === 'POST') {
        const llm = opts.llm?.() ?? null;
        if (!llm) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'The planner chat is not configured on this server.' })); return; }
        const now = Date.now();
        while (stamps.length && now - stamps[0] > 3600_000) stamps.shift();
        if (stamps.length >= LLM_HOURLY_CAP) { res.writeHead(429, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Chat limit reached for this hour. Try again later.' })); return; }
        let body: any;
        try { body = JSON.parse(await readBody(req)); } catch (e) { if (e instanceof TooLarge) { res.writeHead(413, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'message too large' })); return; } res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid JSON body' })); return; }
        const st = stateFromBody(body);
        const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 400) : '';
        if (!st || !message) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'artist, home{lat,lon} and message are required' })); return; }
        stamps.push(now);
        let turn;
        try { turn = await chatTurn(port, llm, st, message); }
        catch (e) {
          if (/^Gemini/.test((e as Error).message)) { console.error('llm error:', (e as Error).message); res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'The planner model is busy. Try again in a minute; the plan on screen is unchanged.' })); return; }
          throw e;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(turn));
        return;
      }
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(INDEX);
        return;
      }
      if (url.pathname === '/api/meta') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ dataMode: port.mode, sampleArtists: port.mode === 'sample' ? SAMPLE_ARTISTS : [], chat: Boolean(opts.llm?.()), drive: { roadFactor: ROAD_FACTOR, avgSpeedKmh: AVG_SPEED_KMH } }));
        return;
      }
      if (url.pathname === '/api/plan') {
        const artistName = (url.searchParams.get('artist') ?? '').slice(0, 120);
        const [lat, lon] = (url.searchParams.get('home') ?? '40.71,-74.01').split(',').map(Number);
        const stops = Math.max(2, Math.min(12, Number(url.searchParams.get('stops') ?? 8) || 8));
        const list = (k: string) => (url.searchParams.get(k) ?? '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12);
        if (!artistName || !Number.isFinite(lat) || !Number.isFinite(lon)) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'artist and home=lat,lon are required' }));
          return;
        }
        const maxLegKm = Math.max(100, Math.min(2000, Math.round(Number(url.searchParams.get('maxleg')) || 650)));
        let extra: PlanState['extra'] = [];
        try { extra = stateFromBody({ artist: artistName, home: { lat, lon }, state: { extra: JSON.parse(url.searchParams.get('extra') ?? '[]') } })?.extra ?? []; } catch { /* ignore a malformed extra list */ }
        const result = await routeTour(port, { artistName, home: { lat, lon }, stops, maxLegKm, mustInclude: list('must'), exclude: list('exclude'), extraCities: extra });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      const notFound = e instanceof ArtistNotFound;
      if (!notFound) console.error('taste error:', (e as Error).message);
      res.writeHead(notFound ? 404 : 502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: notFound ? (e as Error).message : 'Taste service unavailable' }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = Number(process.env.PORT ?? 8787);
  makeServer(portFromEnv(), { llm: llmFromEnv() }).listen(p, '127.0.0.1', () => console.log(`Tour Router on http://127.0.0.1:${p}`));
}
