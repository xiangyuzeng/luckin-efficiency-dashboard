'use client';

import { labels } from '@/lib/labels';
import type { Freshness } from '@/lib/freshness';
import styles from './FreshnessBadge.module.css';

export function RealtimeFreshnessBadge({ freshness, available }: { freshness: Freshness | null; available: boolean }) {
  if (!available || !freshness) {
    return (
      <span className={`${styles.realtimeBadge} ${styles.stale}`}>
        <span className={styles.dot} />
        {labels.freshness.realtimeUnavailable}
      </span>
    );
  }
  const { ageMinutes, isStale } = freshness;
  const text = ageMinutes < 1 ? labels.freshness.realtimeJustNow : labels.freshness.realtimeAgo(ageMinutes);
  return (
    <span className={`${styles.realtimeBadge} ${isStale ? styles.stale : ''}`}>
      <span className={styles.dot} />
      {text}
    </span>
  );
}
