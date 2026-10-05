import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { DATASET_DIR, DEFAULT_DATASET, loadDataset } from '@consentreachlint/engine-client'
import { loadCatalog } from '@consentreachlint/skills'
import { buildRegistry as buildPluginRegistry } from '@consentreachlint/plugins'
import { buildToolRegistry } from './bootstrap.js'

export type Status = 'ok' | 'warn' | 'fail'

export interface Check {
  readonly name: string
  readonly status: Status
  readonly detail: string
  readonly fix?: string
}

export interface DoctorReport {
  readonly ok: boolean
  readonly checks: readonly Check[]
}

const pkg = { name: 'consentreach-lint', version: '0.1.0' }

/**
 * The flagship command. An agent that mutates its own configuration must be able to
 * diagnose itself, and every failing row carries a fix hint rather than only a status.
 */
export async function doctor(cwd = process.cwd()): Promise<DoctorReport> {
  const checks: Check[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0])
  checks.push(
    nodeMajor >= 22
      ? { name: 'node', status: 'ok', detail: `v${process.versions.node}` }
      : {
          name: 'node',
          status: 'fail',
          detail: `v${process.versions.node} is below the required v22.12.0`,
          fix: 'install Node 22.12 or newer (see .nvmrc)',
        },
  )

  checks.push({
    name: 'package',
    status: 'ok',
    detail: `${pkg.name}@${pkg.version}`,
  })

  const skills = loadCatalog(join(cwd, 'skills'))
  checks.push(
    skills.issues.length === 0
      ? { name: 'skills', status: 'ok', detail: `${skills.skills.length} skills, 0 invalid` }
      : {
          name: 'skills',
          status: 'fail',
          detail: `${skills.skills.length} valid, ${skills.issues.length} invalid`,
          fix: skills.issues[0] ?? 'see npm run check:skill-version',
        },
  )

  const plugins = buildPluginRegistry(join(cwd, 'plugins'))
  checks.push(
    plugins.rejected.length === 0
      ? {
          name: 'plugins',
          status: 'ok',
          detail: `${plugins.active.length} active, ${plugins.disabled.length} disabled`,
        }
      : {
          name: 'plugins',
          status: 'warn',
          detail: `${plugins.rejected.length} rejected`,
          fix: plugins.rejected[0]?.issues[0] ?? 'inspect plugins/*/plugin.json',
        },
  )

  const configPath = join(cwd, 'product.config.json')
  checks.push(
    existsSync(configPath)
      ? { name: 'config', status: 'ok', detail: 'product.config.json found' }
      : {
          name: 'config',
          status: 'warn',
          detail: 'no product.config.json — using defaults',
          fix: 'run with defaults, or create product.config.json',
        },
  )

  // The engine is the product's credibility, so its absence inside a real product tree is a
  // failure and not a warning. Outside one it is only a warning: `doctor` should still be able
  // to describe a directory that is not a ConsentReach tree at all.
  const inProductTree =
    existsSync(join(cwd, 'apps', 'web', 'data')) || existsSync(join(cwd, 'services', 'engine'))
  const strict = inProductTree ? 'fail' : 'warn'

  const engine = await probeEngine(cwd, strict)
  checks.push(engine)

  const dataset = probeDataset(cwd, strict)
  checks.push(dataset)

  const tools = buildToolRegistry(cwd).size
  checks.push(
    tools >= 9
      ? { name: 'tools', status: 'ok', detail: `${tools} registered, including the reach tools` }
      : {
          name: 'tools',
          status: strict,
          detail: `${tools} registered, expected at least 9`,
          fix: 'rebuild: npm run build',
        },
  )

  return { ok: checks.every((c) => c.status !== 'fail'), checks }
}

/** Runs one engine operation end to end, because a present file is not a working engine. */
async function probeEngine(cwd: string, severity: Status): Promise<Check> {
  try {
    const { EngineBridge } = await import('@consentreachlint/engine-client')
    const bridge = new EngineBridge({
      module: 'consentreach_lint',
      cwd: join(cwd, 'services', 'engine', 'src'),
      timeoutMs: 30_000,
    })
    const started = Date.now()
    const value = (await bridge.call({
      op: 'validate_surface',
      input: {
        surface: {
          system: 'probe',
          epoch: '2000-01-01',
          activities: [
            {
              id: 'probe',
              purpose: 'probe',
              subjectClass: 'probe',
              automation: 'none',
              decisionEffect: 'none',
              dataClasses: ['contact'],
              legalBasis: 'consent',
            },
          ],
        },
        ledger: { grants: [] },
      },
    })) as { checkedActivities?: number }
    return {
      name: 'engine',
      status: 'ok',
      detail: `python engine answered validate_surface in ${Date.now() - started}ms (${value?.checkedActivities ?? 0} activities)`,
    }
  } catch (cause) {
    return {
      name: 'engine',
      status: severity,
      detail: `python engine did not answer: ${cause instanceof Error ? cause.message : String(cause)}`,
      fix: 'install Python 3.11+ and run: pip install -e "services/engine"',
    }
  }
}

function probeDataset(cwd: string, severity: Status): Check {
  try {
    const data = loadDataset(cwd, DEFAULT_DATASET)
    return {
      name: 'dataset',
      status: 'ok',
      detail: `${DEFAULT_DATASET}: ${data.after.activities.length} activities, ${data.ledger.grants.length} grants, as of ${data.asOf}`,
    }
  } catch (cause) {
    return {
      name: 'dataset',
      status: severity,
      detail: `no loadable dataset under ${DATASET_DIR}: ${cause instanceof Error ? cause.message : String(cause)}`,
      fix: 'restore apps/web/data/*.json, or run npm run build',
    }
  }
}

export function renderReport(report: DoctorReport): string {
  const width = Math.max(...report.checks.map((c) => c.name.length), 5)
  const icon = (status: Status): string => (status === 'ok' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL')
  const lines = report.checks.map((c) => {
    const head = `  [${icon(c.status)}] ${c.name.padEnd(width)}  ${c.detail}`
    return c.fix === undefined ? head : `${head}\n         fix: ${c.fix}`
  })
  return [
    `${pkg.name} doctor`,
    ...lines,
    '',
    report.ok ? 'all required checks passed' : 'one or more checks failed',
  ].join('\n')
}
