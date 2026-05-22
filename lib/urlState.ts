// URL state helpers. We use plain query params (?start=…&end=…&city=…&region=…&store=…&grain=…)
// so that hitting reload or sharing a link restores the entire UI state.

import type { FilterScope, Grain } from '@/lib/types';

export interface UrlState {
  filter: FilterScope;
  grain: Grain;
}

export function parseUrlState(
  search: URLSearchParams,
  defaults: { startDate: string; endDate: string },
): UrlState {
  const startDate = search.get('start') ?? defaults.startDate;
  const endDate = search.get('end') ?? defaults.endDate;
  const cityId = search.get('city') || null;
  const regionId = search.get('region') || null;
  const shopNumber = search.get('store') || null;
  const grainParam = (search.get('grain') ?? 'store') as Grain;
  const grain: Grain = grainParam === 'city' || grainParam === 'region' || grainParam === 'store' ? grainParam : 'store';
  return {
    filter: { startDate, endDate, cityId, regionId, shopNumber },
    grain,
  };
}

export function buildSearch(state: UrlState, defaults: { startDate: string; endDate: string }): string {
  const sp = new URLSearchParams();
  if (state.filter.startDate !== defaults.startDate) sp.set('start', state.filter.startDate);
  if (state.filter.endDate !== defaults.endDate) sp.set('end', state.filter.endDate);
  if (state.filter.cityId) sp.set('city', state.filter.cityId);
  if (state.filter.regionId) sp.set('region', state.filter.regionId);
  if (state.filter.shopNumber) sp.set('store', state.filter.shopNumber);
  if (state.grain !== 'store') sp.set('grain', state.grain);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// Clamp a date range to the retention window. Returns whether the range was modified.
export function clampToRetention(
  start: string,
  end: string,
  retentionStart: string,
  retentionEnd: string,
): { startDate: string; endDate: string; clamped: boolean } {
  let s = start < retentionStart ? retentionStart : start;
  let e = end > retentionEnd ? retentionEnd : end;
  if (s > e) {
    // Inverted range — collapse to retention end day
    s = retentionEnd;
    e = retentionEnd;
  }
  const clamped = s !== start || e !== end;
  return { startDate: s, endDate: e, clamped };
}
