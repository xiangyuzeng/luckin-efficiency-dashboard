'use client';

import { useMemo, useState } from 'react';
import { formatCount, formatDuration, NONOPERATING_DISPLAY } from '@/lib/formatters';
import { labels } from '@/lib/labels';
import type { IntervalSlotAggregate } from '@/lib/aggregate';
import { INTERVAL_TABLE_METRIC_COLUMNS, METRICS } from '@/lib/metrics';
import type { MetricKey } from '@/lib/types';
import styles from './IntervalTable.module.css';

type SortKey = 'slot' | MetricKey;
type Dir = 'asc' | 'desc';

interface Props {
  rows: IntervalSlotAggregate[];
}

function pick(row: IntervalSlotAggregate, key: MetricKey): number | null {
  switch (key) {
    case 'efficiencyDuration': return row.efficiencyDurationSec;
    case 'avgOrderResponse': return row.avgOrderResponseSec;
    case 'avgEquivMakeTime': return row.avgEquivMakeTimeSec;
    case 'equivProductsMade': return row.equivProductsMade;
    default: return null;
  }
}

function render(key: MetricKey, val: number | null): string {
  if (val === null) return NONOPERATING_DISPLAY;
  const m = METRICS[key];
  if (m.format === 'duration') return formatDuration(val);
  if (m.format === 'count') return formatCount(val);
  return String(val);
}

export function IntervalTable({ rows }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('slot');
  const [dir, setDir] = useState<Dir>('asc');

  const sorted = useMemo(() => {
    const factor = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      if (sortKey === 'slot') return a.slot.localeCompare(b.slot) * factor;
      const av = pick(a, sortKey);
      const bv = pick(b, sortKey);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * factor;
    });
  }, [rows, sortKey, dir]);

  function toggle(next: SortKey) {
    if (next === sortKey) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(next); setDir('asc'); }
  }

  function ariaSort(target: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== target) return 'none';
    return dir === 'asc' ? 'ascending' : 'descending';
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>{labels.interval.title}</div>
          <div className={styles.subtitle}>{labels.interval.subtitle}</div>
        </div>
      </div>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <thead className={styles.thead}>
            <tr>
              <th aria-sort={ariaSort('slot')}>
                <button type="button" onClick={() => toggle('slot')}>{labels.interval.slot}</button>
              </th>
              {INTERVAL_TABLE_METRIC_COLUMNS.map((key) => (
                <th key={key} aria-sort={ariaSort(key)}>
                  <button type="button" onClick={() => toggle(key)}>{METRICS[key].labelZh}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className={styles.tbody}>
            {sorted.map((row) => (
              <tr key={row.slot}>
                <td className={styles.slot}>{row.slot}</td>
                {INTERVAL_TABLE_METRIC_COLUMNS.map((key) => {
                  const v = pick(row, key);
                  return <td key={key} className={v === null ? styles.dim : ''}>{render(key, v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
