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
// Data and structure (SPEC §12).
/** A metro with at least this many people is a "big market". */
export const BIG_MARKET_POP = 1_000_000;
/** The market-size baseline considers US metros within this distance of the start. */
export const MARKET_REGION_KM = 900;
/** Two stops this close are the same market when plans are compared. */
export const LIFT_MATCH_KM = 100;
/** A town not named in any metro is assigned to the nearest metro only within this distance. */
export const MARKET_NEAR_KM = 60;
/** A room this far from the candidate city, in another city, moves the stop to the room's own city. */
export const VENUE_RELOCATE_MIN_KM = 8;
/** Drive time estimate: straight-line km × ROAD_FACTOR ÷ AVG_SPEED_KMH. */
export const ROAD_FACTOR = 1.25;
export const AVG_SPEED_KMH = 80;
/** Artist weight class from Qloo artist popularity: below MID = emerging, below HEADLINE = mid, else headline. */
export const ARTIST_BAND_MID = 0.9;
export const ARTIST_BAND_HEADLINE = 0.97;
export const LLM_MAX_TOOL_ROUNDS = 4;
/** Chat calls per server instance per hour (protects the Gemini quota). */
export const LLM_HOURLY_CAP = 40;
export const ROOM_CLUSTER_KM = 30;
