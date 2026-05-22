"""Map t_order_item.one_category_name (English) to the Chinese 现制/外购 buckets.

The schema probe confirmed one_category_name carries English values for the LKUS
tenant (Drink, Food, Merchandise) — not 现制/外购 as the original spec assumed.
This mapping is the single source of truth and is documented in README.md.
Pending business sign-off — the metric registry flags affected metrics as
source='pipeline-mapping' to make the assumption visible in the UI.
"""

from __future__ import annotations

FRESH_MADE: frozenset[str] = frozenset({"Drink", "Food"})
PURCHASED: frozenset[str] = frozenset({"Merchandise"})

EQUIV_WEIGHT_FRESH = 1.0
EQUIV_WEIGHT_PURCHASED = 0.25


def classify(one_category_name: str | None) -> str | None:
    """Return 'fresh', 'purchased', or None if unmappable."""
    if one_category_name is None:
        return None
    if one_category_name in FRESH_MADE:
        return "fresh"
    if one_category_name in PURCHASED:
        return "purchased"
    return None


def equiv_weight(one_category_name: str | None) -> float:
    """Return the equivalent-product weight for the formula 现制 + 0.25 × 外购."""
    bucket = classify(one_category_name)
    if bucket == "fresh":
        return EQUIV_WEIGHT_FRESH
    if bucket == "purchased":
        return EQUIV_WEIGHT_PURCHASED
    return 0.0
