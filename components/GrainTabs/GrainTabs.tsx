'use client';

import { useRef } from 'react';
import { labels } from '@/lib/labels';
import type { Grain } from '@/lib/types';
import styles from './GrainTabs.module.css';

interface Props {
  grain: Grain;
  onChange: (next: Grain) => void;
}

const ORDER: Grain[] = ['city', 'region', 'store'];
const LABEL: Record<Grain, string> = {
  city: labels.tabs.cityGrain,
  region: labels.tabs.regionGrain,
  store: labels.tabs.storeGrain,
};

export function GrainTabs({ grain, onChange }: Props) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function handleKey(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    let nextIdx = idx;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % ORDER.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + ORDER.length) % ORDER.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = ORDER.length - 1;
    else return;
    e.preventDefault();
    const next = ORDER[nextIdx];
    if (next) {
      onChange(next);
      refs.current[nextIdx]?.focus();
    }
  }

  return (
    <div role="tablist" aria-label={labels.tabs.cityGrain} className={styles.tablist}>
      {ORDER.map((g, i) => (
        <button
          key={g}
          ref={(el) => { refs.current[i] = el; }}
          role="tab"
          aria-selected={grain === g}
          tabIndex={grain === g ? 0 : -1}
          className={`${styles.tab} ${grain === g ? styles.active : ''}`}
          onClick={() => onChange(g)}
          onKeyDown={(e) => handleKey(e, i)}
          type="button"
        >
          {LABEL[g]}
        </button>
      ))}
    </div>
  );
}
