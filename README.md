<div align="center">

# ConsentReach Lint

**Lint the declared processing surface of an AI system against its consent ledger, and prove
which people a change leaves without cover.**

[CI](https://github.com/aniruddhaadak80/consentreach-lint/actions/workflows/ci.yml) ·
[License](https://github.com/aniruddhaadak80/consentreach-lint/blob/main/LICENSE) ·
[Issues](https://github.com/aniruddhaadak80/consentreach-lint/issues)

</div>

---

## The problem

You ship an AI feature. It starts touching people in ways nobody agreed to — a new purpose, a new
data class, or the same activity decided by a machine instead of a human. The consent you collected
does not automatically cover the change, and the part that actually breaks your week is that this
is not a set difference over activity names.

Consent to be **scored** is not consent to be **refused by a machine**. So an activity can lose its
cover with no activity added, no identifier changed, and no line in a conventional diff. A code
review cannot see it.

## What this does

You declare a **processing surface** — every activity the system performs, with its purpose,
cohort, data classes, automation level, decision effect, and legal basis — and a **consent ledger**
of what people actually agreed to, each grant recording the automation level and decision effect
they _accepted_.

You get back the minimal edit script between the old and new surface, every hunk classified by why
it matters ethically, and each activity left without cover with the reason.

## Quick start

```bash
git clone https://github.com/aniruddhaadak80/consentreach-lint.git
cd consentreach-lint
npm install
node packages/cli/dist/bin.js doctor
```

`doctor` probes the runtime, the skill catalog, the plugin registry, the **Python engine** (it makes
a real call), and the **committed dataset**. If it exits `0`, the install is good.

```console
$ node packages/cli/dist/bin.js doctor
consentreach-lint doctor
  [PASS] node     v22.23.2
  [PASS] package  consentreach-lint@0.1.0
  [PASS] skills   4 skills, 0 invalid
  [PASS] plugins  1 active, 0 disabled
  [WARN] config   no product.config.json — using defaults
         fix: run with defaults, or create product.config.json
  [PASS] engine   python engine answered validate_surface in 164ms (1 activities)
  [PASS] dataset  claims-triage: 8 activities, 6 grants, as of 2026-09-01
  [PASS] tools    9 registered, including the reach tools

all required checks passed
```

## Walkthrough

Every command below was run against this repository at commit time; the output is real.

### 1. Lint the change

```bash
node packages/cli/dist/bin.js lint
```

```console
consent reach at 2026-09-01

  coverage   ########................ 33%  (2/6 consent activities)
  orphans    4
  out of scope 2 (non-consent legal basis)

uncovered processing activities
  [100] fraud_score
         reason   grant-escalation
         blockers grant-escalation, data-class-not-covered
         scope    fraud_screen / policyholder / automated / advisory
  [ 80] estimate_severity
         reason   grant-expired
         blockers grant-expired
         scope    claims_triage / policyholder / human_approval / dispositive
  [ 60] auto_settle_small_claims
         reason   no-active-grant
         blockers no-active-grant
         scope    claims_triage / policyholder / automated / binding
  [ 60] infer_health_from_notes
         reason   no-active-grant
         blockers no-active-grant
         scope    claims_triage / policyholder / automated / advisory

edit script
  [100] change estimate_severity (decisionEffect)  effect-escalation
  [ 90] change fraud_score (automation, dataClasses)  automation-escalation
  [ 80] change g-1003 (validUntil)  reach-withdrawal
  [ 80] change g-1005 (status)  reach-withdrawal
  [ 80] change g-1006 (validUntil)  reach-withdrawal
  [ 60] add    auto_settle_small_claims  scope-creep
  [ 60] add    infer_health_from_notes  scope-creep
  [  0] remove manual_review_queue  benign
  [  0] add    vendor_analytics_share  benign

out of scope (no consent obligation): renewal_offer, vendor_analytics_share
```

Three things to read here.

`fraud_score` is reported as `grant-escalation` even though a grant matching its scope exists and is
active **forever**. That grant accepted `human_review`; the system now applies `automated`. The
activity also gained `biometric`, so it has two independent blockers and both are listed — burying
the escalation under a data-class complaint would hide the more serious fact.

`g-1003`, `g-1005` and `g-1006` appear in the edit script as `reach-withdrawal`. They are grants, not
activities: they were covering before this change and no longer are.

`renewal_offer` and `vendor_analytics_share` are **out of scope**, not orphans. They rest on
`legitimate_interest`, so no re-consent is owed. They are named rather than dropped, because a
report that quietly shrinks its own denominator is a report you cannot audit.

### 2. Plan the re-consent ask, and price the over-reach

```bash
node packages/cli/dist/bin.js plan
```

```console
re-consent plan for 4 uncovered activities

  narrow plan    4 grants, over-reach 0
                 proven minimal (bound 4 == size 4)
  broad plan     2 grants, over-reach 1
                 proven minimal (bound 2 == size 2)

  recommended    specific — 4 grants, over-reach 0

  over-reach is the number of already-consented processing activities a grant would
  authorise beyond the orphans it is required to cover.

  grants to issue
    activity:claims_triage:auto_settle_small_claims
      covers  auto_settle_small_claims
      sweep   0
    activity:claims_triage:estimate_severity
      covers  estimate_severity
      sweep   0
    activity:claims_triage:infer_health_from_notes
      covers  infer_health_from_notes
      sweep   0
    activity:fraud_screen:fraud_score
      covers  fraud_score
      sweep   0
```

This is the whole argument. The broad plan needs **two** asks instead of four — and silently
authorises one already-consented activity nobody asked about. The product recommends four asks with
zero over-reach, because over-reach is a harm to a third party while an extra ask is only a cost
to the team.

### 3. Notice that minimality is a certificate, not a claim

Set cover is NP-hard, so the planner never asserts an optimum. It computes an achievable solution
and an admissible lower bound by disjoint greedy packing, and reports `provenMinimal` only when the
two agree. When they do not, it prints `NOT proven (bound N, size M)`.

That claim is falsifiable, so it is tested. `test_cover.py` enumerates every subset of candidates on
small instances and asserts the planner equals the true minimum:

```bash
python -m pytest services/engine -q
```

```console
89 passed in 9.88s
```

### 4. Work the queue, and record ownership

```bash
node packages/cli/dist/bin.js decide fraud_score --owner "dana@privacy"
node packages/cli/dist/bin.js queue
```

```console
recorded claims-triage:fraud_score -> dana@privacy (acknowledged)

claims-triage review queue at 2026-09-01

  2/6 covered, 4 open
  recommended plan specific: 4 grants, over-reach 0

  [100] fraud_score               grant-escalation
        owner  dana@privacy (acknowledged)
        clears activity:fraud_screen:fraud_score
  [ 80] estimate_severity         grant-expired
        owner  unassigned
        clears activity:claims_triage:estimate_severity
  [ 60] auto_settle_small_claims  no-active-grant
        owner  unassigned
        clears activity:claims_triage:auto_settle_small_claims
  [ 60] infer_health_from_notes   no-active-grant
        owner  unassigned
        clears activity:claims_triage:infer_health_from_notes
```

Ownership is the only thing this tool writes, and it writes to local SQLite — never to the
repository. The declarations are policy and live in git; who picked up an obligation is ephemeral
workflow state.

### 5. Use it as a merge gate

`lint` and `validate` exit `2` when something is open, so this works as a required check:

```bash
node packages/cli/dist/bin.js lint; echo "exit: $?"
```

```console
exit: 2
```

### 6. Run the engine directly

It is a pure function over stdin/stdout — no server, no port, no daemon:

```console
$ cd services/engine/src
$ echo '{"op":"validate_surface","input":{"surface":{"system":"x","epoch":"2026-09-01","activities":[]},"ledger":{"grants":[]}}}' | python -m consentreach_lint
{"ok":true,"value":{"violations":[],"counts":{"high":0,"medium":0,"info":0},"clean":true,"checkedActivities":0,"checkedGrants":0},"durationMs":11}
```

Same input, same bytes, every time. `asOf` is an argument rather than a clock read, which is what
makes a lint run replayable.

### 7. Let another agent ask the question

Every capability is a `Tool` in one registry, so a CLI command is an MCP tool the same day it is
written. The list is _derived_ from the registry, not maintained beside it:

```bash
node packages/cli/dist/bin.js tools
```

```console
  reach_lint        [core]  Compare a system's declared processing surface before and after a change, against its consent ledger...
  reach_plan        [core]  Plan the re-consent ask for everything reach_lint reports as uncovered...
  reach_queue       [core]  The review queue: every uncovered activity as an owned obligation...
  reach_validate    [core]  Static rules on the declaration itself, needing no before-state...
  list_plugins      [core]  List the resolved plugin registry...
  list_skills       [core]  List the skill catalog with each skill name, version and description...
  engine_diff       [core]  Compute a minimal structural diff between two record sets...
  engine_normalize  [core]  Flatten records into a stable, sorted, comparable shape...
  engine_summarize  [core]  Aggregate a set of records by kind...
```

Point any MCP client at it:

```json
{
  "mcpServers": {
    "consentreach-lint": {
      "command": "node",
      "args": ["packages/cli/dist/bin.js", "mcp", "serve"]
    }
  }
}
```

And prove it actually speaks the protocol, from outside, over a real pipe:

```bash
npm run verify:mcp
```

```console
  ok    initialize -> consentreach-lint v0.1.0 (protocol 2024-11-05)
  ok    tools/list -> 9 tools: engine_diff, engine_normalize, engine_summarize, list_plugins, list_skills, reach_lint, reach_plan, reach_queue, reach_validate
  ok    tools/call reach_lint -> asOf 2026-09-01, 9 hunks, 4 uncovered of 6 (top hunk estimate_severity effect-escalation)
  ok    tools/call reach_plan -> specific plan, 4 grants, over-reach 0 vs 1, provenMinimal true
  ok    unknown tool is rejected with a typed error

MCP VERIFICATION PASSED — the server speaks the protocol over real stdio.
```

### 8. Run the web app

```bash
npm run build --workspace @consentreachlint/web
npm run start --workspace @consentreachlint/web
```

The deployed app is at
<https://web-c0st32kns-aniruddha-adaks-projects.vercel.app>.

```console
$ curl -s https://web-c0st32kns-aniruddha-adaks-projects.vercel.app/api/health
{"ok":true,"name":"consentreach-lint","version":"0.1.0","commit":"2e242f8e10c7cddace503f2a401f1984835bf1bb","runtime":"24.21.0","region":"bom1","uptimeSeconds":3,"checks":[...]}
```

The `reach` check in that body is the important one: it is the deployed app recomputing the
algebra over the committed declarations, so a green health response is a statement about the
product and not only about the runtime.

### 9. Run the whole gate

```bash
npm run check
```

This is the exact command CI runs, in the same order, so a green local run means a green CI run. It
covers format, lint, typecheck, seven policy gates, the TypeScript tests, the Python tests, and the
build. `npm run check` exits `0` on this tree.

## How it works

```
                    ┌───────────────┐
    CLI ───────────▶│               │
    Web ───────────▶│  ToolRegistry │────▶ services/engine  (pure Python, stdin/stdout)
    MCP server ────▶│               │────▶ packages/memory  (SQLite, workflow state only)
    SDK ───────────▶└───────────────┘
```

The CLI, the web app, the MCP server and the SDK are transports. None of them contains product
logic. The parts that must be exactly right live in a dependency-free Python package that runs as a
pure function.

### The reach algebra

Cover is a conjunction over four axes — cohort, purpose, activities, data classes — so widening any
one of them is a new grant rather than an extension of an old one. On top of that, a grant records
the automation level and decision effect a person _accepted_, and cover requires it to be at least
what the system now _applies_. Four rules, in order:

1. a non-`consent` legal basis means no re-consent is owed — reported as out of scope, never dropped;
2. no active grant matches all four axes → `no-active-grant`;
3. grants match the axes but not the data → `data-class-not-covered`;
4. grants match the axes and the data but not the level → `grant-escalation`.

Every failing dimension is reported, and the queue is ordered by the most severe. Specified in
[`docs/adr/0004-reach-algebra.md`](docs/adr/0004-reach-algebra.md).

### Two implementations, one rule

The Python engine is authoritative. The web app cannot call it — ADR 0003 keeps `apps/web` free of
workspace dependencies so a monorepo build order cannot break a deployment — so `apps/web/lib/reach.ts`
mirrors it. That mirror is pinned to output the real engine produced:

```bash
npm run parity-fixture
node --test apps/web/tests/parity.test.mjs
```

```console
# tests 7
# pass 7
# fail 0
```

The exact-cover solver is deliberately **not** reimplemented in TypeScript. Its output is committed
as an artifact and `npm run check:plan-artifact` fails the build if it ever stops matching the
engine.

## Repository map

| Path                     | What lives there                                                     |
| ------------------------ | -------------------------------------------------------------------- |
| `services/engine`        | the reach algebra, the cover solver, and their tests                 |
| `packages/core`          | the `Tool` interface and the one registry                            |
| `packages/cli`           | `lint`, `plan`, `queue`, `validate`, `decide`, `doctor`, `mcp serve` |
| `packages/engine-client` | the typed bridge to the engine, and the committed-dataset loader     |
| `packages/mcp`           | MCP server and client, both derived from the registry                |
| `packages/memory`        | SQLite for workflow state only                                       |
| `apps/web`               | the review queue, the re-consent plan, the declarations              |
| `apps/web/data`          | the committed processing surfaces and consent ledgers                |
| `skills`                 | markdown skills, validated on load and version-gated                 |
| `docs/adr`               | why it is built this way                                             |

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture contract](docs/architecture.md) — the five decisions everything else follows from
- [Product contract](docs/product-contract.md)
- [CLI reference](docs/cli.md)
- [MCP](docs/mcp.md)
- [Adr 0004 — the reach algebra](docs/adr/0004-reach-algebra.md)

## Contributing

Read [`AGENTS.md`](AGENTS.md) first — it is a router, not a manual. Run `npm run check` before you
claim anything works.

## Licence

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
