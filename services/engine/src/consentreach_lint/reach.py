"""The reach relation: which consent grants actually cover a processing activity.

Pure functions only. No clock, no network, no randomness, no filesystem. `asOf` is always an
explicit argument, which is what makes a lint run replayable: the same commit and the same
`asOf` produce byte-identical output.

The algebra, and why each rule exists, is specified in docs/adr/0004-reach-algebra.md.
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from .protocol import EngineError

# Ordered levels. A grant records the level a person actually accepted; an activity records the
# level the system now applies. Cover requires the grant's level to be at least the activity's.
AUTOMATION_RANK: Final[dict[str, int]] = {
    "none": 0,
    "human_review": 1,
    "human_approval": 2,
    "automated": 3,
}
EFFECT_RANK: Final[dict[str, int]] = {
    "none": 0,
    "advisory": 1,
    "binding": 2,
    "dispositive": 3,
}

LEGAL_BASES: Final[frozenset[str]] = frozenset(
    {"consent", "legitimate_interest", "contract", "statutory"}
)

# Data classes whose processing is treated as heightened regardless of declared basis.
SENSITIVE_DATA_CLASSES: Final[frozenset[str]] = frozenset(
    {"health", "biometric", "genetic", "precise_location", "financial"}
)

HUNK_CLASSES: Final[tuple[str, ...]] = (
    "effect-escalation",
    "automation-escalation",
    "reach-withdrawal",
    "scope-creep",
    "benign",
)
SEVERITY: Final[dict[str, int]] = {
    "effect-escalation": 100,
    "automation-escalation": 90,
    "reach-withdrawal": 80,
    "scope-creep": 60,
    "benign": 0,
}

COVERED: Final[str] = "covered"

REASON_NO_GRANT: Final[str] = "no-active-grant"
REASON_WITHDRAWN: Final[str] = "grant-withdrawn"
REASON_EXPIRED: Final[str] = "grant-expired"
REASON_DATA: Final[str] = "data-class-not-covered"
REASON_ESCALATION: Final[str] = "grant-escalation"

REASON_SEVERITY: Final[dict[str, int]] = {
    REASON_NO_GRANT: 60,
    REASON_WITHDRAWN: 80,
    REASON_EXPIRED: 80,
    REASON_DATA: 60,
    REASON_ESCALATION: 100,
}


# ------------------------------------------------------------------ types


class ProcessingActivity(TypedDict):
    id: str
    purpose: str
    subjectClass: str
    automation: str
    decisionEffect: str
    dataClasses: list[str]
    legalBasis: str


class ProcessingSurface(TypedDict):
    system: str
    epoch: str
    activities: list[ProcessingActivity]


class ConsentGrant(TypedDict):
    id: str
    subjectClass: str
    purposes: list[str]
    activities: list[str]
    dataClasses: list[str]
    legalBasis: str
    automation: str
    decisionEffect: str
    validFrom: str
    validUntil: str
    status: str


class ConsentLedger(TypedDict):
    grants: list[ConsentGrant]


class Hunk(TypedDict):
    op: str
    id: str
    fields: list[str]
    klass: str
    severity: int


class UncoveredTuple(TypedDict):
    activityId: str
    subjectClass: str
    purpose: str
    dataClasses: list[str]
    automation: str
    decisionEffect: str
    legalBasis: str
    reason: str
    reasonSeverity: int
    blockers: list[str]


class Violation(TypedDict):
    rule: str
    severity: str
    subject: str
    detail: str


# ------------------------------------------------------------------ validation helpers

_ACTIVITY_KEYS: Final[tuple[str, ...]] = (
    "id",
    "purpose",
    "subjectClass",
    "automation",
    "decisionEffect",
    "dataClasses",
    "legalBasis",
)
_GRANT_KEYS: Final[tuple[str, ...]] = (
    "id",
    "subjectClass",
    "purposes",
    "activities",
    "dataClasses",
    "legalBasis",
    "automation",
    "decisionEffect",
    "validFrom",
    "validUntil",
    "status",
)


def _require_object(payload: Any, field: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"expected an object for {field!r}")
    return payload


def _require_str_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise EngineError("BAD_SHAPE", f"{field!r} must be a list of strings")
    return list(value)


_ISO_DATE_LENGTH: Final[int] = 10


def _require_date(value: Any, field: str) -> str:
    if value == "forever":
        return value
    if (
        not isinstance(value, str)
        or len(value) != _ISO_DATE_LENGTH
        or value[4] != "-"
        or value[7] != "-"
    ):
        raise EngineError("BAD_SHAPE", f"{field!r} must be an ISO date (YYYY-MM-DD) or 'forever'")
    return value


def parse_activities(payload: Any, field: str) -> list[ProcessingActivity]:
    """Validate a list of activities, rejecting duplicates and unknown enum levels."""
    if not isinstance(payload, list):
        raise EngineError("BAD_SHAPE", f"{field!r} must be a list of activities")
    seen: set[str] = set()
    activities: list[ProcessingActivity] = []
    for index, raw in enumerate(payload):
        obj = _require_object(raw, f"{field}[{index}]")
        for key in _ACTIVITY_KEYS:
            if key not in obj:
                raise EngineError("MISSING_FIELD", f"{field}[{index}] is missing {key!r}")
        identifier = obj["id"]
        if not isinstance(identifier, str) or not identifier:
            raise EngineError("BAD_SHAPE", f"{field}[{index}].id must be a non-empty string")
        if identifier in seen:
            raise EngineError("DUPLICATE_ID", f"{field}[{index}].id {identifier!r} appears twice")
        seen.add(identifier)
        if obj["automation"] not in AUTOMATION_RANK:
            raise EngineError(
                "BAD_ENUM",
                f"{field}[{index}].automation must be one of {sorted(AUTOMATION_RANK)}",
            )
        if obj["decisionEffect"] not in EFFECT_RANK:
            raise EngineError(
                "BAD_ENUM",
                f"{field}[{index}].decisionEffect must be one of {sorted(EFFECT_RANK)}",
            )
        if obj["legalBasis"] not in LEGAL_BASES:
            raise EngineError(
                "BAD_ENUM", f"{field}[{index}].legalBasis must be one of {sorted(LEGAL_BASES)}"
            )
        for key in ("purpose", "subjectClass"):
            if not isinstance(obj[key], str) or not obj[key]:
                raise EngineError("BAD_SHAPE", f"{field}[{index}].{key} must be a non-empty string")
        activities.append(
            {
                "id": identifier,
                "purpose": obj["purpose"],
                "subjectClass": obj["subjectClass"],
                "automation": obj["automation"],
                "decisionEffect": obj["decisionEffect"],
                "dataClasses": _require_str_list(
                    obj["dataClasses"], f"{field}[{index}].dataClasses"
                ),
                "legalBasis": obj["legalBasis"],
            }
        )
    return activities


def parse_grants(payload: Any, field: str = "grants") -> list[ConsentGrant]:
    if not isinstance(payload, list):
        raise EngineError("BAD_SHAPE", f"{field!r} must be a list of grants")
    seen: set[str] = set()
    grants: list[ConsentGrant] = []
    for index, raw in enumerate(payload):
        obj = _require_object(raw, f"{field}[{index}]")
        for key in _GRANT_KEYS:
            if key not in obj:
                raise EngineError("MISSING_FIELD", f"{field}[{index}] is missing {key!r}")
        identifier = obj["id"]
        if not isinstance(identifier, str) or not identifier:
            raise EngineError("BAD_SHAPE", f"{field}[{index}].id must be a non-empty string")
        if identifier in seen:
            raise EngineError("DUPLICATE_ID", f"{field}[{index}].id {identifier!r} appears twice")
        seen.add(identifier)
        if obj["automation"] not in AUTOMATION_RANK:
            raise EngineError(
                "BAD_ENUM",
                f"{field}[{index}].automation must be one of {sorted(AUTOMATION_RANK)}",
            )
        if obj["decisionEffect"] not in EFFECT_RANK:
            raise EngineError(
                "BAD_ENUM",
                f"{field}[{index}].decisionEffect must be one of {sorted(EFFECT_RANK)}",
            )
        if obj["legalBasis"] not in LEGAL_BASES:
            raise EngineError(
                "BAD_ENUM", f"{field}[{index}].legalBasis must be one of {sorted(LEGAL_BASES)}"
            )
        if obj["status"] not in {"active", "withdrawn"}:
            raise EngineError("BAD_ENUM", f"{field}[{index}].status must be active or withdrawn")
        grants.append(
            {
                "id": identifier,
                "subjectClass": obj["subjectClass"],
                "purposes": _require_str_list(obj["purposes"], f"{field}[{index}].purposes"),
                "activities": _require_str_list(
                    obj["activities"], f"{field}[{index}].activities"
                ),
                "dataClasses": _require_str_list(
                    obj["dataClasses"], f"{field}[{index}].dataClasses"
                ),
                "legalBasis": obj["legalBasis"],
                "automation": obj["automation"],
                "decisionEffect": obj["decisionEffect"],
                "validFrom": _require_date(obj["validFrom"], f"{field}[{index}].validFrom"),
                "validUntil": _require_date(obj["validUntil"], f"{field}[{index}].validUntil"),
                "status": obj["status"],
            }
        )
    return grants


# ------------------------------------------------------------------ the relation

def _matches(pattern: Any, value: str) -> bool:
    return pattern in ("*", value)


def _axes_match(grant: ConsentGrant, activity: ProcessingActivity) -> bool:
    """The four-axis conjunction (cohort, purpose, activity, basis), ignoring lifecycle.

    Widening any single axis makes this False, which is the point: widening is a new grant.
    """
    if grant["legalBasis"] != activity["legalBasis"]:
        return False
    if not _matches(grant["subjectClass"], activity["subjectClass"]):
        return False
    if "*" not in grant["purposes"] and activity["purpose"] not in grant["purposes"]:
        return False
    if "*" not in grant["activities"] and activity["id"] not in grant["activities"]:
        return False
    return True


def _data_covers(grant: ConsentGrant, activity: ProcessingActivity) -> bool:
    return "*" in grant["dataClasses"] or set(activity["dataClasses"]) <= set(grant["dataClasses"])


def _escalation_ok(grant: ConsentGrant, activity: ProcessingActivity) -> bool:
    """The person accepted at least the level the system now applies."""
    return (
        AUTOMATION_RANK[grant["automation"]] >= AUTOMATION_RANK[activity["automation"]]
        and EFFECT_RANK[grant["decisionEffect"]] >= EFFECT_RANK[activity["decisionEffect"]]
    )


def _in_window(grant: ConsentGrant, as_of: str) -> bool:
    if grant["validFrom"] > as_of:
        return False
    return grant["validUntil"] == "forever" or as_of <= grant["validUntil"]


def blockers_for(
    activity: ProcessingActivity, grants: list[ConsentGrant], as_of: str
) -> list[str]:
    """Every reason this activity is uncovered, most severe first. Empty means covered.

    A single activity can fail on two axes at once — a change that adds a data class *and*
    escalates automation produces two independent obligations. Reporting only one would bury the
    more serious fact, so all of them are returned and the caller derives the single triage
    reason from the head of this list.
    """
    structural = [grant for grant in grants if _axes_match(grant, activity)]
    live = [
        grant
        for grant in structural
        if grant["status"] == "active" and _in_window(grant, as_of)
    ]

    if live:
        # Only meaningful when something is actually in force. With an empty `live` these two
        # checks would be vacuously false and would mask a lifecycle problem as a scope one.
        found: list[str] = []
        if not any(_data_covers(grant, activity) for grant in live):
            found.append(REASON_DATA)
        if not any(_escalation_ok(grant, activity) for grant in live):
            found.append(REASON_ESCALATION)
        if found:
            return sorted(found, key=lambda reason: (-REASON_SEVERITY[reason], reason))
        return []

    # Nothing is in force, so the gap is about the grant's lifecycle or its total absence.
    if any(grant["status"] == "withdrawn" for grant in structural):
        return [REASON_WITHDRAWN]
    if structural:
        return [REASON_EXPIRED]
    return [REASON_NO_GRANT]


def classify_activity(activity: ProcessingActivity, grants: list[ConsentGrant], as_of: str) -> str:
    """Return COVERED, or the single most severe reason the activity is uncovered."""
    found = blockers_for(activity, grants, as_of)
    return found[0] if found else COVERED


# ------------------------------------------------------------------ the edit script

def _classify_change(before: ProcessingActivity, after: ProcessingActivity) -> tuple[str, list[str]]:
    """Name the most severe reason a single activity's change matters. Pure ordering, no model."""
    touched = sorted(
        key
        for key in set(before) | set(after)
        if key != "id" and before.get(key) != after.get(key)
    )
    if EFFECT_RANK[after["decisionEffect"]] > EFFECT_RANK[before["decisionEffect"]]:
        return "effect-escalation", touched
    if AUTOMATION_RANK[after["automation"]] > AUTOMATION_RANK[before["automation"]]:
        return "automation-escalation", touched
    widening = False
    if before["purpose"] != after["purpose"]:
        widening = True
    if before["subjectClass"] != after["subjectClass"]:
        widening = True
    if set(after["dataClasses"]) - set(before["dataClasses"]):
        widening = True
    if before["legalBasis"] != after["legalBasis"]:
        widening = True
    return ("scope-creep" if widening else "benign"), touched


def build_hunks(
    before: list[ProcessingActivity], after: list[ProcessingActivity]
) -> tuple[list[Hunk], int]:
    """The minimal structural edit script between two surfaces.

    Keyed by activity identity, so a change that adds no activity but escalates one is still
    visible — that case is invisible to a diff over identifiers alone.
    """
    before_by_id = {item["id"]: item for item in before}
    after_by_id = {item["id"]: item for item in after}

    hunks: list[Hunk] = []
    for identifier in sorted(set(after_by_id) - set(before_by_id)):
        item = after_by_id[identifier]
        # A new activity on a non-consent basis creates no consent obligation at all.
        klass = "scope-creep" if item["legalBasis"] == "consent" else "benign"
        hunks.append(
            {"op": "add", "id": identifier, "fields": [], "klass": klass, "severity": SEVERITY[klass]}
        )
    for identifier in sorted(set(before_by_id) - set(after_by_id)):
        hunks.append(
            {"op": "remove", "id": identifier, "fields": [], "klass": "benign", "severity": 0}
        )

    unchanged = 0
    for identifier in sorted(set(before_by_id) & set(after_by_id)):
        left = before_by_id[identifier]
        right = after_by_id[identifier]
        if left == right:
            unchanged += 1
            continue
        klass, touched = _classify_change(left, right)
        hunks.append(
            {
                "op": "change",
                "id": identifier,
                "fields": touched,
                "klass": klass,
                "severity": SEVERITY[klass],
            }
        )

    hunks.sort(key=lambda hunk: (-hunk["severity"], hunk["id"], hunk["op"]))
    return hunks, unchanged


def withdrawal_hunks(
    grants_before: list[ConsentGrant], grants_after: list[ConsentGrant], as_of: str
) -> list[Hunk]:
    """Grants that were covering on the before-ledger and no longer are."""
    before_by_id = {grant["id"]: grant for grant in grants_before}
    after_by_id = {grant["id"]: grant for grant in grants_after}
    hunks: list[Hunk] = []
    for identifier in sorted(set(before_by_id) & set(after_by_id)):
        left = before_by_id[identifier]
        right = after_by_id[identifier]
        if _effective(left, as_of) and not _effective(right, as_of):
            hunks.append(
                {
                    "op": "change",
                    "id": identifier,
                    "fields": sorted(
                        key
                        for key in set(left) | set(right)
                        if key != "id" and left.get(key) != right.get(key)
                    ),
                    "klass": "reach-withdrawal",
                    "severity": SEVERITY["reach-withdrawal"],
                }
            )
    return hunks


def _effective(grant: ConsentGrant, as_of: str) -> bool:
    return grant["status"] == "active" and _in_window(grant, as_of)


# ------------------------------------------------------------------ operations

def reach_diff(payload: Any) -> dict[str, Any]:
    """Compare two surfaces against one consent ledger and report what lost its cover.

    `ledgerBefore` is optional; when supplied it additionally reports reach-withdrawal hunks.
    """
    obj = _require_object(payload, "reach_diff input")
    before = parse_activities(obj.get("before"), "before")
    after = parse_activities(obj.get("after"), "after")
    ledger_obj = _require_object(obj.get("ledger"), "ledger")
    grants = parse_grants(ledger_obj.get("grants"), "ledger.grants")
    as_of = obj.get("asOf")
    if not isinstance(as_of, str) or not as_of:
        raise EngineError("BAD_SHAPE", "'asOf' is required and must be an ISO date")

    hunks, unchanged = build_hunks(before, after)

    if "ledgerBefore" in obj and obj["ledgerBefore"] is not None:
        ledger_before_obj = _require_object(obj["ledgerBefore"], "ledgerBefore")
        grants_before = parse_grants(ledger_before_obj.get("grants"), "ledgerBefore.grants")
        hunks.extend(withdrawal_hunks(grants_before, grants, as_of))
        hunks.sort(key=lambda hunk: (-hunk["severity"], hunk["id"], hunk["op"]))

    uncovered: list[UncoveredTuple] = []
    out_of_scope: list[str] = []
    covered = 0
    for activity in sorted(after, key=lambda item: item["id"]):
        if activity["legalBasis"] != "consent":
            out_of_scope.append(activity["id"])
            continue
        blockers = blockers_for(activity, grants, as_of)
        if not blockers:
            covered += 1
            continue
        uncovered.append(
            {
                "activityId": activity["id"],
                "subjectClass": activity["subjectClass"],
                "purpose": activity["purpose"],
                "dataClasses": sorted(activity["dataClasses"]),
                "automation": activity["automation"],
                "decisionEffect": activity["decisionEffect"],
                "legalBasis": activity["legalBasis"],
                "reason": blockers[0],
                "reasonSeverity": REASON_SEVERITY[blockers[0]],
                "blockers": blockers,
            }
        )
    uncovered.sort(key=lambda item: (-item["reasonSeverity"], item["activityId"]))

    consent_total = len(after) - len(out_of_scope)
    by_class: dict[str, int] = {name: 0 for name in HUNK_CLASSES}
    for hunk in hunks:
        by_class[hunk["klass"]] += 1

    return {
        "asOf": as_of,
        "hunks": hunks,
        "uncovered": uncovered,
        "outOfScope": sorted(out_of_scope),
        "coverage": {
            "activities": len(after),
            "consentActivities": consent_total,
            "covered": covered,
            "uncovered": len(uncovered),
            "outOfScope": len(out_of_scope),
            "coverageRatio": round(covered / consent_total, 6) if consent_total else 1.0,
        },
        "stats": {
            "hunks": len(hunks),
            "unchangedActivities": unchanged,
            "byClass": by_class,
            "maxSeverity": max((hunk["severity"] for hunk in hunks), default=0),
            "orphans": len(uncovered),
        },
    }


def validate_surface(payload: Any) -> dict[str, Any]:
    """Static rules that need no before-state: what is wrong with the declaration itself."""
    obj = _require_object(payload, "validate_surface input")
    surface_obj = _require_object(obj.get("surface"), "surface")
    activities = parse_activities(surface_obj.get("activities"), "surface.activities")
    ledger_obj = _require_object(obj.get("ledger"), "ledger")
    grants = parse_grants(ledger_obj.get("grants"), "ledger.grants")

    violations: list[Violation] = []

    for activity in sorted(activities, key=lambda item: item["id"]):
        if (
            activity["decisionEffect"] in {"binding", "dispositive"}
            and activity["automation"] == "automated"
        ):
            violations.append(
                {
                    "rule": "machine-decided-binding-effect",
                    "severity": "high",
                    "subject": activity["id"],
                    "detail": (
                        "a machine decides a binding or dispositive outcome; consent cannot be "
                        "reused from a human-reviewed version of this activity"
                    ),
                }
            )
        if activity["legalBasis"] != "consent" and (
            set(activity["dataClasses"]) & SENSITIVE_DATA_CLASSES
        ):
            sensitive = sorted(set(activity["dataClasses"]) & SENSITIVE_DATA_CLASSES)
            violations.append(
                {
                    "rule": "sensitive-data-without-consent",
                    "severity": "high",
                    "subject": activity["id"],
                    # Joined, not repr'd: this string is shown to a person by both the CLI and the
                    # web app, and Python's list repr would leak into the middle of it.
                    "detail": (
                        f"touches {', '.join(sensitive)} "
                        f"under basis {activity['legalBasis']}"
                    ),
                }
            )
        if not activity["dataClasses"]:
            violations.append(
                {
                    "rule": "undeclared-data-classes",
                    "severity": "medium",
                    "subject": activity["id"],
                    "detail": "no data classes declared, so no grant can be shown to cover it",
                }
            )

    for grant in sorted(grants, key=lambda item: item["id"]):
        wildcard_axes = (
            ("purposes", "wildcard-purpose-grant", grant["purposes"]),
            ("activities", "wildcard-activity-grant", grant["activities"]),
            ("dataClasses", "wildcard-data-grant", grant["dataClasses"]),
        )
        for field, rule, values in wildcard_axes:
            if "*" in values:
                violations.append(
                    {
                        "rule": rule,
                        "severity": "medium",
                        "subject": grant["id"],
                        "detail": (
                            f"{field} contains '*', so this grant authorises more than it names; "
                            "it will sweep in processing nobody asked about"
                        ),
                    }
                )
        if grant["subjectClass"] == "*":
            violations.append(
                {
                    "rule": "wildcard-cohort-grant",
                    "severity": "medium",
                    "subject": grant["id"],
                    "detail": "subjectClass is '*', so this grant covers cohorts it never named",
                }
            )
        if grant["status"] == "active" and grant["validUntil"] != "forever":
            violations.append(
                {
                    "rule": "expiring-grant",
                    "severity": "info",
                    "subject": grant["id"],
                    "detail": f"lapses on {grant['validUntil']}; activities covered by it alone "
                    "will be orphaned on that date",
                }
            )

    order = {"high": 0, "medium": 1, "info": 2}
    violations.sort(key=lambda item: (order[item["severity"]], item["rule"], item["subject"]))
    counts: dict[str, int] = {"high": 0, "medium": 0, "info": 0}
    for violation in violations:
        counts[violation["severity"]] += 1

    return {
        "violations": violations,
        "counts": counts,
        "clean": not violations,
        "checkedActivities": len(activities),
        "checkedGrants": len(grants),
    }
