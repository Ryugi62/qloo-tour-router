import type { TastePort } from '../application/routeTour';
import { QlooHttp } from '../adapters/qlooHttp';
import { SampleTaste } from '../adapters/sampleTaste';

export function portFromEnv(env: NodeJS.ProcessEnv = process.env): TastePort {
  return env.QLOO_API_KEY ? new QlooHttp(env.QLOO_API_KEY) : new SampleTaste();
}
