import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { doctor, renderReport } from './doctor.js'

const dirs: string[] = []

/** The repository root, three levels up from packages/cli/src. */
function repoRoot(): string {
  return resolve(fileURLToPath(import.meta.url), '../../../..')
}

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), 'doctor-'))
  dirs.push(root)
  mkdirSync(join(root, 'skills', 'alpha'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'alpha', 'SKILL.md'),
    '---\nname: alpha\ndescription: A valid skill for the doctor test suite.\nmetadata:\n  version: 1.0.0\n---\nBody.\n',
    'utf8',
  )
  return root
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('doctor', () => {
  it('passes on a well-formed tree', async () => {
    const report = await doctor(repo())
    expect(report.ok).toBe(true)
    expect(report.checks.find((c) => c.name === 'skills')?.status).toBe('ok')
  })

  it('fails and names a fix when a skill is invalid', async () => {
    const root = repo()
    mkdirSync(join(root, 'skills', 'broken'), { recursive: true })
    writeFileSync(join(root, 'skills', 'broken', 'SKILL.md'), 'no frontmatter', 'utf8')
    const report = await doctor(root)
    expect(report.ok).toBe(false)
    const skills = report.checks.find((c) => c.name === 'skills')
    expect(skills?.status).toBe('fail')
    expect(skills?.fix).toBeTruthy()
  })

  it('warns rather than fails when config is absent', async () => {
    const report = await doctor(repo())
    expect(report.checks.find((c) => c.name === 'config')?.status).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('warns about the engine and dataset outside a product tree', async () => {
    const report = await doctor(repo())
    // A directory that is not a ConsentReach tree at all should still be describable.
    expect(report.checks.find((c) => c.name === 'engine')?.status).toBe('warn')
    expect(report.checks.find((c) => c.name === 'dataset')?.status).toBe('warn')
    expect(report.ok).toBe(true)
  })

  it('fails when a product tree is missing its declarations', async () => {
    const root = repo()
    // Marking the tree as a product root must make a missing dataset a hard failure, because
    // inside a real install the declarations are not optional.
    mkdirSync(join(root, 'apps', 'web', 'data'), { recursive: true })
    const report = await doctor(root)
    expect(report.checks.find((c) => c.name === 'dataset')?.status).toBe('fail')
    expect(report.checks.find((c) => c.name === 'dataset')?.fix).toBeTruthy()
    expect(report.ok).toBe(false)
  })

  it('probes the engine and dataset for real in the actual repository', async () => {
    // The committed tree must satisfy the strict path, or the whole product claim is hollow.
    const report = await doctor(repoRoot())
    expect(report.checks.find((c) => c.name === 'engine')?.status).toBe('ok')
    expect(report.checks.find((c) => c.name === 'dataset')?.status).toBe('ok')
    expect(report.checks.find((c) => c.name === 'tools')?.detail).toContain('9 registered')
    expect(report.ok).toBe(true)
  })

  it('renders every check with a status token', async () => {
    const rendered = renderReport(await doctor(repo()))
    expect(rendered).toMatch(/doctor/)
    expect(rendered).toMatch(/[PASS]/)
    expect(rendered).toMatch(/[WARN]/)
  })
})
