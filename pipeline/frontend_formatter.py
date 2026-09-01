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
    FORCE_FULL_REBUILD,
    FULL_REBUILD_WEEKDAY,
    INCREMENTAL_DAYS,
    RETENTION_DAYS,
)
from config.store_geography import STORES, build_hierarchy


def _us_eastern_today() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("US/Eastern")).date()
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


OUTPUT = Path(__file__).resolve().parent.parent / "data" / "efficiency.json"


def _load_previous_payload() -> dict | None:
    """The payload from the last run, or None if it cannot be trusted."""
    if not OUTPUT.exists():
        print("[mode] no previous payload on disk")
        return None
    try:
        prev = json.loads(OUTPUT.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"[mode] previous payload unreadable ({exc})")
        return None
    if prev.get("schemaVersion") != 1:
        print("[mode] previous payload has a different schemaVersion")
        return None
    if not prev.get("dailyStoreRows"):
        print("[mode] previous payload carries no daily rows")
        return None
    return prev


def _payload_leaves_a_gap(prev: dict | None, fresh_from: str) -> bool:
    """True if splicing onto this payload would leave days with no data.

    The realtime collector upserts today's rows into the same file, so a
    payload can be recent without being complete; what matters is the newest
    date it holds. If that is more than a day older than the fresh window's
    start, the days in between belong to neither side and an incremental run
    would write a hole into the history.
    """
    if prev is None:
        return False
    dates = {r["date"] for r in prev.get("dailyStoreRows", []) if r.get("date")}
    if not dates:
        return True
    newest = date.fromisoformat(max(dates))
    return newest < date.fromisoformat(fresh_from) - timedelta(days=1)


def _splice_rows(prev_rows: list, fresh_rows: list, fresh_from: str,
                 retain_from: str) -> list:
    """Freshly collected days replace their old versions; older days carry over.

    A day inside the re-collected window that comes back with no rows genuinely
    has none now, so the old rows are not resurrected.
    """
    kept = [r for r in prev_rows if retain_from <= r["date"] < fresh_from]
    fresh = [r for r in fresh_rows if r["date"] >= fresh_from]
    return kept + fresh


def build_payload() -> dict:
    end_date = _us_eastern_today()
    prev_payload = _load_previous_payload()
    fresh_from_date = end_date - timedelta(days=INCREMENTAL_DAYS - 1)
    fresh_from = fresh_from_date.isoformat()
    retain_from = (end_date - timedelta(days=RETENTION_DAYS - 1)).isoformat()

    stale_prev = _payload_leaves_a_gap(prev_payload, fresh_from)
    full_rebuild = (
        prev_payload is None
        or FORCE_FULL_REBUILD
        or end_date.weekday() == FULL_REBUILD_WEEKDAY
        or stale_prev
    )
    window_days = RETENTION_DAYS if full_rebuild else INCREMENTAL_DAYS
    reason = ("forced" if FORCE_FULL_REBUILD else
              "no usable previous payload" if prev_payload is None else
              "previous payload too old to splice onto" if stale_prev else
              f"weekly rebuild (weekday={FULL_REBUILD_WEEKDAY})")
    if full_rebuild:
        print(f"[mode] FULL rebuild — {reason}; window={window_days}d")
    else:
        print(f"[mode] incremental — window={window_days}d, "
              f"re-collecting from {fresh_from}, retaining from {retain_from}")

    out = collect(days=window_days)

    hierarchy = build_hierarchy()
    valid_shops = {s.shop_number for s in STORES}

    # Daily rows: we want one row per (date, shop) for every shop in the geography table,
    # filling in zeros for days with no traffic so the client can still mark them operating=False.
    # Zero-fill only the days this run actually collected; older days come from
    # the previous payload in the splice below.
    start_date = end_date - timedelta(days=window_days - 1)
    all_dates = [(start_date + timedelta(days=i)).isoformat() for i in range(window_days)]

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

    if not full_rebuild and prev_payload is not None:
        before = (len(daily_rows), len(interval_rows))
        daily_rows = _splice_rows(prev_payload.get("dailyStoreRows", []),
                                  daily_rows, fresh_from, retain_from)
        interval_rows = _splice_rows(prev_payload.get("intervalRows", []),
                                     interval_rows, fresh_from, retain_from)
        print(f"[merge] dailyStoreRows {before[0]} fresh → {len(daily_rows)} retained; "
              f"intervalRows {before[1]} fresh → {len(interval_rows)} retained")

    daily_rows.sort(key=lambda r: (r["date"], r["shopNumber"]))
    interval_rows.sort(key=lambda r: (r["date"], r["slot"], r["shopNumber"]))
    if not daily_rows:
        raise RuntimeError("No daily rows after merge; refusing to write an empty payload.")

    primary_start = end_date.isoformat()
    primary_end = end_date.isoformat()

    def shift(iso: str, delta_days: int) -> str:
        return (datetime.fromisoformat(iso).date() + timedelta(days=delta_days)).isoformat()

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "timezone": "US/Eastern",
        "retentionDays": RETENTION_DAYS,
        # Which days this run actually queried. Anything older was carried over
        # from the previous payload, unchanged.
        "collectionMode": "full" if full_rebuild else "incremental",
        "collectedFrom": all_dates[0],
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
        # All metrics in this payload come from the daily `collect()` call above —
        # stamp the same timestamp on every metric so the ?debug=1 overlay can
        # show last-run age. Realtime overlay timestamp lives on realtime.json.
        "collectorTimestamps": {
            "daily": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "efficiencyDuration": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "avgOrderResponse":   datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "avgEquivMakeTime":   datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
            "equivProductsMade":  datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        },
    }


def main() -> int:
    try:
        payload = build_payload()
    except Exception as exc:
        print(f"frontend_formatter FAILED: {exc}", file=sys.stderr)
        return 1

    # Same path build_payload() reads the previous payload from — the splice
    # depends on those two being the same file.
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUTPUT} — {len(payload['dailyStoreRows'])} daily rows, "
          f"{len(payload['intervalRows'])} interval rows "
          f"({payload['collectionMode']}, collected from {payload['collectedFrom']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
