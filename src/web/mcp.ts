// Agentic surface: MCP tools so any agent (Claude, Cursor, custom) can route tours and re-plan on follow-ups.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { routeTour, type TastePort } from '../application/routeTour.js';
import { portFromEnv } from './portFromEnv.js';

const planInput = {
  artist: z.string().min(1).describe('Artist name'),
  home_lat: z.number().describe('Start latitude'),
  home_lon: z.number().describe('Start longitude'),
  stops: z.number().int().min(2).max(12).default(8),
  max_leg_km: z.number().min(100).max(2000).default(650),
  must_include: z.array(z.string()).default([]).describe('City ids that must stay on the route'),
  exclude: z.array(z.string()).default([]).describe('City ids to drop'),
};
type PlanArgs = { artist: string; home_lat: number; home_lon: number; stops: number; max_leg_km: number; must_include: string[]; exclude: string[] };
const run = (port: TastePort, a: PlanArgs) =>
  routeTour(port, { artistName: a.artist, home: { lat: a.home_lat, lon: a.home_lon }, stops: a.stops, maxLegKm: a.max_leg_km, mustInclude: a.must_include, exclude: a.exclude });
const reply = (o: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(o, null, 2) }], structuredContent: o as Record<string, unknown> });

export function makeMcp(port: TastePort): McpServer {
  const mcp = new McpServer({ name: 'tour-router', version: '0.3.0' });
  mcp.registerTool(
    'plan_tour',
    {
      description:
        'Plan: route an artist through the cities where their audience taste (Qloo) is concentrated, with taste-matched rooms and openers per stop. ' +
        'The planner checks its own plan (room exists, opener weight class, drive limits, taste-rank cap), re-queries Qloo with changed conditions when a check fails, and returns the decision trace. ' +
        'Call again with must_include / exclude to re-plan after user feedback; call explain_stop for one stop.',
      inputSchema: planInput,
    },
    async (a) => {
      const r = await run(port, a);
      return reply({
        dataMode: r.dataMode,
        artist: r.artist.name,
        audience: r.audience?.text ?? null,
        route: r.taste.stops.map((s) => ({
          id: s.city.id, city: s.city.name, affinity: s.affinity, rank: s.affinityRank,
          why: r.stopNotes[s.city.id]?.summary, rankNote: r.stopNotes[s.city.id]?.rankNote ?? null,
          venues: (s.city.venues ?? []).map((v) => ({ name: v.name, affinity: v.affinity, kind: v.kind, size: v.size, sizeEstimate: v.tier, fitForArtist: v.fit, city: v.city })),
          movedFrom: s.city.relocatedFrom ?? null,
          openers: (s.city.openers ?? []).map((o) => ({ name: o.name, scope: o.scope, popularity: o.popularity ?? null })),
        })),
        totalKm: Math.round(r.taste.totalKm),
        routeStats: { ...r.taste.stats, driveHours: Math.round(r.taste.stats.driveHours * 10) / 10 },
        marketBaseline: { stops: r.generic.stops.map((s) => ({ city: s.city.name, pop: s.city.population })), omittedFromTasteRoute: r.baselineOmissions },
        stopMarkets: r.stopMarkets,
        warnings: r.taste.warnings,
        unfilled: r.unfilled,
        degraded: r.degraded,
        selfCheck: r.selfCheck,
        trace: r.trace,
        tasteVsGeneric: { changedCities: r.lift.changed.count, added: r.lift.added, dropped: r.lift.dropped, tasteMeanRank: r.lift.changed.tasteMeanRank, genericMeanRank: r.lift.changed.genericMeanRank },
        cityPitches: r.cityPitches,
      });
    },
  );
  mcp.registerTool(
    'explain_stop',
    {
      description:
        'Explain: why one city is (or is not) on the route: its taste rank, rooms, openers, what the self-check changed for it, and the promoter email. ' +
        'Pass the same arguments as plan_tour plus city_id. Qloo responses are cached, so this does not repeat the API calls.',
      inputSchema: { ...planInput, city_id: z.string().min(1).describe('City id from plan_tour (also works for a dropped city)') },
    },
    async (a) => {
      const r = await run(port, a);
      const stop = r.taste.stops.find((s) => s.city.id === a.city_id);
      const key = stop?.city.name ?? '';
      const trace = r.trace.filter((t) => t.cityId === a.city_id || t.city === key || (!stop && t.city.startsWith(a.city_id)));
      const droppedName = r.trace.find((t) => /drop/i.test(t.action) && t.city.split(',')[0] === a.city_id)?.city;
      const note = stop ? r.stopNotes[stop.city.id] : null;
      return reply({
        city: stop?.city.name ?? droppedName ?? a.city_id,
        onRoute: Boolean(stop),
        rank: stop?.affinityRank ?? null,
        affinity: stop?.affinity ?? null,
        why: note ? [note.summary, note.rankNote].filter(Boolean).join(' ') : 'Not on the route: see trace.',
        cityTags: stop?.city.tags ?? [],
        venues: (stop?.city.venues ?? []).map((v) => ({ name: v.name, affinity: v.affinity, kind: v.kind, size: v.size })),
        openers: (stop?.city.openers ?? []).map((o) => ({ name: o.name, scope: o.scope })),
        trace: trace.length ? trace : r.trace.filter((t) => t.city === (droppedName ?? '')),
        email: stop ? r.cityPitches[stop.city.id] : '',
        degraded: r.degraded,
      });
    },
  );
  return mcp;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await makeMcp(portFromEnv()).connect(new StdioServerTransport());
}
