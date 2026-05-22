#!/usr/bin/env python3
"""Realtime backlog snapshot — SELECT-only.

Runs frequently (GHA cron */15 * * * *) and emits data/realtime.json with
the current 压单 counts per store. The client overlays this onto the daily
payload for the KPI cards and detail-table backlog column.

Backlog definition: an order is in 压单 if either
  - it has finish_time and (finish_time − pay_time) > BACKLOG_THRESHOLD_MIN
  - it is still open and (UTC_NOW − pay_time) > BACKLOG_THRESHOLD_MIN

Run: python3 pipeline/realtime_collector.py
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from config.category_mapping import EQUIV_WEIGHT_PURCHASED, FRESH_MADE, PURCHASED
from config.settings import (
    BACKLOG_THRESHOLD_MIN,
    EXCLUDED_SHOP_PATTERNS,
    REALTIME_STALE_THRESHOLD_MIN,
    TENANT,
    load_mysql_credentials,
)
from config.store_geography import STORES

FRESH_LIST = sorted(FRESH_MADE)
PURCHASED_LIST = sorted(PURCHASED)


@dataclass
class StoreBacklog:
    shop_number: str
    backlog_equiv_products: float = 0.0
    backlog_orders_open: int = 0
    total_orders_today: int = 0
    backlog_orders_today: int = 0


def _excluded_clause(alias: str) -> str:
    parts = []
    for pat in EXCLUDED_SHOP_PATTERNS:
        if pat.startswith("US999"):
            parts.append(f"{alias} NOT LIKE '{pat}%'")
        else:
            parts.append(f"{alias} <> '{pat}'")
    return " AND ".join(parts)


def collect_realtime() -> dict[str, StoreBacklog]:
    import pymysql

    creds = load_mysql_credentials()
    conn = pymysql.connect(
        host=creds.host, port=creds.port, user=creds.user, password=creds.password,
        cursorclass=pymysql.cursors.DictCursor, autocommit=True, charset="utf8mb4",
    )

    by_shop: dict[str, StoreBacklog] = {s.shop_number: StoreBacklog(shop_number=s.shop_number) for s in STORES}
    in_fresh = ",".join(["%s"] * len(FRESH_LIST))
    in_purchased = ",".join(["%s"] * len(PURCHASED_LIST))
    excluded = _excluded_clause("o.shop_number")

    try:
        with conn.cursor() as cur:
            # NOTE: the open-overdue branch does not exclude cancelled orders because
            # the cancellation status code(s) are not yet confirmed from the schema probe.
            # When confirmed, add `AND o.status NOT IN (...)` to the IS NULL branches.
            # Total + backlog orders for today (US/Eastern day)
            cur.execute(
                f"""
                SELECT
                  o.shop_number AS shop,
                  COUNT(*) AS total_today,
                  SUM(CASE
                        WHEN m.finish_time IS NOT NULL
                          AND TIMESTAMPDIFF(MINUTE, o.pay_time, m.finish_time) > %s THEN 1
                        WHEN m.finish_time IS NULL
                          AND TIMESTAMPDIFF(MINUTE, o.pay_time, UTC_TIMESTAMP()) > %s THEN 1
                        ELSE 0
                      END) AS backlog_today,
                  SUM(CASE WHEN m.finish_time IS NULL
                        AND TIMESTAMPDIFF(MINUTE, o.pay_time, UTC_TIMESTAMP()) > %s THEN 1 ELSE 0 END) AS open_overdue
                FROM luckyus_sales_order.t_order o
                LEFT JOIN luckyus_sales_order.t_order_make m ON m.order_id = o.id AND m.tenant = o.tenant
                WHERE o.tenant = %s
                  AND o.pay_time IS NOT NULL
                  AND DATE(CONVERT_TZ(o.pay_time, 'UTC', 'US/Eastern')) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), 'UTC', 'US/Eastern'))
                  AND {excluded}
                GROUP BY o.shop_number
                """,
                (BACKLOG_THRESHOLD_MIN, BACKLOG_THRESHOLD_MIN, BACKLOG_THRESHOLD_MIN, TENANT),
            )
            for r in cur.fetchall():
                shop = r["shop"]
                if shop not in by_shop:
                    continue
                by_shop[shop].total_orders_today = int(r["total_today"] or 0)
                by_shop[shop].backlog_orders_today = int(r["backlog_today"] or 0)
                by_shop[shop].backlog_orders_open = int(r["open_overdue"] or 0)

            # Equiv products for currently-open overdue orders
            cur.execute(
                f"""
                SELECT
                  o.shop_number AS shop,
                  SUM(CASE WHEN i.one_category_name IN ({in_fresh}) THEN i.sku_num ELSE 0 END) AS fresh,
                  SUM(CASE WHEN i.one_category_name IN ({in_purchased}) THEN i.sku_num ELSE 0 END) AS purchased
                FROM luckyus_sales_order.t_order o
                JOIN luckyus_sales_order.t_order_item i ON i.order_id = o.id AND i.tenant = o.tenant
                LEFT JOIN luckyus_sales_order.t_order_make m ON m.order_id = o.id AND m.tenant = o.tenant
                WHERE o.tenant = %s
                  AND o.pay_time IS NOT NULL
                  AND m.finish_time IS NULL
                  AND TIMESTAMPDIFF(MINUTE, o.pay_time, UTC_TIMESTAMP()) > %s
                  AND {excluded}
                GROUP BY o.shop_number
                """,
                (*FRESH_LIST, *PURCHASED_LIST, TENANT, BACKLOG_THRESHOLD_MIN),
            )
            for r in cur.fetchall():
                shop = r["shop"]
                if shop not in by_shop:
                    continue
                fresh = int(r["fresh"] or 0)
                purchased = int(r["purchased"] or 0)
                by_shop[shop].backlog_equiv_products = float(fresh) + EQUIV_WEIGHT_PURCHASED * float(purchased)
    finally:
        conn.close()

    return by_shop


def build_payload() -> dict:
    by_shop = collect_realtime()
    by_store = [
        {
            "shopNumber": s.shop_number,
            "backlogEquivProducts": round(s.backlog_equiv_products, 2),
            "backlogOrdersOpen": s.backlog_orders_open,
            "totalOrdersToday": s.total_orders_today,
            "backlogOrdersToday": s.backlog_orders_today,
        }
        for s in by_shop.values()
    ]
    g_backlog_equiv = round(sum(s["backlogEquivProducts"] for s in by_store), 2)
    g_backlog_open = sum(s["backlogOrdersOpen"] for s in by_store)
    g_total_today = sum(s["totalOrdersToday"] for s in by_store)
    g_backlog_today = sum(s["backlogOrdersToday"] for s in by_store)
    rate = (g_backlog_today / g_total_today * 100.0) if g_total_today > 0 else None

    return {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "backlogThresholdMin": BACKLOG_THRESHOLD_MIN,
        "staleThresholdMin": REALTIME_STALE_THRESHOLD_MIN,
        "global": {
            "backlogEquivProducts": g_backlog_equiv,
            "backlogOrdersOpen": g_backlog_open,
            "totalOrdersToday": g_total_today,
            "backlogOrdersToday": g_backlog_today,
            "backlogRatePercent": round(rate, 2) if rate is not None else None,
        },
        "byStore": by_store,
    }


def main() -> int:
    try:
        payload = build_payload()
    except Exception as exc:
        print(f"realtime_collector FAILED: {exc}", file=sys.stderr)
        return 1
    out = Path(__file__).resolve().parent.parent / "data" / "realtime.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} — backlog equiv {payload['global']['backlogEquivProducts']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
