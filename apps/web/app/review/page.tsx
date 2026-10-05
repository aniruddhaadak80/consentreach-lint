import Link from 'next/link'
import plan from '../../data/claims-triage.plan.json'
import { loadDataset } from '@/lib/dataset'
import { reachDiff, type UncoveredTuple } from '@/lib/reach'

/**
 * THE SIGNATURE VIEW.
 *
 * Every obligation is a card stamped with a sweep count: how many already-consented processing
 * activities the grant that clears this obligation would authorise beyond the orphans it is
 * required to cover. A narrow grant re-consenting seven people reads +0. A broad grant
 * re-consenting the same seven reads +1 — it silently widens permission for something nobody
 * asked about. That single number is the product's whole argument.
 *
 * The coverage is recomputed here; the plan is the committed engine artifact, because the solver
 * is exact branch-and-bound and is deliberately not reimplemented in TypeScript. `npm run
 * check:plan-artifact` fails the build if the two ever disagree.
 */

interface PlanArtifact {
  readonly asOf: string
  readonly coverage: {
    readonly activities: number
    readonly consentActivities: number
    readonly covered: number
    readonly uncovered: number
    readonly outOfScope: number
    readonly coverageRatio: number
  }
  readonly uncovered: readonly UncoveredTuple[]
  readonly specific: {
    readonly grants: readonly string[]
    readonly count: number
    readonly lowerBound: number
    readonly provenMinimal: boolean
  }
  readonly broad: {
    readonly grants: readonly string[]
    readonly count: number
    readonly lowerBound: number
    readonly provenMinimal: boolean
  }
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

const REASON_EXPLANATION: Readonly<Record<string, string>> = {
  'grant-escalation':
    'The grant accepted a lower automation or decision level than the system now applies. Consent to be scored is not consent to be refused by a machine.',
  'data-class-not-covered':
    'A grant matches this scope but its data classes do not include everything the activity now touches.',
  'grant-expired': 'A grant matched, but its validity window closed before this change landed.',
  'grant-withdrawn': 'The grant that used to cover this was withdrawn.',
  'no-active-grant': 'No grant in the ledger names this activity at all.',
}

function SweepStamp({ sweep, count }: { sweep: number; count: number }) {
  return (
    <div className="sweep-stamp" data-zero={sweep === 0}>
      <span className="sweep-stamp__number">{sweep === 0 ? '±0' : `+${sweep}`}</span>
      <span className="sweep-stamp__label">
        over-reach
        <br />
        {count === 1 ? 'grant' : 'grants'} beyond {count === 1 ? 'this' : 'these'} orphan
        {count === 1 ? '' : 's'}
      </span>
    </div>
  )
}

export default function ReviewPage() {
  const dataset = loadDataset()
  const lint = reachDiff({
    before: dataset.before.activities,
    after: dataset.after.activities,
    ledger: dataset.ledger,
    ledgerBefore: dataset.ledgerBefore,
    asOf: dataset.asOf,
  })

  const sweepByActivity = new Map<string, number>()
  const grantByActivity = new Map<string, string>()
  for (const detail of artifact.recommended.sweepDetail) {
    for (const activityId of detail.covers) {
      sweepByActivity.set(activityId, detail.sweep)
      grantByActivity.set(activityId, detail.grant)
    }
  }

  const segments: readonly ('covered' | 'uncovered' | 'out-of-scope')[] = [
    ...Array.from({ length: lint.coverage.covered }, () => 'covered' as const),
    ...Array.from({ length: lint.coverage.uncovered }, () => 'uncovered' as const),
    ...Array.from({ length: lint.coverage.outOfScope }, () => 'out-of-scope' as const),
  ]

  return (
    <>
      <section className="hero">
        <p className="eyebrow">review queue</p>
        <h1>{lint.coverage.uncovered} open obligations</h1>
        <p>
          Every processing activity at {lint.asOf} that no active consent grant covers, with the reason, and
          the narrow grant that would clear it.
        </p>
      </section>

      <section className="section" aria-labelledby="coverage">
        <h2 id="coverage" className="section__title">
          Coverage
        </h2>
        <div className="meter">
          <div
            className="meter__track"
            role="img"
            aria-label={`${lint.coverage.covered} of ${lint.coverage.consentActivities} consent activities covered`}
          >
            {segments.map((state, index) => (
              <span key={index} className="meter__seg" data-state={state} />
            ))}
          </div>
          <div className="meter__caption">
            <span>{lint.coverage.covered} covered</span>
            <span>{lint.coverage.uncovered} uncovered</span>
            <span>{lint.coverage.outOfScope} out of scope</span>
            <span>{Math.round(lint.coverage.coverageRatio * 100)}% of consent activities</span>
          </div>
        </div>
        <p className="section__note" style={{ marginTop: 'var(--space-3)' }}>
          Out of scope means the activity rests on a legal basis other than consent, so no re-consent is owed.
          Those are named in the report rather than silently dropped.
        </p>
      </section>

      <section className="section" aria-labelledby="obligations">
        <h2 id="obligations" className="section__title">
          Obligations
        </h2>
        <p className="section__note">
          Ordered by severity. The stamp on each card is the cost of clearing it with one broad grant instead
          of the narrow one the planner recommends.
        </p>

        <div className="grid">
          {lint.uncovered.map((item) => {
            const sweep = sweepByActivity.get(item.activityId) ?? 0
            const grant = grantByActivity.get(item.activityId)
            return (
              <article className="obligation" key={item.activityId} data-severity={item.reasonSeverity}>
                <div className="obligation__head">
                  <span className="obligation__id">{item.activityId}</span>
                  <span className="obligation__severity">severity {item.reasonSeverity}</span>
                </div>

                <dl className="obligation__meta">
                  <div>
                    <dt>reason</dt>
                    <dd>{item.reason}</dd>
                  </div>
                  {item.blockers.length > 1 ? (
                    <div>
                      <dt>blockers</dt>
                      <dd>{item.blockers.join(', ')}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>purpose</dt>
                    <dd>{item.purpose}</dd>
                  </div>
                  <div>
                    <dt>cohort</dt>
                    <dd>{item.subjectClass}</dd>
                  </div>
                  <div>
                    <dt>decides</dt>
                    <dd>
                      {item.automation} / {item.decisionEffect}
                    </dd>
                  </div>
                  <div>
                    <dt>data</dt>
                    <dd>{item.dataClasses.join(', ')}</dd>
                  </div>
                  {grant ? (
                    <div>
                      <dt>clears via</dt>
                      <dd>{grant}</dd>
                    </div>
                  ) : null}
                </dl>

                <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--fg-muted)' }}>
                  {REASON_EXPLANATION[item.reason] ?? 'No active grant covers this activity.'}
                </p>

                <SweepStamp sweep={sweep} count={1} />
              </article>
            )
          })}
        </div>
      </section>

      <section className="section" aria-labelledby="assignment">
        <h2 id="assignment" className="section__title">
          Assign an obligation
        </h2>
        <p className="section__note">
          Ownership is workflow state, so it lives in local SQLite and never in the repository. The
          declarations stay in git; the queue state stays with the reviewer.
        </p>
        <pre>{`consentreach-lint decide ${lint.uncovered[0]?.activityId ?? '<activity>'} --owner <name>
consentreach-lint queue`}</pre>
      </section>

      <section className="section" aria-labelledby="next">
        <h2 id="next" className="section__title">
          What to issue
        </h2>
        <p className="section__note">
          The recommended plan is <strong>{artifact.recommended.plan}</strong>: {artifact.recommended.count}{' '}
          grants, over-reach <code>{artifact.recommended.sweep}</code>.{' '}
          {artifact.recommended.provenMinimal
            ? 'Minimality is proven: the admissible lower bound equals the achieved size.'
            : `Minimality is not proven: the bound is ${artifact.recommended.lowerBound} against a size of ${artifact.recommended.count}.`}{' '}
          <Link href="/plan">See both plans side by side</Link>.
        </p>
      </section>
    </>
  )
}
