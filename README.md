# Luckin Efficiency Dashboard (效能看板)

Standalone production board for Luckin Coffee North America. Focuses on
order-fulfillment timing and order backlog (压单): how fast stores accept
and make orders, and how much work is queued up. Simplified-Chinese UI;
English code, identifiers, and commits.

Deploys to Vercel. The public client never touches a database.

---

## Data flow

```
              ┌──────────────────────────────┐
              │  GitHub Actions runner       │
              │  (internal network egress)   │
              └─────────────┬────────────────┘
                            │ AWS Secrets Manager (collector/mysql)
                            ▼
            ┌──────────────────────────────────────┐
            │  luckyus_sales_order  (read-only)    │
            │  - t_order                           │
            │  - t_order_make                      │
            │  - t_order_item                      │
            │  luckyus_opshop.t_shop_info          │
            └──────────────┬───────────────────────┘
                           │ SELECT-only
                           ▼
       ┌───────────────────────────────────────────────┐
       │ pipeline/collector.py        (daily)          │
       │ pipeline/realtime_collector.py (~15 min)      │
       └────────────────────┬──────────────────────────┘
                            │ committed JSON, git push
                            ▼
       ┌───────────────────────────────────────────────┐
       │ data/efficiency.json   ── heavy, daily         │
       │ data/realtime.json     ── tiny, ~15 min        │
       └────────────────────┬──────────────────────────┘
                            │ Vercel build
                            ▼
                   ┌─────────────────┐
                   │  Next.js (App)  │
                   │  Public users   │
                   └─────────────────┘
```

Two payloads, two cadences:

* `data/efficiency.json` — 180 days of per-day × per-store + per-day × per-half-hour × per-store **raw numerators and denominators**. The client weight-aggregates these for any date range × any grain. The FilterBar exposes quick-range chips (今日 / 昨日 / 近 7 天 / 近 30 天 / 近 90 天 / 近 180 天 / 自定义) plus the raw date inputs for custom ranges.
* `data/realtime.json` — current backlog snapshot only. Refreshed on a tight cron and overlaid on top of the daily payload's KPI cards and backlog column.

Hover the **"?"** next to the freshness badge in the header for the current refresh cadence (daily 02:30 EST + realtime every 15 min).

**Seed mode.** Both payloads carry `"_isSeed": true` when produced by `pipeline/seed_*.py`. On every Vercel build, `pipeline/freshen_payloads.py` runs (via the npm `prebuild` hook) and re-anchors seed dates so the latest day is always today (US/Eastern) and `generatedAt` is current. The script is a no-op on production-pipeline output (which omits the flag), so workflow-generated data passes through untouched.

---

## Backlog (压单) definition

An order is *backlogged* if:
* it has been *finished* but `(finish_time − pay_time) > 10 min`, OR
* it is *still open* and `(now − pay_time) > 10 min`.

`BACKLOG_THRESHOLD_MIN = 10` is a config constant
(`pipeline/config/settings.py` mirrored in `lib/metrics.ts`). Trivial to change
after business sign-off.

---

## Confirmed / decided / derived sources

| Item | Status | Notes |
|---|---|---|
| `t_order.pay_time` | confirmed | datetime, indexed |
| `t_order.status=90` | confirmed | "completed" |
| `t_order_make.accept_time` / `finish_time` | confirmed | 1:1 with t_order via order_id |
| Channel codes 1/2/3 pickup, 8/9/10 delivery | confirmed | not used as a KPI but referenced in schema map |
| 现制/外购 mapping | **decided** | `t_order_item.one_category_name` is English (Drink / Food / Merchandise). Mapping ships in `pipeline/config/category_mapping.py`: **Drink + Food → 现制, Merchandise → 外购**. Metric registry marks affected metrics `source:'pipeline-mapping'`. |
| City / Region | **decided** | `t_shop_info.locality_name` and `administrative_area_name` are NULL for every LKUS row. Mapping ships in `pipeline/config/store_geography.py`: **1 city × 4 Manhattan regions × 12 stores**. Metric registry marks `source:'pipeline-constant'`. |
| `operatingToday` | derived | "has any `pay_time` on this US/Eastern day"; no per-store open-status table available. |

`pipeline/schema_probe.py` re-verifies these and writes the live map to `pipeline/schema_map.json` on every daily refresh. Failures degrade gracefully — the build never blocks on a single missing column.

---

## Local development

```bash
npm install
npm run seed              # python3 — regenerates a believable seed payload
npm run dev               # http://localhost:3000
npm run typecheck         # tsc --noEmit
npm run lint
npm run validate:payload  # checks data/*.json against the contract
npm run build             # runs last after manual smoke
```

Seed data ships in `data/efficiency.json` and `data/realtime.json` so the UI runs without any database access. `npm run seed` regenerates them deterministically.

---

## Production pipeline

Three refresh paths are supported. Choose one for daily, optionally a different one for realtime:

| Path | Daily | Realtime | Notes |
|---|---|---|---|
| **GitHub Actions** (`.github/workflows/`) | ✅ `30 7 * * *` | ✅ `*/15 * * * *` | Recommended. Runner needs network reach into the internal MySQL — same constraint as the daily workflow. Realtime stale-threshold is **30 min** to absorb GHA cron jitter (cannot reliably go below 10 min). |
| **Internal EC2 cron** | ✅ | ✅ down to ~1 min | `bash pipeline/refresh.sh` / `bash pipeline/refresh_realtime.sh`. Uses pymysql + AWS Secrets Manager (`collector/mysql`, `us-east-1`). |
| **mcp-db-gateway** (`http://10.238.3.43:8080`) | optional | optional | For ad-hoc backfill / debugging — wrap the SQL in `pipeline/collector.py`'s queries via the gateway tools. |

Required secrets:

* `AWS_ROLE_ARN` — assumed by `aws-actions/configure-aws-credentials`
* The role must have `secretsmanager:GetSecretValue` on `arn:aws:secretsmanager:us-east-1:*:secret:collector/mysql-*`
* The secret value is JSON: `{ host, port, username, password, dbname? }`

---

## Architecture decisions

| Decision | Why |
|---|---|
| Two payloads (daily + realtime) | Lets us keep 压单 within the 15-minute SLA without rebuilding the 40-day granular history every refresh. |
| Raw `Σnum`/`Σden` in `dailyStoreRows`, never precomputed averages | Weighted aggregation requires the numerators and denominators. Storing `avg_duration` per day would force a naive average-of-averages for any range > 1 day. |
| Client-side tab roll-up | Instant grain switching with zero refetch; the payload carries the city → region → store hierarchy. |
| Semantic coloring on `goodDirection: 'down'` | Decreases (improvements) render green ↓; increases (regressions) red ↑. Matches the mockup. |
| `BACKLOG_THRESHOLD_MIN = 10` as config | One source of truth in `pipeline/config/settings.py` and `lib/metrics.ts`; easy to revise. |
| Pipeline-constant geography | `t_shop_info` is NULL; we ship a constant map and clearly mark `source:'pipeline-constant'` so the assumption is visible. |
| GHA cron `*/15 * * * *` for realtime | GitHub Actions does not reliably run < 10 min. 15-min cadence with a 30-min stale threshold absorbs jitter. |

---

## File layout

```
luckin-efficiency-dashboard/
├─ app/                            # Next.js App Router
├─ components/                     # UI components (FilterBar, KpiCard, GrainTabs, DetailTable, IntervalTable, Charts, ExportButton, FreshnessBadge)
├─ lib/                            # tokens, labels, types, metrics, aggregate, comparison, freshness, formatters, loaders, urlState, export
├─ data/                           # efficiency.json + realtime.json (committed; pipeline regenerates)
├─ pipeline/
│  ├─ config/                      # settings.py, category_mapping.py, store_geography.py
│  ├─ collector.py                 # daily SELECT-only
│  ├─ realtime_collector.py        # realtime SELECT-only
│  ├─ frontend_formatter.py        # writes data/efficiency.json
│  ├─ schema_probe.py              # writes pipeline/schema_map.json
│  ├─ seed_efficiency.py           # deterministic seed
│  ├─ seed_realtime.py
│  ├─ refresh.sh
│  └─ refresh_realtime.sh
├─ scripts/validate_payload.ts     # CI gate
└─ .github/workflows/              # refresh-daily.yml + refresh-realtime.yml
```

---

## Open follow-ups

* Confirm with ops/business whether the **Drink+Food → 现制, Merchandise → 外购** mapping is accurate for the equivalent-products formula. Single source of truth: `pipeline/config/category_mapping.py`.
* When `t_shop_info.locality_name` / `administrative_area_name` are populated, switch `pipeline/config/store_geography.py` to read from the DB and flip `hierarchy.source` from `pipeline-constant` to `shop-info`.
