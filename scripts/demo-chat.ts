// Live chat turn: npx tsx scripts/demo-chat.ts "Artist" "message"   (QLOO_API_KEY + GEMINI_API_KEY from the environment)
import { chatTurn } from '../src/application/agent.js';
import { QlooHttp } from '../src/adapters/qlooHttp.js';
import { GeminiLlm } from '../src/adapters/geminiLlm.js';
const llm = new GeminiLlm(process.env.GEMINI_API_KEY!);
const t = await chatTurn(new QlooHttp(process.env.QLOO_API_KEY!), llm, { artist: process.argv[2], home: { lat: 40.71, lon: -74.01 }, stops: 8, maxLegKm: 650, exclude: [], must: [], extra: [] }, process.argv[3]);
console.log('REPLY', t.reply);
console.log('TOOLS', JSON.stringify(t.tools));
console.log('REASONS', t.reasons);
console.log('BEFORE', t.before.route.map((r) => r.city).join(' > '), t.before.totalKm, 'km', t.before.driveHours, 'h longest', t.before.longestLegKm);
console.log('AFTER ', t.after.route.map((r) => `${r.city}${r.legHours ? `(${r.legHours}h)` : ''}`).join(' > '), t.after.totalKm, 'km', t.after.driveHours, 'h longest', t.after.longestLegKm);
console.log('DIFF', JSON.stringify(t.diff), 'state.maxLegKm', t.state.maxLegKm, 'warnings', t.after.warnings, 'unfilled', t.result.unfilled, 'llmCalls', t.llmCalls);
console.log('LLMTRACE', JSON.stringify(t.result.trace.filter((x) => x.check === 'llm')));
