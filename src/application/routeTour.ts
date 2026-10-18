// Application: UC-1..UC-3 orchestrated over a TastePort, with a bounded plan -> self-check -> re-query loop (SPEC §11).
// No HTTP/framework imports.
import { haversineKm, type LatLon } from '../domain/geo.js';
import { compareLift, type TasteLift } from '../domain/lift.js';
import { classifyVenues } from '../domain/venue.js';
import { venueAnchor } from '../domain/anchor.js';
import { artistBand, rankRoomsByFit } from '../domain/weightClass.js';
import { baselineMarkets, isBigMarket, marketCityName, marketFor, marketLabel, type Market } from '../domain/market.js';
import { LIFT_MATCH_KM, MARKET_REGION_KM, ROOM_CLUSTER_KM, OPENER_COMMON_SHARE, OPENER_FETCH, SELF_CHECK_MAX_ROUNDS, TASTE_RANK_CAP, VENUE_ALT_TAG, VENUE_RADIUS_WIDE_M, MIN_CITY_SEPARATION_KM } from '../domain/constants.js';
import { describeAudience, type AudienceProfile, type AudienceView } from '../domain/audience.js';
import { selectOpeners, type Baseline } from '../domain/openers.js';
import { draftCityPitch, draftPitch, VENUE_FIT_MIN, type Artist } from '../domain/pitch.js';
import { assemblePlan, planGeneric, planTour, type CandidateCity, type Opener, type TourPlan, type Venue } from '../domain/planner.js';

export interface TastePort {
  readonly mode: 'live' | 'sample';
  searchArtist(name: string): Promise<Artist | null>;
  rankCities(artist: Artist, take: number): Promise<CandidateCity[]>;
  /** `opts` lets the self-check loop change the search condition (radius, tag) when a city has no room. */
  venuesNear(artist: Artist, city: CandidateCity, take: number, opts?: { radiusM?: number; tag?: string }): Promise<Venue[]>;
  /** Artists with overlapping fans that over-index near the city (cross-entity taste). */
  openersNear(artist: Artist, city: CandidateCity, take: number): Promise<Opener[]>;
  /** The same ranking without a location signal: lets us tell a local act from a region-wide one. Optional. */
  openersBaseline?(artist: Artist, take: number): Promise<{ id: string; affinity: number }[]>;
  /** Artist-level audience index (Qloo demographics). Optional. */
  audienceProfile?(artist: Artist): Promise<AudienceProfile | null>;
  /** Resolve a typed city name to a destination with coordinates (planner chat). Optional. */
  searchCity?(name: string): Promise<CandidateCity | null>;
}

export interface RouteTourInput {
  readonly artistName: string;
  readonly home: LatLon;
  readonly stops?: number;
  readonly maxLegKm?: number;
  readonly mustInclude?: readonly string[];
  readonly exclude?: readonly string[];
  /** Cities the user named that Qloo did not rank (resolved by searchCity). They enter the pool with no taste rank and are labelled. */
  readonly extraCities?: readonly CandidateCity[];
}
/** One decision of the self-check loop: what was found, what condition was changed, what came out. */
export interface TraceEntry {
  readonly round: number;
  readonly city: string;
  /** Candidate city id (the name changes when a stop moves to its room's city). */
  readonly cityId?: string;
  readonly check: 'room' | 'rank' | 'opener' | 'drive' | 'size' | 'llm';
  readonly finding: string;
  readonly action: string;
  readonly outcome: string;
}
export interface StopNote {
  readonly kind: 'added' | 'confirmed' | 'bridge';
  /** One line: why this city is on the route. */
  readonly summary: string;
  readonly replaces?: string;
  /** Set when the stop ranks below the top `stops` cities. */
  readonly rankNote?: string;
}
export interface RouteTourResult {
  readonly dataMode: 'live' | 'sample';
  readonly artist: Artist;
  readonly taste: TourPlan;
  readonly generic: TourPlan;
  readonly lift: TasteLift;
  readonly pitch: string;
  readonly cityPitches: Readonly<Record<string, string>>;
  /** Acts Qloo returned for most stops: shown as region-wide, not as local openers (SPEC S11). */
  readonly regionWideOpeners: readonly string[];
  /** Calls that failed; the plan is still complete without them (SPEC S12). */
  readonly degraded: readonly string[];
  /** Decision trace of the self-check loop (SPEC §11). */
  readonly trace: readonly TraceEntry[];
  readonly selfCheck: { readonly rounds: number; readonly retries: number; readonly maxRounds: number; readonly rankCap: number };
  readonly stopNotes: Readonly<Record<string, StopNote>>;
  /** Stops that could not be filled, with the reason. */
  readonly unfilled: readonly string[];
  readonly audience: AudienceView | null;
  /** Market-size facts per stop id (SPEC S20): Census metro, population, big-market flag. */
  readonly stopMarkets: Readonly<Record<string, StopMarket>>;
  /** Why each baseline (largest-metro) stop is not on the taste route (SPEC S21). */
  readonly baselineOmissions: readonly BaselineOmission[];
  readonly artistBand: ReturnType<typeof artistBand>;
  /** Every city Qloo ranked for this audience (and any the user added), for name lookups by the planner chat. */
  readonly candidates: readonly { readonly id: string; readonly name: string; readonly rank: number; readonly affinity: number }[];
}
export interface StopMarket { readonly metro: string | null; readonly pop: number | null; readonly big: boolean; readonly label: string }
export interface BaselineOmission { readonly market: string; readonly pop: number; readonly qlooRank: number | null; readonly affinity: number | null; readonly reason: string }

export class ArtistNotFound extends Error {}

const short = (c: CandidateCity) => c.name.split(',')[0];
type Look = { raw: Venue[] | null; step: 0 | 1 | 2; openers: Opener[] | null; accepted?: boolean };

export async function routeTour(port: TastePort, input: RouteTourInput): Promise<RouteTourResult> {
  const artist = await port.searchArtist(input.artistName);
  if (!artist) throw new ArtistNotFound(`No artist found for "${input.artistName}"`);
  const wanted = input.stops ?? 8;
  const req = { stops: wanted, maxLegKm: input.maxLegKm ?? 650, home: input.home, mustInclude: input.mustInclude };
  const rawCands = await port.rankCities(artist, 30);
  const fullRank = new Map([...rawCands].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id)).map((c, i) => [c.id, i + 1] as const));
  const known = new Set(rawCands.map((c) => c.id));
  const allCands = [...rawCands, ...(input.extraCities ?? []).filter((c) => !known.has(c.id))].filter((c) => !input.exclude?.includes(c.id));
  const candById = new Map(allCands.map((c) => [c.id, c] as const));
  const band = artistBand(artist.popularity);
  const ordered = [...allCands].sort((a, b) => b.affinity - a.affinity || a.id.localeCompare(b.id));
  const ranks = new Map(ordered.map((c, i) => [c.id, i + 1] as const));
  // Top N by taste, plus any city the user explicitly asked to keep (their decision overrides the cap and is labelled).
  const pool = ordered.filter((c, i) => i < TASTE_RANK_CAP || input.mustInclude?.includes(c.id));
  const degraded: string[] = [];
  const trace: TraceEntry[] = [];
  const looks = new Map<string, Look>();
  const rejected = new Map<string, string>();
  let rounds = 0;
  let retries = 0;

  // Optional context calls: a failure is a degraded note, never fatal.
  let audience: AudienceView | null = null;
  if (port.audienceProfile) {
    try { const p = await port.audienceProfile(artist); audience = p ? describeAudience(p) : null; }
    catch (e) { degraded.push(`audience profile failed (${(e as Error).message.slice(0, 60)})`); }
  }
  let baseline: Baseline = null;
  if (port.openersBaseline) {
    try { baseline = new Map((await port.openersBaseline(artist, OPENER_FETCH)).map((o) => [o.id, o.affinity] as const)); }
    catch (e) { baseline = 'unavailable'; degraded.push(`opener baseline lookup failed (${(e as Error).message.slice(0, 60)})`); }
  }

  const lookup = async (c: CandidateCity) => {
    const look: Look = looks.get(c.id) ?? { raw: null, step: 0, openers: null };
    looks.set(c.id, look);
    try { look.raw = await port.venuesNear(artist, c, 10); }
    catch (e) { degraded.push(`${short(c)}: venue lookup failed (${(e as Error).message.slice(0, 60)})`); }
    try { look.openers = await port.openersNear(artist, c, OPENER_FETCH); }
    catch (e) { degraded.push(`${short(c)}: opener lookup failed (${(e as Error).message.slice(0, 60)})`); }
  };

  // A room appears once per plan: the stop with the better taste rank keeps it. Returns each stop's classified rooms.
  const assignRooms = (stops: TourPlan['stops']) => {
    const taken = new Set<string>();
    const out = new Map<string, Venue[]>();
    for (const s of [...stops].sort((a, b) => a.affinityRank - b.affinityRank)) {
      const look = looks.get(s.city.id);
      if (!look?.raw) continue;
      const ranked = rankRoomsByFit(classifyVenues(look.raw), band).filter((v) => !taken.has(v.id));
      // Rooms of one stop must sit together: everything within ROOM_CLUSTER_KM of the best room (SPEC S22).
      const head = ranked[0];
      const mine = ranked.filter((v) => !head || v === head || typeof v.lat !== 'number' || typeof head.lat !== 'number' || haversineKm(head as LatLon, v as LatLon) <= ROOM_CLUSTER_KM).slice(0, 3);
      mine.forEach((v) => taken.add(v.id));
      out.set(s.city.id, mine);
    }
    return out;
  };
  /** ok = a confirmed concert room fits; weak = only rooms Qloo cannot confirm; none = no room at all (or a lookup that did not fail but found nothing). */
  const roomState = (stops: TourPlan['stops']) => {
    const rooms = assignRooms(stops);
    return stops.filter((s) => rooms.has(s.city.id)).map((s) => {
      const fit = rooms.get(s.city.id)!.filter((v) => v.affinity >= VENUE_FIT_MIN);
      return { s, state: fit.some((v) => v.kind === 'venue') ? 'ok' as const : fit.length ? 'weak' as const : 'none' as const };
    });
  };
  const noRoom = (stops: TourPlan['stops']) => roomState(stops).filter((x) => x.state !== 'ok' && !(x.state === 'weak' && looks.get(x.s.city.id)?.accepted)).map((x) => x.s);

  const planOver = (cs: CandidateCity[], stops = wanted) => planTour(cs, { ...req, stops, ranks });
  let live = pool;
  let first = planOver(live);
  // SPEC S22: a stop lives where its best room is. Moves the stop to the room's city and coordinates, then the planner re-checks separation and drive limits on the new coordinates.
  let anchorPasses = 0;
  const anchorPass = (stops: TourPlan['stops']) => {
    const rooms = assignRooms(stops);
    let moved = 0;
    for (const s of stops) {
      const orig = candById.get(s.city.id);
      if (!orig) continue;
      const room = rooms.get(s.city.id)?.[0];
      const a = venueAnchor(orig, room) ?? orig;
      const cur = live.find((x) => x.id === s.city.id);
      if (!cur || (cur.lat === a.lat && cur.lon === a.lon)) continue;
      live = live.map((x) => (x.id === a.id ? a : x));
      moved++;
      const km = Math.round(haversineKm(orig, a));
      trace.push({ round: rounds, city: a.name, cityId: a.id, check: 'room', finding: room && a !== orig ? `${room.name} is in ${a.name}, ${km} km from ${short(orig)} (the city Qloo ranked)` : `room changed, stop returns to ${short(orig)}`, action: a !== orig ? "move the stop to the room's own city and coordinates, re-check separation and drive limits" : 'restore the ranked city', outcome: a !== orig ? `stop is now ${a.name}` : `stop is ${short(orig)}` });
    }
    return moved;
  };
  for (;;) {
    for (const s of first.stops) if (!looks.has(s.city.id)) await lookup(s.city);
    if (anchorPasses < 12 && anchorPass(first.stops)) { anchorPasses++; first = planOver(live); continue; }
    const bad = noRoom(first.stops);
    if (!bad.length || rounds >= SELF_CHECK_MAX_ROUNDS) break;
    rounds++;
    for (const s of bad) {
      const c = s.city;
      const look = looks.get(c.id)!;
      const label = short(c);
      if (look.step === 0 || look.step === 1) {
        retries++;
        const opts = look.step === 0 ? { radiusM: VENUE_RADIUS_WIDE_M } : { radiusM: VENUE_RADIUS_WIDE_M, tag: VENUE_ALT_TAG };
        const action = look.step === 0 ? `widen venue search radius 15 km → ${VENUE_RADIUS_WIDE_M / 1000} km` : `retry with venue tag concert_hall at ${VENUE_RADIUS_WIDE_M / 1000} km`;
        look.step = (look.step + 1) as 1 | 2;
        let found = 0;
        try { look.raw = await port.venuesNear(artist, c, 10, opts); found = classifyVenues(look.raw).filter((v) => v.affinity >= VENUE_FIT_MIN).length; }
        catch (e) { degraded.push(`${label}: venue retry failed (${(e as Error).message.slice(0, 60)})`); look.raw = null; }
        trace.push({ round: rounds, city: c.name, cityId: c.id, check: 'room', finding: 'no qualifying room', action, outcome: found ? `found ${found} qualifying room(s)` : 'still no qualifying room' });
      } else if (roomState([s]).some((x) => x.state === 'weak')) {
        look.accepted = true;
        trace.push({ round: rounds, city: c.name, cityId: c.id, check: 'room', finding: 'only rooms Qloo cannot confirm as concert rooms', action: 'keep, label the room "room type unverified"', outcome: 'kept with the unverified label' });
      } else {
        rejected.set(c.id, 'no qualifying room');
        live = live.filter((x) => x.id !== c.id);
        trace.push({ round: rounds, city: c.name, cityId: c.id, check: 'room', finding: 'no qualifying room after radius and tag retries', action: 'drop city and fill from the next taste-ranked city', outcome: `rank #${ranks.get(c.id)} removed` });
      }
    }
    first = planOver(live);
  }
  // Rounds exhausted with rooms still missing: shrink to the stops that passed instead of keeping a stop without a room.
  const leftover = roomState(first.stops).filter((x) => x.state === 'none').map((x) => x.s);
  let unfilled: string[] = [];
  if (leftover.length) {
    for (const s of leftover) {
      rejected.set(s.city.id, 'no qualifying room');
      trace.push({ round: rounds, city: s.city.name, cityId: s.city.id, check: 'room', finding: 'no qualifying room when the round limit was reached', action: 'drop city, route shrinks (no unverified replacement)', outcome: `rank #${s.affinityRank} removed` });
    }
    const okIds = new Set(first.stops.map((s) => s.city.id));
    leftover.forEach((s) => okIds.delete(s.city.id));
    live = live.filter((c) => okIds.has(c.id));
    first = planOver(live, live.length);
  }
  if (first.stops.length < wanted) {
    const names = [...rejected].map(([id]) => short(allCands.find((c) => c.id === id)!));
    unfilled = [`${first.stops.length} of ${wanted} stops: ${rejected.size ? `no qualifying room within ${VENUE_RADIUS_WIDE_M / 1000} km for ${names.join(', ')}` : 'not enough separate markets in the taste top ' + TASTE_RANK_CAP}; the next candidates are outside the taste top ${TASTE_RANK_CAP}`];
  }

  // Openers: below the headliner's weight class; "local" only if the location signal moved them; acts returned for most stops are region-wide.
  const taste0 = first;
  const rawOpeners = new Map<string, Opener[]>();
  for (const s of taste0.stops) { const o = looks.get(s.city.id)?.openers; if (o) rawOpeners.set(s.city.id, o); }
  const seen = new Map<string, { name: string; n: number }>();
  for (const list of rawOpeners.values()) for (const o of list) seen.set(o.id, { name: o.name, n: (seen.get(o.id)?.n ?? 0) + 1 });
  const commonIds = new Set(rawOpeners.size >= 3 ? [...seen].filter(([, v]) => v.n / rawOpeners.size > OPENER_COMMON_SHARE).map(([id]) => id) : []);
  const regionWideOpeners = [...commonIds].map((id) => seen.get(id)!.name);
  const rooms = assignRooms(taste0.stops);
  const openers = new Map([...rawOpeners].map(([id, list]) => [id, selectOpeners(list.filter((o) => !commonIds.has(o.id)), artist.popularity, baseline, 3)] as const));
  for (const s of taste0.stops) {
    if (openers.has(s.city.id) && openers.get(s.city.id)!.length === 0) trace.push({ round: 0, city: s.city.name, cityId: s.city.id, check: 'opener', finding: 'no opener below the headliner weight class', action: 'show none instead of a bigger act', outcome: 'no opener listed' });
  }
  for (const s of taste0.stops) {
    const top = rooms.get(s.city.id)?.[0];
    if (top && (top.fit === 'too-small' || top.fit === 'too-big')) {
      trace.push({ round: 0, city: s.city.name, cityId: s.city.id, check: 'size', finding: `best room ${top.name} looks ${top.fit === 'too-small' ? 'small' : 'large'} for a ${band} act (estimate from ${top.sizeBasis === 'tags' ? 'Qloo tags' : 'Qloo popularity'}, not a capacity)`, action: 'keep, label "size mismatch" on the card', outcome: `${top.fit}` });
    }
  }
  const liveById = new Map(live.map((c) => [c.id, c] as const));
  const enriched = allCands.map((c0) => {
    const c = liveById.get(c0.id) ?? c0;
    const look = looks.get(c.id);
    return look ? { ...c, venues: rooms.get(c.id) ?? [], openers: openers.get(c.id) ?? [] } : c;
  });
  const taste = planOver(enriched.filter((c) => live.some((l) => l.id === c.id)), live.length < wanted ? live.length : wanted);
  // SPEC S20: the "without taste data" plan is the same planner over the largest US metros in range, ranked by Census population.
  const nearestQloo = (m: Market) => rawCands.map((q) => ({ q, km: haversineKm(m, q) })).filter((x) => x.km < LIFT_MATCH_KM).sort((a, b) => a.km - b.km)[0]?.q;
  const baseMarkets = baselineMarkets(input.home, MARKET_REGION_KM);
  const baseQ = new Map(baseMarkets.map((m) => [m.id, nearestQloo(m)] as const));
  const baseCands: CandidateCity[] = baseMarkets.map((m) => ({ id: `msa-${m.id}`, name: marketCityName(m), lat: m.lat, lon: m.lon, affinity: baseQ.get(m.id)?.affinity ?? 0, population: m.pop }));
  const baseRanks = new Map(baseMarkets.map((m) => [`msa-${m.id}`, baseQ.get(m.id) ? fullRank.get(baseQ.get(m.id)!.id) ?? 0 : 0] as const));
  const generic = planGeneric(baseCands, { ...req, ranks: baseRanks });
  const lift = compareLift(taste, generic);

  // Why each stop is on the route (one line) and why a lower-ranked city was used.
  const tasteIds = new Set(taste.stops.map((s) => s.city.id));
  const genericOnly = generic.stops.filter((s) => !taste.stops.some((t) => haversineKm(t.city, s.city) < LIFT_MATCH_KM));
  const inGeneric = (c: CandidateCity) => generic.stops.some((g) => haversineKm(g.city, c) < LIFT_MATCH_KM);
  const stopMarkets: Record<string, StopMarket> = {};
  for (const s of taste.stops) {
    const m = marketFor(s.city.name, s.city);
    stopMarkets[s.city.id] = { metro: m ? m.name : null, pop: m ? m.pop : null, big: isBigMarket(m?.pop), label: marketLabel(m?.pop) };
  }
  const stopNotes: Record<string, StopNote> = {};
  for (const s of taste.stops) {
    const nearest = genericOnly.length ? [...genericOnly].sort((a, b) => haversineKm(a.city, s.city) - haversineKm(b.city, s.city))[0] : null;
    const base: Pick<StopNote, 'kind' | 'summary' | 'replaces'> = s.bridge
      ? { kind: 'bridge', summary: 'drive-splitting stop, not a taste pick' }
      : inGeneric(s.city)
        ? { kind: 'confirmed', summary: `taste #${s.affinityRank} and also a top-market pick (${stopMarkets[s.city.id].label}): Qloo confirms it` }
        : { kind: 'added', summary: nearest ? `taste #${s.affinityRank} replaces ${short(nearest.city)} (${marketLabel(nearest.city.population)}, ${nearest.affinityRank ? `taste #${nearest.affinityRank}` : "not in Qloo's top 30"}) from the market-size plan` : `taste #${s.affinityRank}, added by taste data`, ...(nearest ? { replaces: short(nearest.city) } : {}) };
    let rankNote: string | undefined;
    if (input.mustInclude?.includes(s.city.id) && s.affinityRank > TASTE_RANK_CAP) {
      rankNote = `Taste #${s.affinityRank}, outside the top ${TASTE_RANK_CAP}: kept because you asked to keep it.`;
    } else if (s.affinityRank > wanted && !s.bridge) {
      const causes = ordered.slice(0, s.affinityRank - 1).filter((c) => !tasteIds.has(c.id)).map((c) => {
        const why = rejected.get(c.id) ?? (taste.stops.some((o) => haversineKm(o.city, c) < MIN_CITY_SEPARATION_KM) ? 'same market as a stronger stop' : 'out of reach of the drive limit or route order');
        return { n: short(c), rank: ranks.get(c.id)!, why };
      });
      const noRoomFirst = [...causes].sort((a, b) => Number(b.why === 'no qualifying room') - Number(a.why === 'no qualifying room') || a.rank - b.rank);
      rankNote = `Taste #${s.affinityRank} used because higher-ranked cities were not usable: ${noRoomFirst.slice(0, 3).map((c) => `#${c.rank} ${c.n} (${c.why})`).join('; ')}${noRoomFirst.length > 3 ? `; +${noRoomFirst.length - 3} more` : ''}.`;
      trace.push({ round: 0, city: s.city.name, cityId: s.city.id, check: 'rank', finding: `taste rank #${s.affinityRank} is outside the top ${wanted}`, action: 'keep, show the reason on the card', outcome: rankNote });
    }
    stopNotes[s.city.id] = { ...base, ...(rankNote ? { rankNote } : {}) };
  }
  for (const w of taste.warnings) if (/leg /.test(w)) trace.push({ round: 0, city: 'route', cityId: 'route', check: 'drive', finding: w, action: 'kept, flagged on screen', outcome: 'not fixable with the available cities' });

  // SPEC S21: for every market-size stop the taste route does not use, say why in data.
  const baselineOmissions: BaselineOmission[] = genericOnly.map((g) => {
    const m = baseMarkets.find((x) => `msa-${x.id}` === g.city.id)!;
    const q = baseQ.get(m.id);
    const rank = q ? fullRank.get(q.id) ?? 0 : 0;
    const mine = taste.stops.filter((t) => !t.bridge);
    const qKm = q ? Math.round(haversineKm(g.city, q)) : 0;
    const qName = q ? `${short(q)} (taste #${rank}${qKm > 5 ? `, ${qKm} km from the metro centre` : ''})` : '';
    // A stronger taste stop within the separation distance of the Qloo-ranked city makes them one market (SPEC S9).
    const blocker = q ? mine.map((t) => ({ t, km: haversineKm(t.city, q) })).filter((x) => x.km < MIN_CITY_SEPARATION_KM && x.t.affinityRank < rank).sort((a, b) => a.t.affinityRank - b.t.affinityRank)[0] : undefined;
    const nearest = mine.map((t) => ({ t, km: haversineKm(t.city, g.city) })).sort((a, b) => a.km - b.km)[0];
    let reason: string;
    if (!q) reason = `not among Qloo's top ${rawCands.length} destinations for this audience, so there is no taste signal to rank it`;
    else if (input.exclude?.includes(q.id)) reason = `Qloo's nearest ranked city ${qName}; you dropped it`;
    else if (rejected.has(q.id)) reason = `Qloo's nearest ranked city ${qName} was dropped: ${rejected.get(q.id)}`;
    else if (rank > TASTE_RANK_CAP) reason = `Qloo's nearest ranked city ${qName} is outside the taste top ${TASTE_RANK_CAP} that the route may use`;
    else if (blocker) reason = `Qloo's nearest ranked city ${qName} is ${Math.round(blocker.km)} km from ${short(blocker.t.city)} (taste #${blocker.t.affinityRank}), a stronger stop, so the two count as one market`;
    else reason = `Qloo's nearest ranked city ${qName} was in range but the route kept stops with a better taste-versus-distance score (nearest stop ${nearest ? `${short(nearest.t.city)}, ${Math.round(nearest.km)} km` : 'none'}; drive limit ${req.maxLegKm} km per leg)`;
    return { market: g.city.name, pop: m.pop, qlooRank: rank || null, affinity: q ? q.affinity : null, reason };
  });

  const cityPitches = Object.fromEntries(taste.stops.map((s) => [s.city.id, draftCityPitch(artist, taste, s.city.id)]));
  return {
    dataMode: port.mode, artist, taste, generic, lift, pitch: draftPitch(artist, taste, audience?.text), cityPitches, regionWideOpeners, degraded,
    trace, selfCheck: { rounds, retries, maxRounds: SELF_CHECK_MAX_ROUNDS, rankCap: TASTE_RANK_CAP }, stopNotes, unfilled, audience,
    stopMarkets, baselineOmissions, artistBand: band,
    candidates: allCands.map((c) => ({ id: c.id, name: c.name, rank: ranks.get(c.id) ?? 0, affinity: c.affinity })),
  };
}
