// Tunable plan-quality constants (SPEC §9).
export const MIN_CITY_SEPARATION_KM = 150;
export const VENUE_ESTABLISHED_POPULARITY = 0.9;
export const OPENER_COMMON_SHARE = 0.5;
// Agentic self-check (SPEC §11). Single source for every number the loop uses.
/** Cities are chosen only from the top N by taste affinity. */
export const TASTE_RANK_CAP = 20;
/** Max self-check rounds (re-query with changed conditions) before the route shrinks instead of filling. */
export const SELF_CHECK_MAX_ROUNDS = 4;
/** Venue search radius ladder: first 15 km, then widened once. */
export const VENUE_RADIUS_M = 15000;
export const VENUE_RADIUS_WIDE_M = 40000;
/** Second venue tag tried after the radius was widened. */
export const VENUE_ALT_TAG = 'urn:tag:genre:place:concert_hall';
/** An opener must sit at least this far below the headliner's Qloo popularity (0..1). */
export const OPENER_POPULARITY_MARGIN = 0.05;
/** An act counts as "local" only if the location signal raised its affinity by at least this much vs. the no-location baseline. */
export const LOCAL_SIGNAL_MIN_DELTA = 0.02;
/** Openers requested per city (the popularity band filters most of them). */
export const OPENER_FETCH = 20;
