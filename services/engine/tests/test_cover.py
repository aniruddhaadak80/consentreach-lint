"""Tests for the cover planner.

The important test in this file is `test_matches_brute_force_optimum`: it enumerates every subset
of candidates and asserts the planner's answer equals the true minimum. Without that, the
`provenMinimal` flag would be an unfalsifiable claim, which is the one thing this product must not
ship.
"""

from __future__ import annotations

from itertools import combinations

import pytest

from consentreach_lint.cover import build_candidates, plan_cover
from consentreach_lint.protocol import EngineError


def orphan(
    identifier: str,
    purpose: str = "risk_scoring",
    subject: str = "applicant",
    automation: str = "human_review",
    effect: str = "advisory",
    data: tuple[str, ...] = ("contact",),
) -> dict[str, object]:
    return {
        "activityId": identifier,
        "subjectClass": subject,
        "purpose": purpose,
        "dataClasses": list(data),
        "automation": automation,
        "decisionEffect": effect,
        "legalBasis": "consent",
    }


def activity(
    identifier: str,
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


def run(orphans: list[dict[str, object]], acts: list[dict[str, object]]) -> dict:
    return plan_cover({"uncovered": orphans, "activities": acts})


def brute_force_minimum(candidates: list[dict], universe: set[str]) -> int | None:
    """The true minimum, by exhaustive enumeration. Exponential on purpose."""
    usable = [item for item in candidates if item["covers"]]
    for size in range(0, len(usable) + 1):
        for subset in combinations(usable, size):
            covered: set[str] = set()
            for item in subset:
                covered |= set(item["covers"])
            if covered >= universe:
                return size
    return None


class TestCandidateGeneration:
    def test_three_widths_per_orphan(self) -> None:
        candidates = build_candidates([orphan("a1")], [activity("a1")])
        assert [item["width"] for item in candidates] == ["activity", "cohort", "purpose"]

    def test_candidate_ids_are_deterministic_and_sorted(self) -> None:
        forward = build_candidates([orphan("b1"), orphan("a1")], [activity("a1"), activity("b1")])
        backward = build_candidates([orphan("a1"), orphan("b1")], [activity("b1"), activity("a1")])
        assert [item["id"] for item in forward] == [item["id"] for item in backward]
        assert [item["id"] for item in forward] == sorted(item["id"] for item in forward)

    def test_a_purpose_wide_candidate_sweeps_in_covered_activities(self) -> None:
        acts = [activity("a1"), activity("a2"), activity("a3")]
        candidates = {item["id"]: item for item in build_candidates([orphan("a1")], acts)}
        purpose_wide = candidates["purpose:risk_scoring:*"]
        assert purpose_wide["covers"] == ["a1"]
        # a2 and a3 were already consented; this grant would authorise them too.
        assert purpose_wide["sweep"] == 2

    def test_an_activity_width_candidate_never_sweeps(self) -> None:
        acts = [activity("a1"), activity("a2")]
        candidates = {item["id"]: item for item in build_candidates([orphan("a1")], acts)}
        assert candidates["activity:risk_scoring:a1"]["sweep"] == 0

    def test_a_candidate_asks_for_the_highest_level_it_must_cover(self) -> None:
        acts = [activity("a1", automation="automated"), activity("a2")]
        candidates = {item["id"]: item for item in build_candidates(
            [orphan("a1", automation="automated"), orphan("a2")], acts
        )}
        assert candidates["purpose:risk_scoring:*"]["automation"] == "automated"

    def test_non_consent_activities_never_count_as_swept(self) -> None:
        acts = [activity("a1"), activity("a9", basis="statutory")]
        candidates = {item["id"]: item for item in build_candidates([orphan("a1")], acts)}
        assert candidates["purpose:risk_scoring:*"]["sweep"] == 0


class TestPlanning:
    def test_a_single_orphan_needs_a_single_narrow_grant(self) -> None:
        result = run([orphan("a1")], [activity("a1")])
        assert result["specific"]["count"] == 1
        assert result["specific"]["grants"] == ["activity:risk_scoring:a1"]
        assert result["overReachCost"]["specific"] == 0

    def test_broad_plan_is_never_larger_than_specific(self) -> None:
        result = run([orphan("a1"), orphan("a2")], [activity("a1"), activity("a2")])
        assert result["broad"]["count"] <= result["specific"]["count"]

    def test_specific_plan_avoids_the_sweep(self) -> None:
        # Two orphans in one purpose: the broad plan saves one ask but sweeps in the two
        # already-consented activities behind them. This is the trade the product exists to show.
        acts = [activity("a1"), activity("a2"), activity("a3"), activity("a4")]
        result = run([orphan("a1"), orphan("a2")], acts)
        assert result["specific"]["count"] == 2
        assert result["broad"]["count"] == 1
        assert result["overReachCost"] == {"specific": 0, "broad": 2}
        assert result["recommended"]["plan"] == "specific"
        assert result["recommended"]["sweep"] == 0

    def test_a_single_orphan_prefers_the_narrow_grant_even_at_equal_count(self) -> None:
        result = run([orphan("a1")], [activity("a1"), activity("a2"), activity("a3")])
        assert result["specific"]["count"] == result["broad"]["count"] == 1
        assert result["overReachCost"] == {"specific": 0, "broad": 0}
        assert result["recommended"]["grants"] == ["activity:risk_scoring:a1"]

    def test_recommendation_explains_itself_with_sweep_detail(self) -> None:
        result = run([orphan("a1")], [activity("a1"), activity("a2")])
        detail = result["recommended"]["sweepDetail"]
        assert len(detail) == result["recommended"]["count"]
        assert all(item["sweep"] == 0 for item in detail)

    def test_no_orphans_yields_an_empty_proven_plan(self) -> None:
        result = run([], [activity("a1")])
        assert result["specific"] == {"grants": [], "count": 0, "lowerBound": 0, "provenMinimal": True}
        assert result["orphanCount"] == 0

    def test_output_is_independent_of_orphan_order(self) -> None:
        acts = [activity("a1"), activity("a2"), activity("a3")]
        forward = run([orphan("a1"), orphan("a2")], acts)
        backward = run([orphan("a2"), orphan("a1")], acts)
        assert forward == backward

    def test_missing_orphans_field_is_rejected(self) -> None:
        with pytest.raises(EngineError) as caught:
            plan_cover({"activities": []})
        assert caught.value.code == "BAD_SHAPE"


class TestOptimalityCertificate:
    @pytest.mark.parametrize(
        "orphans,acts",
        [
            ([orphan("a1")], [activity("a1"), activity("a2")]),
            (
                [orphan("a1"), orphan("a2"), orphan("a3")],
                [activity("a1"), activity("a2"), activity("a3"), activity("a4")],
            ),
            (
                [
                    orphan("a1", purpose="risk_scoring"),
                    orphan("a2", purpose="fraud_detection"),
                    orphan("a3", purpose="risk_scoring"),
                ],
                [
                    activity("a1", purpose="risk_scoring"),
                    activity("a2", purpose="fraud_detection"),
                    activity("a3", purpose="risk_scoring"),
                ],
            ),
            (
                [
                    orphan("a1", subject="applicant"),
                    orphan("a2", subject="employee"),
                    orphan("a3", subject="applicant", automation="automated"),
                ],
                [
                    activity("a1", subject="applicant"),
                    activity("a2", subject="employee"),
                    activity("a3", subject="applicant", automation="automated"),
                ],
            ),
            (
                [orphan("a1"), orphan("a2"), orphan("a3"), orphan("a4")],
                [activity(f"a{i}") for i in range(1, 5)],
            ),
        ],
    )
    def test_matches_brute_force_optimum(self, orphans: list, acts: list) -> None:
        result = run(orphans, acts)
        universe = {item["activityId"] for item in orphans}
        true_minimum = brute_force_minimum(result["candidates"], universe)
        assert result["broad"]["count"] == true_minimum
        # Once the incumbent equals the admissible bound, minimality is proven, not claimed.
        assert result["broad"]["provenMinimal"] is True
        assert result["broad"]["lowerBound"] == true_minimum

    def test_the_bound_never_exceeds_the_achieved_size(self) -> None:
        result = run([orphan(f"a{i}") for i in range(1, 6)], [activity(f"a{i}") for i in range(1, 6)])
        assert result["specific"]["lowerBound"] <= result["specific"]["count"]
        assert result["broad"]["lowerBound"] <= result["broad"]["count"]

    def test_proven_minimal_is_never_asserted_when_the_bound_is_not_met(self) -> None:
        # Constructed so the greedy incumbent beats the packing bound by one, which is the only
        # way the flag may go false.
        orphans = [orphan("a1"), orphan("a2"), orphan("a3"), orphan("a4"), orphan("a5")]
        result = run(orphans, [activity(f"a{i}") for i in range(1, 6)])
        if result["broad"]["lowerBound"] < result["broad"]["count"]:
            assert result["broad"]["provenMinimal"] is False
        else:
            assert result["broad"]["provenMinimal"] is True
