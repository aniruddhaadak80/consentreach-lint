"""Tests for the reach algebra.

These assert the properties the product's credibility rests on: that cover is a conjunction over
four axes, that escalation invalidates cover on its own, that reasons are the actionable one, and
that every report is replayable for a fixed `asOf`.
"""

from __future__ import annotations

import pytest

from consentreach_lint.reach import (
    REASON_DATA,
    REASON_ESCALATION,
    REASON_EXPIRED,
    REASON_NO_GRANT,
    REASON_WITHDRAWN,
    blockers_for,
    build_hunks,
    classify_activity,
    reach_diff,
    validate_surface,
)
from consentreach_lint.protocol import EngineError


def activity(
    identifier: str = "a1",
    purpose: str = "risk_scoring",
    subject: str = "applicant",
    automation: str = "human_review",
    effect: str = "advisory",
    data: tuple[str, ...] = ("contact",),
    basis: str = "consent",
) -> dict[str, object]:
    return {
        "id": identifier,
        "purpose": purpose,
        "subjectClass": subject,
        "automation": automation,
        "decisionEffect": effect,
        "dataClasses": list(data),
        "legalBasis": basis,
    }


def grant(
    identifier: str = "g1",
    subject: str = "applicant",
    purposes: tuple[str, ...] = ("risk_scoring",),
    acts: tuple[str, ...] = ("a1",),
    data: tuple[str, ...] = ("contact",),
    basis: str = "consent",
    automation: str = "human_review",
    effect: str = "advisory",
    valid_from: str = "2026-01-01",
    valid_until: str = "forever",
    status: str = "active",
) -> dict[str, object]:
    return {
        "id": identifier,
        "subjectClass": subject,
        "purposes": list(purposes),
        "activities": list(acts),
        "dataClasses": list(data),
        "legalBasis": basis,
        "automation": automation,
        "decisionEffect": effect,
        "validFrom": valid_from,
        "validUntil": valid_until,
        "status": status,
    }


def surface(*activities: dict[str, object]) -> list[dict[str, object]]:
    return list(activities)


def run_diff(
    before: list[dict[str, object]],
    after: list[dict[str, object]],
    grants: list[dict[str, object]],
    as_of: str = "2026-06-01",
    **extra: object,
) -> dict:
    return reach_diff(
        {"before": before, "after": after, "ledger": {"grants": grants}, "asOf": as_of, **extra}
    )


class TestCoverage:
    def test_a_matching_grant_covers(self) -> None:
        assert classify_activity(activity(), [grant()], "2026-06-01") == "covered"

    def test_purpose_must_match(self) -> None:
        assert classify_activity(activity(), [grant(purposes=("marketing",))], "2026-06-01") == (
            REASON_NO_GRANT
        )

    def test_cohort_must_match(self) -> None:
        assert classify_activity(activity(), [grant(subject="employee")], "2026-06-01") == (
            REASON_NO_GRANT
        )

    def test_a_narrowed_purpose_list_still_covers_when_included(self) -> None:
        assert classify_activity(
            activity(), [grant(purposes=("marketing", "risk_scoring"))], "2026-06-01"
        ) == "covered"

    def test_legal_basis_must_match(self) -> None:
        assert classify_activity(activity(), [grant(basis="contract")], "2026-06-01") == (
            REASON_NO_GRANT
        )

    def test_data_classes_must_cover_the_activity(self) -> None:
        result = classify_activity(activity(data=("contact", "biometric")), [grant()], "2026-06-01")
        assert result == REASON_DATA

    def test_wildcards_cover_every_axis(self) -> None:
        everything = grant(subject="*", purposes=("*",), acts=("*",), data=("*",))
        assert classify_activity(activity(), [everything], "2026-06-01") == "covered"


class TestEscalation:
    def test_automation_escalation_invalidates_cover(self) -> None:
        # The person accepted human review; the system now decides automatically.
        result = classify_activity(
            activity(automation="automated"), [grant(automation="human_review")], "2026-06-01"
        )
        assert result == REASON_ESCALATION

    def test_effect_escalation_invalidates_cover(self) -> None:
        result = classify_activity(
            activity(effect="dispositive"), [grant(effect="advisory")], "2026-06-01"
        )
        assert result == REASON_ESCALATION

    def test_a_grant_that_accepted_the_higher_level_covers(self) -> None:
        result = classify_activity(
            activity(automation="automated", effect="binding"),
            [grant(automation="automated", effect="binding")],
            "2026-06-01",
        )
        assert result == "covered"

    def test_de_escalation_needs_no_reconsent(self) -> None:
        result = classify_activity(
            activity(automation="human_review"), [grant(automation="automated")], "2026-06-01"
        )
        assert result == "covered"


class TestLifecycle:
    def test_expired_grant_is_reported_as_expired(self) -> None:
        result = classify_activity(
            activity(), [grant(valid_until="2026-05-01")], "2026-06-01"
        )
        assert result == REASON_EXPIRED

    def test_withdrawn_grant_is_reported_as_withdrawn(self) -> None:
        assert classify_activity(activity(), [grant(status="withdrawn")], "2026-06-01") == (
            REASON_WITHDRAWN
        )

    def test_a_withdrawal_is_preferred_over_an_expiry_as_the_reason(self) -> None:
        result = classify_activity(
            activity(), [grant(valid_until="2026-05-01"), grant("g2", status="withdrawn")],
            "2026-06-01",
        )
        assert result == REASON_WITHDRAWN

    def test_the_same_report_appears_at_a_date_before_expiry(self) -> None:
        assert classify_activity(activity(), [grant(valid_until="2026-05-01")], "2026-04-01") == (
            "covered"
        )


class TestBlockers:
    def test_a_single_failure_yields_one_blocker(self) -> None:
        assert blockers_for(activity(), [grant()], "2026-06-01") == []

    def test_two_independent_failures_are_both_reported(self) -> None:
        # New data class AND escalated automation: two obligations, not one.
        result = blockers_for(
            activity(automation="automated", data=("contact", "biometric")),
            [grant(automation="human_review")],
            "2026-06-01",
        )
        assert result == [REASON_ESCALATION, REASON_DATA]

    def test_the_head_is_the_most_severe(self) -> None:
        assert classify_activity(
            activity(automation="automated", data=("contact", "biometric")),
            [grant(automation="human_review")],
            "2026-06-01",
        ) == REASON_ESCALATION

    def test_a_live_grant_beats_a_lapsed_one_in_the_reason(self) -> None:
        # g-1002 is active forever but too short; g-1006 lapsed. The actionable reason is the
        # live grant's shortfall, not the expired one.
        result = blockers_for(
            activity(automation="automated", data=("contact", "biometric")),
            [
                grant("g-1002", automation="human_review"),
                grant("g-1006", valid_until="2026-03-31"),
            ],
            "2026-06-01",
        )
        assert result == [REASON_ESCALATION, REASON_DATA]

    def test_lifecycle_is_only_reported_when_nothing_is_in_force(self) -> None:
        assert blockers_for(activity(), [grant(valid_until="2026-05-01")], "2026-06-01") == [
            REASON_EXPIRED
        ]


class TestHunks:
    def test_an_escalation_is_visible_without_any_added_activity(self) -> None:
        hunks, unchanged = build_hunks(
            surface(activity()), surface(activity(automation="automated"))
        )
        assert [hunk["klass"] for hunk in hunks] == ["automation-escalation"]
        assert hunks[0]["op"] == "change"
        assert unchanged == 0

    def test_effect_escalation_outranks_automation_escalation(self) -> None:
        hunks, _ = build_hunks(
            surface(activity(automation="human_review", effect="advisory")),
            surface(activity(automation="automated", effect="dispositive")),
        )
        assert hunks[0]["klass"] == "effect-escalation"

    def test_a_new_consent_activity_is_scope_creep(self) -> None:
        hunks, _ = build_hunks(surface(), surface(activity("a1")))
        assert hunks[0]["klass"] == "scope-creep"

    def test_a_new_non_consent_activity_is_benign(self) -> None:
        hunks, _ = build_hunks(surface(), surface(activity("a1", basis="statutory")))
        assert hunks[0]["klass"] == "benign"

    def test_removal_is_benign(self) -> None:
        hunks, _ = build_hunks(surface(activity()), surface())
        assert hunks[0] == {"op": "remove", "id": "a1", "fields": [], "klass": "benign", "severity": 0}

    def test_widening_data_classes_is_scope_creep(self) -> None:
        hunks, _ = build_hunks(
            surface(activity(data=("contact",))), surface(activity(data=("contact", "biometric")))
        )
        assert hunks[0]["klass"] == "scope-creep"
        assert hunks[0]["fields"] == ["dataClasses"]

    def test_hunks_are_ordered_by_severity_then_id(self) -> None:
        hunks, _ = build_hunks(
            surface(activity("z1"), activity("a1")),
            surface(activity("z1", automation="automated"), activity("a1", automation="automated")),
        )
        assert [hunk["id"] for hunk in hunks] == ["a1", "z1"]


class TestReachDiff:
    def test_reports_coverage_ratio(self) -> None:
        result = run_diff(
            surface(activity("a1")), surface(activity("a1"), activity("a2")), [grant(acts=("a1",))]
        )
        assert result["coverage"]["consentActivities"] == 2
        assert result["coverage"]["covered"] == 1
        assert result["coverage"]["uncovered"] == 1
        assert result["coverage"]["coverageRatio"] == 0.5

    def test_non_consent_activities_are_out_of_scope_not_orphans(self) -> None:
        result = run_diff(
            surface(), surface(activity("a1", basis="statutory")), [grant()]
        )
        assert result["outOfScope"] == ["a1"]
        assert result["uncovered"] == []

    def test_uncovered_is_sorted_by_severity_then_id(self) -> None:
        result = run_diff(
            surface(),
            surface(activity("b1"), activity("a1")),
            [],
        )
        assert [item["activityId"] for item in result["uncovered"]] == ["a1", "b1"]

    def test_orphans_carry_an_actionable_reason(self) -> None:
        result = run_diff(surface(), surface(activity("a1")), [])
        assert result["uncovered"][0]["reason"] == REASON_NO_GRANT
        assert result["uncovered"][0]["reasonSeverity"] > 0

    def test_orphans_carry_every_blocker(self) -> None:
        result = run_diff(
            surface(),
            surface(activity("a1", automation="automated", data=("contact", "biometric"))),
            [grant(automation="human_review")],
        )
        assert result["uncovered"][0]["blockers"] == [REASON_ESCALATION, REASON_DATA]
        assert result["uncovered"][0]["reasonSeverity"] == 100

    def test_reach_withdrawal_is_reported_when_the_ledger_is_supplied(self) -> None:
        result = run_diff(
            surface(activity()),
            surface(activity()),
            [grant("g1", status="withdrawn")],
            ledgerBefore={"grants": [grant("g1")]},
        )
        assert [hunk["klass"] for hunk in result["hunks"]] == ["reach-withdrawal"]
        assert result["uncovered"][0]["reason"] == REASON_WITHDRAWN

    def test_without_the_before_ledger_there_is_no_withdrawal_hunk(self) -> None:
        result = run_diff(surface(activity()), surface(activity()), [grant("g1", status="withdrawn")])
        assert result["hunks"] == []

    def test_as_of_is_required(self) -> None:
        with pytest.raises(EngineError) as caught:
            reach_diff({"before": [], "after": [], "ledger": {"grants": []}})
        assert caught.value.code == "BAD_SHAPE"

    def test_a_duplicate_activity_id_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            run_diff(surface(), surface(activity("a1"), activity("a1")), [])
        assert caught.value.code == "DUPLICATE_ID"

    def test_an_unknown_automation_level_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            run_diff(surface(), surface(activity(automation="vibes")), [])
        assert caught.value.code == "BAD_ENUM"

    def test_output_is_independent_of_input_order(self) -> None:
        forward = run_diff(
            surface(activity("a1"), activity("a2")),
            surface(activity("a2"), activity("a1")),
            [grant("g1", acts=("a1",)), grant("g2", acts=("a2",))],
        )
        backward = run_diff(
            surface(activity("a2"), activity("a1")),
            surface(activity("a1"), activity("a2")),
            [grant("g2", acts=("a2",)), grant("g1", acts=("a1",))],
        )
        assert forward == backward


class TestValidateSurface:
    def test_a_clean_declaration_has_no_violations(self) -> None:
        result = validate_surface(
            {"surface": {"activities": surface(activity())}, "ledger": {"grants": [grant()]}}
        )
        assert result["clean"] is True
        assert result["violations"] == []

    def test_a_machine_decided_binding_effect_is_high(self) -> None:
        result = validate_surface(
            {
                "surface": {"activities": surface(activity(automation="automated", effect="binding"))},
                "ledger": {"grants": []},
            }
        )
        rules = [violation["rule"] for violation in result["violations"]]
        assert "machine-decided-binding-effect" in rules
        assert result["counts"]["high"] == 1

    def test_sensitive_data_on_a_non_consent_basis_is_high(self) -> None:
        result = validate_surface(
            {
                "surface": {"activities": surface(activity(data=("health",), basis="legitimate_interest"))},
                "ledger": {"grants": []},
            }
        )
        assert "sensitive-data-without-consent" in [v["rule"] for v in result["violations"]]

    def test_a_wildcard_grant_is_reported_with_its_sweep_risk(self) -> None:
        result = validate_surface(
            {
                "surface": {"activities": surface(activity())},
                "ledger": {"grants": [grant(acts=("*",))]},
            }
        )
        rules = [violation["rule"] for violation in result["violations"]]
        assert "wildcard-activity-grant" in rules

    def test_an_expiring_grant_is_informational(self) -> None:
        result = validate_surface(
            {
                "surface": {"activities": surface(activity())},
                "ledger": {"grants": [grant(valid_until="2026-05-01")]},
            }
        )
        assert result["counts"]["info"] == 1

    def test_violations_are_ordered_by_severity(self) -> None:
        result = validate_surface(
            {
                "surface": {"activities": surface(activity(automation="automated", effect="binding"))},
                "ledger": {"grants": [grant(acts=("*",), valid_until="2026-05-01")]},
            }
        )
        severities = [violation["severity"] for violation in result["violations"]]
        assert severities == sorted(severities, key=lambda s: {"high": 0, "medium": 1, "info": 2}[s])
