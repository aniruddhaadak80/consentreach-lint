/**
 * The product's identity and its shipped-surface manifest, in one typed place.
 *
 * `SURFACES` lists what genuinely ships and what is deliberately omitted, and the UI renders the
 * list as given. Nothing here is aspirational: if a surface is marked `shipped` it has working
 * code and a test, and if it is marked `planned` there is a stated reason it is absent.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Surface {
  readonly id: string
  readonly title: string
  readonly summary: string
  readonly status: 'shipped' | 'planned'
  readonly reason?: string
}

export const PRODUCT = {
  name: 'ConsentReach Lint',
  slug: 'consentreach-lint',
  version: '0.1.0',
  tagline:
    'Lint the declared processing surface of an AI system against its consent ledger, and prove which people a change leaves without cover.',
  license: 'Apache-2.0',
  engine: 'python (pure, dependency-free)',
} as const

/**
 * The engine in one sentence, stated identically by the CLI, this app, and the README so the
 * three can never make different promises.
 */
export const ENGINE_SUMMARY =
  'Three pure Python functions — reach_diff, plan_cover, validate_surface — over typed dictionaries, with no clock, no network, and no randomness.'

export const SURFACES: readonly Surface[] = [
  {
    id: 'cli',
    title: 'CLI',
    summary:
      'The load-bearing surface. lint, plan, queue, validate, decide. lint and validate exit 2 on an open obligation, so it works as a merge gate.',
    status: 'shipped',
  },
  {
    id: 'web',
    title: 'Web (Vercel)',
    summary:
      'This app. Server-rendered from the committed declarations, recomputing the reach algebra at build time rather than showing a fixture.',
    status: 'shipped',
  },
  {
    id: 'mcp-server',
    title: 'MCP server',
    summary:
      'The same nine tools over stdio, derived from the core registry rather than a second list, so a CLI command is an MCP tool the same day.',
    status: 'shipped',
  },
  {
    id: 'mcp-client',
    title: 'MCP client',
    summary:
      'A real client that spawns the server and drives initialize, tools/list and tools/call. scripts/verify-mcp.mjs is the proof.',
    status: 'shipped',
  },
  {
    id: 'skills',
    title: 'Skills catalog',
    summary:
      'SKILL.md files loaded from disk with frontmatter validation, and a CI gate that fails when a skill body changes without a version bump.',
    status: 'shipped',
  },
  {
    id: 'plugins',
    title: 'Plugin registry',
    summary:
      'Manifests validated against a schema with priority-based conflict resolution, for organisation-specific policy that should not be a core edit.',
    status: 'shipped',
  },
  {
    id: 'memory',
    title: 'Memory',
    summary:
      'SQLite in WAL for workflow state only: who owns which obligation, and when it was decided. The declarations stay in git.',
    status: 'shipped',
  },
  {
    id: 'desktop',
    title: 'Desktop (Electron)',
    summary:
      'The workflow is a CI check plus a pull-request review. A packaging shell improves neither and adds a second artifact to sign.',
    status: 'planned',
    reason: 'the novelty draw is cli-first; a shell would add distribution without adding review',
  },
  {
    id: 'channels',
    title: 'Channels',
    summary:
      'An obligation you can resolve by replying in a thread is an obligation nobody can audit. These need an owner and a record.',
    status: 'planned',
    reason: 'chat surfaces would manufacture the "looks approved" ambiguity this product removes',
  },
  {
    id: 'model-providers',
    title: 'Model providers',
    summary:
      'A product whose credibility is a proof must not contain a fallback that guesses. There is no model tier here at any confidence.',
    status: 'planned',
    reason: 'no provider tier exists anywhere in this repository, by decision rather than omission',
  },
]

/**
 * Read from the installed manifest rather than returned as a literal, so the health endpoint
 * cannot report a version that has drifted from the package. Falls back to the constant only when
 * the manifest is unreadable, which on a deployed server it never is.
 */
export function resolveVersion(): string {
  try {
    const raw = readFileSync(join(process.cwd(), 'package.json'), 'utf8')
    const parsed = JSON.parse(raw) as { version?: string }
    return typeof parsed.version === 'string' ? parsed.version : PRODUCT.version
  } catch {
    return PRODUCT.version
  }
}
