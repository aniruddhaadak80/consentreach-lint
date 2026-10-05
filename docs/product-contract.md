# Product Contract

**ConsentReach Lint** is a linter for the consent debt of an AI system.

## What it is

You declare what your system _does to people_ — a **processing surface**: a list of activities,
each naming a purpose, a subject cohort, the data classes it touches, an automation level, a
decision effect, and a legal basis. You declare a **consent ledger**: the grants people actually
agreed to, each scoped to a purpose, a cohort, a set of activities, a set of data classes, and a
validity window.

When the system changes, the linter returns the minimal edit script between the old and new
surface, every hunk classified by _why it matters ethically_, and a proof of exactly which people
the change leaves without cover.

## Who has this problem

Teams shipping AI features into production who hold a consent ledger nobody can reason about.
Today the work is manual: a privacy lawyer reading a PR diff against a spreadsheet, or a DPO
re-reading every policy document after each model swap. Both are `O(reviewer)` in the size of the
surface, and neither produces an artifact that can be re-checked by anyone else.

## The one thing a chatbot cannot do

It cannot **prove minimality**.

Given the set of orphaned tuples, the engine returns the minimum number of narrowly-scoped
re-consent grants that cover all of them, together with an admissible lower bound. When the two
agree it states `proven_minimal: true`. When they disagree it reports the bound gap honestly and
sets `proven_minimal: false` — it never rounds an upper bound up to an optimum.

## The deterministic engine

Three pure Python functions over typed dictionaries, with no clock, no network, no randomness:

| Operation          | What it proves                                                                      |
| ------------------ | ----------------------------------------------------------------------------------- |
| `reach_diff`       | the minimal edit script between two surfaces, and which tuples lost their cover     |
| `plan_cover`       | the minimum set of narrowly-scoped grants covering every orphan, with a certificate |
| `validate_surface` | which declarations are internally inconsistent before any change is even made       |

This must be code, not generation. A consent obligation is a legal fact about a set of tuples,
and "the fewest grants that still do not over-reach" is a set cover with an exact optimality
certificate. A model cannot emit a certificate; it can only emit prose shaped like one — which is
the precise failure mode this product exists to replace.

## Signature surfaces that ship

- **CLI** — the load-bearing surface. Linting belongs in CI, before a merge, not in a dashboard
  someone remembers to open.
- **Web** — the review queue, for the human who owns the obligations.
- **MCP server** — so another agent can ask "is this change covered?" without a human in the loop.
- **MCP client** — proves the server from the outside, over real stdio.
- **Skills catalog** — `SKILL.md` files loaded from disk with frontmatter validation.
- **Plugin registry** — manifests validated against a schema, with conflicts reported.
- **Memory** — SQLite for review-queue state: assignment, decision, timestamps.

## Deliberate omissions

An omission is a design decision, and these are the decisions:

- **Desktop.** The draw is `cli-first`, and the real workflow is a CI check plus a PR review. A
  packaging shell cannot improve either one; it only adds a second distribution to keep signed.
- **Channels.** Consent obligations are a _queue with an owner and a deadline_, not a
  conversation. A chat surface would invite exactly the "it looks approved" ambiguity the product
  exists to remove.
- **Model providers.** A product whose credibility rests on deterministic proofs must not contain
  a fallback path that guesses. There is no "ask a model" tier here, at any confidence.

## The visual signature

Every queue card is stamped with a **sweep count**: how many already-consented processing tuples
one new grant would drag into scope beyond the orphans it is actually required to cover.

That single number is the product's whole argument. A narrow grant that re-consents seven people
reads `+0`. A broad grant that re-consents the same seven reads `+47` — it silently widens
permission for forty other processing tuples nobody asked about. A screenshot shows lime-on-stone
cards, each carrying an over-reach cost, sorted by it.

## The novelty claim

Domain `ai` (AI ethics), archetype `linter`, interaction `queue-first`, storage `git-backed`,
engine `diff-engine`, surface `cli-first`. No ledger entry shares more than one of these
coordinates with this build, and the closest one — `flame-diff`, also a differ — uses a
tokenizer engine to prove a lossless round trip on trace renders. This build uses a diff engine to
prove a _minimum-cover_ result about legal obligations. A reviewer shown only this README could
not mistake it for a previous build.
