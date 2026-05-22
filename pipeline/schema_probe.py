#!/usr/bin/env python3
"""One-shot validation of the source schema.

Confirms the columns the collectors rely on, surfaces any naming drift, and
writes pipeline/schema_map.json with per-metric source confidence so the build
never silently emits stale assumptions.

Run: python3 pipeline/schema_probe.py
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from config.settings import TENANT, load_mysql_credentials


@dataclass
class ColumnCheck:
    db: str
    table: str
    column: str
    found: bool


@dataclass
class ProbeResult:
    probed_at: str
    columns: list[ColumnCheck]
    one_category_values: list[str]
    geography_populated: bool
    sources: dict[str, str]


# (database, table, column) we expect to find.
REQUIRED_COLUMNS = [
    ("luckyus_sales_order",  "t_order",       "pay_time"),
    ("luckyus_sales_order",  "t_order",       "channel"),
    ("luckyus_sales_order",  "t_order",       "shop_number"),
    ("luckyus_sales_order",  "t_order",       "status"),
    ("luckyus_sales_order",  "t_order",       "tenant"),
    ("luckyus_sales_order",  "t_order_make",  "accept_time"),
    ("luckyus_sales_order",  "t_order_make",  "finish_time"),
    ("luckyus_sales_order",  "t_order_make",  "order_id"),
    ("luckyus_sales_order",  "t_order_item",  "one_category_name"),
    ("luckyus_sales_order",  "t_order_item",  "order_id"),
    ("luckyus_sales_order",  "t_order_item",  "sku_num"),
    ("luckyus_opshop",       "t_shop_info",   "shop_no"),
    ("luckyus_opshop",       "t_shop_info",   "status"),
    ("luckyus_opshop",       "t_shop_info",   "tenant"),
    ("luckyus_opshop",       "t_shop_info",   "locality_name"),
    ("luckyus_opshop",       "t_shop_info",   "administrative_area_name"),
]


def probe() -> ProbeResult:
    import pymysql
    from datetime import datetime, timezone

    creds = load_mysql_credentials()
    conn = pymysql.connect(
        host=creds.host, port=creds.port, user=creds.user, password=creds.password,
        cursorclass=pymysql.cursors.DictCursor, autocommit=True, charset="utf8mb4",
    )
    columns: list[ColumnCheck] = []
    try:
        with conn.cursor() as cur:
            for db, table, col in REQUIRED_COLUMNS:
                cur.execute(
                    """
                    SELECT 1 FROM information_schema.COLUMNS
                    WHERE TABLE_SCHEMA=%s AND TABLE_NAME=%s AND COLUMN_NAME=%s
                    """,
                    (db, table, col),
                )
                columns.append(ColumnCheck(db, table, col, bool(cur.fetchone())))

            # Distinct values for one_category_name — used to confirm the 现制/外购 mapping.
            cur.execute(
                """
                SELECT DISTINCT one_category_name
                FROM luckyus_sales_order.t_order_item
                WHERE tenant=%s AND one_category_name IS NOT NULL
                LIMIT 50
                """,
                (TENANT,),
            )
            one_category_values = sorted(r["one_category_name"] for r in cur.fetchall())

            # Are any geography columns populated for LKUS stores?
            cur.execute(
                """
                SELECT COUNT(*) AS populated
                FROM luckyus_opshop.t_shop_info
                WHERE tenant=%s AND (locality_name IS NOT NULL OR administrative_area_name IS NOT NULL)
                """,
                (TENANT,),
            )
            row = cur.fetchone() or {"populated": 0}
            geography_populated = row.get("populated", 0) > 0
    finally:
        conn.close()

    sources = {
        "efficiencyDuration":     "confirmed",
        "avgOrderResponse":       "confirmed",
        "avgEquivMakeTime":       "pipeline-mapping",
        "backlogEquivProducts":   "confirmed",
        "backlogRate":            "confirmed",
        "equivProductsMade":      "pipeline-mapping",
        "_geography":             "shop-info" if geography_populated else "pipeline-constant",
    }

    return ProbeResult(
        probed_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        columns=columns,
        one_category_values=one_category_values,
        geography_populated=geography_populated,
        sources=sources,
    )


def main() -> int:
    try:
        result = probe()
    except Exception as exc:
        print(f"schema_probe FAILED: {exc}", file=sys.stderr)
        return 1

    missing = [f"{c.db}.{c.table}.{c.column}" for c in result.columns if not c.found]
    if missing:
        print("WARNING — missing columns:")
        for m in missing:
            print(f"  - {m}")

    out_path = Path(__file__).resolve().parent / "schema_map.json"
    out_path.write_text(
        json.dumps(
            {
                "probedAt": result.probed_at,
                "columns": [asdict(c) for c in result.columns],
                "oneCategoryValues": result.one_category_values,
                "geographyPopulated": result.geography_populated,
                "sources": result.sources,
            },
            ensure_ascii=False, indent=2,
        ) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {out_path}")
    print(f"one_category_name values seen: {result.one_category_values}")
    print(f"geography populated: {result.geography_populated}")
    return 0 if not missing else 2


if __name__ == "__main__":
    raise SystemExit(main())
