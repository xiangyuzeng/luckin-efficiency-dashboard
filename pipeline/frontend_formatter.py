#!/usr/bin/env python3
"""Combine collector output + geography into data/efficiency.json.

The output schema must match lib/types.ts EfficiencyPayload exactly; the
client never touches a database and trusts this JSON as the contract.

Run: python3 pipeline/frontend_formatter.py
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from collector import collect
from config.settings import (
    BACKLOG_THRESHOLD_MIN,
    DAILY_STALE_THRESHOLD_MIN,
    RETENTION_DAYS,
)
from config.store_geography import STORES, build_hierarchy


def _us_eastern_today() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("US/Eastern")).date()
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def build_payload() -> dict:
    out = collect(days=RETENTION_DAYS)

    hierarchy = build_hierarchy()
    valid_shops = {s.shop_number for s in STORES}

    # Daily rows: we want one row per (date, shop) for every shop in the geography table,
    # filling in zeros for days with no traffic so the client can still mark them operating=False.
    end_date = _us_eastern_today()
    start_date = end_date - timedelta(days=RETENTION_DAYS - 1)
    all_dates = [(start_date + timedelta(days=i)).isoformat() for i in range(RETENTION_DAYS)]

    daily_rows = []
    for d in all_dates:
        for shop in sorted(valid_shops):
            acc = out.daily.get((d, shop))
            if acc is None:
                daily_rows.append({
                    "date": d,
                    "shopNumber": shop,
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
                })
            else:
                daily_rows.append({
                    "date": acc.date,
                    "shopNumber": acc.shop_number,
                    "operatingToday": acc.operating_today,
                    "totalOrders": acc.total_orders,
                    "completedOrders": acc.completed_orders,
                    "backlogOrders": acc.backlog_orders,
                    "responseSecondsSum": acc.response_seconds_sum,
                    "responseOrdersCount": acc.response_orders_count,
                    "makeSecondsSum": acc.make_seconds_sum,
                    "equivProductsMadeSum": round(acc.equiv_products_made_sum, 4),
                    "freshMadeCount": acc.fresh_made_count,
                    "purchasedCount": acc.purchased_count,
                })

    interval_rows = []
    for acc in out.interval.values():
        if acc.shop_number not in valid_shops:
            continue
        interval_rows.append({
            "date": acc.date,
            "slot": acc.slot,
            "shopNumber": acc.shop_number,
            "responseSecondsSum": acc.response_seconds_sum,
            "responseOrdersCount": acc.response_orders_count,
            "makeSecondsSum": acc.make_seconds_sum,
            "equivProductsMadeSum": round(acc.equiv_products_made_sum, 4),
            "hasProducts": acc.has_products,
        })

    primary_start = end_date.isoformat()
    primary_end = end_date.isoformat()

    def shift(iso: str, delta_days: int) -> str:
        return (datetime.fromisoformat(iso).date() + timedelta(days=delta_days)).isoformat()

    return {
        "schemaVersion": 1,
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


def main() -> int:
    try:
        payload = build_payload()
    except Exception as exc:
        print(f"frontend_formatter FAILED: {exc}", file=sys.stderr)
        return 1

    out = Path(__file__).resolve().parent.parent / "data" / "efficiency.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} — {len(payload['dailyStoreRows'])} daily rows, {len(payload['intervalRows'])} interval rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
