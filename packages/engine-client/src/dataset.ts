/**
 * Loading the declared surfaces and consent ledgers from disk.
 *
 * This is the `git-backed` storage decision made concrete: the declarations are committed JSON
 * under `apps/web/data/`, reviewed in a pull request like code, because a change to what you
 * process is a policy change and deserves a diff and a revert.
 *
 * The dataset lives inside `apps/web/` rather than at the repository root because ADR 0003 keeps
 * the deployed app free of workspace dependencies and the Vercel project root is `apps/web`. A
 * single copy serves the CLI, the MCP tools, and the deployed site.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ConsentLedger, ProcessingSurface } from './domain.js'

export const DATASET_DIR = join('apps', 'web', 'data')

export interface Dataset {
  readonly name: string
  readonly before: ProcessingSurface
  readonly after: ProcessingSurface
  readonly ledger: ConsentLedger
  readonly ledgerBefore: ConsentLedger
  readonly asOf: string
}

function readJson<T>(path: string): T {
  const raw = readFileSync(path, 'utf8')
  try {
    return JSON.parse(raw) as T
  } catch (cause) {
    throw new Error(`${path} is not valid JSON: ${String(cause)}`)
  }
}

/** The dataset name used when the caller does not name one. */
export const DEFAULT_DATASET = 'claims-triage'

/**
 * Loads one dataset by name. The date checked against is the after-surface's own `epoch`, so a
 * report always states which date it reasoned about instead of reading the clock.
 */
export function loadDataset(cwd: string, name = DEFAULT_DATASET): Dataset {
  const dir = join(cwd, DATASET_DIR)
  const before = readJson<ProcessingSurface>(join(dir, `${name}.before.json`))
  const after = readJson<ProcessingSurface>(join(dir, `${name}.after.json`))
  const ledger = readJson<ConsentLedger>(join(dir, `${name}.ledger.json`))
  const ledgerBefore = readJson<ConsentLedger>(join(dir, `${name}.ledger-before.json`))
  return { name, before, after, ledger, ledgerBefore, asOf: after.epoch }
}
