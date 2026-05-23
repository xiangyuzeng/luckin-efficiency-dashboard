'use client';

import { useEffect, useRef, useState } from 'react';
import { labels } from '@/lib/labels';
import type { Freshness } from '@/lib/freshness';
import styles from './FreshnessBadge.module.css';

export function FreshnessBadge({ freshness }: { freshness: Freshness }) {
  const { ageMinutes, isStale } = freshness;
  const text = ageMinutes < 1 ? labels.freshness.updatedJustNow : labels.freshness.updatedAgo(ageMinutes);
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Close on Esc and on click-outside.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    function onClick(e: MouseEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  return (
    <span className={styles.wrap}>
      <span className={styles.badge} title={new Date(freshness.generatedAt).toLocaleString()}>
        <span className={`${styles.dot} ${isStale ? styles.dotStale : ''}`} />
        {text}
        {isStale && <span className={styles.staleHint}>{labels.freshness.stale}</span>}
      </span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.infoBtn}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="cadence-popover"
        aria-label={labels.cadence.info}
      >
        ?
      </button>
      {open && (
        <div
          ref={popoverRef}
          id="cadence-popover"
          role="dialog"
          aria-modal="false"
          aria-labelledby="cadence-title"
          className={styles.popover}
        >
          <div id="cadence-title" className={styles.popoverTitle}>{labels.cadence.title}</div>
          <ul className={styles.popoverList}>
            <li>{labels.cadence.daily}</li>
            <li>{labels.cadence.realtime}</li>
          </ul>
          <div className={styles.popoverFooter}>{labels.cadence.timezone}</div>
        </div>
      )}
    </span>
  );
}
