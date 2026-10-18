// Vercel serverless entry: reuses the same request listener as `npm start`. Key comes from env (QLOO_API_KEY) only.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { makeServer, portFromEnv, llmFromEnv } from '../src/web/server.js';

const server = makeServer(portFromEnv(), { llm: llmFromEnv() });
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  server.emit('request', req, res);
}
