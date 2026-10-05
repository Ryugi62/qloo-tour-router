import { describe, expect, it } from 'vitest';
import { haversineKm } from '../src/domain/geo';
import { planTour, planGeneric, type CandidateCity } from '../src/domain/planner';
import { compareLift } from '../src/domain/lift';
import { draftPitch } from '../src/domain/pitch';

// 20 synthetic US-ish cities on a grid (deterministic).
const cities: CandidateCity[] = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`,
  name: `City ${i}`,
  lat: 33 + (i % 5) * 2.2,
  lon: -118 + Math.floor(i / 5) * 9,
  affinity: Math.round((0.3 + ((i * 37) % 70) / 100) * 1000) / 1000,
  population: 200_000 + ((i * 7919) % 20) * 150_000,
}));
const req = { stops: 8, maxLegKm: 650, home: { lat: 34, lon: -118 } };

describe('UC-1 planTour', () => {
  it('AC-1 eight distinct stops, first stop nearest the home base among chosen', () => {
    const p = planTour(cities, req);
    expect(p.stops).toHaveLength(8);
    expect(new Set(p.stops.map((s) => s.city.id)).size).toBe(8);
    const d0 = haversineKm(req.home, p.stops[0].city);
    for (const s of p.stops) expect(d0).toBeLessThanOrEqual(haversineKm(req.home, s.city) + 1e-9);
  });
  it('AC-2 legs respect maxLegKm or are reported in warnings', () => {
    const p = planTour(cities, req);
    for (const leg of p.legs) {
      if (leg.km > req.maxLegKm) expect(p.warnings.some((w) => w.includes(leg.from) && w.includes(leg.to))).toBe(true);
    }
    expect(p.legs).toHaveLength(7);
  });
  it('AC-3 deterministic', () => {
    expect(planTour(cities, req)).toEqual(planTour(cities, req));
  });
  it('every stop carries affinity and rank evidence', () => {
    const p = planTour(cities, req);
    for (const s of p.stops) {
      expect(s.affinity).toBe(s.city.affinity);
      expect(s.affinityRank).toBeGreaterThanOrEqual(1);
      expect(s.affinityRank).toBeLessThanOrEqual(cities.length);
    }
  });
  it('prefers higher-affinity cities than the generic market-size plan', () => {
    const taste = planTour(cities, req);
    const generic = planGeneric(cities, req);
    const mean = (p: typeof taste) => p.stops.reduce((a, s) => a + s.city.affinity, 0) / p.stops.length;
    expect(mean(taste)).toBeGreaterThan(mean(generic));
  });
  it('handles fewer candidates than stops', () => {
    const p = planTour(cities.slice(0, 3), req);
    expect(p.stops).toHaveLength(3);
    expect(p.warnings.join(' ')).toMatch(/only 3/);
  });
});

describe('UC-2 compareLift (AC-4)', () => {
  it('computes Jaccard overlap and mean-affinity lift', () => {
    const taste = planTour(cities, req);
    const generic = planGeneric(cities, req);
    const lift = compareLift(taste, generic);
    const a = new Set(taste.stops.map((s) => s.city.id));
    const b = new Set(generic.stops.map((s) => s.city.id));
    const inter = [...a].filter((x) => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    expect(lift.jaccard).toBeCloseTo(inter / union, 9);
    const m = (p: typeof taste) => p.stops.reduce((s, x) => s + x.city.affinity, 0) / p.stops.length;
    expect(lift.meanAffinityTaste - lift.meanAffinityGeneric).toBeCloseTo(m(taste) - m(generic), 9);
    expect(lift.added.length + inter).toBe(taste.stops.length);
  });
});

describe('UC-3 draftPitch (AC-5)', () => {
  it('names every stop with its rank and makes no ticket-sales claim', () => {
    const plan = planTour(cities, req);
    const text = draftPitch({ id: 'a1', name: 'Test Artist' }, plan);
    for (const s of plan.stops) {
      expect(text).toContain(s.city.name);
      expect(text).toContain(`#${s.affinityRank}`);
    }
    expect(text.toLowerCase()).not.toMatch(/sell out|ticket sales|guarantee/);
  });
});

describe('selection quality', () => {
  it('when every city is within reach, picks exactly the top-N by affinity', () => {
    const dense = cities.map((c, i) => ({ ...c, lat: 40 + (i % 5) * 0.3, lon: -75 + Math.floor(i / 5) * 0.3 }));
    const p = planTour(dense, { ...req, home: { lat: 40, lon: -75 } });
    const top = [...dense].sort((a, b) => b.affinity - a.affinity).slice(0, 8).map((c) => c.id).sort();
    expect(p.stops.map((s) => s.city.id).sort()).toEqual(top);
  });
  it('never picks a city outside the top-2N by affinity', () => {
    const p = planTour(cities, req);
    const top16 = new Set([...cities].sort((a, b) => b.affinity - a.affinity).slice(0, 16).map((c) => c.id));
    for (const s of p.stops) expect(top16.has(s.city.id)).toBe(true);
  });
});
