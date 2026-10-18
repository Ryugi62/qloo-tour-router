import { describe, expect, it } from 'vitest';
import { artistBand, venueTier, sizeFit, rankRoomsByFit } from '../src/domain/weightClass';
import { classifyVenue, classifyVenues } from '../src/domain/venue';
import type { Venue } from '../src/domain/planner';

const tag = (...xs: string[]) => xs.map((x) => `urn:tag:${x}`);

describe('S23 weight class (estimate)', () => {
  it('artist band from Qloo popularity thresholds', () => {
    expect(artistBand(0.89)).toBe('emerging');
    expect(artistBand(0.9)).toBe('mid');
    expect(artistBand(0.969)).toBe('mid');
    expect(artistBand(0.97)).toBe('headline');
    expect(artistBand(undefined)).toBe('unknown');
  });
  it('venue tier from tags first, popularity only as fallback, and says which', () => {
    expect(venueTier(tag('setting:qloo:outdoor_music_venue', 'category:place:auditorium', 'ambience:qloo:intimate'), 0.99)).toEqual({ tier: 'large', basis: 'tags' });
    expect(venueTier(tag('genre:place:concert_hall'), 0.5)).toEqual({ tier: 'mid', basis: 'tags' });
    expect(venueTier(tag('ambience:qloo:intimate', 'amenity:qloo:bar', 'genre:place:live_music_venue'), 0.72)).toEqual({ tier: 'small', basis: 'tags' });
    expect(venueTier(tag('genre:place:live_music_venue'), 0.97)).toEqual({ tier: 'mid', basis: 'popularity' });
    expect(venueTier(tag('genre:place:live_music_venue'), 0.4)).toEqual({ tier: 'small', basis: 'popularity' });
    expect(venueTier(tag('genre:place:live_music_venue'), 0.85)).toEqual({ tier: 'unknown', basis: 'none' });
    expect(venueTier([], undefined)).toEqual({ tier: 'unknown', basis: 'none' });
  });
  it('AC-26 fit: a headline artist in a basement venue is too small; an emerging act in an amphitheater too big', () => {
    expect(sizeFit('headline', 'small')).toBe('too-small');
    expect(sizeFit('headline', 'mid')).toBe('match');
    expect(sizeFit('mid', 'small')).toBe('match');
    expect(sizeFit('mid', 'large')).toBe('too-big');
    expect(sizeFit('emerging', 'large')).toBe('too-big');
    expect(sizeFit('emerging', 'small')).toBe('match');
    expect(sizeFit('unknown', 'small')).toBe('unknown');
    expect(sizeFit('mid', 'unknown')).toBe('unknown');
  });
  it('rooms are ordered confirmed first, then size match, then affinity', () => {
    const v = (id: string, affinity: number, tags: string[], popularity?: number): Venue => ({ id, name: id, affinity, tags, popularity, kind: 'venue' });
    const rooms = [v('club', 0.9, tag('setting:qloo:basement_venue')), v('hall', 0.7, tag('genre:place:concert_hall')), v('arena', 0.95, tag('genre:place:arena'))];
    const out = rankRoomsByFit(rooms, 'headline').map((x) => x.id);
    expect(out).toEqual(['arena', 'hall', 'club']);
    expect(rankRoomsByFit(rooms, 'headline')[2].fit).toBe('too-small');
    expect(rankRoomsByFit(rooms, 'emerging').map((x) => x.id)[0]).toBe('club');
  });
});

describe('S23 galleries and art centers need a concert-room tag', () => {
  it('gallery / arts center alone is excluded', () => {
    expect(classifyVenue(tag('genre:place:art_gallery', 'genre:place:live_music_venue'), 0.8).kind).toBe('excluded');
    expect(classifyVenue(tag('genre:place:arts_center'), 0.8).kind).toBe('excluded');
    expect(classifyVenue(tag('genre:place:museum', 'genre:place:live_music_venue'), 0.8).kind).toBe('excluded');
  });
  it('an arts center that also carries a concert hall tag stays a room', () => {
    expect(classifyVenue(tag('genre:place:arts_center', 'genre:place:concert_hall'), 0.8).kind).toBe('venue');
    expect(classifyVenues([{ id: 'a', name: 'Arts Center', affinity: 0.8, tags: tag('genre:place:arts_center') }])).toHaveLength(0);
  });
});
