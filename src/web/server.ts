// Web adapter: static UI + JSON API. Key read server-side only (SPEC S4).
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { routeTour, ArtistNotFound, type TastePort } from '../application/routeTour';
import { SAMPLE_ARTISTS } from '../adapters/sampleTaste';
import { portFromEnv } from './portFromEnv';
export { portFromEnv };

const here = dirname(fileURLToPath(import.meta.url));
const INDEX = readFileSync(join(here, 'index.html'), 'utf8');


export function makeServer(port: TastePort): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://local');
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(INDEX);
        return;
      }
      if (url.pathname === '/api/meta') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ dataMode: port.mode, sampleArtists: port.mode === 'sample' ? SAMPLE_ARTISTS : [] }));
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
        const result = await routeTour(port, { artistName, home: { lat, lon }, stops, mustInclude: list('must'), exclude: list('exclude') });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      const notFound = e instanceof ArtistNotFound;
      res.writeHead(notFound ? 404 : 502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: notFound ? (e as Error).message : 'Taste service unavailable' }));
    }
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const p = Number(process.env.PORT ?? 8787);
  makeServer(portFromEnv()).listen(p, '127.0.0.1', () => console.log(`Tour Router on http://127.0.0.1:${p}`));
}
