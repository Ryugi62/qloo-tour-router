import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { makeServer, portFromEnv } from '../src/web/server';
import { SampleTaste } from '../src/adapters/sampleTaste';

const srv = makeServer(new SampleTaste());
let base = '';
beforeAll(async () => {
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => srv.close(() => r())));

describe('web adapter', () => {
  it('AC-6 no key → sample mode labelled on every response', async () => {
    expect(portFromEnv({}).mode).toBe('sample');
    const j = await (await fetch(`${base}/api/plan?artist=folk&home=40.71,-74.01`)).json();
    expect(j.dataMode).toBe('sample');
    expect(j.taste.stops.filter((s: any) => !s.bridge)).toHaveLength(8);
  });
  it('AC-7 served HTML never contains the key value', async () => {
    const key = 'qk_test_SECRET_123';
    expect(portFromEnv({ QLOO_API_KEY: key }).mode).toBe('live');
    const html = await (await fetch(`${base}/`)).text();
    expect(html).not.toContain(key);
    expect(html).not.toMatch(/X-Api-Key/i);
  });
  it('rejects a missing artist with 400', async () => {
    expect((await fetch(`${base}/api/plan?artist=`)).status).toBe(400);
  });
});

describe('live-mode page', () => {
  it('labels live data and supports a shareable ?artist= link', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('Live Qloo taste data');
    expect(html).toContain("get('artist')");
  });
});

describe('quality fields over HTTP and in the page', () => {
  it('plan JSON carries the changed-cities metric, degraded and region-wide notes', async () => {
    const j = await (await fetch(`${base}/api/plan?artist=folk&home=40.71,-74.01`)).json();
    expect(j.lift.changed).toHaveProperty('count');
    expect(Array.isArray(j.degraded)).toBe(true);
    expect(Array.isArray(j.regionWideOpeners)).toBe(true);
  });
  it('page leads with the changed-cities line and states Qloo gives no capacity', async () => {
    const html = await (await fetch(`${base}/`)).text();
    expect(html).toContain('headline(c, n)');
    expect(html).toContain('Qloo returns no capacity');
    expect(html.toLowerCase()).not.toMatch(/ticket sales will|sell out/);
  });
});
