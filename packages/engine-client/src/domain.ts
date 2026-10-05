/**
 * The typed I/O contract with the Python engine, as seen from TypeScript.
 *
 * Types only. The behaviour lives in one place on each side of the language boundary: the
 * authoritative implementation is the Python engine, and the single TypeScript mirror is
 * `apps/web/lib/reach.ts`, which exists because ADR 0003 keeps the deployed app free of
 * workspace dependencies. `apps/web/tests/parity.test.mjs` pins that mirror against output
 * actually produced by `python -m consentreach_lint`, so the two cannot drift.
 *
 * This module deliberately contains no algorithm. A second copy of the reach algebra here would
 * be a third implementation of the same rule and a drift hazard with no caller.
 *
 * Field names are camelCase because they are the JSON keys on the wire; renaming one to satisfy
 * a TypeScript convention would silently break the contract with the engine.
 */

export const AUTOMATION_RANK: Readonly<Record<string, number>> = Object.freeze({
  none: 0,
  human_review: 1,
  human_approval: 2,
  automated: 3,
})

export const EFFECT_RANK: Readonly<Record<string, number>> = Object.freeze({
  none: 0,
  advisory: 1,
  binding: 2,
  dispositive: 3,
})

export const SENSITIVE_DATA_CLASSES: ReadonlySet<string> = new Set([
  'health',
  'biometric',
  'genetic',
  'precise_location',
  'financial',
])

export const REASON_SEVERITY: Readonly<Record<string, number>> = Object.freeze({
  'grant-escalation': 100,
  'grant-withdrawn': 80,
  'grant-expired': 80,
  'no-active-grant': 60,
  'data-class-not-covered': 60,
})

export const HUNK_SEVERITY: Readonly<Record<string, number>> = Object.freeze({
  'effect-escalation': 100,
  'automation-escalation': 90,
  'reach-withdrawal': 80,
  'scope-creep': 60,
  benign: 0,
})

export type HunkClass =
  'effect-escalation' | 'automation-escalation' | 'reach-withdrawal' | 'scope-creep' | 'benign'

export type BlockerReason =
  'grant-escalation' | 'grant-withdrawn' | 'grant-expired' | 'no-active-grant' | 'data-class-not-covered'

export interface ProcessingActivity {
  readonly id: string
  readonly purpose: string
  readonly subjectClass: string
  readonly automation: string
  readonly decisionEffect: string
  readonly dataClasses: readonly string[]
  readonly legalBasis: string
}

export interface ProcessingSurface {
  readonly system: string
  readonly epoch: string
  readonly note?: string
  readonly activities: readonly ProcessingActivity[]
}

export interface ConsentGrant {
  readonly id: string
  readonly subjectClass: string
  readonly purposes: readonly string[]
  readonly activities: readonly string[]
  readonly dataClasses: readonly string[]
  readonly legalBasis: string
  readonly automation: string
  readonly decisionEffect: string
  readonly validFrom: string
  readonly validUntil: string
  readonly status: 'active' | 'withdrawn'
}

export interface ConsentLedger {
  readonly note?: string
  readonly grants: readonly ConsentGrant[]
}

export interface Hunk {
  readonly op: 'add' | 'remove' | 'change'
  readonly id: string
  readonly fields: readonly string[]
  readonly klass: HunkClass
  readonly severity: number
}

export interface UncoveredTuple {
  readonly activityId: string
  readonly subjectClass: string
  readonly purpose: string
  readonly dataClasses: readonly string[]
  readonly automation: string
  readonly decisionEffect: string
  readonly legalBasis: string
  readonly reason: BlockerReason
  readonly reasonSeverity: number
  readonly blockers: readonly BlockerReason[]
}

export interface Coverage {
  readonly activities: number
  readonly consentActivities: number
  readonly covered: number
  readonly uncovered: number
  readonly outOfScope: number
  readonly coverageRatio: number
}

export interface ReachDiffResult {
  readonly asOf: string
  readonly hunks: readonly Hunk[]
  readonly uncovered: readonly UncoveredTuple[]
  readonly outOfScope: readonly string[]
  readonly coverage: Coverage
  readonly stats: {
    readonly hunks: number
    readonly unchangedActivities: number
    readonly byClass: Readonly<Record<string, number>>
    readonly maxSeverity: number
    readonly orphans: number
  }
}

export interface CoverSolution {
  readonly grants: readonly string[]
  readonly count: number
  readonly lowerBound: number
  readonly provenMinimal: boolean
}

export interface CoverCandidate {
  readonly id: string
  readonly width: 'activity' | 'cohort' | 'purpose'
  readonly purpose: string
  readonly subjectClass: string
  readonly activities: readonly string[]
  readonly dataClasses: readonly string[]
  readonly automation: string
  readonly decisionEffect: string
  readonly covers: readonly string[]
  readonly sweep: number
}

export interface PlanCoverResult {
  readonly orphanCount: number
  readonly candidates: readonly CoverCandidate[]
  readonly specific: CoverSolution
  readonly broad: CoverSolution
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

export interface Violation {
  readonly rule: string
  readonly severity: 'high' | 'medium' | 'info'
  readonly subject: string
  readonly detail: string
}

export interface ValidateResult {
  readonly violations: readonly Violation[]
  readonly counts: { readonly high: number; readonly medium: number; readonly info: number }
  readonly clean: boolean
  readonly checkedActivities: number
  readonly checkedGrants: number
}
