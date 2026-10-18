// UC-1: choose and order tour stops. Pure and deterministic.
import { haversineKm, type LatLon } from './geo.js';
import { MIN_CITY_SEPARATION_KM } from './constants.js';
import { bestOrder, driveHours, greedyOrder, pathKm } from './route.js';

export type VenueKind = 'venue' | 'unverified';
export type VenueSize = 'established' | 'smaller' | 'unknown';
/** Estimated room class from Qloo tags/popularity (never a capacity). */
export type VenueTier = 'small' | 'mid' | 'large' | 'unknown';
export type SizeFit = 'match' | 'too-small' | 'too-big' | 'unknown';
export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly affinity: number;
  /** Qloo popularity 0..1: a notoriety signal, not a capacity. */
  readonly popularity?: number;
  /** Qloo tag ids as returned (urn:tag:...). */
  readonly tags?: readonly string[];
  /** Set by the application after classification (domain/venue.ts). */
  readonly kind?: VenueKind;
  readonly size?: VenueSize;
  /** The room's own location from the Qloo response (SPEC S22). */
  readonly lat?: number;
  readonly lon?: number;
  readonly city?: string;
  readonly region?: string;
  /** Weight class estimate vs the artist (SPEC S23). */
  readonly tier?: VenueTier;
  readonly sizeBasis?: 'tags' | 'popularity' | 'none';
  readonly fit?: SizeFit;
}
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
  readonly openers?: readonly Opener[];
  /** Qloo's own destination tags (e.g. "Foodie Destination"), shown as city character. */
  readonly tags?: readonly string[];
  /** Set when the stop was moved to its room's own city (SPEC S22): the candidate city Qloo ranked. */
  readonly relocatedFrom?: string;
}
export interface Opener {
  readonly id: string;
  readonly name: string;
  readonly affinity: number;
  /** Qloo popularity 0..1 (notoriety, not draw). */
  readonly popularity?: number;
  /** local = the location signal moved this act; region = it is a region-wide taste neighbour. */
  readonly scope?: 'local' | 'region';
}
export interface TourRequest {
  readonly stops: number;
  readonly maxLegKm: number;
  readonly home: LatLon;
  /** City ids that must be on the route (agent follow-ups like "keep Austin in"). */
  readonly mustInclude?: readonly string[];
  /** Two stops closer than this are the same market (default MIN_CITY_SEPARATION_KM). */
  readonly minSeparationKm?: number;
  /** Rank of each candidate id in the full taste ordering (so ranks stay stable when the pool shrinks). */
  readonly ranks?: ReadonlyMap<string, number>;
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
  /** Stop-to-stop km (the start leg is in `stats`). */
  readonly totalKm: number;
  readonly warnings: readonly string[];
  readonly stats: RouteStats;
}
/** Drive numbers (SPEC S24). Hours are an estimate: km × road factor ÷ average speed. */
export interface RouteStats {
  readonly totalKm: number;
  readonly homeLegKm: number;
  readonly driveHours: number;
  readonly longestLegKm: number;
  /** Km saved against nearest-neighbour + 2-opt for the same stops (>= 0). */
  readonly orderGainKm: number;
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

/** Keep the best-keyed city of every market: a city within `sep` km of an already kept one is dropped (must-includes first). */
function dedupeMarkets(cands: readonly CandidateCity[], key: KeyFn, must: readonly string[], sep: number): CandidateCity[] {
  const order = [...cands].sort((a, b) => Number(must.includes(b.id)) - Number(must.includes(a.id)) || key(b, cands) - key(a, cands) || a.id.localeCompare(b.id));
  const kept: CandidateCity[] = [];
  for (const c of order) if (kept.every((k) => haversineKm(k, c) >= sep)) kept.push(c);
  return kept;
}

function plan(allCands: readonly CandidateCity[], req: TourRequest, key: KeyFn, basis: TourPlan['basis']): TourPlan {
  const warnings: string[] = [];
  const sep = req.minSeparationKm ?? MIN_CITY_SEPARATION_KM;
  const cands = dedupeMarkets(allCands, key, req.mustInclude ?? [], sep);
  const sameMarket = allCands.length - cands.length;
  if (sameMarket > 0) warnings.push(`${sameMarket} candidate cities skipped as the same market as a stronger pick (< ${sep} km apart)`);
  const sorted = [...allCands].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id));
  const rank = new Map(sorted.map((c, i) => [c.id, req.ranks?.get(c.id) ?? i + 1]));
  const n = Math.min(req.stops, cands.length);
  if (cands.length < req.stops) warnings.push(`only ${cands.length} candidate cities for ${req.stops} stops${sameMarket > 0 ? ' after the same-market separation' : ''}`);

  const must = cands.filter((c) => req.mustInclude?.includes(c.id));
  for (const id of req.mustInclude ?? []) if (!must.some((c) => c.id === id)) warnings.push(`must-include city ${id} is not among candidates`);
  const ranked = [...cands].sort((a, b) => key(b, cands) - key(a, cands) || a.id.localeCompare(b.id));

  // Objective: leg violations first, then total key (taste or market), then distance.
  const evalSet = (set: CandidateCity[]) => {
    const order = greedyOrder(set, req.home);
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
  const core = best ? best.order : [];
  const tourKm = (p: readonly CandidateCity[]) => (p.length ? haversineKm(req.home, p[0]) + pathKm(p) : 0);
  const exact = bestOrder(core, req.home, req.maxLegKm);
  const orderGainKm = Math.max(0, tourKm(core) - tourKm(exact));
  const bridged = insertBridges(exact, cands, req.maxLegKm, sep);
  return assemblePlan(bridged.order, bridged.bridges, rank, req, basis, warnings, orderGainKm);
}

/** Legs, totals, drive stats and leg warnings for an ordered list of stops (also used after a stop is re-anchored). */
export function assemblePlan(order: readonly CandidateCity[], bridges: ReadonlySet<string>, rank: ReadonlyMap<string, number>, req: Pick<TourRequest, 'maxLegKm' | 'home'>, basis: TourPlan['basis'], warnings: readonly string[], orderGainKm = 0): TourPlan {
  const w = [...warnings];
  const legs: Leg[] = [];
  for (let i = 1; i < order.length; i++) {
    const km = haversineKm(order[i - 1], order[i]);
    legs.push({ from: order[i - 1].name, to: order[i].name, km });
    if (km > req.maxLegKm) w.push(`leg ${order[i - 1].name} → ${order[i].name} is ${Math.round(km)} km (> ${req.maxLegKm})`);
  }
  const totalKm = legs.reduce((a, l) => a + l.km, 0);
  const homeLegKm = order.length ? haversineKm(req.home, order[0]) : 0;
  return {
    basis,
    stops: order.map((c) => ({ city: c, affinity: c.affinity, affinityRank: rank.get(c.id) ?? 0, ...(bridges.has(c.id) ? { bridge: true } : {}) })),
    legs,
    totalKm,
    warnings: w,
    stats: { totalKm, homeLegKm, driveHours: driveHours(totalKm + homeLegKm), longestLegKm: Math.max(0, ...legs.map((l) => l.km)), orderGainKm },
  };
}

/** Split any drive longer than maxLegKm through the unused candidate that makes both halves fit. */
export function insertBridges(route: readonly CandidateCity[], cands: readonly CandidateCity[], maxLegKm: number, sepKm = MIN_CITY_SEPARATION_KM) {
  let order = [...route];
  const bridges = new Set<string>();
  for (let i = 1; i < order.length; i++) {
    const a = order[i - 1];
    const b = order[i];
    if (haversineKm(a, b) <= maxLegKm) continue;
    let pick: CandidateCity | null = null;
    let worst = Infinity;
    for (const c of cands) {
      if (order.includes(c) || order.some((o) => haversineKm(o, c) < sepKm)) continue;
      const m = Math.max(haversineKm(a, c), haversineKm(c, b));
      if (m <= maxLegKm && (m < worst || (m === worst && pick && c.id < pick.id))) { pick = c; worst = m; }
    }
    if (pick) { order = [...order.slice(0, i), pick, ...order.slice(i)]; bridges.add(pick.id); i++; }
  }
  return { order, bridges };
}
