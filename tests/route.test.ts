import { describe, expect, it } from 'vitest';
import { bestOrder, driveHours, pathKm, greedyOrder } from '../src/domain/route';
import { haversineKm } from '../src/domain/geo';
import type { CandidateCity } from '../src/domain/planner';

const c = (id: string, lat: number, lon: number): CandidateCity => ({ id, name: id, lat, lon, affinity: 0.5 });
// Dead-end corner: Maine is far north-east; Burlington sits west of the corner. Greedy goes to the corner first and doubles back.
const pts = [c('bos', 42.36, -71.06), c('port', 43.66, -70.26), c('bar', 44.39, -68.2), c('bur', 44.48, -73.21), c('alb', 42.65, -73.75), c('hart', 41.76, -72.68), c('prov', 41.82, -71.41)];
const home = { lat: 40.71, lon: -74.01 };

describe('S24 route order', () => {
  it('AC-27 exact order is never longer than nearest-neighbour + 2-opt, and visits every stop once', () => {
    const exact = bestOrder(pts, home, 650);
    const greedy = greedyOrder(pts, home);
    expect(exact).toHaveLength(pts.length);
    expect(new Set(exact.map((x) => x.id)).size).toBe(pts.length);
    const total = (p: CandidateCity[]) => haversineKm(home, p[0]) + pathKm(p);
    expect(total(exact)).toBeLessThanOrEqual(total(greedy) + 1e-9);
  });
  it('ends at the dead end (Bar Harbor) instead of doubling back to Burlington', () => {
    const o = bestOrder(pts, home, 650).map((x) => x.id);
    expect(o[o.length - 1]).toBe('bar');
    expect(o.indexOf('bur')).toBeLessThan(o.indexOf('bar'));
  });
  it('a leg over the limit costs more than any detour: the order keeps legs feasible when it can', () => {
    const far = [c('a', 40.7, -74), c('b', 40.9, -73.9), c('z', 47, -122)];
    const o = bestOrder(far, { lat: 40.6, lon: -74 }, 650).map((x) => x.id);
    expect(o).toEqual(['a', 'b', 'z']);
  });
  it('is deterministic and handles 0/1 stops and more than 12 stops (falls back to heuristic)', () => {
    expect(bestOrder([], home, 650)).toEqual([]);
    expect(bestOrder([pts[0]], home, 650)).toHaveLength(1);
    const many = Array.from({ length: 14 }, (_, i) => c(`m${i}`, 35 + (i % 4), -100 + i));
    expect(bestOrder(many, home, 650)).toHaveLength(14);
    expect(bestOrder(pts, home, 650)).toEqual(bestOrder(pts, home, 650));
  });
  it('drive hours = km × road factor ÷ average speed', () => {
    expect(driveHours(640)).toBeCloseTo((640 * 1.25) / 80, 9);
  });
});
