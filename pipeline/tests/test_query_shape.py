"""Guards on the two things that took this dashboard off the air.

It was stopped on 2026-08-25 for performance. The slow log from that day says
why: 14 queries, 138.9 s, 25.1M rows examined, the worst single one 49.6 s.
Both realtime queries — the ones that run every 15 minutes all day — were full
scans of t_order, and one of them was also returning the wrong number.

  1. "Today" was written as DATE(CONVERT_TZ(o.pay_time, ...)) = <today>. Wrapping
     the indexed column in functions means idx_pay_time shows up in
     possible_keys and is then discarded: EXPLAIN type=ALL, key=NULL,
     rows=1,337,633. Written as a range on the bare column it is type=range,
     key=idx_pay_time, rows=4,845.

  2. The backlog equiv-products query had no date bound at all. "Still open and
     older than 10 minutes" matched every unfinished order since 2025-06-11:
     7,018 of them, where 2026-09-01's real figure was 6.

Run from pipeline/:  python -m unittest discover -s tests
"""

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

SOURCES = {
    "realtime_collector.py": Path(__file__).resolve().parent.parent / "realtime_collector.py",
    "collector.py": Path(__file__).resolve().parent.parent / "collector.py",
}


def _where_clauses(sql_source: str) -> list:
    """Every WHERE ... GROUP BY block in a source file, roughly."""
    return re.findall(r"WHERE\s(.*?)(?:GROUP BY|\"\"\")", sql_source, re.S)


class Sargability(unittest.TestCase):
    def test_no_query_filters_a_wrapped_pay_time(self):
        # DATE(CONVERT_TZ(o.pay_time ...)) is fine in SELECT and GROUP BY — that
        # is how the ET day is labelled. In WHERE it costs the index.
        for name, path in SOURCES.items():
            source = path.read_text(encoding="utf-8")
            for clause in _where_clauses(source):
                with self.subTest(source=name):
                    self.assertNotRegex(
                        clause,
                        r"DATE\s*\(\s*CONVERT_TZ\s*\(\s*o\.pay_time",
                        f"{name} filters on a function of o.pay_time. "
                        f"idx_pay_time cannot be used: that is the full scan "
                        f"that ran every 15 minutes until 2026-08-25. Compare "
                        f"the bare column against CONVERT_TZ(%s, ...) bounds.",
                    )

    def test_pay_time_is_compared_as_a_bare_column(self):
        source = SOURCES["realtime_collector.py"].read_text(encoding="utf-8")
        self.assertEqual(
            source.count("o.pay_time >= CONVERT_TZ(%s, 'US/Eastern', 'UTC')"), 2,
            "both realtime queries must bound o.pay_time to the ET day",
        )


class BacklogIsBoundedToToday(unittest.TestCase):
    """An order from last year is not current backlog."""

    def test_every_realtime_query_has_a_day_bound(self):
        source = SOURCES["realtime_collector.py"].read_text(encoding="utf-8")
        clauses = _where_clauses(source)
        self.assertGreaterEqual(len(clauses), 2, "expected both realtime queries")
        for i, clause in enumerate(clauses):
            with self.subTest(query=i):
                self.assertIn(
                    "o.pay_time >=", clause,
                    "a realtime query with no lower bound on pay_time scans the "
                    "whole table and counts unfinished orders back to 2025 as "
                    "current backlog — 7,018 against a true 6 on 2026-09-01.",
                )
                self.assertIn("o.pay_time <", clause)

    def test_the_threshold_still_applies_on_top_of_the_day(self):
        # The bound narrows the window; it must not replace the 压单 rule.
        source = SOURCES["realtime_collector.py"].read_text(encoding="utf-8")
        self.assertIn("TIMESTAMPDIFF(MINUTE, o.pay_time, UTC_TIMESTAMP()) > %s", source)


class DailyRefreshIsOffTheBatchWindow(unittest.TestCase):
    def test_daily_hour_is_not_inside_the_0500_utc_batch(self):
        from config import settings

        self.assertEqual(settings.DAILY_TIMEZONE, "US/Eastern")
        # 01:00 ET = 05:00 UTC lands in the nightly batch window on salesorder.
        self.assertNotEqual((settings.DAILY_HOUR, settings.DAILY_MINUTE), (1, 0))
        self.assertEqual((settings.DAILY_HOUR, settings.DAILY_MINUTE), (2, 45))


if __name__ == "__main__":
    unittest.main()
