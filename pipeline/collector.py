#!/usr/bin/env python3
"""Daily collector — SELECT-only.

Produces, for the last RETENTION_DAYS days (US/Eastern), per-store and
per-store-per-half-hour raw counters used by lib/aggregate.ts for weighted
roll-up. Writes them to in-memory dicts; aggregator.py is the next stage.

This is the only file that talks to the production database. Read-only by
construction — every query starts with SELECT.

Output shape mirrors the EfficiencyPayload schema in lib/types.ts so that
frontend_formatter.py can pour the data straight into the JSON file.

Run: python3 pipeline/collector.py [--days N]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

from config.category_mapping import EQUIV_WEIGHT_PURCHASED, FRESH_MADE, PURCHASED
from config.settings import (
    BACKLOG_THRESHOLD_MIN,
    EXCLUDED_SHOP_PATTERNS,
    ORDER_STATUS_COMPLETED,
    RETENTION_DAYS,
    TENANT,
    load_mysql_credentials,
)

# All queries use these placeholders.
FRESH_LIST = sorted(FRESH_MADE)
PURCHASED_LIST = sorted(PURCHASED)


def _us_eastern_today() -> date:
    """Today's US/Eastern date — we use Python's zoneinfo for DST correctness."""
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("US/Eastern")).date()
    except Exception:
        # Fallback: UTC minus 5 hours.
        return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


@dataclass
class DailyStoreAccumulator:
    date: str
    shop_number: str
    total_orders: int = 0
    completed_orders: int = 0
    backlog_orders: int = 0
    response_seconds_sum: int = 0
    response_orders_count: int = 0
    make_seconds_sum: int = 0
    equiv_products_made_sum: float = 0.0
    fresh_made_count: int = 0
    purchased_count: int = 0
    operating_today: bool = False


@dataclass
class IntervalAccumulator:
    date: str
    slot: str
    shop_number: str
    response_seconds_sum: int = 0
    response_orders_count: int = 0
    make_seconds_sum: int = 0
    equiv_products_made_sum: float = 0.0
    has_products: bool = False


@dataclass
class CollectorOutput:
    daily: dict[tuple[str, str], DailyStoreAccumulator] = field(default_factory=dict)
    interval: dict[tuple[str, str, str], IntervalAccumulator] = field(default_factory=dict)


def _excluded_shop_clause(alias: str) -> str:
    # Build a SQL exclusion clause. Every literal % must be emitted as %%
    # because the SQL is later run through pymysql's mogrify, which calls
    # `query % args` once. A bare `'US999%'` becomes `%'` to Python's
    # %-formatter and crashes with "not enough arguments for format string".
    # e.g. final SQL: ( alias.shop_no NOT LIKE 'US999%' AND alias.shop_no <> 'US00000' )
    parts = []
    for pat in EXCLUDED_SHOP_PATTERNS:
        if pat.endswith("%"):
            parts.append(f"{alias} NOT LIKE '{pat.replace('%', '%%')}'")
        elif pat.startswith("US999"):
            parts.append(f"{alias} NOT LIKE '{pat}%%'")
        else:
            parts.append(f"{alias} <> '{pat}'")
    return " AND ".join(parts)


def collect(days: int) -> CollectorOutput:
    import pymysql

    creds = load_mysql_credentials()
    conn = pymysql.connect(
        host=creds.host, port=creds.port, user=creds.user, password=creds.password,
        cursorclass=pymysql.cursors.DictCursor, autocommit=True, charset="utf8mb4",
    )

    end_date = _us_eastern_today()
    start_date = end_date - timedelta(days=days - 1)
    out = CollectorOutput()

    in_fresh = ",".join(["%s"] * len(FRESH_LIST))
    in_purchased = ",".join(["%s"] * len(PURCHASED_LIST))
    excluded = _excluded_shop_clause("o.shop_number")

    try:
        with conn.cursor() as cur:
            # NOTE: the open-overdue branch of the backlog CASE does not exclude cancelled orders
            # because the cancellation status code(s) are not yet confirmed from the schema probe.
            # When confirmed, add `AND o.status NOT IN (...)` to the WHEN m.finish_time IS NULL branch.
            # --- Per-day per-store totals + response timing ---
            cur.execute(
                f"""
                SELECT
                  DATE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) AS d,
                  o.shop_number AS shop,
                  COUNT(*) AS total_orders,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL THEN 1 ELSE 0 END) AS completed_orders,
                  SUM(CASE
                        WHEN m.finish_time IS NOT NULL
                          AND TIMESTAMPDIFF(MINUTE, o.pay_time, m.finish_time) > %s THEN 1
                        WHEN m.finish_time IS NULL
                          AND TIMESTAMPDIFF(MINUTE, o.pay_time, UTC_TIMESTAMP()) > %s THEN 1
                        ELSE 0
                      END) AS backlog_orders,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL AND m.accept_time IS NOT NULL
                        THEN TIMESTAMPDIFF(SECOND, o.pay_time, m.accept_time) ELSE 0 END) AS response_seconds_sum,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL AND m.accept_time IS NOT NULL
                        THEN 1 ELSE 0 END) AS response_orders_count,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL AND m.accept_time IS NOT NULL
                        THEN TIMESTAMPDIFF(SECOND, m.accept_time, m.finish_time) ELSE 0 END) AS make_seconds_sum
                FROM luckyus_sales_order.t_order o
                LEFT JOIN luckyus_sales_order.t_order_make m ON m.order_id = o.id AND m.tenant = o.tenant
                WHERE o.tenant = %s
                  AND o.pay_time IS NOT NULL
                  AND o.pay_time >= CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND o.pay_time <  CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND {excluded}
                GROUP BY d, o.shop_number
                """,
                (
                    ORDER_STATUS_COMPLETED, BACKLOG_THRESHOLD_MIN, BACKLOG_THRESHOLD_MIN,
                    ORDER_STATUS_COMPLETED, ORDER_STATUS_COMPLETED, ORDER_STATUS_COMPLETED,
                    TENANT, start_date.isoformat() + " 00:00:00", (end_date + timedelta(days=1)).isoformat() + " 00:00:00",
                ),
            )
            for r in cur.fetchall():
                d = r["d"].isoformat() if isinstance(r["d"], date) else str(r["d"])
                shop = r["shop"]
                if not shop:
                    continue
                key = (d, shop)
                acc = out.daily.setdefault(key, DailyStoreAccumulator(date=d, shop_number=shop))
                acc.total_orders = int(r["total_orders"] or 0)
                acc.completed_orders = int(r["completed_orders"] or 0)
                acc.backlog_orders = int(r["backlog_orders"] or 0)
                acc.response_seconds_sum = int(r["response_seconds_sum"] or 0)
                acc.response_orders_count = int(r["response_orders_count"] or 0)
                acc.make_seconds_sum = int(r["make_seconds_sum"] or 0)
                acc.operating_today = acc.total_orders > 0

            # --- Equivalent products made per day per store (joins t_order_item) ---
            cur.execute(
                f"""
                SELECT
                  DATE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) AS d,
                  o.shop_number AS shop,
                  SUM(CASE WHEN i.one_category_name IN ({in_fresh}) THEN i.sku_num ELSE 0 END) AS fresh_made,
                  SUM(CASE WHEN i.one_category_name IN ({in_purchased}) THEN i.sku_num ELSE 0 END) AS purchased
                FROM luckyus_sales_order.t_order o
                JOIN luckyus_sales_order.t_order_item i ON i.order_id = o.id AND i.tenant = o.tenant
                JOIN luckyus_sales_order.t_order_make m ON m.order_id = o.id AND m.tenant = o.tenant
                WHERE o.tenant = %s
                  AND o.status = %s
                  AND m.finish_time IS NOT NULL
                  AND o.pay_time IS NOT NULL
                  AND o.pay_time >= CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND o.pay_time <  CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND {excluded}
                GROUP BY d, o.shop_number
                """,
                (
                    *FRESH_LIST, *PURCHASED_LIST,
                    TENANT, ORDER_STATUS_COMPLETED,
                    start_date.isoformat() + " 00:00:00", (end_date + timedelta(days=1)).isoformat() + " 00:00:00",
                ),
            )
            for r in cur.fetchall():
                d = r["d"].isoformat() if isinstance(r["d"], date) else str(r["d"])
                shop = r["shop"]
                if not shop:
                    continue
                key = (d, shop)
                acc = out.daily.setdefault(key, DailyStoreAccumulator(date=d, shop_number=shop))
                acc.fresh_made_count = int(r["fresh_made"] or 0)
                acc.purchased_count = int(r["purchased"] or 0)
                acc.equiv_products_made_sum = float(acc.fresh_made_count) + EQUIV_WEIGHT_PURCHASED * float(acc.purchased_count)

            # --- Per-day per-shop per-half-hour interval rows ---
            cur.execute(
                f"""
                SELECT
                  DATE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) AS d,
                  DATE_FORMAT(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern'),
                    CONCAT(LPAD(HOUR(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')), 2, '0'), ':',
                           IF(MINUTE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) < 30, '00', '30'))) AS slot,
                  o.shop_number AS shop,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL AND m.accept_time IS NOT NULL
                        THEN TIMESTAMPDIFF(SECOND, o.pay_time, m.accept_time) ELSE 0 END) AS response_seconds_sum,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL AND m.accept_time IS NOT NULL
                        THEN 1 ELSE 0 END) AS response_orders_count,
                  SUM(CASE WHEN o.status = %s AND m.finish_time IS NOT NULL AND m.accept_time IS NOT NULL
                        THEN TIMESTAMPDIFF(SECOND, m.accept_time, m.finish_time) ELSE 0 END) AS make_seconds_sum
                FROM luckyus_sales_order.t_order o
                LEFT JOIN luckyus_sales_order.t_order_make m ON m.order_id = o.id AND m.tenant = o.tenant
                WHERE o.tenant = %s
                  AND o.pay_time IS NOT NULL
                  AND o.pay_time >= CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND o.pay_time <  CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND {excluded}
                GROUP BY d, slot, o.shop_number
                """,
                (
                    ORDER_STATUS_COMPLETED, ORDER_STATUS_COMPLETED, ORDER_STATUS_COMPLETED,
                    TENANT, start_date.isoformat() + " 00:00:00", (end_date + timedelta(days=1)).isoformat() + " 00:00:00",
                ),
            )
            for r in cur.fetchall():
                d = r["d"].isoformat() if isinstance(r["d"], date) else str(r["d"])
                slot = r["slot"]
                shop = r["shop"]
                if not shop or not slot:
                    continue
                key = (d, slot, shop)
                acc = out.interval.setdefault(key, IntervalAccumulator(date=d, slot=slot, shop_number=shop))
                acc.response_seconds_sum = int(r["response_seconds_sum"] or 0)
                acc.response_orders_count = int(r["response_orders_count"] or 0)
                acc.make_seconds_sum = int(r["make_seconds_sum"] or 0)

            # --- Interval equiv products made (second pass with item join) ---
            cur.execute(
                f"""
                SELECT
                  DATE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) AS d,
                  DATE_FORMAT(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern'),
                    CONCAT(LPAD(HOUR(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')), 2, '0'), ':',
                           IF(MINUTE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) < 30, '00', '30'))) AS slot,
                  o.shop_number AS shop,
                  SUM(CASE WHEN i.one_category_name IN ({in_fresh}) THEN i.sku_num ELSE 0 END) AS fresh_made,
                  SUM(CASE WHEN i.one_category_name IN ({in_purchased}) THEN i.sku_num ELSE 0 END) AS purchased
                FROM luckyus_sales_order.t_order o
                JOIN luckyus_sales_order.t_order_item i ON i.order_id = o.id AND i.tenant = o.tenant
                JOIN luckyus_sales_order.t_order_make m ON m.order_id = o.id AND m.tenant = o.tenant
                WHERE o.tenant = %s
                  AND o.status = %s
                  AND m.finish_time IS NOT NULL
                  AND o.pay_time IS NOT NULL
                  AND o.pay_time >= CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND o.pay_time <  CONVERT_TZ(%s, 'US/Eastern', 'UTC')
                  AND {excluded}
                GROUP BY d, slot, o.shop_number
                """,
                (
                    *FRESH_LIST, *PURCHASED_LIST,
                    TENANT, ORDER_STATUS_COMPLETED,
                    start_date.isoformat() + " 00:00:00", (end_date + timedelta(days=1)).isoformat() + " 00:00:00",
                ),
            )
            for r in cur.fetchall():
                d = r["d"].isoformat() if isinstance(r["d"], date) else str(r["d"])
                slot = r["slot"]
                shop = r["shop"]
                if not shop or not slot:
                    continue
                fresh = int(r["fresh_made"] or 0)
                purchased = int(r["purchased"] or 0)
                key = (d, slot, shop)
                acc = out.interval.setdefault(key, IntervalAccumulator(date=d, slot=slot, shop_number=shop))
                acc.equiv_products_made_sum = float(fresh) + EQUIV_WEIGHT_PURCHASED * float(purchased)
                acc.has_products = acc.equiv_products_made_sum > 0
    finally:
        conn.close()

    return out


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=RETENTION_DAYS)
    parser.add_argument("--dump", type=Path, default=None, help="Optional path to dump collector output as JSON.")
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        out = collect(days=args.days)
    except Exception as exc:
        print(f"collector FAILED: {exc}", file=sys.stderr)
        return 1

    if args.dump:
        args.dump.parent.mkdir(parents=True, exist_ok=True)
        args.dump.write_text(
            json.dumps(
                {
                    "daily": [acc.__dict__ for acc in out.daily.values()],
                    "interval": [acc.__dict__ for acc in out.interval.values()],
                },
                ensure_ascii=False, indent=2,
            ) + "\n",
            encoding="utf-8",
        )
        print(f"dumped collector output to {args.dump}")

    print(f"collected — {len(out.daily)} daily store rows, {len(out.interval)} interval rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
