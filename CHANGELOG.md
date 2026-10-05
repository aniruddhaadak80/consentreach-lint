# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The reach algebra (`reach.py`): cover as a four-axis conjunction, with escalation
  invalidating cover independently of coverage, and every failing dimension reported rather
  than only the most convenient one.
- The cover solver (`cover.py`): exact branch-and-bound over candidate grant widths with an
  admissible lower bound by disjoint greedy packing. `provenMinimal` is set only when the
  incumbent equals the bound.
- `validate_surface`: static rules on a declaration, needing no before-state.
- Four product tools — `reach_lint`, `reach_plan`, `reach_queue`, `reach_validate` — registered
  in the one registry and therefore exposed over MCP automatically.
- CLI verbs `lint`, `plan`, `queue`, `validate` and `decide`. `lint` and `validate` exit `2` on
  an open obligation so they work as a merge gate.
- `doctor` now probes the Python engine with a real call and loads the committed dataset, and
  distinguishes a broken product tree from a directory that is not one.
- The `claims-triage` dataset: two surfaces, two ledgers, four obligations, and a plan whose
  narrow and broad answers differ.
- A TypeScript mirror of the reach algebra for the web app, pinned to real engine output by
  `apps/web/tests/parity.test.mjs`.
- The web app: the review queue with an over-reach stamp per obligation, the re-consent plan with
  its minimality certificates, and the declarations themselves.
- `check:plan-artifact`, which fails the build when the committed plan stops matching the engine.
- `verify:mcp`, which spawns the MCP server and drives `initialize`, `tools/list` and
  `tools/call` from the outside over real stdio.
- Two skills: `triage-consent-gap` and `declare-processing-surface`.

### Fixed

- `ledger.jsonl` in the novelty ledger shipped with two records concatenated on one line, so a
  line-based reader silently dropped both. Repaired to eight parseable entries.
- The novelty engine read used coordinates only from top-level fields while later entries nested
  them under `noveltyVector`, so visual-axis exclusion was empty. Now reads both.
- `_require_date` rejected the `forever` sentinel its own contract documented.
- Orphan reasons were single-valued, so an activity failing two axes reported only the less
  serious one. Reasons are now a severity-ordered list with the head used for triage.


## [0.1.0] - 2026-01-01

### Added

- The narrow waist: one `Tool` interface and one `ToolRegistry`, reachable from the CLI,
  the web app, the MCP server, and every channel.
- `consentreach-lint doctor` — subsystem probes with a fix hint per failing row.
- The deterministic Python engine, called as a pure function over stdin/stdout.
- The skills catalog with frontmatter validation and a CI version gate.
- The plugin registry with schema validation and priority-based conflict resolution.
- SQLite storage with WAL, numbered migrations, and FTS5 search.
- An MCP server exposing the registry over stdio, plus an MCP client.
- The web workspace, deployed to Vercel, with a real `/api/health` endpoint.

[Unreleased]: https://github.com/aniruddhaadak80/consentreach-lint/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aniruddhaadak80/consentreach-lint/releases/tag/v0.1.0
