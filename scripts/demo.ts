// Prints a live plan summary (uses QLOO_API_KEY from the environment). Usage: npx tsx scripts/demo.ts "Artist" [stops]
import { routeTour } from '../src/application/routeTour.js';
import { QlooHttp } from '../src/adapters/qlooHttp.js';
const q = new QlooHttp(process.env.QLOO_API_KEY!);
let n = 0; const orig = (q as any).fetchImpl;
(q as any).fetchImpl = async (...a: any[]) => { n++; return orig(...a); };
const r = await routeTour(q, { artistName: process.argv[2] ?? 'Samia', home: { lat: 40.71, lon: -74.01 }, stops: Number(process.argv[3] ?? 8) });
console.log(`artist ${r.artist.name} pop ${r.artist.popularity?.toFixed(3)} band ${r.artistBand} | qloo http calls ${n}`);
console.log(`TASTE ${Math.round(r.taste.totalKm)} km (+start ${Math.round(r.taste.stats.homeLegKm)}) ${r.taste.stats.driveHours.toFixed(1)} h, order gain ${Math.round(r.taste.stats.orderGainKm)} km, longest ${Math.round(r.taste.stats.longestLegKm)}`);
for (const s of r.taste.stops) { const v = s.city.venues?.[0]; const m = r.stopMarkets[s.city.id]; console.log(` ${s.city.name}${s.city.relocatedFrom ? ` (from ${s.city.relocatedFrom})` : ''} #${s.affinityRank} | ${v ? `${v.name} [${v.tier}/${v.fit}/${v.sizeBasis}] ${v.city ?? ''}` : 'NO ROOM'} | ${m.label}${m.big ? ' BIG' : ''} | ${r.stopNotes[s.city.id].kind}`); }
console.log(`BASELINE ${Math.round(r.generic.totalKm)} km`, r.generic.stops.map((s) => `${s.city.name}(${(s.city.population! / 1e6).toFixed(1)}M)`).join(' > '));
console.log(`changed ${r.lift.changed.count}/${r.taste.stops.length}`, r.lift.changed.tasteMeanRank, r.lift.changed.genericMeanRank, 'notReturned', r.lift.changed.genericNotReturned);
for (const o of r.baselineOmissions) console.log(' OMIT', o.market, (o.pop / 1e6).toFixed(1) + 'M', o.qlooRank, '-', o.reason);
for (const t of r.trace) console.log(' TRACE', t.check, t.city, '|', t.finding, '->', t.action, '->', t.outcome);
console.log('warnings', r.taste.warnings, 'unfilled', r.unfilled, 'degraded', r.degraded);
