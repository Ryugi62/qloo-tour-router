import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { makeServer, llmFromEnv } from '../src/web/server';
import { SampleTaste } from '../src/adapters/sampleTaste';
import type { LlmPort } from '../src/application/agent';
import { LLM_HOURLY_CAP } from '../src/domain/constants';

const scripted = (): LlmPort => {
  let i = 0;
  return {
    get calls() { return i; },
    async generate() {
      i++;
      return i === 1
        ? { role: 'model', parts: [{ call: { name: 'plan_tour', args: { stops: 5, max_drive_hours_per_day: 6, reason: 'fewer, shorter shows' } } }] }
        : { role: 'model', parts: [{ text: 'Five stops, none over 6 hours.' }] };
    },
  };
};
const on = makeServer(new SampleTaste(), { llm: () => scripted() });
const off = makeServer(new SampleTaste());
let a = ''; let b = '';
beforeAll(async () => {
  await Promise.all([on, off].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))));
  a = `http://127.0.0.1:${(on.address() as AddressInfo).port}`;
  b = `http://127.0.0.1:${(off.address() as AddressInfo).port}`;
});
afterAll(async () => { await Promise.all([on, off].map((s) => new Promise<void>((r) => s.close(() => r())))); });
const post = (base: string, body: unknown) => fetch(`${base}/api/chat`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
const ok = { artist: 'folk', home: { lat: 40.71, lon: -74.01 }, message: 'five stops, max 6 hours of driving' };

describe('S25 /api/chat', () => {
  it('a model failure answers 502 with a plain message, not a changed plan', async () => {
    const failing = makeServer(new SampleTaste(), { llm: () => ({ calls: 0, generate: async () => { throw new Error('Gemini → HTTP 429'); } }) });
    await new Promise<void>((r) => failing.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(failing.address() as AddressInfo).port}`;
    const r = await post(base, ok);
    expect(r.status).toBe(502);
    expect((await r.json()).error).toMatch(/busy/);
    await new Promise<void>((r2) => failing.close(() => r2()));
  });
  it('without a Gemini key it answers 503 and the rest of the app works', async () => {
    expect(llmFromEnv({})()).toBeNull();
    expect((await post(b, ok)).status).toBe(503);
    expect((await (await fetch(`${b}/api/meta`)).json()).chat).toBe(false);
    expect((await fetch(`${b}/api/plan?artist=folk&home=40.71,-74.01`)).status).toBe(200);
  });
  it('with a model it returns before, after, diff, tool log and the reason in the trace', async () => {
    expect((await (await fetch(`${a}/api/meta`)).json()).chat).toBe(true);
    const r = await post(a, ok);
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.after.route.filter((x: any) => x).length).toBeLessThanOrEqual(7);
    expect(j.state.stops).toBe(5);
    expect(j.state.maxLegKm).toBe(384);
    expect(j.tools[0].name).toBe('plan_tour');
    expect(j.llmCalls).toBe(2);
    expect(j.result.trace.some((t: any) => t.check === 'llm' && /fewer, shorter shows/.test(t.outcome))).toBe(true);
  });
  it('validates the body: bad JSON, missing message, oversize, and clamps client state', async () => {
    expect((await post(a, '{nope')).status).toBe(400);
    expect((await post(a, { ...ok, message: '' })).status).toBe(400);
    expect((await post(a, { ...ok, home: { lat: 'x' } })).status).toBe(400);
    expect((await post(a, 'x'.repeat(20000))).status).toBe(413);
    const j = await (await post(a, { ...ok, state: { stops: 999, maxLegKm: 1, exclude: ['a'.repeat(500)] } })).json();
    expect(j.state.stops).toBe(5); // the model's plan_tour call sets it; the client value was clamped first
  });
  it('the key never appears in the page or a response', async () => {
    const html = await (await fetch(`${a}/`)).text();
    expect(html).not.toMatch(/x-goog-api-key|GEMINI_API_KEY/i);
  });
  it('an hourly cap protects the model quota', async () => {
    const capped = makeServer(new SampleTaste(), { llm: () => scripted() });
    await new Promise<void>((r) => capped.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(capped.address() as AddressInfo).port}`;
    let last = 200;
    for (let i = 0; i < LLM_HOURLY_CAP + 1; i++) last = (await post(base, ok)).status;
    expect(last).toBe(429);
    await new Promise<void>((r) => capped.close(() => r()));
  }, 60000);
});
