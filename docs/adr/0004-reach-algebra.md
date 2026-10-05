# ADR 0004 — The reach algebra, and why consent is not a set difference

- **Status**: accepted
- **Date**: 2026-10-05
- **Supersedes**: nothing

## Context

The intuitive model of this problem is a set difference. A system touched some processing before,
it touches some processing now, so the new processing needs consent. That model is wrong in three
ways that matter, and each wrongness produces a false negative on a real legal obligation.

## The three wrongnesses

**1. Coverage is not a subset test on the whole surface.** A grant is scoped by four independent
axes — cohort, purpose, activities, data classes — and it covers an activity only if _all four_
match. Widening any one axis is a new grant, not an extension of the old one. So reach is a
conjunction over axes, not a subset relation on activities.

**2. Data classes accumulate; purposes do not.** A grant that covered `email` does not cover
`biometric`. The obligation that arises is about the _difference_ in data classes, which is
invisible if you compare activity identifiers and ignore their fields.

**3. Escalation invalidates cover even when nothing was added.** If an activity's automation moves
from `human_review` to `automated`, or its effect moves from `advisory` to `binding`, the same
tuple that was covered a moment ago is now uncovered — with no new activity, no new purpose, and
no new data class. A diff over activity identity cannot see this, because the identifier did not
change. **Consent to be scored is not consent to be refused by a machine.**

## Decision

Reach is defined as a relation, computed at an explicit `asOf` date, and an activity is uncovered
when **any** of the following holds:

1. its `legalBasis` is not `consent` → it is reported out of scope, with the reason, never silently
   dropped;
2. no _active_ grant matches all four axes;
3. some grant matches on cohort/purpose/activity but its `dataClasses` do not cover the activity's;
4. its automation or decision effect **increased** relative to the before-surface.

`reach_diff` therefore emits hunks classified as `benign`, `scope-creep`, `automation-escalation`,
`effect-escalation`, or `reach-withdrawal`, each with a severity from a fixed table, and emits one
`UncoveredTuple` per failing tuple carrying a `reason` that names which of the four rules fired.

`asOf` is an input, never a read of the clock. A lint run is therefore replayable: the same commit
and the same `asOf` give the same report, which is the property that makes a CI gate trustworthy.

## The minimum cover, and why the naive answer is the wrong one

Given the uncovered set, the obvious answer is "ask for the fewest grants". That answer is wrong:
a grant scoped `activities: ["*"]` covers everything in one ask, and simultaneously widens
permission for every processing tuple in the surface, including ones nobody questioned.

So the engine computes two answers and reports both:

- `minSpecific` — the minimum number of **narrowly scoped** candidates (exact cohort, exact
  activity). This is the defensible ask.
- `minBroad` — the minimum over all candidate widths, including purpose-wide grants.

Each candidate carries `sweepSize`: the number of after-surface tuples it covers _beyond_ the
orphans it is required to cover. `overReachCost` is the total sweep of the chosen plan. A plan with
`minBroad = 1` and `sweepSize = 47` is a worse answer than `minSpecific = 3` with `sweepSize = 0`,
and the report is designed to make that comparison the obvious one.

Set cover is NP-hard, so optimality is **certified, never assumed**. The engine runs exact
branch-and-bound in a deterministic total order against an admissible lower bound computed by
disjoint greedy packing, and sets `provenMinimal` only when the incumbent equals the bound.
Otherwise it reports `provenMinimal: false` and the gap. Reporting a bound as an optimum is the one
failure this product exists to eliminate, so it does not commit it in its own engine.

## Consequences

- A surface that adds nothing can still fail a lint run, via escalation. That is intended.
- The same surface linted at two different `asOf` dates can produce different reports, because a
  grant may have expired between them. That is also intended, and it is why `asOf` is explicit.
- `plan_cover` is the only non-trivial algorithm in the repository. It is isolated in one function
  so that a future reader can audit it, and its optimality claim is testable against brute force
  on small instances.
