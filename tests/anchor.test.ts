import { describe, expect, it } from 'vitest';
import { venueAnchor } from '../src/domain/anchor';
import { compareLift } from '../src/domain/lift';
import { assemblePlan, planGeneric, type CandidateCity, type Venue } from '../src/domain/planner';

const city: CandidateCity = { id: 'w', name: 'Williamstown, Massachusetts', lat: 42.71, lon: -73.2, affinity: 0.9 };
const troy: Venue = { id: 'v', name: 'Troy Savings Bank Music Hall', affinity: 0.8, lat: 42.7284, lon: -73.6918, city: 'Troy', region: 'New York', kind: 'venue' };

describe('S22 venue location is the stop location', () => {
  it('AC-25 a room in another city moves the stop to the room city and coordinates, remembering the origin', () => {
    const a = venueAnchor(city, troy)!;
    expect(a.name).toBe('Troy, New York');
    expect(a.lat).toBeCloseTo(42.7284, 4);
    expect(a.id).toBe('w');
    expect(a.relocatedFrom).toBe('Williamstown, Massachusetts');
    expect(a.affinity).toBe(0.9);
  });
  it('no move when the room is in the same city, near the centre, or has no coordinates', () => {
    expect(venueAnchor(city, { ...troy, city: 'Williamstown', lat: 42.713, lon: -73.203 })).toBeNull();
    expect(venueAnchor(city, { ...troy, city: 'Williamstown' })).toBeNull();
    expect(venueAnchor(city, { ...troy, lat: undefined, lon: undefined })).toBeNull();
    expect(venueAnchor(city, { ...troy, lat: 42.72, lon: -73.21 })).toBeNull(); // another suburb name but < 8 km
  });
  it('after the move the leg limit is checked again on the new coordinates', () => {
    const a = venueAnchor(city, troy)!;
    const far: CandidateCity = { id: 'p', name: 'Portland, Maine', lat: 43.66, lon: -70.26, affinity: 0.8 };
    const home = { lat: 42.4, lon: -73.2 };
    const before = assemblePlan([city, far], new Set(), new Map(), { maxLegKm: 300, home }, 'taste', []);
    const after = assemblePlan([a, far], new Set(), new Map(), { maxLegKm: 300, home }, 'taste', []);
    expect(after.legs[0].km).toBeGreaterThan(before.legs[0].km);
    expect(after.stats.homeLegKm).toBeGreaterThan(0);
    const tight = assemblePlan([a, far], new Set(), new Map(), { maxLegKm: 250, home }, 'taste', []);
    expect(tight.warnings.some((w) => /Troy, New York → Portland, Maine/.test(w))).toBe(true);
  });
});

describe('S21 plans are compared by market, not id', () => {
  const mk = (id: string, name: string, lat: number, lon: number, affinity = 0, population?: number): CandidateCity => ({ id, name, lat, lon, affinity, population });
  const req = { stops: 3, maxLegKm: 2000, home: { lat: 40.7, lon: -74 } };
  it('a taste stop within LIFT_MATCH_KM of a baseline stop is the same market even with another id', () => {
    const taste = assemblePlan([mk('q-nyc', 'New York', 40.75, -73.99, 0.9), mk('q-bos', 'Boston', 42.36, -71.06, 0.8), mk('q-troy', 'Troy', 42.73, -73.69, 0.7)], new Set(), new Map([['q-nyc', 1], ['q-bos', 2], ['q-troy', 3]]), req, 'taste', []);
    const generic = planGeneric([mk('msa-1', 'New York', 40.73, -73.8, 0, 19_000_000), mk('msa-2', 'Boston', 42.5, -71.0, 0, 5_000_000), mk('msa-3', 'Philadelphia', 39.9, -75.3, 0, 6_000_000)], { ...req, ranks: new Map([['msa-1', 1], ['msa-2', 2], ['msa-3', 0]]) });
    const l = compareLift(taste, generic);
    expect(l.changed.count).toBe(1);
    expect(l.changed.tasteOnly.map((x) => x.name)).toEqual(['Troy']);
    expect(l.changed.genericOnly.map((x) => x.name)).toEqual(['Philadelphia']);
    expect(l.changed.genericNotReturned).toBe(1);
    expect(l.changed.genericMeanRank).toBeNull();
    expect(l.jaccard).toBeCloseTo(2 / 4, 9);
  });
});
