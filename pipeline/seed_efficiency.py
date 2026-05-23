#!/usr/bin/env python3
"""Generate a realistic seed efficiency.json.

The dashboard needs to render fully before the production pipeline is wired,
so this script produces a believable 40-day × 12-store × 48-slot dataset.
Stays deterministic (seeded RNG) so the UI looks the same across runs.

Run: python3 pipeline/seed_efficiency.py
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from config.settings import (
    BACKLOG_THRESHOLD_MIN,
    DAILY_STALE_THRESHOLD_MIN,
    RETENTION_DAYS,
)
from config.store_geography import STORES, build_hierarchy

# 48 half-hour slots
SLOTS = [f"{h:02d}:{m:02d}" for h in range(24) for m in (0, 30)]


def _slot_intensity(slot: str) -> float:
    """Two-peak daily curve: morning rush (07–10) and lunch (11–14)."""
    h, m = (int(s) for s in slot.split(":"))
    t = h + m / 60.0
    if 6.5 <= t < 10.5:
        return 1.0 - abs(t - 8.5) * 0.4          # peak 8:30
    if 10.5 <= t < 14.5:
        return 0.9 - abs(t - 12.5) * 0.35        # peak 12:30
    if 14.5 <= t < 19.0:
        return 0.45 - (t - 14.5) * 0.05          # gentle afternoon
    if 6.0 <= t < 6.5 or 19.0 <= t < 20.0:
        return 0.25
    return 0.05  # closed-ish hours


def _store_speed_factor(shop_number: str) -> float:
    """Each store has a stable speed offset — some are faster, some slower."""
    rng = random.Random(shop_number)
    return rng.uniform(0.85, 1.20)


def _us_eastern_today():
    """Return today's date in US/Eastern — same convention as the production collector."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("US/Eastern")).date()
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def _build_payload() -> dict[str, Any]:
    rng = random.Random("luckin-efficiency-seed")

    today_date = _us_eastern_today()
    retained_start = today_date - timedelta(days=RETENTION_DAYS - 1)

    hierarchy = build_hierarchy()
    daily_rows = []
    interval_rows = []

    for offset in range(RETENTION_DAYS):
        d = retained_start + timedelta(days=offset)
        iso_date = d.isoformat()
        # Most stores operate every day. Pick a couple to be non-operating on this date occasionally.
        nonop = set()
        if rng.random() < 0.18:
            nonop = {STORES[rng.randrange(len(STORES))].shop_number}

        for s in STORES:
            speed = _store_speed_factor(s.shop_number)
            if s.shop_number in nonop:
                daily_rows.append(
                    {
                        "date": iso_date,
                        "shopNumber": s.shop_number,
                        "operatingToday": False,
                        "totalOrders": 0,
                        "completedOrders": 0,
                        "backlogOrders": 0,
                        "responseSecondsSum": 0,
                        "responseOrdersCount": 0,
                        "makeSecondsSum": 0,
                        "equivProductsMadeSum": 0.0,
                        "freshMadeCount": 0,
                        "purchasedCount": 0,
                    }
                )
                # Skip interval rows entirely for non-operating days.
                continue

            day_total_orders = 0
            day_completed_orders = 0
            day_backlog_orders = 0
            day_resp_sec_sum = 0
            day_resp_orders = 0
            day_make_sec_sum = 0
            day_equiv_made_sum = 0.0
            day_fresh = 0
            day_purchased = 0

            for slot in SLOTS:
                intensity = _slot_intensity(slot)
                if intensity < 0.08:
                    # Outside open hours — skip the row entirely. Mirrors the
                    # production SQL GROUP BY which only emits rows where orders
                    # exist. Keeps the seed payload roughly proportional to
                    # actual store operating hours.
                    continue

                # Orders this slot — small noise around a per-store baseline.
                base_orders = int(28 * intensity * rng.uniform(0.85, 1.15))
                slot_orders = max(0, base_orders)
                completed = slot_orders                       # seed: assume all complete same day
                fresh = int(slot_orders * rng.uniform(0.65, 0.85))
                purchased = slot_orders - fresh
                equiv_made = fresh + 0.25 * purchased

                # Per-order response & make seconds — vary with intensity and store speed.
                resp_mean = (90 + 60 * intensity) * speed * rng.uniform(0.9, 1.1)
                make_mean = (180 + 90 * intensity) * speed * rng.uniform(0.9, 1.1)
                resp_sec_sum = int(resp_mean * completed)
                make_sec_sum = int(make_mean * equiv_made)

                # ~10% backlog at peak, ~3% off-peak.
                backlog_rate = 0.03 + 0.10 * intensity
                backlog = int(slot_orders * backlog_rate * rng.uniform(0.6, 1.4))
                backlog = min(backlog, slot_orders)

                interval_rows.append(
                    {
                        "date": iso_date,
                        "slot": slot,
                        "shopNumber": s.shop_number,
                        "responseSecondsSum": resp_sec_sum,
                        "responseOrdersCount": completed,
                        "makeSecondsSum": make_sec_sum,
                        "equivProductsMadeSum": round(equiv_made, 4),
                        "hasProducts": equiv_made > 0,
                    }
                )

                day_total_orders += slot_orders
                day_completed_orders += completed
                day_backlog_orders += backlog
                day_resp_sec_sum += resp_sec_sum
                day_resp_orders += completed
                day_make_sec_sum += make_sec_sum
                day_equiv_made_sum += equiv_made
                day_fresh += fresh
                day_purchased += purchased

            daily_rows.append(
                {
                    "date": iso_date,
                    "shopNumber": s.shop_number,
                    "operatingToday": True,
                    "totalOrders": day_total_orders,
                    "completedOrders": day_completed_orders,
                    "backlogOrders": day_backlog_orders,
                    "responseSecondsSum": day_resp_sec_sum,
                    "responseOrdersCount": day_resp_orders,
                    "makeSecondsSum": day_make_sec_sum,
                    "equivProductsMadeSum": round(day_equiv_made_sum, 4),
                    "freshMadeCount": day_fresh,
                    "purchasedCount": day_purchased,
                }
            )

    primary_start = today_date.isoformat()
    primary_end = today_date.isoformat()

    def shift(iso: str, delta_days: int) -> str:
        return (datetime.fromisoformat(iso).date() + timedelta(days=delta_days)).isoformat()

    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "_isSeed": True,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "timezone": "US/Eastern",
        "retentionDays": RETENTION_DAYS,
        "backlogThresholdMin": BACKLOG_THRESHOLD_MIN,
        "staleThresholdMin": DAILY_STALE_THRESHOLD_MIN,
        "hierarchy": hierarchy,
        "dailyStoreRows": daily_rows,
        "intervalRows": interval_rows,
        "comparisonWindows": {
            "primary": {"startDate": primary_start, "endDate": primary_end},
            "wow": {"startDate": shift(primary_start, -7), "endDate": shift(primary_end, -7)},
            "mom": {"startDate": shift(primary_start, -30), "endDate": shift(primary_end, -30)},
        },
        "sources": {
            "efficiencyDuration": "confirmed",
            "avgOrderResponse": "confirmed",
            "avgEquivMakeTime": "pipeline-mapping",
            "backlogEquivProducts": "confirmed",
            "backlogRate": "confirmed",
            "equivProductsMade": "pipeline-mapping",
        },
    }
    return payload


def main() -> None:
    payload = _build_payload()
    out = Path(__file__).resolve().parent.parent / "data" / "efficiency.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} — {len(payload['dailyStoreRows'])} daily rows, {len(payload['intervalRows'])} interval rows")


if __name__ == "__main__":
    main()
