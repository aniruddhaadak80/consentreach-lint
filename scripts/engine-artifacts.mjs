#!/usr/bin/env node
/**
 * Generates and verifies the committed engine artifacts.
 *
 * The cover solver is exact branch-and-bound and is NOT reimplemented in TypeScript — a second
 * copy of an NP-hard optimiser is a drift hazard with no upside. Instead the engine's plan
 * output is committed next to the declarations, exactly as the declarations themselves are, and
 * this script is the gate that keeps it honest.
 *
 *   node scripts/engine-artifacts.mjs            # write, and report what changed
 *   node scripts/engine-artifacts.mjs --check    # fail if the artifact is stale
 *
 * `--check` runs in CI and in `npm run check`, so a changed declaration cannot leave a stale plan
 * sitting in the repository advertising a minimality the engine would no longer produce.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECK_ONLY = process.argv.includes('--check')
const DATA = join(ROOT, 'apps', 'web', 'data')
const OUT = join(DATA, 'claims-triage.plan.json')

const read = (name) => JSON.parse(readFileSync(join(DATA, name), 'utf8'))

const before = read('claims-triage.before.json')
const after = read('claims-triage.after.json')
const ledger = read('claims-triage.ledger.json')
const ledgerBefore = read('claims-triage.ledger-before.json')

/** The engine decides the answer; this script only moves bytes. */
const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'services', 'engine', 'src'))})
from consentreach_lint.analysis import analyse

payload = json.loads(sys.stdin.read())
reach = payload["reach"]
lint = analyse("reach_diff", reach)
plan = analyse("plan_cover", {"uncovered": lint["uncovered"], "activities": reach["after"]})
validate = analyse(
    "validate_surface",
    {"surface": {"system": reach["afterSystem"], "epoch": reach["asOf"], "activities": reach["after"]},
     "ledger": reach["ledger"]},
)
sys.stdout.write(json.dumps({
    "asOf": lint["asOf"],
    "coverage": lint["coverage"],
    "uncovered": lint["uncovered"],
    "specific": plan["specific"],
    "broad": plan["broad"],
    "overReachCost": plan["overReachCost"],
    "recommended": plan["recommended"],
    "violations": validate["violations"],
    "violationCounts": validate["counts"],
}, indent=2, sort_keys=True))
`

const output = execFileSync('python', ['-c', driver], {
  input: JSON.stringify({
    reach: {
      before: before.activities,
      after: after.activities,
      ledger,
      ledgerBefore,
      asOf: after.epoch,
      afterSystem: after.system,
    },
  }),
  encoding: 'utf8',
  cwd: ROOT,
})

const generated = `${output.trim()}\n`

/**
 * Canonical form: object keys sorted recursively, so a comparison cannot be decided by key order
 * or by how a formatter happened to wrap a line. Formatting is irrelevant to the claim; content
 * is the whole of it.
 */
const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    )
  }
  return value
}

const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))

if (CHECK_ONLY) {
  let current = null
  try {
    current = JSON.parse(readFileSync(OUT, 'utf8'))
  } catch {
    process.stderr.write(
      'check:plan-artifact FAILED — apps/web/data/claims-triage.plan.json is missing or unreadable.\n' +
        '  fix: node scripts/engine-artifacts.mjs\n',
    )
    process.exitCode = 1
  }
  if (current && !same(current, JSON.parse(generated))) {
    process.stderr.write(
      'check:plan-artifact FAILED — the committed plan no longer matches the engine output.\n' +
        '  The declarations or the engine changed; the plan artifact is stale.\n' +
        '  fix: node scripts/engine-artifacts.mjs\n',
    )
    process.exitCode = 1
  } else if (current) {
    process.stdout.write('check:plan-artifact ok — the committed plan matches the engine\n')
  }
} else {
  writeFileSync(OUT, generated, 'utf8')
  const parsed = JSON.parse(generated)
  process.stdout.write(
    `wrote ${OUT}\n` +
      `  as of          ${parsed.asOf}\n` +
      `  uncovered      ${parsed.uncovered.length}\n` +
      `  narrow plan    ${parsed.specific.count} grants, proven ${parsed.specific.provenMinimal}\n` +
      `  broad plan     ${parsed.broad.count} grants, proven ${parsed.broad.provenMinimal}\n` +
      `  over-reach     specific ${parsed.overReachCost.specific}, broad ${parsed.overReachCost.broad}\n` +
      `  recommended    ${parsed.recommended.plan}\n`,
  )
}
