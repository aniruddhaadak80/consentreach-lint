/**
 * Pins the TypeScript mirror to the Python engine.
 *
 * `fixtures/parity.json` is produced by running the real engine — regenerate it with
 * `node scripts/gen-parity-fixture.mjs`. This test asserts the mirror in `lib/reach.ts` produces
 * the same object, field for field, including ordering and tie-breaks. Comparing only counts
 * would let two implementations drift on exactly the details a reviewer cannot audit by eye.
 *
 * The dataset is read here with `readFileSync` rather than imported, because `lib/reach.ts` is
 * deliberately import-free so this test can run under Node's test runner with no bundler.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { blockersFor, reachDiff, validateSurface } from '../lib/reach.ts'

const WEB = new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1')
const read = (name) => readFileSync(join(WEB, 'data', name), 'utf8')
const fixture = JSON.parse(readFileSync(join(WEB, 'tests', 'fixtures', 'parity.json'), 'utf8'))

const before = JSON.parse(read('claims-triage.before.json'))
const after = JSON.parse(read('claims-triage.after.json'))
const ledger = JSON.parse(read('claims-triage.ledger.json'))
const ledgerBefore = JSON.parse(read('claims-triage.ledger-before.json'))
const asOf = after.epoch

const expectedDiff = fixture.reach_diff
const expectedValidate = fixture.validate_surface

const lint = () =>
  reachDiff({ before: before.activities, after: after.activities, ledger, ledgerBefore, asOf })

test('reproduces the engine hunk list and its order exactly', () => {
  assert.deepEqual(lint().hunks, expectedDiff.hunks)
})

test('reproduces the coverage figures and stats exactly', () => {
  const actual = lint()
  assert.deepEqual(actual.coverage, expectedDiff.coverage)
  assert.deepEqual(actual.stats, expectedDiff.stats)
  assert.deepEqual(actual.outOfScope, expectedDiff.outOfScope)
})

test('reproduces every uncovered tuple, including reason and blockers', () => {
  assert.deepEqual(lint().uncovered, expectedDiff.uncovered)
})

test('reproduces the validation violations and their order', () => {
  const actual = validateSurface({ surface: { activities: after.activities }, ledger })
  assert.deepEqual(actual.violations, expectedValidate.violations)
  assert.deepEqual(actual.counts, expectedValidate.counts)
})

test('agrees with the engine on the reason for each orphan, readably', () => {
  // Restated as a small object so a behavioural change fails with a legible diff rather than a
  // wall of JSON.
  const actual = lint()
  assert.deepEqual(
    {
      asOf: actual.asOf,
      covered: actual.coverage.covered,
      uncovered: actual.coverage.uncovered,
      ratio: actual.coverage.coverageRatio,
      reasons: actual.uncovered.map((item) => `${item.activityId}:${item.reason}`),
    },
    {
      asOf: expectedDiff.asOf,
      covered: expectedDiff.coverage.covered,
      uncovered: expectedDiff.coverage.uncovered,
      ratio: expectedDiff.coverage.coverageRatio,
      reasons: expectedDiff.uncovered.map((item) => `${item.activityId}:${item.reason}`),
    },
  )
})

test('is independent of the order the input arrives in', () => {
  const shuffled = reachDiff({
    before: [...before.activities].reverse(),
    after: [...after.activities].reverse(),
    ledger: { grants: [...ledger.grants].reverse() },
    ledgerBefore: { grants: [...ledgerBefore.grants].reverse() },
    asOf,
  })
  assert.deepEqual(shuffled, lint())
})

test('refuses to compose half a permission out of two grants', () => {
  // g-data took these data classes at human review; g-level took the machine level but not the
  // data. Nobody accepted the two together, so the activity is not covered. Restated here because
  // the committed dataset contains no split pair, so the fixture alone cannot catch this.
  const activity = {
    id: 'a1',
    purpose: 'risk_scoring',
    subjectClass: 'applicant',
    automation: 'automated',
    decisionEffect: 'advisory',
    dataClasses: ['contact', 'health'],
    legalBasis: 'consent',
  }
  const half = (id, dataClasses, automation) => ({
    id,
    subjectClass: 'applicant',
    purposes: ['risk_scoring'],
    activities: ['a1'],
    dataClasses,
    legalBasis: 'consent',
    automation,
    decisionEffect: 'advisory',
    validFrom: '2026-01-01',
    validUntil: 'forever',
    status: 'active',
  })
  assert.deepEqual(
    blockersFor(
      activity,
      [half('g-data', ['contact', 'health'], 'human_review'), half('g-level', ['contact'], 'automated')],
      '2026-06-01',
    ),
    ['grant-escalation', 'data-class-not-covered'],
  )
  assert.deepEqual(
    blockersFor(
      activity,
      [
        half('g-data', ['contact', 'health'], 'human_review'),
        half('g-level', ['contact'], 'automated'),
        half('g-both', ['contact', 'health'], 'automated'),
      ],
      '2026-06-01',
    ),
    [],
  )
})

test('the fixture is the one the engine actually produced', () => {
  // Guards against a fixture that was hand-edited, which would make every other assertion here
  // a comparison against fiction.
  assert.equal(expectedDiff.asOf, '2026-09-01')
  assert.equal(expectedDiff.hunks.length, 9)
  assert.equal(expectedDiff.uncovered.length, 4)
  assert.equal(fixture.plan_cover.specific.provenMinimal, true)
  assert.equal(fixture.plan_cover.broad.provenMinimal, true)
  assert.deepEqual(fixture.plan_cover.overReachCost, { specific: 0, broad: 1 })
})
