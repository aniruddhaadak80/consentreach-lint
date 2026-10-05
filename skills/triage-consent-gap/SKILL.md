---
name: triage-consent-gap
description: Use when a change to an AI system leaves processing activities without covering consent and you must decide what to re-ask for, because the count alone is the wrong answer and the over-reach cost is the right one.
metadata:
  version: 1.0.0
---

# Triaging a consent gap

## When to use this

`consentreach-lint lint` reports activities with no covering grant, and you now have to decide
what to do about them. Do not start from the number of orphans. Start from the reasons.

## The reason decides the remedy

| Reason                   | What actually happened                                    | Remedy                                  |
| ------------------------ | --------------------------------------------------------- | --------------------------------------- |
| `grant-escalation`       | Nobody consented to _how it now decides_                  | Re-ask for the new automation or effect |
| `data-class-not-covered` | A grant matches the scope but not the data it now touches | Re-ask for the added data classes       |
| `grant-expired`          | The window closed before the change landed                | Re-ask, and fix the renewal process     |
| `grant-withdrawn`        | The person took it back                                   | Re-ask, or remove the activity          |
| `no-active-grant`        | The activity was never consented at all                   | Re-ask, or delete the activity          |

`grant-escalation` is the one a code review misses. No activity was added and no identifier
changed, so a diff over activity ids is silent about it.

## Steps

1. **Read the reasons, not the count.**

   ```bash
   consentreach-lint lint
   ```

2. **Check for more than one blocker on a single activity.** An activity can fail on two axes at
   once. `fraud_score` below needed both new data classes and a higher automation level, so a
   single re-ask phrased for either one alone would be wrong.

3. **Ask for the narrow plan.** `consentreach-lint plan` prints both plans. Read the over-reach
   column before the grant count.

4. **Prefer a narrow grant even when it means more asks.** A broad grant saves an ask and quietly
   authorises processing nobody agreed to. The engine prices that: `over-reach` is how many
   already-consented activities a grant would cover beyond the orphans it must cover.

5. **Check the certificate before you promise anything.** `proven minimal (bound 4 == size 4)` is a
   proof. `NOT proven (bound 3, size 4)` is an upper bound, and you must not describe it as the
   minimum.

6. **Record the owner.**

   ```bash
   consentreach-lint decide fraud_score --owner "dana@privacy"
   ```

## Rules

- Never widen a grant to save an ask. Widening is the harm.
- Never re-use consent for a higher automation level. Consent to be scored is not consent to be
  refused by a machine.
- Never report an unproven optimum as a minimum.
- A non-consent legal basis means no re-consent is owed. Do not queue those activities.
