import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ToolRegistry, ValidationError, type Tool, type ToolContext } from '@consentreachlint/core'
import { DATASET_DIR, DEFAULT_DATASET, loadDataset } from '@consentreachlint/engine-client'
import { buildRegistry } from '@consentreachlint/plugins'
import { loadCatalog } from '@consentreachlint/skills'

export const ENGINE_MODULE = 'consentreach_lint'

/**
 * Builds the one registry every surface shares.
 *
 * These five tools are real and working out of the box — they are what makes the MCP server
 * useful on a fresh install instead of exposing an empty tool list. They are also the
 * intended shape for your own tools: a name a model can type, an inputSchema it can fill,
 * declared permissions, and a handler that returns JSON-serialisable data.
 *
 * Every name matches ^[a-z][a-z0-9_]*$ so it is directly exposable over MCP.
 */
export function buildToolRegistry(cwd = process.cwd()): ToolRegistry {
  const registry = new ToolRegistry()

  registry.register(
    {
      name: 'list_skills',
      description:
        'List the skill catalog with each skill name, version and description. Use this to discover what the agent can do before guessing a command.',
      inputSchema: {
        type: 'object',
        properties: {
          includeBodies: { type: 'boolean', description: 'Include each skill body.' },
        },
        additionalProperties: false,
      },
      outputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number' },
          issues: { type: 'array', items: { type: 'string' } },
          skills: { type: 'array', items: { type: 'object' } },
        },
        required: ['count', 'issues', 'skills'],
      },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async (input: { includeBodies?: boolean }) => {
        const { skills, issues } = loadCatalog(join(cwd, 'skills'))
        return {
          count: skills.length,
          issues: [...issues],
          skills: skills.map((skill) => ({
            name: skill.name,
            version: skill.version,
            description: skill.description,
            ...(input.includeBodies === true ? { body: skill.body } : {}),
          })),
        }
      },
    } satisfies Tool<{ includeBodies?: boolean }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'list_plugins',
      description:
        'List the resolved plugin registry, including plugins that were shadowed, disabled or rejected and why. Use this to explain why an expected capability is missing.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      outputSchema: { type: 'object' },
      permissions: ['fs:read'],
      surface: 'core',
      handler: async () => {
        const result = buildRegistry(join(cwd, 'plugins'))
        return {
          active: result.active.map((p) => ({
            name: p.manifest.name,
            version: p.manifest.version,
            capabilities: p.manifest.capabilities,
            shadowed: p.shadowed,
          })),
          disabled: result.disabled.map((p) => p.manifest.name),
          rejected: result.rejected.map((p) => ({ path: p.path, issues: p.issues })),
        }
      },
    } satisfies Tool<Record<string, never>, unknown>,
    { source: 'core' },
  )

  const runEngine = async (op: string, input: unknown): Promise<unknown> => {
    const { EngineBridge } = await import('@consentreachlint/engine-client')
    const bridge = new EngineBridge({
      module: ENGINE_MODULE,
      cwd: join(cwd, 'services', 'engine', 'src'),
      // Generous on purpose: the engine is a real subprocess, and several tools call it twice.
      // A 10s default produced intermittent false failures on a cold Windows filesystem.
      timeoutMs: 30_000,
    })
    return await bridge.call({ op, input })
  }

  const engineSchema = (properties: Record<string, unknown>, required: string[]) =>
    ({
      type: 'object',
      properties: { records: { type: 'array', items: { type: 'object' } }, ...properties },
      required: ['records', ...required],
      additionalProperties: false,
    }) as const

  const validateRecords = (input: unknown): unknown[] => {
    const records = (input as { records?: unknown }).records
    if (!Array.isArray(records)) {
      throw new ValidationError('"records" must be an array', { field: 'records' })
    }
    return records
  }

  registry.register(
    {
      name: 'engine_summarize',
      description:
        'Aggregate a set of records by kind and report the total and the newest/oldest timestamps. Deterministic: same records always give the same answer.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('summarize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_diff',
      description:
        'Compute a minimal structural diff between two record sets, reporting added, removed, changed and unchanged identifiers. Use this instead of comparing JSON by eye.',
      inputSchema: {
        type: 'object',
        properties: {
          before: { type: 'array', items: { type: 'object' } },
          after: { type: 'array', items: { type: 'object' } },
        },
        required: ['before', 'after'],
        additionalProperties: false,
      },
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        if (!Array.isArray((input as { before?: unknown }).before)) {
          throw new ValidationError('"before" must be an array', { field: 'before' })
        }
        if (!Array.isArray((input as { after?: unknown }).after)) {
          throw new ValidationError('"after" must be an array', { field: 'after' })
        }
        return await runEngine('diff', input)
      },
    } satisfies Tool<{ before: unknown[]; after: unknown[] }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'engine_normalize',
      description:
        'Flatten records into a stable, sorted, comparable shape. Use this before diffing or storing so ordering never changes the result.',
      inputSchema: engineSchema({}, []),
      outputSchema: { type: 'object' },
      permissions: ['proc:spawn'],
      surface: 'core',
      handler: async (input) => {
        validateRecords(input)
        return await runEngine('normalize', input)
      },
    } satisfies Tool<{ records: unknown[] }, unknown>,
    { source: 'core' },
  )

  // ---------------------------------------------------------------- product tools
  //
  // The five tools above are the generic scaffold surface. These four are the product: they take
  // a declared processing surface and a consent ledger, and return a proof rather than a summary.
  // Each one is stateless, so all four are exposed over MCP with no extra work.

  const datasetArg = {
    dataset: {
      type: 'string',
      description: `Dataset name under ${DATASET_DIR}. Defaults to "${DEFAULT_DATASET}".`,
    },
    asOf: {
      type: 'string',
      description: 'ISO date to reason about. Defaults to the after-surface epoch.',
    },
  }

  const resolveDataset = (
    dataset?: string,
    asOf?: string,
  ): ReturnType<typeof loadDataset> & { asOf: string } => {
    const loaded = loadDataset(cwd, dataset ?? DEFAULT_DATASET)
    return { ...loaded, asOf: asOf ?? loaded.asOf }
  }

  const lintInput = {
    type: 'object',
    properties: datasetArg,
    additionalProperties: false,
  } as const

  const lintDescription =
    "Compare a system's declared processing surface before and after a change, against its consent ledger. Returns the minimal edit script, every hunk classified by ethical severity, and each processing activity left without cover with the reason. Consent to be scored is not consent to be refused by a machine, so an escalation is reported even when nothing was added."

  registry.register(
    {
      name: 'reach_lint',
      description: lintDescription,
      inputSchema: lintInput,
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { dataset?: string; asOf?: string }) => {
        const data = await resolveDataset(input.dataset, input.asOf)
        return await runEngine('reach_diff', {
          before: data.before.activities,
          after: data.after.activities,
          ledger: data.ledger,
          ledgerBefore: data.ledgerBefore,
          asOf: data.asOf,
        })
      },
    } satisfies Tool<{ dataset?: string; asOf?: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'reach_plan',
      description:
        'Plan the re-consent ask for everything reach_lint reports as uncovered. Returns a narrow plan and a broad plan, the admissible lower bound for each, provenMinimal only when the bound is met, and the over-reach cost of each: how many already-consented processing activities a grant would authorise beyond the orphans it must cover.',
      inputSchema: lintInput,
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { dataset?: string; asOf?: string }) => {
        const data = await resolveDataset(input.dataset, input.asOf)
        const lint = (await runEngine('reach_diff', {
          before: data.before.activities,
          after: data.after.activities,
          ledger: data.ledger,
          ledgerBefore: data.ledgerBefore,
          asOf: data.asOf,
        })) as { uncovered: unknown[] }
        return await runEngine('plan_cover', {
          uncovered: lint.uncovered,
          activities: data.after.activities,
        })
      },
    } satisfies Tool<{ dataset?: string; asOf?: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'reach_validate',
      description:
        'Static rules on the declaration itself, needing no before-state: machine-decided binding effects, sensitive data on a non-consent basis, wildcard grants that authorise more than they name, and grants about to lapse.',
      inputSchema: lintInput,
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { dataset?: string }) => {
        const data = await resolveDataset(input.dataset)
        return await runEngine('validate_surface', {
          surface: { system: data.after.system, epoch: data.after.epoch, activities: data.after.activities },
          ledger: data.ledger,
        })
      },
    } satisfies Tool<{ dataset?: string; asOf?: string }, unknown>,
    { source: 'core' },
  )

  registry.register(
    {
      name: 'reach_queue',
      description:
        'The review queue: every uncovered activity as an owned obligation, joined with the plan that clears it and with any recorded decision. This is what a consent or compliance reviewer works through.',
      inputSchema: lintInput,
      outputSchema: { type: 'object' },
      permissions: ['fs:read', 'proc:spawn'],
      surface: 'core',
      handler: async (input: { dataset?: string; asOf?: string }) => {
        const data = await resolveDataset(input.dataset, input.asOf)
        const lint = (await runEngine('reach_diff', {
          before: data.before.activities,
          after: data.after.activities,
          ledger: data.ledger,
          ledgerBefore: data.ledgerBefore,
          asOf: data.asOf,
        })) as {
          uncovered: readonly {
            activityId: string
            reason: string
            reasonSeverity: number
            blockers: readonly string[]
          }[]
          coverage: { consentActivities: number; covered: number; uncovered: number }
        }
        const plan = (await runEngine('plan_cover', {
          uncovered: lint.uncovered,
          activities: data.after.activities,
        })) as {
          specific: { grants: readonly string[]; count: number; provenMinimal: boolean }
          broad: { grants: readonly string[]; count: number; provenMinimal: boolean }
          overReachCost: { specific: number; broad: number }
          recommended: {
            plan: string
            count: number
            sweep: number
            sweepDetail: readonly { grant: string; covers: readonly string[] }[]
          }
        }

        // The engine already states which activities each chosen grant covers, so the queue reads
        // that mapping directly rather than re-deriving grant ids from the orphan name.
        const clearing = new Map<string, string>()
        for (const detail of plan.recommended.sweepDetail) {
          for (const activityId of detail.covers) clearing.set(activityId, detail.grant)
        }

        const rows = lint.uncovered.map((orphan) => ({
          id: `${data.name}:${orphan.activityId}`,
          activityId: orphan.activityId,
          reason: orphan.reason,
          blockers: orphan.blockers,
          severity: orphan.reasonSeverity,
        }))
        const decisions = await loadDecisions(
          cwd,
          rows.map((row) => row.id),
        )
        const queue = rows.map((row) => {
          const decision = decisions.get(row.id)
          return {
            ...row,
            owner: decision?.owner ?? null,
            status: decision?.status ?? 'open',
            decidedAt: decision?.decidedAt ?? null,
            clearsVia: clearing.get(row.activityId) ?? null,
          }
        })
        return {
          dataset: data.name,
          asOf: data.asOf,
          summary: lint.coverage,
          plan: {
            recommended: plan.recommended.plan,
            grants: plan.recommended.count,
            sweep: plan.recommended.sweep,
            specific: { count: plan.specific.count, provenMinimal: plan.specific.provenMinimal },
            broad: { count: plan.broad.count, provenMinimal: plan.broad.provenMinimal },
            overReachCost: plan.overReachCost,
          },
          queue,
        }
      },
    } satisfies Tool<{ dataset?: string; asOf?: string }, unknown>,
    { source: 'core' },
  )

  return registry
}

interface ObligationDecision {
  readonly owner: string | null
  readonly status: string
  readonly decidedAt: number | null
}

/**
 * Recorded decisions live in SQLite, not in the repository, because an assignment is ephemeral
 * workflow state. The declarations stay in git; the queue state stays local.
 */
async function loadDecisions(cwd: string, ids: readonly string[]): Promise<Map<string, ObligationDecision>> {
  const found = new Map<string, ObligationDecision>()
  if (ids.length === 0) return found
  const { Store } = await import('@consentreachlint/memory')
  const path = join(cwd, '.data', 'obligations.sqlite')
  if (!existsSync(path)) return found
  const store = new Store(path)
  try {
    for (const id of ids) {
      const row = store.get(id)
      if (!row) continue
      const payload = JSON.parse(row.payload) as Partial<ObligationDecision>
      found.set(id, {
        owner: payload.owner ?? null,
        status: payload.status ?? 'open',
        decidedAt: payload.decidedAt ?? null,
      })
    }
  } finally {
    store.close()
  }
  return found
}

/** A minimal, dependency-free logger for the tool context. */
export function createContext(requestId = 'cli'): ToolContext {
  return {
    requestId,
    now: () => Date.now(),
    log: (level, message, fields) => {
      process.stderr.write(`${JSON.stringify({ level, message, requestId, ...fields })}\n`)
    },
    dataDir: process.env.PRODUCT_DATA_DIR ?? '.data',
  }
}
