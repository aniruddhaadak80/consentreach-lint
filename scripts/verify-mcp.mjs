/**
 * Proves the MCP surface really works, from the outside, over real stdio.
 *
 * This is deliberately not a unit test with a mocked transport. It launches `mcp serve` as a
 * child process and drives a genuine MCP client against it, because the failure modes that
 * matter (a protocol framing error, a tool name MCP cannot carry, a handler that only works
 * in-process) are invisible to an in-process test.
 *
 *   node scripts/verify-mcp.mjs
 */

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join, resolve } from 'node:path'

const ROOT = resolve(process.argv[2] ?? '.')
const SERVER = join(ROOT, 'packages', 'cli', 'dist', 'bin.js')

/**
 * Generous on purpose. The server spawns a real Python subprocess per tool call, and on a cold
 * Windows filesystem — or a busy CI runner — module loading and interpreter start-up have been
 * observed to exceed 30s. A flaky verification gate is worse than a slow one, because it trains
 * people to re-run it instead of reading it.
 */
const TIMEOUT_MS = Number(process.env.VERIFY_MCP_TIMEOUT_MS ?? 90_000)

const log = (line) => process.stdout.write(`${line}\n`)

function frame(payload) {
  return `${JSON.stringify(payload)}\n`
}

/**
 * A minimal MCP client over newline-delimited JSON-RPC, speaking to a spawned stdio server.
 * Kept dependency-free so this script proves the protocol, not the SDK.
 */
class StdioProbe {
  #child = null
  #pending = new Map()
  #nextId = 1

  async start() {
    this.#child = spawn(process.execPath, [SERVER, 'mcp', 'serve'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    })

    this.#child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8').trim()
      if (text.length > 0) process.stderr.write(`  [server stderr] ${text}\n`)
    })

    const reader = createInterface({ input: this.#child.stdout })
    reader.on('line', (line) => {
      if (line.trim().length === 0) return
      let message
      try {
        message = JSON.parse(line)
      } catch {
        process.stderr.write(`  [non-JSON on stdout] ${line}\n`)
        return
      }
      if (message.id !== undefined && this.#pending.has(message.id)) {
        const { resolve: settle, reject } = this.#pending.get(message.id)
        this.#pending.delete(message.id)
        if (message.error) reject(new Error(`${message.error.code}: ${message.error.message}`))
        else settle(message.result)
      }
    })

    await new Promise((settle, reject) => {
      this.#child.once('spawn', settle)
      this.#child.once('error', reject)
    })
  }

  request(method, params) {
    const id = this.#nextId++
    const promise = new Promise((settle, reject) => {
      this.#pending.set(id, { resolve: settle, reject })
      setTimeout(() => {
        if (this.#pending.has(id)) {
          this.#pending.delete(id)
          reject(new Error(`${method} timed out after ${TIMEOUT_MS}ms`))
        }
      }, TIMEOUT_MS).unref?.()
    })
    this.#child.stdin.write(frame({ jsonrpc: '2.0', id, method, params }))
    return promise
  }

  notify(method, params) {
    this.#child.stdin.write(frame({ jsonrpc: '2.0', method, params }))
  }

  stop() {
    if (this.#child) {
      this.#child.stdin.end()
      this.#child.kill()
    }
  }
}

function fail(message) {
  log(`  FAIL  ${message}`)
  process.exitCode = 1
}

function pass(message) {
  log(`  ok    ${message}`)
}

const probe = new StdioProbe()

try {
  await probe.start()

  // 1. initialize — the handshake
  const initialized = await probe.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'verify-mcp', version: '0.1.0' },
  })
  if (initialized?.serverInfo?.name !== 'consentreach-lint') {
    fail(`initialize returned unexpected serverInfo: ${JSON.stringify(initialized?.serverInfo)}`)
  } else {
    pass(
      `initialize -> ${initialized.serverInfo.name} v${initialized.serverInfo.version} (protocol ${initialized.protocolVersion})`,
    )
  }
  probe.notify('notifications/initialized', {})

  // 2. tools/list — the registry reaches the wire
  const listed = await probe.request('tools/list', {})
  const names = (listed?.tools ?? []).map((tool) => tool.name).sort()
  if (names.length < 9) {
    fail(`tools/list returned ${names.length} tools, expected at least 9`)
  } else {
    pass(`tools/list -> ${names.length} tools: ${names.join(', ')}`)
  }
  for (const required of ['reach_lint', 'reach_plan', 'reach_queue', 'reach_validate']) {
    if (!names.includes(required)) fail(`tools/list is missing ${required}`)
  }

  // 3. tools/call that reaches the Python engine
  const called = await probe.request('tools/call', { name: 'reach_lint', arguments: {} })
  const text = (called?.content ?? []).map((part) => part.text ?? '').join('')
  if (called?.isError === true) {
    fail(`tools/call reach_lint returned an error: ${text}`)
  } else {
    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed.hunks) || parsed.hunks.length === 0) {
      fail('tools/call reach_lint returned no hunks — the engine was not reached')
    } else {
      pass(
        `tools/call reach_lint -> asOf ${parsed.asOf}, ${parsed.hunks.length} hunks, ` +
          `${parsed.coverage.uncovered} uncovered of ${parsed.coverage.consentActivities} (top hunk ${parsed.hunks[0].id} ${parsed.hunks[0].klass})`,
      )
    }
  }

  // 4. tools/call for the proof-carrying plan
  const planned = await probe.request('tools/call', { name: 'reach_plan', arguments: {} })
  const planText = (planned?.content ?? []).map((part) => part.text ?? '').join('')
  const plan = JSON.parse(planText)
  if (plan?.recommended?.provenMinimal !== true) {
    fail(`reach_plan did not prove minimality: provenMinimal=${plan?.recommended?.provenMinimal}`)
  } else {
    pass(
      `tools/call reach_plan -> ${plan.recommended.plan} plan, ${plan.recommended.count} grants, ` +
        `over-reach ${plan.overReachCost.specific} vs ${plan.overReachCost.broad}, provenMinimal true`,
    )
  }

  // 5. an unknown tool must be an error, not a silent success
  const bogus = await probe.request('tools/call', { name: 'not_a_tool', arguments: {} })
  if (bogus?.isError !== true && bogus?.content?.[0]?.text?.includes('not_a_tool') !== true) {
    fail('calling an unknown tool did not produce an error')
  } else {
    pass('unknown tool is rejected with a typed error')
  }
} catch (cause) {
  fail(`probe threw: ${cause instanceof Error ? cause.message : String(cause)}`)
} finally {
  probe.stop()
}

if (process.exitCode) {
  log('')
  log('MCP VERIFICATION FAILED')
} else {
  log('')
  log('MCP VERIFICATION PASSED — the server speaks the protocol over real stdio.')
}
