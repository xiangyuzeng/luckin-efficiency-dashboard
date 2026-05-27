"""Pipeline-wide configuration.

Secrets (database connection) come from AWS Secrets Manager — never hardcoded.
The collector script uses boto3 to resolve `collector/mysql` in `us-east-1`.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
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


def load_mysql_credentials() -> MySQLCredentials:
    """Load credentials from AWS Secrets Manager.

    Expects the secret value to be a JSON document with keys:
      host, port, username, password, dbname (optional)
    """
    import boto3  # imported lazily so the seed scripts can run without boto3.

    client = boto3.client("secretsmanager", region_name=AWS_REGION)
    response = client.get_secret_value(SecretId=SECRET_ID)
    secret: dict[str, Any] = json.loads(response["SecretString"])
    return MySQLCredentials(
        host=secret["host"],
        port=int(secret.get("port", 3306)),
        user=secret["username"],
        password=secret["password"],
        database=secret.get("dbname"),
    )
