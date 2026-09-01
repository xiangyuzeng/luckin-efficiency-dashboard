"""The daily collector re-queries a few days, not 180.

Measured on 2026-08-25, the day this dashboard was stopped: the four daily
queries took 13.9 / 49.6 / 9.9 / 37.7 s and examined 11.4M rows, recomputing
180 days of numbers that had not changed since the previous night. 180 days
covers a large share of t_order (1.34M rows), which is why the optimizer stops
using idx_pay_time and scans (LCNA-DBA-SQL-2026-0901-D, D-04).

What has to hold for incremental collection to be safe:
  - a day older than the fresh window keeps the value it already had;
  - a day inside the fresh window takes the new value, including when the new
    value is "no rows";
  - a previous payload too old to abut the fresh window forces a full rebuild
    instead of writing a hole into the history.

Run from pipeline/:  python -m unittest discover -s tests
"""

import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from frontend_formatter import _payload_leaves_a_gap, _splice_rows  # noqa: E402


def _row(d: str, shop: str, orders: int):
    return {"date": d, "shopNumber": shop, "totalOrders": orders}


class Splice(unittest.TestCase):
    def setUp(self):
        self.prev = [
            _row("2025-06-01", "US00001", 1),      # outside retention
            _row("2026-08-20", "US00001", 100),    # carried over
            _row("2026-08-30", "US00001", 200),    # stale, must be replaced
        ]
        self.fresh = [
            _row("2026-08-30", "US00001", 205),
            _row("2026-08-31", "US00001", 190),
        ]

    def test_fresh_days_win_and_older_days_carry_over(self):
        out = _splice_rows(self.prev, self.fresh, "2026-08-30", "2026-06-01")
        by_date = {r["date"]: r["totalOrders"] for r in out}
        self.assertEqual(by_date["2026-08-20"], 100)
        self.assertEqual(by_date["2026-08-30"], 205)
        self.assertEqual(by_date["2026-08-31"], 190)
        self.assertNotIn("2025-06-01", by_date)

    def test_a_day_that_lost_its_rows_does_not_come_back(self):
        out = _splice_rows(self.prev, [_row("2026-08-31", "US00001", 190)],
                           "2026-08-30", "2026-06-01")
        self.assertEqual([r["date"] for r in out], ["2026-08-20", "2026-08-31"])

    def test_an_empty_previous_payload_yields_just_the_fresh_window(self):
        self.assertEqual(len(_splice_rows([], self.fresh, "2026-08-30", "2026-06-01")), 2)


class GapGuard(unittest.TestCase):
    """The realtime collector writes into the same file, so recency of the file
    says nothing — only the newest date it holds does."""

    def _payload(self, newest: str):
        return {"schemaVersion": 1, "dailyStoreRows": [_row(newest, "US00001", 1)]}

    def test_a_payload_that_abuts_the_window_is_spliceable(self):
        self.assertFalse(_payload_leaves_a_gap(self._payload("2026-08-29"), "2026-08-30"))
        self.assertFalse(_payload_leaves_a_gap(self._payload("2026-08-31"), "2026-08-30"))

    def test_an_older_payload_leaves_a_gap(self):
        self.assertTrue(_payload_leaves_a_gap(self._payload("2026-08-25"), "2026-08-30"))
        self.assertTrue(_payload_leaves_a_gap(self._payload("2026-06-01"), "2026-08-30"))

    def test_a_payload_with_no_rows_is_not_trusted(self):
        self.assertTrue(_payload_leaves_a_gap({"dailyStoreRows": []}, "2026-08-30"))

    def test_no_previous_payload_is_handled_elsewhere(self):
        self.assertFalse(_payload_leaves_a_gap(None, "2026-08-30"))


class WindowSettings(unittest.TestCase):
    def test_the_collected_window_is_days_not_months(self):
        from config import settings

        self.assertEqual(settings.RETENTION_DAYS, 180)      # what the board keeps
        self.assertLessEqual(settings.INCREMENTAL_DAYS, 7)  # what each run queries
        self.assertGreaterEqual(settings.INCREMENTAL_DAYS, 2)  # margin for late changes
        self.assertIn(settings.FULL_REBUILD_WEEKDAY, range(7))


if __name__ == "__main__":
    unittest.main()
