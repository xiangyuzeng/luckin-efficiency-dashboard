"""Pipeline-wide configuration.

Secrets (database connection) come from AWS Secrets Manager — never hardcoded.
The collector script uses boto3 to resolve `collector/mysql` in `us-east-1`.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
SECRET_ID = os.environ.get("MYSQL_SECRET_ID", "collector/mysql")

# GitHub push config — consumed by pipeline/sender/github_pusher.py.
# Required when running the in-container scheduler; the legacy refresh*.sh
# scripts use `git push` and ignore these.
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO = os.environ.get("GITHUB_REPO", "xiangyuzeng/luckin-efficiency-dashboard")
GITHUB_BRANCH = os.environ.get("GITHUB_BRANCH", "main")
GITHUB_DAILY_PATH = os.environ.get("GITHUB_DAILY_PATH", "data/efficiency.json")
GITHUB_REALTIME_PATH = os.environ.get("GITHUB_REALTIME_PATH", "data/realtime.json")

# Where the scheduler writes its log file. Inside Docker this is mounted as a volume.
LOG_DIR = os.environ.get("LOG_DIR", "logs")

# ── Daily cron schedule ─────────────────────────────────────────────────
# Defaults: 01:00 US/Eastern — off-peak both for MySQL load and for any
# operators watching dashboards. Override per environment in .env.
DAILY_TIMEZONE = os.environ.get("DAILY_TIMEZONE", "US/Eastern")
DAILY_HOUR = int(os.environ.get("DAILY_HOUR", "1"))
DAILY_MINUTE = int(os.environ.get("DAILY_MINUTE", "0"))

# ── Realtime cron schedule (consumed by pipeline/scheduler/cron_runner.py) ──
# Defaults match Luckin USA store hours (Manhattan stores). To deploy in a
# different region or extend coverage, override these in .env — no code change
# needed. APScheduler accepts any IANA timezone string and cron-style hour
# expressions (single hour, range "a-b", list "a,b,c", or "*").
REALTIME_TIMEZONE = os.environ.get("REALTIME_TIMEZONE", "US/Eastern")
REALTIME_HOURS = os.environ.get("REALTIME_HOURS", "7-19")
REALTIME_INTERVAL_MIN = int(os.environ.get("REALTIME_INTERVAL_MIN", "15"))

# 压单 (backlog) policy threshold — keep in sync with lib/metrics.ts BACKLOG_THRESHOLD_MIN.
BACKLOG_THRESHOLD_MIN: int = 10

# How many days of granular per-day per-store data the daily payload retains.
# 180 days gives users six months of history, lets MoM comparisons resolve cleanly
# for selections up to ~120 days, and still keeps the payload around 18MB raw
# (after closed-hour rows are dropped — see pipeline/seed_efficiency.py and the
# production collector's GROUP BY semantics).
RETENTION_DAYS: int = 180

# Staleness thresholds in minutes.
DAILY_STALE_THRESHOLD_MIN: int = 60 * 24       # daily payload stale after 24h
REALTIME_STALE_THRESHOLD_MIN: int = 30         # absorbs GHA 15-min cron jitter

# Tenant filter — all queries restrict to LKUS.
TENANT: str = "LKUS"

# Order completion status that means "made and handed off".
ORDER_STATUS_COMPLETED: int = 90

# Store numbers to exclude from the dashboard even if status=1 (test stores).
EXCLUDED_SHOP_PATTERNS: tuple[str, ...] = ("US00000", "US999")


@dataclass(frozen=True)
class MySQLCredentials:
    host: str
    port: int
    user: str
    password: str
    database: str | None = None


# The primary database this project's collectors query. All queries are
# fully-qualified (`luckyus_sales_order.t_order`), so the connection host
# must be the RDS instance that hosts that schema — NOT whichever host
# happens to live in the AWS secret.
PRIMARY_DATABASE = "luckyus_sales_order"

# RDS instance ID lookup. Data (DB → instance ID) lives in
# pipeline/config/rds_instances.json; the resolver below reads it and
# calls rds:DescribeDBInstances to get the live FQDN, then caches per
# process. Same pattern as luckin-store-ops-dashboard.
_RDS_INSTANCES_FILE = Path(__file__).resolve().parent / "rds_instances.json"
_db_to_instance_cache: dict[str, str] | None = None
_instance_to_endpoint_cache: dict[str, str] = {}


def _load_rds_instance_map() -> dict[str, str]:
    global _db_to_instance_cache
    if _db_to_instance_cache is None:
        with _RDS_INSTANCES_FILE.open(encoding="utf-8") as f:
            _db_to_instance_cache = json.load(f)
    return _db_to_instance_cache


def _rds_endpoint(instance_id: str) -> str:
    """Look up the live endpoint for an RDS instance ID. Cached per process."""
    if instance_id in _instance_to_endpoint_cache:
        return _instance_to_endpoint_cache[instance_id]
    import boto3
    rds = boto3.client("rds", region_name=AWS_REGION)
    resp = rds.describe_db_instances(DBInstanceIdentifier=instance_id)
    endpoint = resp["DBInstances"][0]["Endpoint"]["Address"]
    _instance_to_endpoint_cache[instance_id] = endpoint
    return endpoint


def _resolve_host(database: str, secret_host: str) -> str:
    """Pick the right host for the given database. Order:
      1. SALESORDER_HOST env var (or generic override)
      2. rds_instances.json + boto3 describe_db_instances
      3. The secret's `host` field (fallback for single-RDS setups)
    """
    override = os.environ.get("SALESORDER_HOST") if database == PRIMARY_DATABASE else None
    if override:
        return override
    instance_id = _load_rds_instance_map().get(database)
    if instance_id:
        return _rds_endpoint(instance_id)
    return secret_host


def load_mysql_credentials() -> MySQLCredentials:
    """Load credentials from AWS Secrets Manager and resolve the host to
    the RDS instance that actually contains PRIMARY_DATABASE.

    Expects the secret value to be a JSON document with keys:
      host, port, username, password, dbname (optional)
    """
    import boto3  # imported lazily so the seed scripts can run without boto3.

    client = boto3.client("secretsmanager", region_name=AWS_REGION)
    response = client.get_secret_value(SecretId=SECRET_ID)
    secret: dict[str, Any] = json.loads(response["SecretString"])
    return MySQLCredentials(
        host=_resolve_host(PRIMARY_DATABASE, secret["host"]),
        port=int(secret.get("port", 3306)),
        user=secret["username"],
        password=secret["password"],
        database=secret.get("dbname"),
    )
