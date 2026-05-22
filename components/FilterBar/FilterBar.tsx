'use client';

import { useMemo } from 'react';
import { labels } from '@/lib/labels';
import type { FilterScope, Grain, Hierarchy, StoreNode } from '@/lib/types';
import styles from './FilterBar.module.css';

interface Props {
  filter: FilterScope;
  hierarchy: Hierarchy;
  retentionStart: string;
  retentionEnd: string;
  // Stores considered "operating today" (set of shopNumbers) — drives the store dropdown.
  operatingTodayStoreNumbers: Set<string>;
  // Notes
  rangeNote: 'outside' | 'empty' | null;
  // Callbacks
  onChange: (next: FilterScope) => void;
  onReset: () => void;
  onExport: () => void;
  grain: Grain;
}

export function FilterBar(props: Props) {
  const { filter, hierarchy, retentionStart, retentionEnd, operatingTodayStoreNumbers, rangeNote, onChange, onReset, onExport } = props;

  const cities = hierarchy.cities;
  const regions = useMemo(() => {
    if (!filter.cityId) return cities.flatMap((c) => c.regions);
    const city = cities.find((c) => c.id === filter.cityId);
    return city ? city.regions : [];
  }, [cities, filter.cityId]);

  const stores: StoreNode[] = useMemo(() => {
    return hierarchy.stores.filter((s) => {
      if (s.status !== 'active') return false;
      if (filter.regionId && s.regionId !== filter.regionId) return false;
      if (filter.cityId && s.cityId !== filter.cityId) return false;
      if (!operatingTodayStoreNumbers.has(s.shopNumber)) return false;
      return true;
    });
  }, [hierarchy.stores, filter.cityId, filter.regionId, operatingTodayStoreNumbers]);

  return (
    <div className={styles.bar}>
      <div className={styles.field}>
        <span className={styles.label}>{labels.filter.dateRange}</span>
        <div className={styles.dateGroup}>
          <input
            type="date"
            className={styles.input}
            value={filter.startDate}
            min={retentionStart}
            max={filter.endDate}
            onChange={(e) => onChange({ ...filter, startDate: e.target.value })}
            aria-label={labels.filter.from}
          />
          <span className={styles.dash}>—</span>
          <input
            type="date"
            className={styles.input}
            value={filter.endDate}
            min={filter.startDate}
            max={retentionEnd}
            onChange={(e) => onChange({ ...filter, endDate: e.target.value })}
            aria-label={labels.filter.to}
          />
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{labels.filter.city}</span>
        <select
          className={styles.select}
          value={filter.cityId ?? ''}
          onChange={(e) => {
            const next = e.target.value || null;
            onChange({ ...filter, cityId: next, regionId: null, shopNumber: null });
          }}
        >
          <option value="">{labels.filter.all}</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.labelZh}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{labels.filter.region}</span>
        <select
          className={styles.select}
          value={filter.regionId ?? ''}
          onChange={(e) => {
            const next = e.target.value || null;
            onChange({ ...filter, regionId: next, shopNumber: null });
          }}
        >
          <option value="">{labels.filter.all}</option>
          {regions.map((r) => (
            <option key={r.id} value={r.id}>{r.labelZh}</option>
          ))}
        </select>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>{labels.filter.store}</span>
        <select
          className={styles.select}
          value={filter.shopNumber ?? ''}
          onChange={(e) => onChange({ ...filter, shopNumber: e.target.value || null })}
        >
          <option value="">{labels.filter.all}</option>
          {stores.map((s) => (
            <option key={s.shopNumber} value={s.shopNumber}>
              {s.shopNumber} · {s.shopNameZh ?? s.shopNameEn}
            </option>
          ))}
        </select>
      </div>

      <button type="button" className={styles.reset} onClick={onReset}>
        {labels.filter.reset}
      </button>

      <button type="button" className={styles.export} onClick={onExport}>
        {labels.filter.exportData}
      </button>

      {rangeNote === 'outside' && <div className={styles.note}>{labels.filter.rangeNoteOutside}</div>}
      {rangeNote === 'empty' && <div className={styles.note}>{labels.filter.rangeNoteEmpty}</div>}
    </div>
  );
}
