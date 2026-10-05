import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { buildToolRegistry, createContext } from './bootstrap.js'

/**
 * The product verbs. Each one is a thin renderer over a registered tool — no logic lives here,
 * so `consentreach-lint lint` and an MCP `tools/call` can never disagree.
 */

const PERMISSIONS = ['fs:read', 'net:fetch', 'proc:spawn'] as const

const OBIGATIONS_DB = join('.data', 'obligations.sqlite')

async function invoke(tool: string, input: unknown): Promise<unknown> {
  const registry = buildToolRegistry()
  return await registry.invoke(tool, input, createContext('cli'), [...PERMISSIONS])
}

const bar = (ratio: number, width = 24): string => {
  const filled = Math.round(ratio * width)
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`
}

interface LintResult {
  readonly asOf: string
  readonly hunks: readonly {
    readonly op: string
    readonly id: string
    readonly klass: string
    readonly severity: number
    readonly fields: readonly string[]
  }[]
  readonly uncovered: readonly {
    readonly activityId: string
    readonly reason: string
    readonly reasonSeverity: number
    readonly blockers: readonly string[]
    readonly subjectClass: string
    readonly purpose: string
    readonly automation: string
    readonly decisionEffect: string
  }[]
  readonly outOfScope: readonly string[]
  readonly coverage: {
    readonly consentActivities: number
    readonly covered: number
    readonly uncovered: number
    readonly coverageRatio: number
  }
}

function renderLint(result: LintResult): string {
  const { coverage } = result
  const lines: string[] = [
    `consent reach at ${result.asOf}`,
    '',
    `  coverage   ${bar(coverage.coverageRatio)} ${(coverage.coverageRatio * 100).toFixed(0)}%  (${coverage.covered}/${coverage.consentActivities} consent activities)`,
    `  orphans    ${coverage.uncovered}`,
    `  out of scope ${result.outOfScope.length} (non-consent legal basis)`,
    '',
    'uncovered processing activities',
  ]

  if (result.uncovered.length === 0) {
    lines.push('  none — every consent activity is covered')
  }
  for (const item of result.uncovered) {
    lines.push(
      `  [${String(item.reasonSeverity).padStart(3)}] ${item.activityId}`,
      `         reason   ${item.reason}`,
      `         blockers ${item.blockers.join(', ')}`,
      `         scope    ${item.purpose} / ${item.subjectClass} / ${item.automation} / ${item.decisionEffect}`,
    )
  }

  lines.push('', 'edit script')
  for (const hunk of result.hunks) {
    const fields = hunk.fields.length > 0 ? ` (${hunk.fields.join(', ')})` : ''
    lines.push(
      `  [${String(hunk.severity).padStart(3)}] ${hunk.op.padEnd(6)} ${hunk.id}${fields}  ${hunk.klass}`,
    )
  }
  if (result.outOfScope.length > 0) {
    lines.push('', `out of scope (no consent obligation): ${result.outOfScope.join(', ')}`)
  }
  return lines.join('\n')
}

interface PlanResult {
  readonly orphanCount: number
  readonly specific: { count: number; lowerBound: number; provenMinimal: boolean; grants: readonly string[] }
  readonly broad: { count: number; lowerBound: number; provenMinimal: boolean; grants: readonly string[] }
  readonly overReachCost: { specific: number; broad: number }
  readonly recommended: {
    plan: string
    count: number
    sweep: number
    provenMinimal: boolean
    sweepDetail: readonly { grant: string; sweep: number; covers: readonly string[] }[]
  }
}

function renderPlan(result: PlanResult): string {
  const claim = (proven: boolean, bound: number, size: number): string =>
    proven ? `proven minimal (bound ${bound} == size ${size})` : `NOT proven (bound ${bound}, size ${size})`

  const lines: string[] = [
    `re-consent plan for ${result.orphanCount} uncovered activities`,
    '',
    `  narrow plan    ${result.specific.count} grants, over-reach ${result.overReachCost.specific}`,
    `                 ${claim(result.specific.provenMinimal, result.specific.lowerBound, result.specific.count)}`,
    `  broad plan     ${result.broad.count} grants, over-reach ${result.overReachCost.broad}`,
    `                 ${claim(result.broad.provenMinimal, result.broad.lowerBound, result.broad.count)}`,
    '',
    `  recommended    ${result.recommended.plan} — ${result.recommended.count} grants, ` +
      `over-reach ${result.recommended.sweep}`,
    '',
    '  over-reach is the number of already-consented processing activities a grant would',
    '  authorise beyond the orphans it is required to cover.',
    '',
    '  grants to issue',
  ]
  for (const detail of result.recommended.sweepDetail) {
    lines.push(
      `    ${detail.grant}`,
      `      covers  ${detail.covers.join(', ')}`,
      `      sweep   ${detail.sweep}`,
    )
  }
  return lines.join('\n')
}

interface QueueResult {
  readonly dataset: string
  readonly asOf: string
  readonly summary: { consentActivities: number; covered: number; uncovered: number }
  readonly plan: {
    recommended: string
    grants: number
    sweep: number
    specific: { count: number; provenMinimal: boolean }
    broad: { count: number; provenMinimal: boolean }
    overReachCost: { specific: number; broad: number }
  }
  readonly queue: readonly {
    id: string
    activityId: string
    reason: string
    blockers: readonly string[]
    severity: number
    owner: string | null
    status: string
    decidedAt: number | null
    clearsVia: string | null
  }[]
}

function renderQueue(result: QueueResult): string {
  const width = Math.max(...result.queue.map((row) => row.activityId.length), 4)
  const lines: string[] = [
    `${result.dataset} review queue at ${result.asOf}`,
    '',
    `  ${result.summary.covered}/${result.summary.consentActivities} covered, ${result.summary.uncovered} open`,
    `  recommended plan ${result.plan.recommended}: ${result.plan.grants} grants, over-reach ${result.plan.sweep}`,
    '',
  ]
  if (result.queue.length === 0) {
    lines.push('  nothing to review')
    return lines.join('\n')
  }
  for (const row of result.queue) {
    const owner = row.owner ?? 'unassigned'
    lines.push(
      `  [${String(row.severity).padStart(3)}] ${row.activityId.padEnd(width)}  ${row.reason}`,
      `        owner  ${owner}${row.status === 'open' ? '' : ` (${row.status})`}`,
      `        clears ${row.clearsVia ?? '—'}`,
    )
  }
  lines.push(
    '',
    `  assign one with: consentreach-lint decide ${result.queue[0]?.activityId ?? '<activity>'} --owner <name>`,
  )
  return lines.join('\n')
}

interface ValidateResult {
  readonly violations: readonly {
    readonly rule: string
    readonly severity: string
    readonly subject: string
    readonly detail: string
  }[]
  readonly counts: { high: number; medium: number; info: number }
}

function renderValidate(result: ValidateResult): string {
  const lines: string[] = [
    'declaration checks',
    '',
    `  high ${result.counts.high}   medium ${result.counts.medium}   info ${result.counts.info}`,
    '',
  ]
  if (result.violations.length === 0) {
    lines.push('  clean')
  }
  for (const item of result.violations) {
    lines.push(`  [${item.severity.padEnd(6)}] ${item.subject}  ${item.rule}`, `           ${item.detail}`)
  }
  return lines.join('\n')
}

/**
 * Records an ownership decision. This is the only command that writes, and it writes to local
 * SQLite rather than to the repository: the declarations are policy and live in git, while who
 * picked up an obligation is ephemeral workflow state.
 */
async function decide(activityId: string, owner: string, dataset: string, status: string): Promise<void> {
  const { Store } = await import('@consentreachlint/memory')
  mkdirSync('.data', { recursive: true })
  const path = existsSync(OBIGATIONS_DB) ? OBIGATIONS_DB : join('.data', 'obligations.sqlite')
  const store = new Store(path)
  try {
    const id = `${dataset}:${activityId}`
    const existing = store.get(id)
    const payload = {
      owner,
      status,
      decidedAt: Date.now(),
      note: existing ? (JSON.parse(existing.payload).note ?? '') : '',
    }
    store.put({ id, kind: 'obligation', payload, now: Date.now() })
    process.stdout.write(`recorded ${id} -> ${owner} (${status})\n`)
  } finally {
    store.close()
  }
}

export function registerProductCommands(program: Command): void {
  const datasetOption = (command: Command): Command =>
    command
      .option('-d, --dataset <name>', 'dataset name under apps/web/data')
      .option('--as-of <date>', 'ISO date to reason about (default: the after-surface epoch)')
      .option('--json', 'machine-readable output')

  datasetOption(
    program
      .command('lint')
      .description('report every processing activity left without consent cover')
      .action(async (options: { dataset?: string; asOf?: string; json?: boolean }) => {
        const input = { dataset: options.dataset, asOf: options.asOf }
        const result = (await invoke('reach_lint', input)) as LintResult
        process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : renderLint(result)}\n`)
        // A merge gate needs a non-zero exit when obligations are open.
        if (result.coverage.uncovered > 0) process.exitCode = 2
      }),
  )

  datasetOption(
    program
      .command('plan')
      .description('plan the re-consent ask and price its over-reach')
      .action(async (options: { dataset?: string; asOf?: string; json?: boolean }) => {
        const result = (await invoke('reach_plan', {
          dataset: options.dataset,
          asOf: options.asOf,
        })) as PlanResult
        process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : renderPlan(result)}\n`)
      }),
  )

  datasetOption(
    program
      .command('queue')
      .description('the review queue: open obligations with owners and the grant that clears each')
      .action(async (options: { dataset?: string; asOf?: string; json?: boolean }) => {
        const result = (await invoke('reach_queue', {
          dataset: options.dataset,
          asOf: options.asOf,
        })) as QueueResult
        process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : renderQueue(result)}\n`)
      }),
  )

  datasetOption(
    program
      .command('validate')
      .description('static checks on the declaration itself')
      .action(async (options: { dataset?: string; json?: boolean }) => {
        const result = (await invoke('reach_validate', { dataset: options.dataset })) as ValidateResult
        process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : renderValidate(result)}\n`)
        if (result.counts.high > 0) process.exitCode = 2
      }),
  )

  program
    .command('decide')
    .description('assign an obligation to an owner (records a decision in local SQLite)')
    .argument('<activity>', 'activity id')
    .option('-o, --owner <name>', 'owner')
    .option('-d, --dataset <name>', 'dataset name')
    .option('--status <status>', 'open | acknowledged | reconsented | waived', 'acknowledged')
    .action(async (activity: string, options: { owner?: string; dataset?: string; status?: string }) => {
      if (!options.owner) {
        process.stderr.write('error: --owner is required\n')
        process.exitCode = 2
        return
      }
      await decide(
        activity,
        options.owner,
        options.dataset ?? 'claims-triage',
        options.status ?? 'acknowledged',
      )
    })
}
