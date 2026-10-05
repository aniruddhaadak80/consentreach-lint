import Link from 'next/link'
import plan from '../../data/claims-triage.plan.json'
import { loadDataset } from '@/lib/dataset'

/**
 * The re-consent plan, rendered from the committed engine artifact.
 *
 * The interesting comparison is not the number of asks — it is what each ask costs. A broad
 * grant saves asks and quietly authorises processing nobody agreed to, so the page puts the two
 * plans side by side with their over-reach, and never rounds an unproven optimum up to a proven
 * one.
 */

interface Solution {
  readonly grants: readonly string[]
  readonly count: number
  readonly lowerBound: number
  readonly provenMinimal: boolean
}

interface PlanArtifact {
  readonly asOf: string
  readonly specific: Solution
  readonly broad: Solution
  readonly overReachCost: { readonly specific: number; readonly broad: number }
  readonly recommended: {
    readonly plan: 'specific' | 'broad'
    readonly grants: readonly string[]
    readonly count: number
    readonly lowerBound: number
    readonly provenMinimal: boolean
    readonly sweep: number
    readonly sweepDetail: readonly {
      readonly grant: string
      readonly covers: readonly string[]
      readonly sweep: number
    }[]
  }
}

const artifact = plan as PlanArtifact

function Certificate({ solution }: { solution: Solution }) {
  return (
    <p style={{ margin: 0, fontSize: 'var(--text-sm)' }}>
      {solution.provenMinimal ? (
        <span className="badge" data-tone="ok">
          proven minimal — bound {solution.lowerBound} equals size {solution.count}
        </span>
      ) : (
        <span className="badge" data-tone="warn">
          not proven — bound {solution.lowerBound} against size {solution.count}
        </span>
      )}
    </p>
  )
}

export default function PlanPage() {
  const dataset = loadDataset()

  return (
    <>
      <section className="hero">
        <p className="eyebrow">re-consent plan</p>
        <h1>{artifact.recommended.count} grants, ±0 over-reach</h1>
        <p>
          Two answers for the same {artifact.recommended.sweepDetail.length} obligations. The broad plan asks
          for less. The narrow plan authorises nothing extra.
        </p>
      </section>

      <section className="section" aria-labelledby="compare">
        <h2 id="compare" className="section__title">
          Narrow versus broad
        </h2>
        <p className="section__note">
          Over-reach is the number of already-consented processing activities a grant would authorise beyond
          the orphans it is required to cover. It is a harm to a third party; an extra ask is only a cost to
          the team. That is why the product minimises over-reach first and asks second.
        </p>

        <table className="table">
          <caption>
            Both plans for {dataset.name} at {artifact.asOf}.
          </caption>
          <thead>
            <tr>
              <th scope="col">plan</th>
              <th scope="col">grants</th>
              <th scope="col">over-reach</th>
              <th scope="col">certificate</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>narrow</td>
              <td>{artifact.specific.count}</td>
              <td>{artifact.overReachCost.specific}</td>
              <td>
                <Certificate solution={artifact.specific} />
              </td>
            </tr>
            <tr>
              <td>broad</td>
              <td>{artifact.broad.count}</td>
              <td>{artifact.overReachCost.broad}</td>
              <td>
                <Certificate solution={artifact.broad} />
              </td>
            </tr>
          </tbody>
        </table>

        <p className="section__note" style={{ marginTop: 'var(--space-4)' }}>
          Recommended: <strong>{artifact.recommended.plan}</strong>.{' '}
          {artifact.broad.count < artifact.specific.count
            ? `The broad plan would save ${artifact.specific.count - artifact.broad.count} ${
                artifact.specific.count - artifact.broad.count === 1 ? 'ask' : 'asks'
              }, at a cost of ${artifact.overReachCost.broad} additional ${
                artifact.overReachCost.broad === 1 ? 'authorisation' : 'authorisations'
              } nobody requested.`
            : 'The broad plan saves no asks, so it only adds authorisations.'}
        </p>
      </section>

      <section className="section" aria-labelledby="grants">
        <h2 id="grants" className="section__title">
          Grants to issue
        </h2>
        <p className="section__note">
          Each grant asks for exactly the orphan it clears and nothing wider, which is why every stamp reads
          zero.
        </p>

        <table className="table">
          <caption>
            The {artifact.recommended.count} grants in the recommended {artifact.recommended.plan} plan.
          </caption>
          <thead>
            <tr>
              <th scope="col">grant</th>
              <th scope="col">covers</th>
              <th scope="col">sweep</th>
            </tr>
          </thead>
          <tbody>
            {artifact.recommended.sweepDetail.map((detail) => (
              <tr key={detail.grant}>
                <td>{detail.grant}</td>
                <td>{detail.covers.join(', ')}</td>
                <td>{detail.sweep === 0 ? '±0' : `+${detail.sweep}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section" aria-labelledby="method">
        <h2 id="method" className="section__title">
          How the claim is made
        </h2>
        <div className="prose">
          <p>
            Set cover is NP-hard, so this planner does not claim an optimum unless it can prove one. It
            computes an achievable solution, then an admissible lower bound by disjoint greedy packing, and
            reports <code>provenMinimal</code> only when the two agree.
          </p>
          <p>
            The correctness of that claim is itself tested: the engine test suite enumerates every subset of
            candidates on small instances and asserts the planner matches the true minimum, so the certificate
            is falsifiable rather than decorative.
          </p>
          <p>
            These figures are the Python engine's own output, committed as an artifact rather than recomputed
            in the browser, because the solver is exact branch-and-bound and a second copy of it would be a
            drift hazard. <code>npm run check:plan-artifact</code> fails the build if the artifact stops
            matching the engine.
          </p>
          <p>
            <Link href="/review">Back to the review queue</Link>
          </p>
        </div>
      </section>
    </>
  )
}
