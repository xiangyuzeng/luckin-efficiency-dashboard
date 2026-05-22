'use client';

import { labels } from '@/lib/labels';
import type { Freshness } from '@/lib/freshness';
import styles from './FreshnessBadge.module.css';

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const { ageMinutes, isStale } = freshness;
  const text = ageMinutes < 1 ? labels.freshness.updatedJustNow : labels.freshness.updatedAgo(ageMinutes);
  return (
    <span className={styles.badge} title={new Date(freshness.generatedAt).toLocaleString()}>
      <span className={`${styles.dot} ${isStale ? styles.dotStale : ''}`} />
      {text}
      {isStale && <span className={styles.staleHint}>{labels.freshness.stale}</span>}
    </span>
  );
}
