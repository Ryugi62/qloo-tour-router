// Agentic surface: MCP tools so any agent (Claude, Cursor, custom) can route tours and re-plan on follow-ups.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { routeTour, type TastePort } from '../application/routeTour.js';
import { portFromEnv } from './portFromEnv.js';

export function makeMcp(port: TastePort): McpServer {
  const mcp = new McpServer({ name: 'tour-router', version: '0.2.0' });
  mcp.registerTool(
    'plan_tour',
    {
      description:
        'Route an artist through the cities where their audience taste (Qloo) is concentrated, compared with a generic big-market plan. ' +
        'Call again with must_include / exclude to re-plan after user feedback.',
      inputSchema: {
        artist: z.string().min(1).describe('Artist name'),
        home_lat: z.number().describe('Start latitude'),
        home_lon: z.number().describe('Start longitude'),
        stops: z.number().int().min(2).max(12).default(8),
        max_leg_km: z.number().min(100).max(2000).default(650),
        must_include: z.array(z.string()).default([]).describe('City ids that must stay on the route'),
        exclude: z.array(z.string()).default([]).describe('City ids to drop'),
      },
    },
    async (a) => {
      const r = await routeTour(port, {
        artistName: a.artist, home: { lat: a.home_lat, lon: a.home_lon }, stops: a.stops, maxLegKm: a.max_leg_km,
        mustInclude: a.must_include, exclude: a.exclude,
      });
      const summary = {
        dataMode: r.dataMode,
        artist: r.artist.name,
        route: r.taste.stops.map((s) => ({ id: s.city.id, city: s.city.name, affinity: s.affinity, rank: s.affinityRank })),
        totalKm: Math.round(r.taste.totalKm),
        warnings: r.taste.warnings,
        tasteVsGeneric: { added: r.lift.added, dropped: r.lift.dropped, meanAffinityTaste: r.lift.meanAffinityTaste, meanAffinityGeneric: r.lift.meanAffinityGeneric },
        cityPitches: r.cityPitches,
      };
      return { content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }], structuredContent: summary };
    },
  );
  return mcp;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await makeMcp(portFromEnv()).connect(new StdioServerTransport());
}
