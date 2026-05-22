import type {
  AggregatedMetrics,
  ComparisonWindows,
  DailyStoreRow,
  FilterScope,
  MetricComparison,
  MetricKey,
} from '@/lib/types';
import { aggregate, filterDailyRows } from '@/lib/aggregate';

export interface ComparisonResult {
  metric: MetricKey;
  kind: MetricComparison;
  current: number | null;
  prior: number | null;
  delta: number | null;     // absolute delta in metric units (seconds, fraction, count)
}

// Builds the WoW/MoM windows by reflecting the selected window backwards by 7 or 30 days.
// For a single-day selection the prior windows are exactly 1 day too.
export function buildComparisonWindows(scope: Pick<FilterScope, 'startDate' | 'endDate'>): ComparisonWindows {
  return {
    primary: { startDate: scope.startDate, endDate: scope.endDate },
    wow: shiftWindow(scope.startDate, scope.endDate, -7),
    mom: shiftWindow(scope.startDate, scope.endDate, -30),
  };
}

function shiftWindow(start: string, end: string, deltaDays: number): { startDate: string; endDate: string } {
  return {
    startDate: shiftDate(start, deltaDays),
    endDate: shiftDate(end, deltaDays),
  };
}

function shiftDate(iso: string, deltaDays: number): string {
  // Parse as UTC-noon to avoid DST drift.
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function computeComparison(
  metric: MetricKey,
  current: AggregatedMetrics,
  prior: AggregatedMetrics,
  kind: MetricComparison,
): ComparisonResult {
  const get = (a: AggregatedMetrics): number | null => {
    switch (metric) {
      case 'efficiencyDuration':
        return a.efficiencyDurationSec;
      case 'avgOrderResponse':
        return a.avgOrderResponseSec;
      case 'avgEquivMakeTime':
        return a.avgEquivMakeTimeSec;
      case 'backlogRate':
        return a.backlogRate;
      default:
        return null;
    }
  };
  const c = get(current);
  const p = get(prior);
  const delta = c !== null && p !== null ? c - p : null;
  return { metric, kind, current: c, prior: p, delta };
}

// Convenience: build both wow and mom aggregates given filtered scope + all rows + active store filter.
export function aggregatePriorWindows(
  allRows: DailyStoreRow[],
  scope: FilterScope,
  activeShopNumbers: Set<string>,
): { wow: AggregatedMetrics; mom: AggregatedMetrics } {
  const windows = buildComparisonWindows(scope);
  const wowScope: FilterScope = { ...scope, startDate: windows.wow.startDate, endDate: windows.wow.endDate };
  const momScope: FilterScope = { ...scope, startDate: windows.mom.startDate, endDate: windows.mom.endDate };
  return {
    wow: aggregate(filterDailyRows(allRows, wowScope, activeShopNumbers)),
    mom: aggregate(filterDailyRows(allRows, momScope, activeShopNumbers)),
  };
}
