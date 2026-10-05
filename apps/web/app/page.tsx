import Link from 'next/link'
import { loadDataset } from '@/lib/dataset'
import { reachDiff } from '@/lib/reach'
import { ENGINE_SUMMARY, PRODUCT, SURFACES } from '@/lib/product'

/**
 * The overview. Everything below is computed from the committed declarations at build time by
 * the mirror in `lib/reach.ts`, which `tests/parity.test.mjs` pins to the Python engine. There is
 * no fixture and no loading state here because there is nothing to wait for: the page is static.
 */
export default function HomePage() {
  const dataset = loadDataset()
  const lint = reachDiff({
    before: dataset.before.activities,
    after: dataset.after.activities,
    ledger: dataset.ledger,
    ledgerBefore: dataset.ledgerBefore,
    asOf: dataset.asOf,
  })
  const { coverage } = lint
  const shipped = SURFACES.filter((surface) => surface.status === 'shipped')
  const omitted = SURFACES.filter((surface) => surface.status === 'planned')

  return (
    <>
      <section className="hero">
        <p className="eyebrow">consent reach for AI systems</p>
        <h1>Who does this change leave without cover?</h1>
        <p>{PRODUCT.tagline}</p>
      </section>

      <section className="section" aria-labelledby="verdict">
        <div className="command-bar" role="group" aria-label="Current verdict">
          <span className="command-bar__label">dataset</span>
          <span className="command-bar__value">{dataset.name}</span>
          <span className="chip" data-active="false">
            as of {dataset.asOf}
          </span>
          <span className="chip" data-active={coverage.uncovered > 0}>
            {coverage.uncovered} uncovered
          </span>
          <span className="chip" data-active={coverage.uncovered === 0}>
            {coverage.covered}/{coverage.consentActivities} covered
          </span>
          <span className="chip" data-active="false">
            {coverage.outOfScope} out of scope
          </span>
          <span className="chip" data-active="false">
            {lint.stats.hunks} hunks
          </span>
        </div>

        <h2 id="verdict" className="section__title" style={{ marginTop: 'var(--space-4)' }}>
          The verdict for {dataset.name}
        </h2>
        <p className="section__note">
          Read the reason column before the count. <code>grant-escalation</code> means nobody consented to
          this because the system changed how it decides, not because it started doing something new — and a
          diff over activity identifiers cannot see that case at all.
        </p>

        <table className="table">
          <caption>Processing activities with no covering consent grant at {dataset.asOf}.</caption>
          <thead>
            <tr>
              <th scope="col">severity</th>
              <th scope="col">activity</th>
              <th scope="col">reason</th>
              <th scope="col">purpose</th>
              <th scope="col">automation</th>
              <th scope="col">effect</th>
            </tr>
          </thead>
          <tbody>
            {lint.uncovered.map((item) => (
              <tr key={item.activityId}>
                <td>{item.reasonSeverity}</td>
                <td>{item.activityId}</td>
                <td>{item.reason}</td>
                <td>{item.purpose}</td>
                <td>{item.automation}</td>
                <td>{item.decisionEffect}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p style={{ marginTop: 'var(--space-4)' }}>
          <Link href="/review">Work the review queue</Link> — each obligation shows the grant that clears it
          and what it would sweep in. Or <Link href="/plan">see the re-consent plan</Link>, which prices the
          over-reach.
        </p>
      </section>

      <section className="section" aria-labelledby="engine">
        <h2 id="engine" className="section__title">
          The engine
        </h2>
        <div className="prose">
          <p>{ENGINE_SUMMARY}</p>
          <p>
            Set cover is NP-hard, so the planner never asserts optimality. It runs exact branch and bound
            against an admissible lower bound computed by disjoint greedy packing, and reports{' '}
            <code>provenMinimal</code> only when the two meet. When they do not, it reports the gap.
          </p>
        </div>
      </section>

      <section className="section" aria-labelledby="shipped">
        <h2 id="shipped" className="section__title">
          Surfaces that ship
        </h2>
        <p className="section__note">
          {shipped.length} shipped, {omitted.length} deliberately omitted. Every capability is a tool in one
          registry, so a CLI command is an MCP tool the same day it is written.
        </p>
        <div className="grid">
          {shipped.map((surface) => (
            <article className="card" key={surface.id}>
              <h3>{surface.title}</h3>
              <p>{surface.summary}</p>
              <span className="badge" data-tone="ok">
                shipped
              </span>
            </article>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="omitted">
        <h2 id="omitted" className="section__title">
          Deliberately omitted
        </h2>
        <p className="section__note">
          An omission is a decision. Each of these is absent on purpose, with the reason stated.
        </p>
        <div className="grid">
          {omitted.map((surface) => (
            <article className="card" key={surface.id}>
              <h3>{surface.title}</h3>
              <p>{surface.summary}</p>
              {surface.reason ? <p style={{ color: 'var(--fg-subtle)' }}>{surface.reason}</p> : null}
              <span className="badge" data-tone="warn">
                omitted
              </span>
            </article>
          ))}
        </div>
      </section>
    </>
  )
}
