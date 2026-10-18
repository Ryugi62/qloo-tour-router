import type { TastePort } from '../application/routeTour.js';
import { QlooHttp } from '../adapters/qlooHttp.js';
import { SampleTaste } from '../adapters/sampleTaste.js';

export function portFromEnv(env: NodeJS.ProcessEnv = process.env): TastePort {
  return env.QLOO_API_KEY ? new QlooHttp(env.QLOO_API_KEY) : new SampleTaste();
}
