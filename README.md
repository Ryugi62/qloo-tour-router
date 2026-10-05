# Tour Router — taste-grounded tour routing for small booking agencies

Give it an artist. It finds the cities where that artist's audience taste is concentrated (Qloo Taste AI),
picks taste-matched venues, orders the stops into a route, and drafts a promoter pitch — next to the same
request planned **without** taste data, so you can see exactly what Qloo changed.

- Spec: [SPEC.md](SPEC.md) · Tests: `npm test` · Run: `npm start` (http://127.0.0.1:8787)
- No key → clearly labelled sample data. With `QLOO_API_KEY` set (server-side only) → live Qloo calls to
  `https://hackathon.api.qloo.com`.
- Affinity is audience taste overlap, not a ticket-sales forecast.

Layers: `src/domain` (pure) ← `src/application` ← `src/adapters` (Qloo HTTP, sample) ← `src/web`.
