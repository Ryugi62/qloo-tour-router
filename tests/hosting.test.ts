import { describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import handler from '../api/app';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
}

describe('hosting entry (S8)', () => {
  it('serverless handler serves the page and /api/meta', async () => {
    const srv = createServer(handler);
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    expect((await fetch(`${base}/`)).status).toBe(200);
    expect((await (await fetch(`${base}/api/meta`)).json()).dataMode).toMatch(/live|sample/);
    await new Promise<void>((r) => srv.close(() => r()));
  });
  it('relative imports carry .js so the ESM serverless runtime resolves them', () => {
    const bad = [...files('src'), ...files('api')].filter((f) => f.endsWith('.ts')).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/from '(\.\.?\/[^']+)'/g)].filter((m) => !m[1].endsWith('.js')).map((m) => `${f}: ${m[1]}`));
    expect(bad).toEqual([]);
  });
});
