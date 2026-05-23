// Quick-range presets. Computed relative to the retention end date (= "today" in the dataset).

import type { ISODate } from '@/lib/types';

export type RangePresetId = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'last180' | 'custom';

export interface RangePreset {
  id: RangePresetId;
  labelKey: 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'last180' | 'custom';
  daysBack: number | null; // null = "custom" (no fixed range)
  // Whether endDate equals retentionEnd or shifts (e.g. yesterday).
  endOffset: number;       // 0 = retentionEnd, -1 = day before, etc.
}

export const RANGE_PRESETS: RangePreset[] = [
  { id: 'today',     labelKey: 'today',     daysBack: 0,   endOffset: 0 },
  { id: 'yesterday', labelKey: 'yesterday', daysBack: 0,   endOffset: -1 },
  { id: 'last7',     labelKey: 'last7',     daysBack: 6,   endOffset: 0 },
  { id: 'last30',    labelKey: 'last30',    daysBack: 29,  endOffset: 0 },
  { id: 'last90',    labelKey: 'last90',    daysBack: 89,  endOffset: 0 },
  { id: 'last180',   labelKey: 'last180',   daysBack: 179, endOffset: 0 },
  { id: 'custom',    labelKey: 'custom',    daysBack: null, endOffset: 0 },
];

export function shiftIso(iso: ISODate, deltaDays: number): ISODate {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Compute the {start,end} for a preset given the dataset's retentionEnd ("today").
export function rangeForPreset(preset: RangePreset, retentionEnd: ISODate): { startDate: ISODate; endDate: ISODate } {
  const end = shiftIso(retentionEnd, preset.endOffset);
  const start = preset.daysBack === null ? end : shiftIso(end, -preset.daysBack);
  return { startDate: start, endDate: end };
}

// Reverse-classify: which preset does the current {start,end} match?
// Falls back to 'custom' if no exact match.
export function presetForRange(startDate: ISODate, endDate: ISODate, retentionEnd: ISODate): RangePresetId {
  for (const p of RANGE_PRESETS) {
    if (p.id === 'custom') continue;
    const { startDate: s, endDate: e } = rangeForPreset(p, retentionEnd);
    if (s === startDate && e === endDate) return p.id;
  }
  return 'custom';
}
