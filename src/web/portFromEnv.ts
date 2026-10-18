import type { TastePort } from '../application/routeTour.js';
import { QlooHttp } from '../adapters/qlooHttp.js';
import { SampleTaste } from '../adapters/sampleTaste.js';

export function portFromEnv(env: NodeJS.ProcessEnv = process.env): TastePort {
  return env.QLOO_API_KEY ? new QlooHttp(env.QLOO_API_KEY) : new SampleTaste();
}

import { GeminiLlm } from '../adapters/geminiLlm.js';
import type { LlmPort } from '../application/agent.js';
/** A factory for one LlmPort per chat turn (so the call count is per turn), or one returning null without GEMINI_API_KEY. */
export const llmFromEnv = (env: NodeJS.ProcessEnv = process.env): (() => LlmPort | null) => () => (env.GEMINI_API_KEY ? new GeminiLlm(env.GEMINI_API_KEY) : null);
