import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { makeMcp } from '../src/web/mcp';
import { SampleTaste } from '../src/adapters/sampleTaste';

describe('UC-4 MCP tool plan_tour', () => {
  it('lists the tool and re-plans with exclude/must_include', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    const server = makeMcp(new SampleTaste());
    await server.connect(a);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(b);
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('plan_tour');
    const r1: any = await client.callTool({ name: 'plan_tour', arguments: { artist: 'folk', home_lat: 40.7, home_lon: -74 } });
    const first = r1.structuredContent.route[0].id;
    const r2: any = await client.callTool({ name: 'plan_tour', arguments: { artist: 'folk', home_lat: 40.7, home_lon: -74, exclude: [first], must_include: ['atx'] } });
    const ids = r2.structuredContent.route.map((x: any) => x.id);
    expect(ids).not.toContain(first);
    expect(ids).toContain('atx');
    expect(r2.structuredContent.dataMode).toBe('sample');
    await client.close();
  });
});
