// Vercel serverless entry: reuses the same request listener as `npm start`. Key comes from env (QLOO_API_KEY) only.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { makeServer, portFromEnv } from '../src/web/server.js';

const server = makeServer(portFromEnv());
export default function handler(req: IncomingMessage, res: ServerResponse): void {
  server.emit('request', req, res);
}
