import { beforeEach, describe, expect, it } from 'vitest';
import { chatTurn, resolveCity, hoursToLegKm, type LlmMessage, type LlmPort, type PlanState } from '../src/application/agent';
import { GeminiLlm, resetExhausted, type GeminiFetch } from '../src/adapters/geminiLlm';
import type { CandidateCity, Venue } from '../src/domain/planner';
import type { TastePort } from '../src/application/routeTour';
import { LLM_MAX_TOOL_ROUNDS } from '../src/domain/constants';

const city = (id: string, name: string, lat: number, lon: number, affinity: number): CandidateCity => ({ id, name, lat, lon, affinity });
const NE = [
  city('wil', 'Williamstown, Massachusetts', 42.71, -73.2, 0.95), city('bos', 'Boston, Massachusetts', 42.36, -71.06, 0.9), city('bar', 'Bar Harbor, Maine', 44.39, -68.2, 0.89),
  city('bur', 'Burlington, Vermont', 44.48, -73.21, 0.88), city('pit', 'Pittsburgh, Pennsylvania', 40.44, -80.0, 0.84), city('syr', 'Syracuse, New York', 43.05, -76.15, 0.82),
  city('har', 'Hartford, Connecticut', 41.76, -72.68, 0.78), city('buf', 'Buffalo, New York', 42.89, -78.88, 0.74), city('bal', 'Baltimore, Maryland', 39.29, -76.61, 0.72),
  city('cle', 'Cleveland, Ohio', 41.5, -81.69, 0.7), city('por', 'Portland, Maine', 43.66, -70.26, 0.69),
];
const MONTREAL = city('mtl', 'Montreal', 45.5038, -73.5744, 0);
const room = (id: string): Venue => ({ id, name: `Room ${id}`, affinity: 0.8, popularity: 0.95, tags: ['urn:tag:genre:place:concert_hall'] });
const port: TastePort = {
  mode: 'live', searchArtist: async () => ({ id: 'A', name: 'Band', popularity: 0.93 }), rankCities: async () => NE,
  venuesNear: async (_a, c) => [room(`r-${c.id}`)], openersNear: async () => [],
  searchCity: async (n) => (/montreal/i.test(n) ? MONTREAL : null),
};
const home = { lat: 40.71, lon: -74.01 };
const state: PlanState = { artist: 'Band', home, stops: 6, maxLegKm: 650, exclude: [], must: [], extra: [] };

/** Scripted model: each entry is the next reply; records what it was sent. */
function fakeLlm(script: LlmMessage['parts'][]): LlmPort & { seen: LlmMessage[][] } {
  const seen: LlmMessage[][] = [];
  let i = 0;
  return { seen, get calls() { return i; }, async generate(_s, messages) { seen.push([...messages]); return { role: 'model', parts: script[Math.min(i++, script.length - 1)] }; } };
}

describe('S25 planner chat', () => {
  it('AC-28 natural-language constraints become tool calls: drop a city, add Montreal, limit driving; the model reason is stored', async () => {
    const llm = fakeLlm([
      [{ call: { name: 'search_city', args: { name: 'Montreal' } } }],
      [{ call: { name: 'plan_tour', args: { exclude_cities: ['Bar Harbor'], include_cities: ['Montreal'], max_drive_hours_per_day: 5, reason: 'User wants Montreal instead of the Maine dead end and at most 5 hours of driving per day.' } } }],
      [{ text: 'Dropped Bar Harbor and added Montreal; every drive is now under 5 hours.' }],
    ]);
    const before = await chatTurn(port, fakeLlm([[{ text: 'ok' }]]), state, 'no change');
    expect(before.before.route.map((r) => r.city)).toContain('Bar Harbor, Maine');
    const t = await chatTurn(port, llm, state, 'Drop Bar Harbor, add Montreal, and max 5 hours of driving a day');
    expect(t.tools.map((x) => x.name)).toEqual(['search_city', 'plan_tour']);
    expect(t.tools.every((x) => x.ok)).toBe(true);
    expect(t.after.route.map((r) => r.city)).toContain('Montreal');
    expect(t.after.route.map((r) => r.city).join('|')).not.toMatch(/Bar Harbor/);
    expect(t.diff.removed).toContain('Bar Harbor, Maine');
    expect(t.diff.added).toContain('Montreal');
    expect(t.state.maxLegKm).toBe(hoursToLegKm(5));
    expect(t.state.maxLegKm).toBe(320);
    expect(t.state.exclude).toContain('bar');
    expect(t.state.extra.map((c) => c.id)).toEqual(['mtl']);
    const llmTrace = t.result.trace.filter((x) => x.check === 'llm');
    expect(llmTrace).toHaveLength(1);
    expect(llmTrace[0].outcome).toMatch(/Montreal instead of the Maine dead end/);
    expect(t.reasons).toHaveLength(1);
    expect(t.llmCalls).toBe(3);
    expect(t.reply).toMatch(/Montreal/);
    // the model got the tool results back
    expect(JSON.stringify(llm.seen[2])).toContain('"result"');
  });
  it('an unknown city is an error the model can see and recover from, not a silent change', async () => {
    const llm = fakeLlm([
      [{ call: { name: 'plan_tour', args: { include_cities: ['Atlantis'], reason: 'x' } } }],
      [{ call: { name: 'plan_tour', args: { exclude_cities: ['Boston'], reason: 'fallback' } } }],
      [{ text: 'Done.' }],
    ]);
    const t = await chatTurn(port, llm, state, 'add Atlantis');
    expect(t.tools[0].ok).toBe(false);
    expect(t.tools[0].note).toMatch(/unknown city: Atlantis/);
    expect(t.tools[1].ok).toBe(true);
    expect(t.after.route.map((r) => r.city).join('|')).not.toMatch(/Boston/);
  });
  it('tool rounds are bounded', async () => {
    const llm = fakeLlm([[{ call: { name: 'explain_stop', args: { city: 'Boston' } } }]]);
    const t = await chatTurn(port, llm, state, 'loop forever');
    expect(t.llmCalls).toBe(LLM_MAX_TOOL_ROUNDS);
    expect(t.reply.length).toBeGreaterThan(0);
  });
  it('a provider failure surfaces as an error (the caller answers 502), never as a changed plan', async () => {
    const bad: LlmPort = { calls: 0, generate: async () => { throw new Error('Gemini → HTTP 429'); } };
    await expect(chatTurn(port, bad, state, 'x')).rejects.toThrow(/429/);
  });
  it('resolveCity: exact, moved-from, prefix', () => {
    const pool = [{ id: 'a', name: 'Troy, New York', relocatedFrom: 'Williamstown, Massachusetts' }, { id: 'b', name: 'Bar Harbor, Maine' }, { id: 'c', name: 'Portland, Oregon' }];
    expect(resolveCity('williamstown', pool)).toBe('a');
    expect(resolveCity('Bar Harbor', pool)).toBe('b');
    expect(resolveCity('port', pool)).toBe('c');
    expect(resolveCity('Nowhere', pool)).toBeNull();
  });
});

describe('adapter contract: GeminiLlm', () => {
  beforeEach(() => resetExhausted());
  it('sends the key only as x-goog-api-key, declares tools, maps functionCall and text parts', async () => {
    const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
    const fake: GeminiFetch = async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ functionCall: { name: 'plan_tour', args: { reason: 'r' } } }, { text: 'hi' }] } }] }) };
    };
    const g = new GeminiLlm('SECRETKEY', fake, ['m1']);
    const out = await g.generate('sys', [{ role: 'user', parts: [{ text: 'hello' }] }], [{ name: 'plan_tour', description: 'd', parameters: { type: 'OBJECT' } }]);
    expect(out.parts).toEqual([{ call: { name: 'plan_tour', args: { reason: 'r' } } }, { text: 'hi' }]);
    expect(calls[0].url).toContain('generativelanguage.googleapis.com');
    expect(calls[0].url).not.toContain('SECRETKEY');
    expect(calls[0].body).not.toContain('SECRETKEY');
    expect(calls[0].headers['x-goog-api-key']).toBe('SECRETKEY');
    expect(JSON.parse(calls[0].body).tools[0].functionDeclarations[0].name).toBe('plan_tour');
    expect(g.calls).toBe(1);
  });
  it('surfaces HTTP errors', async () => {
    const g = new GeminiLlm('K', async () => ({ ok: false, status: 401, json: async () => ({}) }), ['m'], async () => {});
    await expect(g.generate('s', [{ role: 'user', parts: [{ text: 'x' }] }], [])).rejects.toThrow(/401/);
    expect(g.calls).toBe(1);
  });
  it('a model out of quota (429) moves on to the next model and is skipped afterwards', async () => {
    const urls: string[] = [];
    const g = new GeminiLlm('K', async (url) => { urls.push(url); return url.includes('/a:') ? { ok: false, status: 429, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'fine' }] } }] }) }; }, ['a', 'b'], async () => {});
    expect((await g.generate('s', [{ role: 'user', parts: [{ text: 'x' }] }], [])).parts).toEqual([{ text: 'fine' }]);
    expect(g.model).toBe('b');
    await g.generate('s', [{ role: 'user', parts: [{ text: 'x' }] }], []);
    expect(urls.filter((u) => u.includes('/a:'))).toHaveLength(1);
  });
  it('reports 429 when every model is out of quota', async () => {
    const bad = new GeminiLlm('K', async () => ({ ok: false, status: 429, json: async () => ({}) }), ['m'], async () => {});
    await expect(bad.generate('s', [{ role: 'user', parts: [{ text: 'x' }] }], [])).rejects.toThrow(/429/);
  });
});
