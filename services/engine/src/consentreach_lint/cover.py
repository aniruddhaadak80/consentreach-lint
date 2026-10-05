"""Minimum re-consent cover, with a certificate instead of a claim.

Set cover is NP-hard, so this module never *asserts* optimality. It computes an achievable
solution, an admissible lower bound by disjoint greedy packing, and reports `provenMinimal` only
when the two meet. When they do not meet it reports the gap and sets the flag false — reporting
a bound as an optimum is the exact failure mode this product exists to eliminate, so the engine
does not commit it in its own house.

The second thing this module exists to make visible: the minimum number of grants is not the
right objective. A grant scoped `activities: ["*"]` covers everything in one ask and simultaneously
authorises every processing tuple it matches. So each candidate carries a `sweep` — the number of
after-surface activities it would newly authorise beyond the orphans it is required to cover — and
the module reports a narrow plan and a broad plan side by side.
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from .protocol import EngineError
from .reach import (
    AUTOMATION_RANK,
    EFFECT_RANK,
    ProcessingActivity,
    _require_object,
    parse_activities,
)

# Guard so a pathological instance cannot hang a CI job. Exceeding it downgrades the claim.
NODE_BUDGET: Final[int] = 200_000

WIDTH_ACTIVITY: Final[str] = "activity"
WIDTH_COHORT: Final[str] = "cohort"
WIDTH_PURPOSE: Final[str] = "purpose"


class Candidate(TypedDict):
    id: str
    width: str
    purpose: str
    subjectClass: str
    activities: list[str]
    dataClasses: list[str]
    automation: str
    decisionEffect: str
    covers: list[str]
    sweep: int


class Solution(TypedDict):
    grants: list[str]
    count: int
    lowerBound: int
    provenMinimal: bool


def _max_rank(levels: list[str], rank: dict[str, int]) -> str:
    return max(sorted(set(levels)), key=lambda level: rank[level])


def _covers_activity(candidate: dict[str, Any], activity: ProcessingActivity) -> bool:
    """Would this candidate grant, if issued, authorise this activity?"""
    if activity["legalBasis"] != "consent":
        return False
    if candidate["purpose"] != activity["purpose"]:
        return False
    if candidate["subjectClass"] not in ("*", activity["subjectClass"]):
        return False
    if "*" not in candidate["activities"] and activity["id"] not in candidate["activities"]:
        return False
    if not set(activity["dataClasses"]) <= set(candidate["dataClasses"]):
        return False
    # The candidate requests the highest level it must cover, so this holds for every orphan it
    # was built from; it is re-checked anyway, because a grant that under-asks must not sweep.
    return (
        EFFECT_RANK[candidate["decisionEffect"]] >= EFFECT_RANK[activity["decisionEffect"]]
        and AUTOMATION_RANK[candidate["automation"]] >= AUTOMATION_RANK[activity["automation"]]
    )


def _parse_uncovered(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list):
        raise EngineError("BAD_SHAPE", "'uncovered' must be a list of orphan tuples")
    required = (
        "activityId",
        "subjectClass",
        "purpose",
        "dataClasses",
        "automation",
        "decisionEffect",
        "legalBasis",
    )
    orphans: list[dict[str, Any]] = []
    for index, raw in enumerate(payload):
        obj = _require_object(raw, f"uncovered[{index}]")
        for key in required:
            if key not in obj:
                raise EngineError("MISSING_FIELD", f"uncovered[{index}] is missing {key!r}")
        if not isinstance(obj["dataClasses"], list):
            raise EngineError("BAD_SHAPE", f"uncovered[{index}].dataClasses must be a list")
        orphans.append(obj)
    # Deterministic order so the generated candidate ids never depend on input order.
    orphans.sort(key=lambda item: str(item["activityId"]))
    return orphans


def build_candidates(
    orphans: list[dict[str, Any]], activities: list[ProcessingActivity]
) -> list[Candidate]:
    """Three scope widths per purpose, deduplicated and deterministically ordered."""
    consent_activities = sorted(
        (item for item in activities if item["legalBasis"] == "consent"),
        key=lambda item: item["id"],
    )

    groups: dict[tuple[str, str, str], list[dict[str, Any]]] = {}
    for orphan in orphans:
        activity_id = str(orphan["activityId"])
        key = (str(orphan["purpose"]), WIDTH_ACTIVITY, activity_id)
        groups.setdefault(key, []).append(orphan)
        key = (str(orphan["purpose"]), WIDTH_COHORT, str(orphan["subjectClass"]))
        groups.setdefault(key, []).append(orphan)
        key = (str(orphan["purpose"]), WIDTH_PURPOSE, "*")
        groups.setdefault(key, []).append(orphan)

    candidates: list[Candidate] = []
    for (purpose, width, selector) in sorted(groups):
        members = groups[(purpose, width, selector)]
        covered_ids = sorted({str(member["activityId"]) for member in members})
        data_classes = sorted({name for member in members for name in member["dataClasses"]})
        subject_class = "*" if width == WIDTH_PURPOSE else str(members[0]["subjectClass"])
        activity_scope = ["*"] if width != WIDTH_ACTIVITY else [selector]
        automation = _max_rank([str(member["automation"]) for member in members], AUTOMATION_RANK)
        decision_effect = _max_rank(
            [str(member["decisionEffect"]) for member in members], EFFECT_RANK
        )

        candidate: dict[str, Any] = {
            "id": f"{width}:{purpose}:{selector}",
            "width": width,
            "purpose": purpose,
            "subjectClass": subject_class,
            "activities": activity_scope,
            "dataClasses": data_classes,
            "automation": automation,
            "decisionEffect": decision_effect,
        }
        authorised = [
            activity["id"] for activity in consent_activities if _covers_activity(candidate, activity)
        ]
        candidate["covers"] = covered_ids
        candidate["sweep"] = max(0, len(authorised) - len(covered_ids))
        candidates.append(candidate)  # type: ignore[arg-type]

    candidates.sort(key=lambda item: item["id"])
    return candidates


def _greedy_incumbent(
    cover: dict[str, frozenset[str]], uncovered: frozenset[str], ordered: list[str]
) -> list[str]:
    """A valid cover found greedily. Only used as the starting incumbent for the search."""
    chosen: list[str] = []
    remaining = set(uncovered)
    while remaining:
        best_id: str | None = None
        best_gain = 0
        for candidate_id in ordered:
            gain = len(cover[candidate_id] & remaining)
            if gain > best_gain:
                best_gain = gain
                best_id = candidate_id
        if best_id is None:  # pragma: no cover - guarded by build_candidates totality
            return []
        chosen.append(best_id)
        remaining -= cover[best_id]
    return chosen


def _packing_lower_bound(cover: dict[str, frozenset[str]], uncovered: frozenset[str]) -> int:
    """An admissible lower bound: greedily pick pairwise-disjoint cover demands."""
    remaining = set(uncovered)
    bound = 0
    while remaining:
        # The element covered by the fewest candidates forces the most constrained choice.
        element = min(
            remaining,
            key=lambda item: (
                sum(1 for cid in sorted(cover) if item in cover[cid]),
                item,
            ),
        )
        bound += 1
        for candidate_id in sorted(cover):
            if element in cover[candidate_id]:
                remaining -= cover[candidate_id]
    return bound


def _exact_cover(
    candidates: list[Candidate], allowed_widths: tuple[str, ...]
) -> Solution:
    """Exact minimum cover over the allowed widths, branch and bound with a node budget."""
    usable = [item for item in candidates if item["width"] in allowed_widths]
    ordered = sorted(item["id"] for item in usable)
    cover = {item["id"]: frozenset(item["covers"]) for item in usable}
    universe = frozenset().union(*cover.values()) if cover else frozenset()
    if not universe:
        return {"grants": [], "count": 0, "lowerBound": 0, "provenMinimal": True}

    global_bound = _packing_lower_bound(cover, universe)
    best = _greedy_incumbent(cover, universe, ordered)
    best_size = len(best)

    nodes = 0
    exhausted = True

    def search(remaining: frozenset[str], chosen: tuple[str, ...]) -> None:
        nonlocal best, best_size, nodes, exhausted
        if not remaining:
            if len(chosen) < best_size:
                best, best_size = list(chosen), len(chosen)
            return
        nodes += 1
        if nodes > NODE_BUDGET:
            exhausted = False
            return
        # Admissible pruning: this branch cannot beat the incumbent even at its best.
        if len(chosen) + _packing_lower_bound(cover, remaining) >= best_size:
            return
        element = min(
            remaining,
            key=lambda item: (
                sum(1 for cid in ordered if item in cover[cid]),
                item,
            ),
        )
        for candidate_id in ordered:
            if element not in cover[candidate_id]:
                continue
            if candidate_id in chosen:
                continue
            search(remaining - cover[candidate_id], (*chosen, candidate_id))

    search(universe, ())

    proven = best_size == global_bound and exhausted
    return {
        "grants": sorted(best),
        "count": best_size,
        "lowerBound": global_bound,
        "provenMinimal": proven,
    }


def plan_cover(payload: Any) -> dict[str, Any]:
    """Plan the re-consent ask, narrowly and broadly, and price the over-reach of each."""
    obj = _require_object(payload, "plan_cover input")
    orphans = _parse_uncovered(obj.get("uncovered"))
    activities = parse_activities(obj.get("activities"), "activities")
    candidates = build_candidates(orphans, activities)

    specific = _exact_cover(candidates, (WIDTH_ACTIVITY,))
    broad = _exact_cover(candidates, (WIDTH_ACTIVITY, WIDTH_COHORT, WIDTH_PURPOSE))

    sweep_by_id = {item["id"]: item["sweep"] for item in candidates}

    def total_sweep(solution: Solution) -> int:
        return sum(sweep_by_id[grant] for grant in solution["grants"] if grant in sweep_by_id)

    # The product's position: over-reach is a harm to a third party, an extra ask is a cost to
    # the team. So sweep is compared first, and only then the number of asks.
    recommended_plan = "specific"
    chosen: Solution = specific
    if (total_sweep(specific), specific["count"]) > (total_sweep(broad), broad["count"]):
        recommended_plan = "broad"
        chosen = broad

    return {
        "orphanCount": len(orphans),
        "candidates": candidates,
        "specific": specific,
        "broad": broad,
        "overReachCost": {
            "specific": total_sweep(specific),
            "broad": total_sweep(broad),
        },
        "recommended": {
            "plan": recommended_plan,
            "grants": chosen["grants"],
            "count": chosen["count"],
            "lowerBound": chosen["lowerBound"],
            "provenMinimal": chosen["provenMinimal"],
            "sweep": total_sweep(chosen),
            "sweepDetail": [
                {
                    "grant": grant,
                    "covers": next(
                        (item["covers"] for item in candidates if item["id"] == grant), []
                    ),
                    "sweep": sweep_by_id[grant],
                }
                for grant in chosen["grants"]
            ],
        },
        "sweepById": sweep_by_id,
    }
