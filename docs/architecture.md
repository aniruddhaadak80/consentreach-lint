# Architecture Contract

The five decisions below are binding. Everything in `packages/` and `services/` is downstream of
them, and this file is the argument for why the repository is shaped the way it is.

---

## 1. Which surfaces ship

| Surface                | Ships  | Why                                                                                               |
| ---------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| **CLI**                | yes    | Load-bearing. A consent gap is a merge blocker, and merge blockers run in CI.                     |
| **Web (Vercel)**       | yes    | The obligations have owners and deadlines. Someone must work a queue.                             |
| **MCP server**         | yes    | High leverage: another agent can ask "is this change covered?" without a human.                   |
| **MCP client**         | yes    | Proves the server from outside over real stdio. A server nobody calls is unverified.              |
| **Skills catalog**     | yes    | Onboarding a new reviewer is a markdown file, not a meeting.                                      |
| **Plugin registry**    | yes    | New org-specific policies ship as manifests, not as core edits.                                   |
| **Memory (SQLite)**    | yes    | Queue assignment and decisions must survive a restart and be queryable.                           |
| **Desktop (Electron)** | **no** | The workflow is CI plus PR review. A packaging shell improves neither and adds a signed artifact. |
| **Channels**           | **no** | Obligations are a queue with an owner, not a conversation.                                        |
| **Model providers**    | **no** | The credibility claim is a proof. A "fallback that guesses" is the failure mode itself.           |
| **Evals**              | yes    | A linter without a regression corpus decays quietly into a rubber stamp.                          |

Each omission is a position, not an omission of effort. Channels in particular would make the
product _worse_: an obligation you can resolve by replying in a thread is an obligation nobody
can audit.

---

## 2. The narrow waist

> Every capability is a `Tool` registered in one `ToolRegistry`, reachable identically from the
> CLI, the web app, the MCP server, and the SDK.

The CLI, the web routes, the MCP server, and the SDK are transports. None contains product logic.
If a surface needs a behaviour, the behaviour belongs in a tool — which is why
`packages/mcp/src/descriptors.ts` _derives_ its tool list from the registry rather than declaring
one, and why a tool added for the CLI is exposed over MCP the same day with no extra work.

The engine sits below the waist, not beside it: tools call it through `engine-client`, and the
Python package is never imported by a transport directly.

---

## 3. The footprint ladder

Binding, and mirrored in `AGENTS.md`:

1. **Extend an existing tool** — the default answer.
2. **New CLI command + skill** — a new verb for a human.
3. **Service-gated tool** — needs an external system to be worth having.
4. **Plugin** — organisation-specific policy. Free: not in every context window.
5. **MCP server tool** — only to fix a naming problem.
6. **New core tool** — last resort.

Every core tool is paid for in context window on every request, permanently. That asymmetry is the
entire reason the ladder exists, and it is why this product keeps its core tool count low and puts
org-specific obligations in `plugins/`.

---

## 4. The deterministic engine

Three pure functions, in `services/engine/src/consentreach_lint/analysis.py`. No clock, no network,
no randomness, no filesystem. Same input, same bytes out.

| Operation          | Input                           | Output                                                        |
| ------------------ | ------------------------------- | ------------------------------------------------------------- |
| `reach_diff`       | `{before, after, ledger, asOf}` | `{hunks, uncovered, coverage, stats}`                         |
| `plan_cover`       | `{uncovered, surface, policy}`  | `{specific, broad, overReachCost, lowerBound, provenMinimal}` |
| `validate_surface` | `{surface, ledger}`             | `{violations}`                                                |

Three properties make these the credibility of the product, and all three are asserted in
`pytest` and mirrored in TypeScript for the web:

**Minimality is certified, not asserted.** `plan_cover` runs exact branch-and-bound over the
candidate grants in a deterministic total order, and computes an admissible lower bound by disjoint
greedy packing. `provenMinimal` is true only when incumbent size equals the bound. Otherwise the
gap is reported.

**Escalation invalidates cover independently of coverage.** If an activity's automation or decision
effect _increases_, the tuple is reported uncovered even when an active grant matches it. Consent
to be scored is not consent to be refused by a machine.

**Over-reach is a first-class cost.** Each candidate grant carries a `sweepSize`: how many tuples of
the after-surface it covers beyond the orphans it is required to cover. A broad grant that solves
the cover in one ask may cost more than the narrow grants it replaced.

The TypeScript mirror in `apps/web/lib/reach.ts` exists because ADR 0003 keeps the web app free of
workspace dependencies. `apps/web/tests/parity.test.mjs` pins the mirror against output produced by
the Python engine, so the two cannot drift.

---

## 5. Data model

Five entities. Two of them are committed; three are derived.

**Committed, because the review _is_ a pull request:**

| Entity               | Where             | Fields                                                                                                 |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `ProcessingActivity` | `surfaces/*.json` | `id, purpose, subjectClass, automation, decisionEffect, dataClasses[], legalBasis`                     |
| `ProcessingSurface`  | `surfaces/*.json` | `system, epoch, activities[]`                                                                          |
| `ConsentGrant`       | `ledger/*.json`   | `id, subjectClass, purposes[], activities[], dataClasses[], legalBasis, validFrom, validUntil, status` |
| `ConsentLedger`      | `ledger/*.json`   | `grants[]`                                                                                             |

**Derived, recomputed on every run, never stored as truth:**

| Entity           | Produced by  | Notes                                                             |
| ---------------- | ------------ | ----------------------------------------------------------------- |
| `Hunk`           | `reach_diff` | `op, id, fields[], class, severity` — the edit script             |
| `UncoveredTuple` | `reach_diff` | the orphan, with `reason` naming _which_ grant law failed         |
| `CoverPlan`      | `plan_cover` | chosen grants, their `sweepSize`, the bound, the optimality claim |

Storage is **git-backed** by decision, and this is the reason `git-backed` was drawn rather than
`sqlite`. Consent scopes are policy; policy changes deserve a diff, a review, and a revert. The
SQLite store in `packages/memory` holds only _workflow_ state — who picked up which obligation, and
when it was decided — because that is ephemeral and must never be committed.

---

## Invariants

1. **Tools are stateless.** State lives in `packages/memory`, addressed through the context.
2. **Input is validated before the handler runs.** Never after, never partially.
3. **Permissions are declared, not assumed.** `doctor` cross-checks declarations against the registry.
4. **Duplicate tool names throw**, naming both registrants.
5. **No cross-package deep imports.** Enforced by `check:boundaries`.
6. **The engine never reads the clock.** `asOf` is an explicit input, so a lint run is replayable.
7. **No report claims optimality without a bound.** `provenMinimal` is derived, never defaulted.

## Packages

| Package         | Responsibility                                                               |
| --------------- | ---------------------------------------------------------------------------- |
| `core`          | the `Tool` interface, the registry, permissions, the error taxonomy. No I/O. |
| `config`        | layered config; the schema is the source of truth                            |
| `memory`        | SQLite workflow state, numbered migrations, FTS5                             |
| `skills`        | `SKILL.md` discovery, frontmatter parsing, catalog validation                |
| `plugins`       | manifest loading, schema validation, priority conflict resolution            |
| `mcp`           | MCP server (stdio) and MCP client, both derived from the core registry       |
| `engine-client` | typed subprocess bridge to the Python engine                                 |
| `cli`           | commander CLI; `doctor` plus the lint/plan/queue verbs                       |
| `sdk`           | the public facade — the stable surface and nothing else                      |

See [adr/0002-python-engine-boundary.md](adr/0002-python-engine-boundary.md),
[adr/0003-web-app-self-contained.md](adr/0003-web-app-self-contained.md), and
[adr/0004-reach-algebra.md](adr/0004-reach-algebra.md).
