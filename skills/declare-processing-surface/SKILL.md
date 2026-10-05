---
name: declare-processing-surface
description: Use when adding or changing an activity in a processing surface, because the four fields that decide whether consent can ever cover it are not obvious from the schema.
metadata:
  version: 1.0.0
---

# Declaring a processing surface

## When to use this

You are editing `apps/web/data/*.before.json` or `*.after.json`, or you are adding an activity to
your own system. The declaration is what every downstream guarantee rests on.

## The fields that decide coverage

A grant covers an activity only if **all four** of these match. Widening any one of them is a new
grant, not an extension of the old one:

1. `subjectClass` — the cohort
2. `purpose` — why
3. `activities` — which
4. `dataClasses` — what it touches

Two more fields decide whether an existing grant survives the change:

5. `automation` — `none` < `human_review` < `human_approval` < `automated`
6. `decisionEffect` — `none` < `advisory` < `binding` < `dispositive`

A grant records the level a person **accepted**. An activity records the level the system now
**applies**. Cover requires the accepted level to be at least the applied level. Raising an
activity's automation therefore orphans it even if nothing was added.

## Steps

1. **One activity is one thing the system does to a cohort.** If the sentence needs "and", it is
   probably two activities.

2. **Declare every data class, including the ones that feel incidental.** A grant for `contact`
   does not cover `biometric`. An undeclared data class cannot be shown to be covered by
   anything.

3. **Set `automation` and `decisionEffect` to what happens today**, not what is planned. Declaring
   the intended future state hides the very escalation the linter exists to catch.

4. **Pick `legalBasis` honestly.** Only `consent` creates a re-consent obligation. Anything else is
   reported as out of scope — and `sensitive-data-without-consent` fires if it touches health,
   biometric, genetic, precise-location or financial data.

5. **Run the static checks before you ask anyone to review.**

   ```bash
   consentreach-lint validate
   ```

6. **Run the lint and read the hunks.** A new activity on a non-consent basis is `benign`. On a
   consent basis it is `scope-creep` and it creates an obligation.

7. **Regenerate the committed plan** if you changed anything the plan depends on:

   ```bash
   npm run artifacts
   ```

   `npm run check:plan-artifact` fails the build if you forget.

## Rules

- Never use `*` in a grant. A wildcard grant is reported, and it sweeps in processing nobody
  asked about — that is the same over-reach the planner prices.
- Never lower `automation` on a grant to make an activity look covered.
- `asOf` is an argument, never the clock, so a lint run is replayable. Do not "fix" a report by
  moving the date until it passes.
