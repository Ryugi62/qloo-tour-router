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
  it('AC-1 eight distinct taste stops, first stop nearest the home base among chosen', () => {
    const p = planTour(cities, req);
    expect(p.stops.filter((s) => !s.bridge)).toHaveLength(8);
    expect(new Set(p.stops.map((s) => s.city.id)).size).toBe(8);
    const d0 = haversineKm(req.home, p.stops[0].city);
    for (const s of p.stops) expect(d0).toBeLessThanOrEqual(haversineKm(req.home, s.city) + 1e-9);
  });
  it('AC-2 legs respect maxLegKm or are reported in warnings', () => {
    const p = planTour(cities, req);
    for (const leg of p.legs) {
      if (leg.km > req.maxLegKm) expect(p.warnings.some((w) => w.includes(leg.from) && w.includes(leg.to))).toBe(true);
    }
    expect(p.legs).toHaveLength(p.stops.length - 1);
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

describe('venue fit floor', () => {
  it('does not present a weak venue as a fit', async () => {
    const { fittingVenue } = await import('../src/domain/pitch');
    expect(fittingVenue({ ...cities[0], venues: [{ id: 'v', name: 'Weak Room', affinity: 0.31 }] })).toBeNull();
    expect(fittingVenue({ ...cities[0], venues: [{ id: 'v', name: 'Good Room', affinity: 0.8 }] })?.name).toBe('Good Room');
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

describe('feasibility and follow-ups (mock round 1 Q-1/Q-2)', () => {
  it('produces zero leg violations when a feasible set exists in the strong pool', () => {
    // Two clusters far apart; the top cities are split, but 8 strong cities exist inside the east cluster.
    const east = Array.from({ length: 10 }, (_, i) => ({ id: `e${i}`, name: `East ${i}`, lat: 40 + (i % 3), lon: -75 + Math.floor(i / 3), affinity: 0.7 + i * 0.01 }));
    const west = Array.from({ length: 3 }, (_, i) => ({ id: `w${i}`, name: `West ${i}`, lat: 37, lon: -122 + i, affinity: 0.85 + i * 0.01 }));
    const p = planTour([...east, ...west], { stops: 8, maxLegKm: 650, home: { lat: 40.7, lon: -74 } });
    expect(p.warnings).toEqual([]);
    expect(p.legs.every((l) => l.km <= 650)).toBe(true);
  });
  it('splits an over-long drive with a bridge stop when one fits', async () => {
    const { insertBridges } = await import('../src/domain/planner');
    const a = { id: 'a', name: 'A', lat: 40, lon: -100, affinity: 0.9 };
    const b = { id: 'b', name: 'B', lat: 40, lon: -88, affinity: 0.9 };
    const mid = { id: 'mid', name: 'Mid', lat: 40, lon: -94, affinity: 0.1 };
    const r = insertBridges([a, b], [a, b, mid], 650);
    expect(r.order.map((c) => c.id)).toEqual(['a', 'mid', 'b']);
    expect([...r.bridges]).toEqual(['mid']);
    expect(insertBridges([a, b], [a, b], 650).order).toHaveLength(2);
  });
  it('honours mustInclude (agent follow-up: "keep Austin in")', () => {
    const p = planTour(cities, { ...req, mustInclude: ['c0'] });
    expect(p.stops.map((s) => s.city.id)).toContain('c0');
  });
  it('warns when a must-include city is unknown', () => {
    expect(planTour(cities, { ...req, mustInclude: ['nope'] }).warnings.join(' ')).toMatch(/nope/);
  });
});
