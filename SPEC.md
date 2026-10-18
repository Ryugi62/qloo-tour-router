# SPEC — Tour Router (working title)

## 0. Purpose (목적)
An agentic tool for small booking agencies and artist managers: given an artist, it finds the cities where
that artist's audience taste is concentrated (Qloo taste graph), picks taste-matched venues, orders the stops
into a drivable route, and drafts a promoter pitch with the evidence that changed each decision. It shows the
same request planned **without** taste data next to it, so the user sees what Qloo changed.

Contest: Qloo Agentic Hackathon (Devpost), deadline 2026-10-30 23:45 EDT.
Agentic surface: an MCP tool `plan_tour` (any agent can call it) + a web app for humans.

## 1. Success conditions (성공 조건, numbers)
- S1 A plan for N stops (default 8) where every leg ≤ maxLegKm (default 650 km), or the plan says which leg
  breaks the limit and why.
- S2 Every stop carries evidence: Qloo affinity (0–1) and its rank among candidates; venues carry their own
  affinity; nothing is shown that the API did not return (no invented capacities or ticket numbers).
- S3 With/without comparison: overlap of city sets (Jaccard) and mean-affinity lift are computed and shown.
- S4 Zero credential exposure: the key is read only server-side from `QLOO_API_KEY`; repo and browser bundle
  contain no key (test greps the served HTML/JS).
- S5 Demo mode works with no key using clearly labelled sample data.
- S6 Cost 0: no paid LLM is required; pitch text is generated from evidence templates.

## 2. Non-goals (비목표)
- No ticket-sales prediction (affinity ≠ ticket sales; copy must not claim it).
- No scraping, no personal data, no booking/sending emails on the user's behalf.

## 3. Ubiquitous language
| Term | Meaning | Code |
|---|---|---|
| Artist | the act being routed | `Artist` |
| Candidate city | a destination with audience affinity for the artist | `CandidateCity` |
| Affinity | Qloo score 0–1 for the artist's audience at a city/venue | `affinity` |
| Stop | a chosen city in order, with venues and evidence | `Stop` |
| Tour plan | ordered stops + legs + totals | `TourPlan` |
| Generic plan | the same planner fed market size only (no taste) | `planGeneric` |
| Taste lift | comparison between taste plan and generic plan | `TasteLift` |
| Taste port | the interface to Qloo | `TastePort` |

## 4. Model
- `planTour(candidates, request) → TourPlan` — select + order (greedy by score, nearest-neighbour order,
  2-opt), score = affinity − λ·detourKm.
- `compareLift(tastePlan, genericPlan) → TasteLift`.
- `draftPitch(artist, plan) → string`.
- Application `RouteTour` use case: TastePort.searchArtist → rankCities → venuesNear(each stop) → plan →
  generic plan → lift → pitch.

## 5. Use cases
- UC-1 Route an artist (taste plan).
- UC-2 Show the generic plan and the taste lift.
- UC-3 Draft the promoter pitch from evidence.
- UC-4 Expose UC-1..3 as MCP tool `plan_tour` and as `GET /api/plan?artist=…`.

## 6. Acceptance criteria
- AC-1 Given 20 candidates and N=8, then the plan has 8 distinct stops and starts nearest the home base.
- AC-2 Given maxLegKm=650, then no leg exceeds 650 km unless no feasible city remains, in which case the
  plan lists the violating leg in `warnings`.
- AC-3 Given the same input twice, the plan is identical (deterministic).
- AC-4 Given a taste plan and a generic plan, Jaccard overlap and mean-affinity lift are correct to 1e-9.
- AC-5 Given a plan, the pitch mentions every stop city and each stop's affinity rank, and contains no
  ticket-sales claim.
- AC-6 Given no `QLOO_API_KEY`, the server uses sample data and every response carries `dataMode: "sample"`.
- AC-7 The served HTML/JS never contains the value of `QLOO_API_KEY`.

## 7. Layers
`src/domain` (pure: geo, planner, lift, pitch) ← `src/application` (RouteTour + TastePort interface) ←
`src/adapters` (QlooHttp, SampleTaste) ← `src/web` (HTTP server, static UI, MCP stdio).

## 8. Live key and hosting (v4)
- S7 With `QLOO_API_KEY` the adapter returns real cities (name carries region, e.g. "Portland, Maine"), affinity in 0..1,
  and venues filtered to `urn:tag:genre:place:live_music_venue`; `population` is not returned by Qloo, so the
  generic plan uses Qloo `popularity` as its market proxy (never invented numbers).
- S8 Hosted URL serves `/` (200) and `/api/plan` with `dataMode: "live"`; the key exists only as a host env var.
- AC-8 Given real-shaped Qloo JSON, When rankCities runs, Then names are region-labelled and popularity is kept.
- AC-9 Given a key, When the live contract test runs, Then >=20 cities and >=1 venue come back (skipped without key).
