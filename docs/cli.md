# CLI reference

Every command below was run against this repository. Exit codes are part of the contract:
**0** ok, **1** runtime failure, **2** open obligation or usage error.

## `doctor`

```bash
node packages/cli/dist/bin.js doctor
node packages/cli/dist/bin.js doctor --json
```

Probes the runtime, the skill catalog, the plugin registry, the config, the Python engine (with a
real call, not a file check), the committed dataset, and the tool registry. Every failing row
carries a fix hint.

It also distinguishes a _broken_ product tree from a directory that is not one: inside a tree that
has `apps/web/data` or `services/engine`, a missing engine or dataset is a **failure**; outside
one it is a warning. `doctor` should be able to describe a directory that has nothing to do with
this product.

## `lint`

```bash
node packages/cli/dist/bin.js lint
node packages/cli/dist/bin.js lint --json
node packages/cli/dist/bin.js lint --as-of 2026-04-01
node packages/cli/dist/bin.js lint --dataset claims-triage
```

The merge gate. Prints coverage, every uncovered activity with its reason and all its blockers,
the classified edit script, and the activities that are out of scope.

**Exits `2`** when any obligation is uncovered, so it can be a required status check.

`--as-of` is an argument, never a clock read. The same commit and the same date give the same
report, which is what makes it replayable. Moving the date to make a report pass is not a fix.

## `plan`

```bash
node packages/cli/dist/bin.js plan
node packages/cli/dist/bin.js plan --json
```

Prints the narrow and broad re-consent plans side by side, each with its admissible lower bound and
its `proven` or `NOT proven` status, plus the recommended plan and its over-reach cost.

**Over-reach** is the number of already-consented processing activities a grant would authorise
beyond the orphans it is required to cover. A broad plan can win on ask count and still be the wrong
answer; that comparison is the point of the command.

## `queue`

```bash
node packages/cli/dist/bin.js queue
```

The review queue: every uncovered activity as an obligation, joined with its owner, its status,
and the grant that clears it. Exits `0` even with open obligations — it is a view, not a gate.

## `validate`

```bash
node packages/cli/dist/bin.js validate
```

Static rules on the declaration itself: machine-decided binding effects, sensitive data on a
non-consent basis, wildcard grants that authorise more than they name, and grants about to lapse.

**Exits `2`** when there is at least one `high` finding.

## `decide`

```bash
node packages/cli/dist/bin.js decide fraud_score --owner "dana@privacy"
node packages/cli/dist/bin.js decide fraud_score --owner dana --status reconsented
```

The only command that writes. It records ownership in local SQLite at `.data/obligations.sqlite`.

Ownership is deliberately **not** committed: the declarations are policy and belong in git, while
who picked up an obligation is ephemeral workflow state that a pull request should not carry.

`--owner` is required.

## `tools`

```bash
node packages/cli/dist/bin.js tools
node packages/cli/dist/bin.js tools --json
```

The authoritative capability list, with each tool's declared permissions and source surface. This
is the same list `tools/list` returns over MCP, because MCP descriptors are derived from this
registry rather than maintained beside it.

## `mcp serve` and `mcp call`

```bash
node packages/cli/dist/bin.js mcp serve
node packages/cli/dist/bin.js mcp call reach_lint '{}'
node packages/cli/dist/bin.js mcp call reach_plan '{"asOf":"2026-09-01"}'
```

`mcp serve` runs the protocol over stdio; stdout belongs to the protocol from that point on.
`mcp call` invokes one tool directly, which is the fastest way to see the engine's raw output.

## `version`

```bash
node packages/cli/dist/bin.js version
```

Name, version, Node version, platform, and the registered tool count, as JSON.

## Exit codes

| Code | Meaning                                                        |
| ---- | -------------------------------------------------------------- |
| `0`  | ok                                                             |
| `1`  | runtime failure — the engine did not answer, a file is missing |
| `2`  | an open obligation (`lint`, `validate`) or a usage error       |

## Installing the binary

The commands above use `node packages/cli/dist/bin.js` because this repository is consumed from a
clone. To get the shorter form used throughout this documentation:

```bash
npm link
consentreach-lint lint
```

`npm link` requires `npm run build` first, since the entry point is `dist/bin.js`.
