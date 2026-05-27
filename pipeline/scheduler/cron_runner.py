"""APScheduler entry point — drives the daily + realtime payloads to GitHub.

This is the Docker / in-container path (docker-compose up runs this).
For ad-hoc runs, the bash entrypoints still work:
  bash pipeline/refresh.sh           — daily, git push
  bash pipeline/refresh_realtime.sh  — realtime, git push

Schedule (UTC):
  - 07:30 daily    → frontend_formatter.main() → push data/efficiency.json
  - every 15 min   → realtime_collector.main() → push data/realtime.json
Both cron jobs are also invoked once on startup so a fresh container
publishes immediately instead of waiting up to a day.
"""
from __future__ import annotations

import logging
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

# Match this project's import convention: pipeline/ on sys.path.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from apscheduler.schedulers.blocking import BlockingScheduler  # noqa: E402
from apscheduler.triggers.cron import CronTrigger  # noqa: E402

from config.settings import (  # noqa: E402
    DAILY_HOUR,
    DAILY_MINUTE,
    DAILY_TIMEZONE,
    GITHUB_DAILY_PATH,
    GITHUB_REALTIME_PATH,
    LOG_DIR,
    REALTIME_HOURS,
    REALTIME_INTERVAL_MIN,
    REALTIME_TIMEZONE,
)
from frontend_formatter import main as run_daily_formatter  # noqa: E402
from realtime_collector import main as run_realtime_collector  # noqa: E402
from sender.github_pusher import push_file  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DAILY_PAYLOAD = PROJECT_ROOT / "data" / "efficiency.json"
REALTIME_PAYLOAD = PROJECT_ROOT / "data" / "realtime.json"

Path(LOG_DIR).mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(Path(LOG_DIR) / "pipeline.log", encoding="utf-8"),
    ],
)
logger = logging.getLogger("cron_runner")


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")


def run_daily() -> None:
    """Collect 180-day window → format → push efficiency.json. Never raises."""
    logger.info("=== run_daily start ===")
    t0 = time.monotonic()
    try:
        rc = run_daily_formatter()
        if rc != 0:
            logger.error("frontend_formatter exited %d; skipping push", rc)
            return
        if not DAILY_PAYLOAD.exists():
            logger.error("efficiency.json was not produced; skipping push")
            return
        ok = push_file(DAILY_PAYLOAD, GITHUB_DAILY_PATH, f"data: daily refresh {_ts()}")
        logger.info("daily push ok=%s", ok)
    except Exception:
        logger.error("run_daily FAILED:\n%s", traceback.format_exc())
    logger.info("=== run_daily done in %.1fs ===", time.monotonic() - t0)


def run_realtime() -> None:
    """Realtime backlog snapshot → push realtime.json. Never raises."""
    logger.info("=== run_realtime start ===")
    t0 = time.monotonic()
    try:
        rc = run_realtime_collector()
        if rc != 0:
            logger.error("realtime_collector exited %d; skipping push", rc)
            return
        if not REALTIME_PAYLOAD.exists():
            logger.error("realtime.json was not produced; skipping push")
            return
        ok = push_file(REALTIME_PAYLOAD, GITHUB_REALTIME_PATH, f"data: realtime {_ts()}")
        logger.info("realtime push ok=%s", ok)
    except Exception:
        logger.error("run_realtime FAILED:\n%s", traceback.format_exc())
    logger.info("=== run_realtime done in %.1fs ===", time.monotonic() - t0)


def main() -> None:
    scheduler = BlockingScheduler(timezone="UTC")
    scheduler.add_job(
        run_daily,
        CronTrigger(hour=DAILY_HOUR, minute=DAILY_MINUTE, timezone=DAILY_TIMEZONE),
        id="efficiency_daily",
        name="efficiency daily refresh",
        misfire_grace_time=3600,
    )
    # Realtime cadence is policy, not code — REALTIME_TIMEZONE / REALTIME_HOURS
    # / REALTIME_INTERVAL_MIN live in .env so the schedule can be retuned per
    # region or extended to 24/7 without a code change. Defaults gate to store
    # hours so we don't emit 12 hours of empty snapshots overnight.
    scheduler.add_job(
        run_realtime,
        CronTrigger(
            hour=REALTIME_HOURS,
            minute=f"*/{REALTIME_INTERVAL_MIN}",
            timezone=REALTIME_TIMEZONE,
        ),
        id="efficiency_realtime",
        name="efficiency realtime snapshot",
        misfire_grace_time=300,
    )
    logger.info(
        "scheduler started; daily %02d:%02d %s, realtime */%d min during %s %s",
        DAILY_HOUR, DAILY_MINUTE, DAILY_TIMEZONE,
        REALTIME_INTERVAL_MIN, REALTIME_HOURS, REALTIME_TIMEZONE,
    )
    # Immediate first runs on container startup so we don't wait up to a day.
    run_daily()
    run_realtime()
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("scheduler stopped")


if __name__ == "__main__":
    main()
