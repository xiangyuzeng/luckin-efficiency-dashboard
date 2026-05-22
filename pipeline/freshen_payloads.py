#!/usr/bin/env python3
"""Re-anchor seed payload dates + timestamps at build time.

Runs as a `prebuild` hook so every Vercel build serves the seed dashboard
anchored to today (US/Eastern).

Detection: only payloads with `_isSeed: true` are touched. Production-pipeline
output never sets `_isSeed`, so workflow-generated data flows through unchanged.

What we do:
- `efficiency.json`: find the latest date in `dailyStoreRows`, shift ALL dates
  uniformly so that latest = today (US/Eastern); update `generatedAt`.
- `realtime.json`: update `generatedAt` to now.

Run: python3 pipeline/freshen_payloads.py
"""

from __future__ import annotations

import json
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EFFICIENCY = ROOT / "data" / "efficiency.json"
REALTIME = ROOT / "data" / "realtime.json"


def _us_eastern_today() -> date:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("US/Eastern")).date()
    except Exception:
        return (datetime.now(timezone.utc) - timedelta(hours=5)).date()


def _now_iso_utc() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _shift_iso(iso: str, delta_days: int) -> str:
    return (date.fromisoformat(iso) + timedelta(days=delta_days)).isoformat()


def freshen_efficiency() -> None:
    if not EFFICIENCY.exists():
        print(f"freshen: {EFFICIENCY} not found, skipping")
        return
    payload = json.loads(EFFICIENCY.read_text(encoding="utf-8"))
    if not payload.get("_isSeed"):
        print("freshen: efficiency.json is not seed, leaving production data untouched")
        return

    rows = payload.get("dailyStoreRows") or []
    if not rows:
        payload["generatedAt"] = _now_iso_utc()
        EFFICIENCY.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("freshen: no dailyStoreRows to anchor; only generatedAt updated")
        return

    latest_iso = max(r["date"] for r in rows)
    latest = date.fromisoformat(latest_iso)
    today = _us_eastern_today()
    delta = (today - latest).days

    if delta != 0:
        print(f"freshen: shifting efficiency.json dates by {delta:+d} day(s) (latest {latest_iso} → {today.isoformat()})")
        for r in payload["dailyStoreRows"]:
            r["date"] = _shift_iso(r["date"], delta)
        for r in payload.get("intervalRows", []) or []:
            r["date"] = _shift_iso(r["date"], delta)
        cw = payload.get("comparisonWindows") or {}
        for key in ("primary", "wow", "mom"):
            win = cw.get(key)
            if win:
                win["startDate"] = _shift_iso(win["startDate"], delta)
                win["endDate"] = _shift_iso(win["endDate"], delta)
    else:
        print("freshen: efficiency.json already anchored to today")

    payload["generatedAt"] = _now_iso_utc()
    EFFICIENCY.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"freshen: efficiency.json updated, generatedAt={payload['generatedAt']}")


def freshen_realtime() -> None:
    if not REALTIME.exists():
        print(f"freshen: {REALTIME} not found, skipping")
        return
    payload = json.loads(REALTIME.read_text(encoding="utf-8"))
    if not payload.get("_isSeed"):
        print("freshen: realtime.json is not seed, leaving production data untouched")
        return
    payload["generatedAt"] = _now_iso_utc()
    REALTIME.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"freshen: realtime.json updated, generatedAt={payload['generatedAt']}")


def main() -> int:
    try:
        freshen_efficiency()
        freshen_realtime()
    except Exception as exc:
        # Never break a Vercel build because of the freshener — fall through to next build steps.
        print(f"freshen: WARNING — non-fatal error: {exc}", file=sys.stderr)
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
