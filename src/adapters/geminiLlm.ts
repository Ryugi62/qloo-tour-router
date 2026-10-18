// Adapter: Gemini generateContent with function calling (https://ai.google.dev/api/generate-content). Key stays server-side (x-goog-api-key header).
import type { LlmMessage, LlmPart, LlmPort, ToolSpec } from '../application/agent.js';

export type GeminiFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export const GEMINI_MODEL = 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export class GeminiLlm implements LlmPort {
  calls = 0;
  constructor(private readonly apiKey: string, private readonly fetchImpl: GeminiFetch = fetch as unknown as GeminiFetch, private readonly model = GEMINI_MODEL, private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {}

  private post(body: unknown) {
    this.calls++;
    return this.fetchImpl(`${BASE}/${this.model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey }, body: JSON.stringify(body) });
  }

  async generate(system: string, messages: readonly LlmMessage[], tools: readonly ToolSpec[]): Promise<LlmMessage> {
    const contents = messages.map((m) => ({ role: m.role, parts: m.raw ?? m.parts.map(toGemini) }));
    const body = {
      systemInstruction: { parts: [{ text: system }] }, contents,
      tools: [{ functionDeclarations: tools }],
      generationConfig: { temperature: 0, thinkingConfig: { thinkingBudget: 0 } },
    };
    let res = await this.post(body);
    // One retry for a rate limit or a busy model; anything else is an error the caller reports.
    if (res.status === 429 || res.status === 503) { await this.sleep(2500); res = await this.post(body); }
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
