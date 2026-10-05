#!/usr/bin/env node
/**
 * Regenerates the parity fixture by running the real Python engine.
 *
 *   python -m pytest services/engine -q          # the engine's own tests
 *   node scripts/gen-parity-fixture.mjs          # refresh this fixture
 *   npm run test --workspace @consentreachlint/web  # assert the mirror matches
 *
 * Run this whenever a reach rule changes. If you change a rule in the mirror and not the engine,
 * `apps/web/tests/parity.test.mjs` fails, which is the point.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'apps', 'web', 'tests', 'fixtures', 'parity.json')

const read = (relative) =>
  JSON.parse(
    execFileSync(
      'node',
      [
        '-e',
        `process.stdout.write(require('fs').readFileSync(${JSON.stringify(join(ROOT, relative))},'utf8'))`,
      ],
      { encoding: 'utf8' },
    ),
  )

const dataset = read('apps/web/data/claims-triage.before.json')
const after = read('apps/web/data/claims-triage.after.json')
const ledger = read('apps/web/data/claims-triage.ledger.json')
const ledgerBefore = read('apps/web/data/claims-triage.ledger-before.json')

/** Built here rather than in Node so the engine, not this script, decides the answer. */
const driver = `
import json, sys
sys.path.insert(0, ${JSON.stringify(join(ROOT, 'services', 'engine', 'src'))})
from consentreach_lint.analysis import analyse

payload = json.loads(sys.stdin.read())
result = {"reach_diff": analyse("reach_diff", payload["reach"])}
lint = result["reach_diff"]
result["validate_surface"] = analyse("validate_surface", {"surface": {"system": "claims-triage", "epoch": payload["reach"]["asOf"], "activities": payload["reach"]["after"]}, "ledger": payload["reach"]["ledger"]})
result["plan_cover"] = analyse("plan_cover", {"uncovered": lint["uncovered"], "activities": payload["reach"]["after"]})
sys.stdout.write(json.dumps(result, sort_keys=True))
`

const request = JSON.stringify({
  reach: {
    before: dataset.activities,
    after: after.activities,
    ledger,
    ledgerBefore,
    asOf: after.epoch,
  },
})

const output = execFileSync('python', ['-c', driver], {
  input: request,
  encoding: 'utf8',
  cwd: ROOT,
})

const parsed = JSON.parse(output)
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8')

process.stdout.write(
  `wrote ${OUT}\n` +
    `  reach_diff       ${parsed.reach_diff.hunks.length} hunks, ${parsed.reach_diff.uncovered.length} uncovered\n` +
    `  plan_cover       specific ${parsed.plan_cover.specific.count} (proven ${parsed.plan_cover.specific.provenMinimal}), ` +
    `broad ${parsed.plan_cover.broad.count} (proven ${parsed.plan_cover.broad.provenMinimal})\n` +
    `  validate_surface ${parsed.validate_surface.violations.length} violations\n`,
)
