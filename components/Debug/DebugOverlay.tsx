'use client';

// Render only when URL contains ?debug=1. Shows source confidence per metric,
// collector timestamps, row coverage in the filtered window, and raw values.

import { useMemo } from 'react';
import type { DailyStoreRow, EfficiencyPayload, MetricKey, RealtimePayload } from '@/lib/types';
import { METRICS } from '@/lib/metrics';
import { aggregate } from '@/lib/aggregate';
import styles from './DebugOverlay.module.css';

interface Props {
  efficiency: EfficiencyPayload;
  realtime: RealtimePayload;
  filteredDaily: DailyStoreRow[];
  rangeFrom: string;
  rangeTo: string;
  activeStoreCount: number;
}

// Each metric needs a populated source field to count as "row coverage". Mirrors aggregate.ts branches.
const COVERAGE_FIELD: Record<MetricKey, (r: DailyStoreRow) => boolean> = {
  efficiencyDuration:   (r) => r.responseOrdersCount > 0 || r.equivProductsMadeSum > 0,
  avgOrderResponse:     (r) => r.responseOrdersCount > 0,
  avgEquivMakeTime:     (r) => r.equivProductsMadeSum > 0,
  backlogEquivProducts: (r) => r.backlogOrders > 0,
  backlogRate:          (r) => r.totalOrders > 0,
  equivProductsMade:    (r) => r.equivProductsMadeSum > 0,
};

function ageString(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return `${Math.floor(mins / 1440)}d ago`;
}

export function DebugOverlay({ efficiency, realtime, filteredDaily, rangeFrom, rangeTo, activeStoreCount }: Props) {
  const agg = useMemo(() => aggregate(filteredDaily), [filteredDaily]);
  const total = filteredDaily.length;

  // AggregatedMetrics uses different field names than MetricKey — map them.
  const AGG_FIELD: Record<MetricKey, keyof typeof agg> = {
    efficiencyDuration:   'efficiencyDurationSec',
    avgOrderResponse:     'avgOrderResponseSec',
    avgEquivMakeTime:     'avgEquivMakeTimeSec',
    backlogEquivProducts: 'equivProductsMade', // closest available; raw backlog lives on realtime
    backlogRate:          'backlogRate',
    equivProductsMade:    'equivProductsMade',
  };

  const rows = useMemo(() => {
    return (Object.keys(METRICS) as MetricKey[]).map((key) => {
      const def = METRICS[key];
      let populated = 0;
      const cov = COVERAGE_FIELD[key];
      for (const r of filteredDaily) if (cov(r)) populated += 1;
      const rawValue = agg[AGG_FIELD[key]];
      const value = typeof rawValue === 'number' ? rawValue : null;
      const ts = efficiency.collectorTimestamps?.[key] ?? efficiency.collectorTimestamps?.daily;
      return { key, label: def.labelZh, source: efficiency.sources?.[key] ?? def.source, populated, value, ts };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [efficiency, filteredDaily, agg]);

  const realtimeTs = efficiency.collectorTimestamps?.realtime ?? realtime.generatedAt;

  return (
    <aside className={styles.overlay} aria-label="Debug overlay">
      <header className={styles.header}>
        <strong>Debug overlay</strong>
        <span className={styles.meta}>?debug=1</span>
      </header>
      <div className={styles.section}>
        <div className={styles.kv}><span>Daily payload</span><span>{efficiency.generatedAt} ({ageString(efficiency.generatedAt)})</span></div>
        <div className={styles.kv}><span>Realtime payload</span><span>{realtime.generatedAt} ({ageString(realtime.generatedAt)})</span></div>
        <div className={styles.kv}><span>Realtime collector</span><span>{realtimeTs ? `${realtimeTs} (${ageString(realtimeTs)})` : '—'}</span></div>
        <div className={styles.kv}><span>Window</span><span>{rangeFrom} → {rangeTo}</span></div>
        <div className={styles.kv}><span>Stores in scope</span><span>{activeStoreCount}</span></div>
        <div className={styles.kv}><span>Daily rows in window</span><span>{total}</span></div>
        <div className={styles.kv}><span>Interval rows total</span><span>{efficiency.intervalRows.length}</span></div>
      </div>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>Metric</th>
            <th>Source</th>
            <th>Rows w/ data</th>
            <th>Value</th>
            <th>Run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={r.value === null ? styles.rowNull : ''}>
              <td>{r.label}<div className={styles.sub}>{r.key}</div></td>
              <td><span className={`${styles.pill} ${styles[`pill_${r.source}`] ?? ''}`}>{r.source}</span></td>
              <td className={styles.numeric}>{r.populated} / {total}</td>
              <td className={styles.numeric}>{r.value === null ? '—' : Number.isFinite(r.value) ? r.value.toFixed(4) : String(r.value)}</td>
              <td className={styles.sub}>{r.ts ? ageString(r.ts) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}
