import { loadDataset } from '@/lib/dataset'
import { reachDiff, validateSurface } from '@/lib/reach'

/**
 * The declarations themselves, as committed. This is the `git-backed` storage decision: what a
 * system does to people is policy, so it lives in version control and is reviewed like code.
 */
export default function SurfacesPage() {
  const dataset = loadDataset()
  const beforeById = new Map(dataset.before.activities.map((item) => [item.id, item]))
  const lint = reachDiff({
    before: dataset.before.activities,
    after: dataset.after.activities,
    ledger: dataset.ledger,
    ledgerBefore: dataset.ledgerBefore,
    asOf: dataset.asOf,
  })
  const validation = validateSurface({
    surface: { activities: dataset.after.activities },
    ledger: dataset.ledger,
  })
  const orphanIds = new Set(lint.uncovered.map((item) => item.activityId))

  return (
    <>
      <section className="hero">
        <p className="eyebrow">declarations</p>
        <h1>{dataset.name}</h1>
        <p>
          Epoch {dataset.before.epoch} to {dataset.after.epoch}. {dataset.after.note}
        </p>
      </section>

      <section className="section" aria-labelledby="surface">
        <h2 id="surface" className="section__title">
          Processing surface
        </h2>
        <p className="section__note">
          An activity is one thing the system does to a cohort. Purposes and cohorts together with data
          classes are the four axes a grant must match on all of.
        </p>
        <table className="table">
          <caption>
            {dataset.after.activities.length} declared activities at {dataset.after.epoch}.
          </caption>
          <thead>
            <tr>
              <th scope="col">activity</th>
              <th scope="col">purpose</th>
              <th scope="col">cohort</th>
              <th scope="col">automation</th>
              <th scope="col">effect</th>
              <th scope="col">basis</th>
              <th scope="col">data</th>
              <th scope="col">changed from {dataset.before.epoch}</th>
              <th scope="col">cover</th>
            </tr>
          </thead>
          <tbody>
            {dataset.after.activities.map((activity) => {
              const previous = beforeById.get(activity.id)
              const changed =
                previous === undefined ? 'added' : previous === activity ? 'unchanged' : 'changed'
              return (
                <tr key={activity.id}>
                  <td>{activity.id}</td>
                  <td>{activity.purpose}</td>
                  <td>{activity.subjectClass}</td>
                  <td>{activity.automation}</td>
                  <td>{activity.decisionEffect}</td>
                  <td>{activity.legalBasis}</td>
                  <td>{activity.dataClasses.join(', ')}</td>
                  <td>{changed}</td>
                  <td>
                    {activity.legalBasis !== 'consent'
                      ? 'out of scope'
                      : orphanIds.has(activity.id)
                        ? 'uncovered'
                        : 'covered'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="section__note" style={{ marginTop: 'var(--space-3)' }}>
          Removed by this change:{' '}
          {dataset.before.activities
            .filter((item) => !dataset.after.activities.some((now) => now.id === item.id))
            .map((item) => item.id)
            .join(', ') || 'none'}
          .
        </p>
      </section>

      <section className="section" aria-labelledby="ledger">
        <h2 id="ledger" className="section__title">
          Consent ledger
        </h2>
        <p className="section__note">
          {dataset.ledger.grants.length} grants. Each records the automation level and decision effect the
          person actually accepted, which is why an escalation invalidates cover even when nothing else
          changed.
        </p>
        <table className="table">
          <caption>Grants in force or on record at {dataset.asOf}.</caption>
          <thead>
            <tr>
              <th scope="col">grant</th>
              <th scope="col">cohort</th>
              <th scope="col">purposes</th>
              <th scope="col">activities</th>
              <th scope="col">data</th>
              <th scope="col">accepted level</th>
              <th scope="col">window</th>
              <th scope="col">status</th>
            </tr>
          </thead>
          <tbody>
            {dataset.ledger.grants.map((grant) => (
              <tr key={grant.id}>
                <td>{grant.id}</td>
                <td>{grant.subjectClass}</td>
                <td>{grant.purposes.join(', ')}</td>
                <td>{grant.activities.join(', ')}</td>
                <td>{grant.dataClasses.join(', ')}</td>
                <td>
                  {grant.automation} / {grant.decisionEffect}
                </td>
                <td>
                  {grant.validFrom} to {grant.validUntil}
                </td>
                <td>{grant.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="section" aria-labelledby="violations">
        <h2 id="violations" className="section__title">
          Declaration checks
        </h2>
        <p className="section__note">
          Rules on the declaration itself, needing no before-state: {validation.counts.high} high,{' '}
          {validation.counts.medium} medium, {validation.counts.info} info.
        </p>
        {validation.violations.length === 0 ? (
          <div className="state">clean</div>
        ) : (
          <table className="table">
            <caption>Findings against the current declaration.</caption>
            <thead>
              <tr>
                <th scope="col">severity</th>
                <th scope="col">rule</th>
                <th scope="col">subject</th>
                <th scope="col">detail</th>
              </tr>
            </thead>
            <tbody>
              {validation.violations.map((item) => (
                <tr key={`${item.rule}:${item.subject}`}>
                  <td>{item.severity}</td>
                  <td>{item.rule}</td>
                  <td>{item.subject}</td>
                  <td>{item.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  )
}
