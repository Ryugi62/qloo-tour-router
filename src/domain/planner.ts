// UC-1: choose and order tour stops. Pure and deterministic.
import { haversineKm, type LatLon } from './geo.js';

export interface Venue { readonly id: string; readonly name: string; readonly affinity: number }
export interface CandidateCity extends LatLon {
  readonly id: string;
  readonly name: string;
  /** Qloo audience affinity for the artist, 0..1. */
  readonly affinity: number;
  /** Optional market size used only by the generic (no-taste) plan. */
  readonly population?: number;
  /** Qloo entity popularity 0..1; market proxy for the generic plan when population is not returned. */
  readonly popularity?: number;
  readonly venues?: readonly Venue[];
  /** Artists whose fans overlap with this artist's, popular around this city (possible openers). */
  readonly openers?: readonly { readonly id: string; readonly name: string; readonly affinity: number }[];
}
export interface TourRequest {
  readonly stops: number;
  readonly maxLegKm: number;
  readonly home: LatLon;
  /** City ids that must be on the route (agent follow-ups like "keep Austin in"). */
  readonly mustInclude?: readonly string[];
}
export interface Stop {
  readonly city: CandidateCity;
  readonly affinity: number;
  readonly affinityRank: number;
  /** Inserted only to split a drive longer than maxLegKm (not a taste pick). */
  readonly bridge?: boolean;
}
export interface Leg { readonly from: string; readonly to: string; readonly km: number }
export interface TourPlan {
  readonly basis: 'taste' | 'generic';
  readonly stops: readonly Stop[];
  readonly legs: readonly Leg[];
  readonly totalKm: number;
  readonly warnings: readonly string[];
}

type KeyFn = (c: CandidateCity, all: readonly CandidateCity[]) => number;
const byAffinity: KeyFn = (c) => c.affinity;
const byMarket: KeyFn = (c, all) => {
  const size = (x: CandidateCity) => x.population ?? x.popularity ?? 0;
  const max = Math.max(...all.map(size), Number.EPSILON);
  return size(c) / max;
};

export const planTour = (cands: readonly CandidateCity[], req: TourRequest): TourPlan =>
  plan(cands, req, byAffinity, 'taste');
export const planGeneric = (cands: readonly CandidateCity[], req: TourRequest): TourPlan =>
  plan(cands, req, byMarket, 'generic');

function plan(cands: readonly CandidateCity[], req: TourRequest, key: KeyFn, basis: TourPlan['basis']): TourPlan {
  const warnings: string[] = [];
  const sorted = [...cands].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id));
  const rank = new Map(sorted.map((c, i) => [c.id, i + 1]));
  const n = Math.min(req.stops, cands.length);
  if (cands.length < req.stops) warnings.push(`only ${cands.length} candidate cities for ${req.stops} stops`);

  const must = cands.filter((c) => req.mustInclude?.includes(c.id));
  for (const id of req.mustInclude ?? []) if (!must.some((c) => c.id === id)) warnings.push(`must-include city ${id} is not among candidates`);
  const ranked = [...cands].sort((a, b) => key(b, cands) - key(a, cands) || a.id.localeCompare(b.id));

  // Objective: leg violations first, then total key (taste or market), then distance.
  const evalSet = (set: CandidateCity[]) => {
    const order = twoOpt(nearestNeighbour(set, req.home));
    let viol = 0;
    for (let i = 1; i < order.length; i++) if (haversineKm(order[i - 1], order[i]) > req.maxLegKm) viol++;
    const k = set.reduce((a, c) => a + key(c, cands), 0);
    const km = pathKm(order);
    return { order, viol, score: -viol * 100 + k - (0.1 / req.maxLegKm) * km };
  };

  let best: { order: CandidateCity[]; viol: number; score: number } | null = null;
  // Pool = strongest markets only (never pick a weak city to save km); widen once if routes stay infeasible.
  for (const poolSize of [Math.ceil(n * 1.5), n * 2]) {
    const pool = ranked.slice(0, poolSize);
    for (const m of must) if (!pool.includes(m)) pool.push(m);
    // Seeded growth: from every pool city, grow a set by best key near the set (reachable first).
    const grow = (seed: CandidateCity) => {
      const set = [...must];
      if (!set.includes(seed)) set.push(seed);
      while (set.length < n) {
        let pick: CandidateCity | null = null;
        let pickScore = -Infinity;
        for (const c of pool) {
          if (set.includes(c)) continue;
          const near = Math.min(...set.map((x) => haversineKm(x, c)));
          const s2 = (near <= req.maxLegKm ? 10 : 0) + key(c, cands) - (0.2 / req.maxLegKm) * near;
          if (s2 > pickScore || (s2 === pickScore && pick && c.id < pick.id)) { pick = c; pickScore = s2; }
        }
        if (!pick) break;
        set.push(pick);
      }
      return set.slice(0, Math.max(n, must.length));
    };
    let set: CandidateCity[] = [];
    let cur = { order: [] as CandidateCity[], viol: Infinity, score: -Infinity };
    for (const seed of pool) {
      const g = grow(seed);
      const r = evalSet(g);
      if (r.score > cur.score + 1e-9) { set = g; cur = r; }
    }
    for (let improved = true; improved; ) {
      improved = false;
      for (const out of set) {
        if (must.includes(out)) continue;
        for (const inn of pool) {
          if (set.includes(inn)) continue;
          const trial = set.map((c) => (c === out ? inn : c));
          const r = evalSet(trial);
          if (r.score > cur.score + 1e-9) { set = trial; cur = r; improved = true; break; }
        }
        if (improved) break;
      }
    }
    if (!best || cur.score > best.score) best = cur;
    if (best.viol === 0) break;
  }
  let order = best ? best.order : [];
  const bridged = insertBridges(order, cands, req.maxLegKm);
  order = bridged.order;
  const bridges = bridged.bridges;

  const legs: Leg[] = [];
  for (let i = 1; i < order.length; i++) {
    const km = haversineKm(order[i - 1], order[i]);
    legs.push({ from: order[i - 1].name, to: order[i].name, km });
    if (km > req.maxLegKm) warnings.push(`leg ${order[i - 1].name} → ${order[i].name} is ${Math.round(km)} km (> ${req.maxLegKm})`);
  }
  return {
    basis,
    stops: order.map((c) => ({ city: c, affinity: c.affinity, affinityRank: rank.get(c.id)!, ...(bridges.has(c.id) ? { bridge: true } : {}) })),
    legs,
    totalKm: legs.reduce((a, l) => a + l.km, 0),
    warnings,
  };
}

function nearestNeighbour(cs: CandidateCity[], home: LatLon): CandidateCity[] {
  if (cs.length === 0) return [];
  const rest = [...cs].sort((a, b) => haversineKm(home, a) - haversineKm(home, b) || a.id.localeCompare(b.id));
  const out = [rest.shift()!];
  while (rest.length) {
    const last = out[out.length - 1];
    rest.sort((a, b) => haversineKm(last, a) - haversineKm(last, b) || a.id.localeCompare(b.id));
    out.push(rest.shift()!);
  }
  return out;
}

const pathKm = (p: CandidateCity[]) => p.slice(1).reduce((a, c, i) => a + haversineKm(p[i], c), 0);

function twoOpt(p: CandidateCity[]): CandidateCity[] {
  let best = p;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const cand = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (pathKm(cand) + 1e-9 < pathKm(best)) { best = cand; improved = true; }
      }
    }
  }
  return best;
}

/** Split any drive longer than maxLegKm through the unused candidate that makes both halves fit. */
export function insertBridges(route: readonly CandidateCity[], cands: readonly CandidateCity[], maxLegKm: number) {
  let order = [...route];
  const bridges = new Set<string>();
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1];
    const b = order[i];
    if (haversineKm(a, b) <= maxLegKm) continue;
    let pick: CandidateCity | null = null;
    let worst = Infinity;
    for (const c of cands) {
      if (order.includes(c)) continue;
      const m = Math.max(haversineKm(a, c), haversineKm(c, b));
      if (m <= maxLegKm && (m < worst || (m === worst && pick && c.id < pick.id))) { pick = c; worst = m; }
    }
    if (pick) { order = [...order.slice(0, i), pick, ...order.slice(i)]; bridges.add(pick.id); i++; }
  }
  return { order, bridges };
}
