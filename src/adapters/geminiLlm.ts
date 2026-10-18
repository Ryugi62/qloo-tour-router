// Adapter: Gemini generateContent with function calling (https://ai.google.dev/api/generate-content). Key stays server-side (x-goog-api-key header).
import type { LlmMessage, LlmPart, LlmPort, ToolSpec } from '../application/agent.js';

export type GeminiFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
/** Tried in order. The free tier gives each model its own small daily quota (gemini-2.5-flash: 20 requests/day), so a 429 moves on to the next model. */
export const GEMINI_MODELS: readonly string[] = ['gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-3.6-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
const EXHAUSTED_MS = 3600_000;
const exhaustedUntil = new Map<string, number>();
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Forget which models were out of quota (tests). */
export const resetExhausted = () => exhaustedUntil.clear();
export class GeminiLlm implements LlmPort {
  calls = 0;
  /** The model that answered the last call. */
  model = '';
  constructor(private readonly apiKey: string, private readonly fetchImpl: GeminiFetch = fetch as unknown as GeminiFetch, private readonly models: readonly string[] = GEMINI_MODELS, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  private post(model: string, body: unknown) {
    this.calls++;
    return this.fetchImpl(`${BASE}/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body) });
  }

  async generate(system: string, messages: readonly LlmMessage[], tools: readonly ToolSpec[]): Promise<LlmMessage> {
    const contents = messages.map((m) => ({ role: m.role, parts: m.raw ?? m.parts.map(toGemini) }));
    const body = (m: string) => ({
      systemInstruction: { parts: [{ text: system }] }, contents,
      tools: [{ functionDeclarations: tools }],
      generationConfig: { temperature: 0, ...(m.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}) },
    });
    let res: Awaited<ReturnType<GeminiLlm['post']>> | null = null;
    for (const m of this.models) {
      if ((exhaustedUntil.get(m) ?? 0) > Date.now()) continue;
      let r = await this.post(m, body(m));
      if (r.status === 503) { await this.sleep(2000); r = await this.post(m, body(m)); }
      if (r.status === 429) { exhaustedUntil.set(m, Date.now() + EXHAUSTED_MS); res = r; continue; }
      res = r; this.model = m; break;
    }
    if (!res) throw new Error('Gemini → HTTP 429');
    if (!res.ok) throw new Error(`Gemini → HTTP ${res.status}`);
    const j = await res.json();
    const rawParts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
    const parts: LlmPart[] = rawParts.flatMap((p): LlmPart[] =>
      p?.functionCall ? [{ call: { name: String(p.functionCall.name), args: (p.functionCall.args ?? {}) as Record<string, unknown> } }] : typeof p?.text === 'string' ? [{ text: p.text }] : []);
    return { role: 'model', parts, raw: rawParts };
  }
}
function toGemini(p: LlmPart): unknown {
  if ('text' in p) return { text: p.text };
  if ('call' in p) return { functionCall: p.call };
  return { functionResponse: { name: p.result.name, response: p.result.response } };
}
