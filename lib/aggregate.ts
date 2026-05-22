// Weighted aggregation engine. Never average per-day averages — sum numerators and denominators, then divide.
//
// This file owns the math for:
//   - Five KPI cards (one aggregate over filtered store-day rows)
//   - Detail table roll-up by city / region / store grain
//   - Interval table aggregation by half-hour slot
//   - Curve series (interval, by store)

import type {
  AggregatedMetrics,
  DailyStoreRow,
  FilterScope,
  Grain,
  GrainRow,
  HalfHourSlot,
  Hierarchy,
  IntervalRow,
  RealtimePayload,
  StoreNode,
} from '@/lib/types';
import { HALF_HOUR_SLOTS } from '@/lib/types';

// ---- Filter helpers ----

export function filterStoresByScope(
  hierarchy: Hierarchy,
  scope: Pick<FilterScope, 'cityId' | 'regionId' | 'shopNumber'>,
): StoreNode[] {
  return hierarchy.stores.filter((s) => {
    if (s.status !== 'active') return false;
    if (scope.shopNumber && s.shopNumber !== scope.shopNumber) return false;
    if (scope.regionId && s.regionId !== scope.regionId) return false;
    if (scope.cityId && s.cityId !== scope.cityId) return false;
    return true;
  });
}

export function filterDailyRows(rows: DailyStoreRow[], scope: FilterScope, activeShopNumbers: Set<string>): DailyStoreRow[] {
  return rows.filter((r) => {
    if (r.date < scope.startDate || r.date > scope.endDate) return false;
    return activeShopNumbers.has(r.shopNumber);
  });
}

export function filterIntervalRows(rows: IntervalRow[], scope: FilterScope, activeShopNumbers: Set<string>): IntervalRow[] {
  return rows.filter((r) => {
    if (r.date < scope.startDate || r.date > scope.endDate) return false;
    return activeShopNumbers.has(r.shopNumber);
  });
}

// ---- Core: weighted aggregate over an arbitrary slice ----

export function aggregate(rows: DailyStoreRow[]): AggregatedMetrics {
  let sumResp = 0;
  let sumRespCnt = 0;
  let sumMake = 0;
  let sumEquiv = 0;
  let sumBacklog = 0;
  let sumTotal = 0;
  let anyOperating = false;

  for (const r of rows) {
    sumResp += r.responseSecondsSum;
    sumRespCnt += r.responseOrdersCount;
    sumMake += r.makeSecondsSum;
    sumEquiv += r.equivProductsMadeSum;
    sumBacklog += r.backlogOrders;
    sumTotal += r.totalOrders;
    if (r.operatingToday) anyOperating = true;
  }

  const avgResp = sumRespCnt > 0 ? sumResp / sumRespCnt : null;
  const avgMake = sumEquiv > 0 ? sumMake / sumEquiv : null;
  const effDur = avgResp !== null && avgMake !== null ? avgResp + avgMake : null;
  const backlogRate = sumTotal > 0 ? sumBacklog / sumTotal : null;

  return {
    efficiencyDurationSec: effDur,
    avgOrderResponseSec: avgResp,
    avgEquivMakeTimeSec: avgMake,
    backlogRate,
    equivProductsMade: sumEquiv,
    totalOrders: sumTotal,
    backlogOrders: sumBacklog,
    operating: anyOperating,
  };
}

// ---- Grain roll-up ----

interface GrainKey {
  cityId: string | null;
  regionId: string | null;
  shopNumber: string | null;
}

function grainKeyOf(store: StoreNode, grain: Grain): GrainKey {
  switch (grain) {
    case 'city':
      return { cityId: store.cityId, regionId: null, shopNumber: null };
    case 'region':
      return { cityId: store.cityId, regionId: store.regionId, shopNumber: null };
    case 'store':
      return { cityId: store.cityId, regionId: store.regionId, shopNumber: store.shopNumber };
  }
}

function grainKeyString(k: GrainKey): string {
  return `${k.cityId ?? ''}|${k.regionId ?? ''}|${k.shopNumber ?? ''}`;
}

export function rollUp(
  rows: DailyStoreRow[],
  hierarchy: Hierarchy,
  grain: Grain,
  realtime: RealtimePayload | null,
  realtimeIsFresh: boolean,
): GrainRow[] {
  const storeByNumber = new Map(hierarchy.stores.map((s) => [s.shopNumber, s]));
  const realtimeByStore = new Map((realtime?.byStore ?? []).map((rt) => [rt.shopNumber, rt]));

  // Bucket rows by grain key
  const buckets = new Map<string, { key: GrainKey; rows: DailyStoreRow[]; storeNumbers: Set<string> }>();
  for (const r of rows) {
    const store = storeByNumber.get(r.shopNumber);
    if (!store) continue;
    const key = grainKeyOf(store, grain);
    const k = grainKeyString(key);
    let bucket = buckets.get(k);
    if (!bucket) {
      bucket = { key, rows: [], storeNumbers: new Set() };
      buckets.set(k, bucket);
    }
    bucket.rows.push(r);
    bucket.storeNumbers.add(r.shopNumber);
  }

  // For grains where the filter could produce no rows for an active entity, ensure the entity still appears with operating=false.
  // We seed with all active stores in scope, then merge bucketed rows.
  const cityById = new Map(hierarchy.cities.map((c) => [c.id, c]));
  const regionById = new Map<string, { labelZh: string; cityId: string }>();
  for (const c of hierarchy.cities) {
    for (const r of c.regions) regionById.set(r.id, { labelZh: r.labelZh, cityId: r.cityId });
  }

  return Array.from(buckets.values()).map((bucket) => {
    const agg = aggregate(bucket.rows);
    let realtimeBacklog: number | null = null;
    if (realtime && realtimeIsFresh) {
      realtimeBacklog = 0;
      for (const sn of bucket.storeNumbers) {
        const rt = realtimeByStore.get(sn);
        if (rt) realtimeBacklog += rt.backlogEquivProducts;
      }
    }

    const cityId = bucket.key.cityId;
    const regionId = bucket.key.regionId;
    const shopNumber = bucket.key.shopNumber;
    const city = cityId ? cityById.get(cityId) : null;
    const region = regionId ? regionById.get(regionId) : null;
    const store = shopNumber ? storeByNumber.get(shopNumber) : null;

    return {
      key: grainKeyString(bucket.key),
      cityId,
      cityLabel: city?.labelZh ?? null,
      regionId,
      regionLabel: region?.labelZh ?? null,
      shopNumber,
      shopLabel: store ? (store.shopNameZh ?? store.shopNameEn) : null,
      metrics: agg,
      realtimeBacklogEquivProducts: realtimeBacklog,
    };
  });
}

// ---- Interval (half-hour) aggregation ----

export interface IntervalSlotAggregate {
  slot: HalfHourSlot;
  efficiencyDurationSec: number | null;
  avgOrderResponseSec: number | null;
  avgEquivMakeTimeSec: number | null;
  equivProductsMade: number;
  hasProducts: boolean;
}

export function aggregateInterval(rows: IntervalRow[]): IntervalSlotAggregate[] {
  const bySlot = new Map<HalfHourSlot, IntervalRow[]>();
  for (const slot of HALF_HOUR_SLOTS) bySlot.set(slot, []);
  for (const r of rows) {
    const bucket = bySlot.get(r.slot);
    if (bucket) bucket.push(r);
  }

  return HALF_HOUR_SLOTS.map((slot) => {
    const slotRows = bySlot.get(slot) ?? [];
    let sumResp = 0;
    let sumRespCnt = 0;
    let sumMake = 0;
    let sumEquiv = 0;
    let hasProducts = false;
    for (const r of slotRows) {
      sumResp += r.responseSecondsSum;
      sumRespCnt += r.responseOrdersCount;
      sumMake += r.makeSecondsSum;
      sumEquiv += r.equivProductsMadeSum;
      if (r.hasProducts) hasProducts = true;
    }
    const avgResp = sumRespCnt > 0 ? sumResp / sumRespCnt : null;
    const avgMake = sumEquiv > 0 ? sumMake / sumEquiv : null;
    const effDur = avgResp !== null && avgMake !== null ? avgResp + avgMake : null;
    return {
      slot,
      efficiencyDurationSec: effDur,
      avgOrderResponseSec: avgResp,
      avgEquivMakeTimeSec: avgMake,
      equivProductsMade: sumEquiv,
      hasProducts,
    };
  });
}

// The IntervalCurve x-axis truncates at the last slot with any products in the selected range.
// Returns the index *after* the last slot with products (so slice(0, lastIndex) gives the visible range).
export function lastSlotWithProductsIndex(slots: IntervalSlotAggregate[]): number {
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i];
    if (slot && slot.hasProducts) return i + 1;
  }
  return 0;
}
