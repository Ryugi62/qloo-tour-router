# Tour Router — taste-grounded tour routing for small booking agencies

Give it an artist. It finds the cities where that artist's audience taste is concentrated (Qloo Taste AI),
picks taste-matched venues, orders the stops into a route, and drafts a promoter pitch — next to the same
request planned **without** taste data, so you can see exactly what Qloo changed.

- Spec: [SPEC.md](SPEC.md) · Tests: `npm test` · Run: `npm start` (http://127.0.0.1:8787)
- No key → clearly labelled sample data. With `QLOO_API_KEY` set (server-side only) → live Qloo calls to
  `https://hackathon.api.qloo.com`.
- Affinity is audience taste overlap, not a ticket-sales forecast.

Layers: `src/domain` (pure) ← `src/application` ← `src/adapters` (Qloo HTTP, sample) ← `src/web`.

## Data sources and the planner chat (v7)
- **Market-size baseline** — the "without taste data" plan routes the largest US metros near the start by population.
  Population: US Census Bureau Vintage 2024 metro estimates (`cbsa-est2024-alldata.csv`, https://www2.census.gov/programs-surveys/popest/datasets/2020-2024/metro/totals/cbsa-est2024-alldata.csv);
  coordinates: Census TIGERweb CBSA layer (https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/CBSA/MapServer/3).
  Fetched once by `node scripts/build-markets.mjs` into `src/domain/data/usMarkets.ts` (public statistics, no scraping at runtime, no personal data).
- **Rooms** carry their own city and coordinates from Qloo; a stop is where its room is. **Room size** is an estimate from Qloo tags/popularity, never a capacity.
- **Route order** is exact (dynamic programming, ≤ 12 stops); drive hours are an estimate (km × 1.25 ÷ 80 km/h).
- **Planner chat** — `POST /api/chat` lets Gemini (`GEMINI_API_KEY`, server-side only) call `plan_tour`, `search_city`, `explain_stop`; the model's reason is stored in the decision trace. No key → 503, the rest works.
