'use client';

import { formatMetricDelta } from '@/lib/formatters';
import { labels } from '@/lib/labels';
import type { MetricComparison, MetricFormat } from '@/lib/types';
import styles from './KpiCard.module.css';

interface Props {
  kind: MetricComparison;
  delta: number | null;          // current - prior, in metric units
  format: MetricFormat;
  decimals?: number;
  // All metrics on this board are goodDirection: 'down'. A *negative* delta is improvement (green),
  // a *positive* delta is regression (red).
  goodDirection: 'down';
}

export function ComparisonBadge({ kind, delta, format, decimals, goodDirection: _gd }: Props) {
  const label = kind === 'wow' ? labels.comparison.wow : labels.comparison.mom;

  if (delta === null || Number.isNaN(delta)) {
    return (
      <span className={`${styles.badge} ${styles.badgeNone}`}>
        <span className={styles.label}>{label}</span>
        {labels.comparison.noData}
      </span>
    );
  }

  // For 'down' direction: negative=improve, positive=regress.
  let cls = styles.badgeFlat;
  let arrow = '→';
  if (delta < 0) {
    cls = styles.badgeImprove;
    arrow = '↓';
  } else if (delta > 0) {
    cls = styles.badgeRegress;
    arrow = '↑';
  }

  return (
    <span className={`${styles.badge} ${cls}`}>
      <span className={styles.label}>{label}</span>
      <span className={styles.arrow}>{arrow}</span>
      {formatMetricDelta(delta, format, decimals)}
    </span>
  );
}
