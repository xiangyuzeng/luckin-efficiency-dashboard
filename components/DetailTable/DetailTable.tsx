'use client';

import { useMemo, useState } from 'react';
import { formatCount, formatDuration, formatPercent, NONOPERATING_DISPLAY } from '@/lib/formatters';
import { labels } from '@/lib/labels';
import { DETAIL_TABLE_METRIC_COLUMNS, METRICS } from '@/lib/metrics';
import type { Grain, GrainRow, MetricKey } from '@/lib/types';
import styles from './DetailTable.module.css';

type SortDir = 'asc' | 'desc';
type SortKey =
  | { kind: 'identity'; col: 'city' | 'region' | 'store' }
  | { kind: 'metric'; col: MetricKey };

interface Props {
  rows: GrainRow[];
  grain: Grain;
}

function sortRows(rows: GrainRow[], sortKey: SortKey | null, dir: SortDir): GrainRow[] {
  if (!sortKey) return rows;
  const factor = dir === 'asc' ? 1 : -1;
  const collator = new Intl.Collator('zh-CN');
  return [...rows].sort((a, b) => {
    if (sortKey.kind === 'identity') {
      const av = sortKey.col === 'city' ? a.cityLabel : sortKey.col === 'region' ? a.regionLabel : a.shopLabel;
      const bv = sortKey.col === 'city' ? b.cityLabel : sortKey.col === 'region' ? b.regionLabel : b.shopLabel;
      return collator.compare(av ?? '', bv ?? '') * factor;
    }
    const av = metricValue(a, sortKey.col);
    const bv = metricValue(b, sortKey.col);
    // null sorts after numbers
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return (av - bv) * factor;
  });
}

function metricValue(row: GrainRow, key: MetricKey): number | null {
  switch (key) {
    case 'efficiencyDuration': return row.metrics.efficiencyDurationSec;
    case 'avgOrderResponse': return row.metrics.avgOrderResponseSec;
    case 'avgEquivMakeTime': return row.metrics.avgEquivMakeTimeSec;
    case 'backlogEquivProducts': return row.realtimeBacklogEquivProducts;
    case 'backlogRate': return row.metrics.backlogRate;
    case 'equivProductsMade': return row.metrics.equivProductsMade;
    default: return null;
  }
}

function renderMetric(key: MetricKey, val: number | null): string {
  const m = METRICS[key];
  if (val === null) return NONOPERATING_DISPLAY;
  switch (m.format) {
    case 'duration': return formatDuration(val);
    case 'percent': return formatPercent(val, m.decimals ?? 2);
    case 'count': return formatCount(val);
  }
}

// For the data-bar effect, normalize each metric column to its max in the visible rows.
function buildScales(rows: GrainRow[]): Record<MetricKey, number> {
  const scales: Partial<Record<MetricKey, number>> = {};
  for (const key of DETAIL_TABLE_METRIC_COLUMNS) {
    let max = 0;
    for (const r of rows) {
      const v = metricValue(r, key);
      if (v !== null && v > max) max = v;
    }
    scales[key] = max;
  }
  return scales as Record<MetricKey, number>;
}

export function DetailTable({ rows, grain }: Props) {
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  const scales = useMemo(() => buildScales(sorted), [sorted]);

  function toggleSort(next: SortKey) {
    if (sortKey && sameKey(sortKey, next)) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(next);
      setSortDir('desc');
    }
  }

  function ariaSort(target: SortKey): 'ascending' | 'descending' | 'none' {
    if (!sortKey || !sameKey(sortKey, target)) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }

  if (rows.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>{labels.table.noOperatingStores}</div>
      </div>
    );
  }

  const showCity = true;
  const showRegion = grain !== 'city';
  const showStore = grain === 'store';

  return (
    <div className={styles.wrapper}>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              {showCity && (
                <th aria-sort={ariaSort({ kind: 'identity', col: 'city' })}>
                  <button type="button" onClick={() => toggleSort({ kind: 'identity', col: 'city' })}>
                    {labels.table.city}
                  </button>
                </th>
              )}
              {showRegion && (
                <th aria-sort={ariaSort({ kind: 'identity', col: 'region' })}>
                  <button type="button" onClick={() => toggleSort({ kind: 'identity', col: 'region' })}>
                    {labels.table.region}
                  </button>
                </th>
              )}
              {showStore && (
                <th aria-sort={ariaSort({ kind: 'identity', col: 'store' })}>
                  <button type="button" onClick={() => toggleSort({ kind: 'identity', col: 'store' })}>
                    {labels.table.store}
                  </button>
                </th>
              )}
              {DETAIL_TABLE_METRIC_COLUMNS.map((key) => (
                <th key={key} aria-sort={ariaSort({ kind: 'metric', col: key })}>
                  <button type="button" onClick={() => toggleSort({ kind: 'metric', col: key })}>
                    {METRICS[key].labelZh}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={styles.tbody}>
            {sorted.map((row) => {
              const operating = row.metrics.operating;
              return (
                <tr key={row.key}>
                  {showCity && <td className={styles.identity}>{row.cityLabel ?? NONOPERATING_DISPLAY}</td>}
                  {showRegion && <td className={styles.identity}>{row.regionLabel ?? NONOPERATING_DISPLAY}</td>}
                  {showStore && (
                    <td className={styles.identity}>
                      {row.shopNumber} · {row.shopLabel ?? NONOPERATING_DISPLAY}
                    </td>
                  )}
                  {DETAIL_TABLE_METRIC_COLUMNS.map((key) => {
                    const v = metricValue(row, key);
                    const shouldDash = !operating || (key === 'backlogEquivProducts' ? v === null : v === null);
                    const max = scales[key];
                    const widthPct = v !== null && max > 0 ? Math.min(100, (v / max) * 100) : 0;
                    return (
                      <td key={key} className={`${styles.metric} ${shouldDash ? styles.nonOp : ''}`}>
                        {shouldDash ? NONOPERATING_DISPLAY : renderMetric(key, v)}
                        {!shouldDash && v !== null && (
                          <span className={styles.metricBar} style={{ width: `${widthPct.toFixed(1)}%` }} />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function sameKey(a: SortKey, b: SortKey): boolean {
  if (a.kind !== b.kind) return false;
  return a.col === b.col;
}
