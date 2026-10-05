/**
 * The committed datasets, imported statically so their values are inlined at build time.
 *
 * Only the Next.js pages import this module. `lib/reach.ts` deliberately has no imports, so the
 * parity test can load the algebra directly under Node's test runner with no bundler and no
 * path-mapping trick.
 *
 * These files are the `git-backed` storage decision made concrete. A change to what a system
 * does to people is a policy change, so it is reviewed in a pull request like code — diffed,
 * approved, reverted.
 */

import claimsBefore from '../data/claims-triage.before.json'
import claimsAfter from '../data/claims-triage.after.json'
import claimsLedger from '../data/claims-triage.ledger.json'
import claimsLedgerBefore from '../data/claims-triage.ledger-before.json'
import type { ConsentLedger, ProcessingSurface } from './reach.js'

export interface Dataset {
  readonly name: string
  readonly before: ProcessingSurface
  readonly after: ProcessingSurface
  readonly ledger: ConsentLedger
  readonly ledgerBefore: ConsentLedger
  readonly asOf: string
}

export const DEFAULT_DATASET = 'claims-triage'

export const DATASETS: Readonly<Record<string, Dataset>> = Object.freeze({
  'claims-triage': {
    name: 'claims-triage',
    before: claimsBefore as ProcessingSurface,
    after: claimsAfter as ProcessingSurface,
    ledger: claimsLedger as ConsentLedger,
    ledgerBefore: claimsLedgerBefore as ConsentLedger,
    asOf: (claimsAfter as ProcessingSurface).epoch,
  },
})

export function loadDataset(name = DEFAULT_DATASET): Dataset {
  const dataset = DATASETS[name]
  if (!dataset) {
    throw new Error(`unknown dataset "${name}"; available: ${Object.keys(DATASETS).join(', ')}`)
  }
  return dataset
}

export type { ConsentLedger, ProcessingSurface }
