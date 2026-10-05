// UC-1: choose and order tour stops. Pure and deterministic.
import { haversineKm, type LatLon } from './geo';

export interface Venue { readonly id: string; readonly name: string; readonly affinity: number }
export interface CandidateCity extends LatLon {
  readonly id: string;
  readonly name: string;
  /** Qloo audience affinity for the artist, 0..1. */
  readonly affinity: number;
  /** Optional market size used only by the generic (no-taste) plan. */
  readonly population?: number;
  readonly venues?: readonly Venue[];
}
export interface TourRequest { readonly stops: number; readonly maxLegKm: number; readonly home: LatLon }
export interface Stop { readonly city: CandidateCity; readonly affinity: number; readonly affinityRank: number }
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
  const max = Math.max(...all.map((x) => x.population ?? 0), 1);
  return (c.population ?? 0) / max;
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

  // 1) Select greedily: best key minus a distance penalty from the previous pick, preferring reachable cities.
  // Pool = best 2N by key, so distance can only trade among strong markets (never pick a weak city to save km).
  const lambda = 0.12 / req.maxLegKm;
  const pool = [...cands].sort((a, b) => key(b, cands) - key(a, cands) || a.id.localeCompare(b.id)).slice(0, Math.max(n * 2, n));
  const chosen: CandidateCity[] = [];
  const left = new Set(pool.map((c) => c.id));
  let at: LatLon = req.home;
  for (let i = 0; i < n; i++) {
    let best: CandidateCity | null = null;
    let bestScore = -Infinity;
    let bestReach = false;
    for (const c of pool) {
      if (!left.has(c.id)) continue;
      const km = haversineKm(at, c);
      const reach = i === 0 || km <= req.maxLegKm;
      const s = key(c, cands) - lambda * km;
      if ((reach && !bestReach) || (reach === bestReach && (s > bestScore || (s === bestScore && best && c.id < best.id)))) {
        best = c; bestScore = s; bestReach = reach;
      }
    }
    chosen.push(best!);
    left.delete(best!.id);
    at = best!;
  }

  // 2) Order: start nearest home, nearest-neighbour, then 2-opt with a fixed start.
  let order = nearestNeighbour(chosen, req.home);
  order = twoOpt(order);
  const legs: Leg[] = [];
  for (let i = 1; i < order.length; i++) {
    const km = haversineKm(order[i - 1], order[i]);
    legs.push({ from: order[i - 1].name, to: order[i].name, km });
    if (km > req.maxLegKm) warnings.push(`leg ${order[i - 1].name} → ${order[i].name} is ${Math.round(km)} km (> ${req.maxLegKm})`);
  }
  return {
    basis,
    stops: order.map((c) => ({ city: c, affinity: c.affinity, affinityRank: rank.get(c.id)! })),
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
