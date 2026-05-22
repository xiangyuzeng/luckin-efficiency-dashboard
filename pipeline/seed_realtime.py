#!/usr/bin/env python3
"""Generate a realistic seed realtime.json.

Refreshes ~15 min in production (GitHub Actions cron */15 * * * *).
For seed we just synthesize an "as of now" snapshot.

Run: python3 pipeline/seed_realtime.py
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config.settings import BACKLOG_THRESHOLD_MIN, REALTIME_STALE_THRESHOLD_MIN
from config.store_geography import STORES


def _build_payload() -> dict[str, Any]:
    rng = random.Random("luckin-efficiency-realtime-seed")
    now_iso = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    by_store = []
    g_backlog_equiv = 0.0
    g_backlog_open = 0
    g_total_today = 0
    g_backlog_today = 0

    for s in STORES:
        # Roughly model the peak-ish "now" snapshot
        total_today = rng.randint(220, 460)
        backlog_today = int(total_today * rng.uniform(0.06, 0.15))
        backlog_open = int(backlog_today * rng.uniform(0.3, 0.7))
        fresh_open = int(backlog_open * rng.uniform(0.6, 0.9))
        purchased_open = backlog_open - fresh_open
        backlog_equiv = round(fresh_open + 0.25 * purchased_open, 2)

        by_store.append(
            {
                "shopNumber": s.shop_number,
                "backlogEquivProducts": backlog_equiv,
                "backlogOrdersOpen": backlog_open,
                "totalOrdersToday": total_today,
                "backlogOrdersToday": backlog_today,
            }
        )
        g_backlog_equiv += backlog_equiv
        g_backlog_open += backlog_open
        g_total_today += total_today
        g_backlog_today += backlog_today

    backlog_rate_percent = (g_backlog_today / g_total_today * 100.0) if g_total_today > 0 else None

    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "_isSeed": True,
        "generatedAt": now_iso,
        "backlogThresholdMin": BACKLOG_THRESHOLD_MIN,
        "staleThresholdMin": REALTIME_STALE_THRESHOLD_MIN,
        "global": {
            "backlogEquivProducts": round(g_backlog_equiv, 2),
            "backlogOrdersOpen": g_backlog_open,
            "totalOrdersToday": g_total_today,
            "backlogOrdersToday": g_backlog_today,
            "backlogRatePercent": round(backlog_rate_percent, 2) if backlog_rate_percent is not None else None,
        },
        "byStore": by_store,
    }
    return payload


def main() -> None:
    payload = _build_payload()
    out = Path(__file__).resolve().parent.parent / "data" / "realtime.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out} — backlog equiv {payload['global']['backlogEquivProducts']}, {len(payload['byStore'])} stores")


if __name__ == "__main__":
    main()
