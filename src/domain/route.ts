// Route order (SPEC S24): exact open-path ordering from the start by dynamic programming (Held-Karp) for <= 12 stops.
import { haversineKm, type LatLon } from './geo.js';
import { AVG_SPEED_KMH, ROAD_FACTOR } from './constants.js';

const PENALTY_KM = 100_000;
const EXACT_MAX = 12;
type P = LatLon & { readonly id: string };

export const pathKm = (p: readonly LatLon[]) => p.slice(1).reduce((a, c, i) => a + haversineKm(p[i], c), 0);
export const driveHours = (km: number) => (km * ROAD_FACTOR) / AVG_SPEED_KMH;

/** Nearest-neighbour from the start followed by 2-opt (the earlier heuristic, kept as the comparison and as the > 12 stops fallback). */
export function greedyOrder<T extends P>(cs: readonly T[], home: LatLon): T[] {
  if (cs.length === 0) return [];
  const rest = [...cs].sort((a, b) => haversineKm(home, a) - haversineKm(home, b) || a.id.localeCompare(b.id));
  let out = [rest.shift()!];
  while (rest.length) {
    const last = out[out.length - 1];
    rest.sort((a, b) => haversineKm(last, a) - haversineKm(last, b) || a.id.localeCompare(b.id));
    out.push(rest.shift()!);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < out.length - 1; i++) for (let k = i + 1; k < out.length; k++) {
      const cand = [...out.slice(0, i), ...out.slice(i, k + 1).reverse(), ...out.slice(k + 1)];
      if (pathKm(cand) + 1e-9 < pathKm(out)) { out = cand; improved = true; }
    }
  }
  return out;
}

/** Order minimising start→first + stop-to-stop km; a stop-to-stop leg above maxLegKm adds a heavy penalty. */
export function bestOrder<T extends P>(cs: readonly T[], home: LatLon, maxLegKm: number): T[] {
  const n = cs.length;
  if (n <= 1) return [...cs];
  if (n > EXACT_MAX) return greedyOrder(cs, home);
  const pts = [...cs].sort((a, b) => a.id.localeCompare(b.id));
  const d = pts.map((a) => pts.map((b) => { const k = haversineKm(a, b); return k + (k > maxLegKm ? PENALTY_KM : 0); }));
  const full = (1 << n) - 1;
  const dp = Array.from({ length: 1 << n }, () => new Float64Array(n).fill(Infinity));
  const prev = Array.from({ length: 1 << n }, () => new Int8Array(n).fill(-1));
  for (let i = 0; i < n; i++) dp[1 << i][i] = haversineKm(home, pts[i]);
  for (let mask = 1; mask <= full; mask++) for (let last = 0; last < n; last++) {
    const cur = dp[mask][last];
    if (cur === Infinity || !(mask & (1 << last))) continue;
    for (let nx = 0; nx < n; nx++) {
      if (mask & (1 << nx)) continue;
      const nm = mask | (1 << nx);
      const v = cur + d[last][nx];
      if (v < dp[nm][nx] - 1e-9) { dp[nm][nx] = v; prev[nm][nx] = last; }
    }
  }
  let end = 0;
  for (let i = 1; i < n; i++) if (dp[full][i] < dp[full][end] - 1e-9) end = i;
  const order: number[] = [];
  for (let mask = full, cur = end; cur !== -1; ) { order.push(cur); const p = prev[mask][cur]; mask &= ~(1 << cur); cur = p; }
  return order.reverse().map((i) => pts[i]);
}
