'use client';

import { ReactNode } from 'react';
import { formatMetricValue } from '@/lib/formatters';
import { labels } from '@/lib/labels';
import type { MetricDefinition } from '@/lib/types';
import styles from './KpiCard.module.css';

interface Props {
  metric: MetricDefinition;
  value: number | null;
  // Optional slot rendered under the value — used for ComparisonBadge[] or the RealtimeFreshnessBadge.
  footer?: ReactNode;
}

export function KpiCard({ metric, value, footer }: Props) {
  const isPending = metric.source === 'pending' || value === null;
  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={styles.title}>{metric.labelZh}</span>
        <button type="button" className={styles.tooltipBtn} aria-label={`${metric.labelZh}：${metric.tooltipZh}`}>
          i
          <span className={styles.tooltipBubble} role="tooltip">
            <strong>{metric.labelZh}</strong>
            {metric.tooltipZh}
            <br />
            <span style={{ opacity: 0.7 }}>公式：{metric.formulaZh}</span>
          </span>
        </button>
      </div>
      <div className={isPending ? `${styles.value} ${styles.valuePending}` : styles.value}>
        {isPending ? labels.pending : formatMetricValue(value, metric.format, metric.decimals)}
      </div>
      {footer}
    </div>
  );
}

export { styles as kpiStyles };
