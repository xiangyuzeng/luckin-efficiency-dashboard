'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { FilterBar } from '@/components/FilterBar/FilterBar';
import { FreshnessBadge } from '@/components/FreshnessBadge/FreshnessBadge';
import { GrainTabs } from '@/components/GrainTabs/GrainTabs';
import { KpiGrid } from '@/components/KpiCard/KpiGrid';
import { DetailTable } from '@/components/DetailTable/DetailTable';
import { IntervalTable } from '@/components/IntervalTable/IntervalTable';
import { IntervalCurve } from '@/components/Charts/IntervalCurve';
import { StoreCurve } from '@/components/Charts/StoreCurve';
import { ExportButton } from '@/components/ExportButton/ExportButton';
import {
  aggregate,
  aggregateInterval,
  filterDailyRows,
  filterIntervalRows,
  filterStoresByScope,
  rollUp,
} from '@/lib/aggregate';
import { aggregatePriorWindows } from '@/lib/comparison';
import { buildFilename, downloadXlsx } from '@/lib/export';
import { formatCount, formatDuration, formatPercent } from '@/lib/formatters';
import { freshness } from '@/lib/freshness';
import { labels } from '@/lib/labels';
import { DETAIL_TABLE_METRIC_COLUMNS, INTERVAL_TABLE_METRIC_COLUMNS, METRICS } from '@/lib/metrics';
import type { EfficiencyPayload, FilterScope, Grain, MetricKey, RealtimePayload } from '@/lib/types';
import { buildSearch, clampToRetention, parseUrlState } from '@/lib/urlState';
import styles from './page.module.css';

const REQUIRE_AUTH = (process.env.NEXT_PUBLIC_EXPORT_REQUIRE_AUTH ?? 'false') === 'true';

interface Props {
  efficiency: EfficiencyPayload;
  realtime: RealtimePayload;
}

function renderMetricCell(key: MetricKey, value: number | null): string {
  if (value === null) return '-';
  const m = METRICS[key];
  if (m.format === 'duration') return formatDuration(value);
  if (m.format === 'percent') return formatPercent(value, m.decimals ?? 2);
  return formatCount(value);
}

export function EfficiencyBoard({ efficiency, realtime }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  // Retention bounds derived from the daily rows.
  const retentionDates = useMemo(() => {
    const dates = efficiency.dailyStoreRows.map((r) => r.date);
    dates.sort();
    const retentionStart = dates[0] ?? efficiency.generatedAt.slice(0, 10);
    const retentionEnd = dates[dates.length - 1] ?? retentionStart;
    return { retentionStart, retentionEnd };
  }, [efficiency]);

  const defaults = useMemo(
    () => ({ startDate: retentionDates.retentionEnd, endDate: retentionDates.retentionEnd }),
    [retentionDates.retentionEnd],
  );

  // Initial state uses defaults so server-rendered HTML and first client render match (no hydration mismatch).
  // URL params are applied via useEffect after mount — see below.
  const [filter, setFilterState] = useState<FilterScope>(() => ({
    startDate: defaults.startDate,
    endDate: defaults.endDate,
    cityId: null,
    regionId: null,
    shopNumber: null,
  }));
  const [grain, setGrainState] = useState<Grain>('store');

  // Hydrate from URL after mount. Avoids useSearchParams which forces the whole subtree to client-only rendering.
  useEffect(() => {
    const parsed = parseUrlState(new URLSearchParams(window.location.search), defaults);
    const clamped = clampToRetention(
      parsed.filter.startDate,
      parsed.filter.endDate,
      retentionDates.retentionStart,
      retentionDates.retentionEnd,
    );
    setFilterState({ ...parsed.filter, startDate: clamped.startDate, endDate: clamped.endDate });
    setGrainState(parsed.grain);
    // We deliberately run this only once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pushUrl(nextFilter: FilterScope, nextGrain: Grain) {
    const qs = buildSearch({ filter: nextFilter, grain: nextGrain }, defaults);
    router.replace(`${pathname}${qs}`, { scroll: false });
  }
  function setFilter(next: FilterScope) {
    const clamped = clampToRetention(next.startDate, next.endDate, retentionDates.retentionStart, retentionDates.retentionEnd);
    const merged = { ...next, startDate: clamped.startDate, endDate: clamped.endDate };
    setFilterState(merged);
    pushUrl(merged, grain);
  }
  function setGrain(next: Grain) {
    setGrainState(next);
    pushUrl(filter, next);
  }
  function onReset() {
    const next: FilterScope = { startDate: defaults.startDate, endDate: defaults.endDate, cityId: null, regionId: null, shopNumber: null };
    setFilterState(next);
    setGrainState('store');
    pushUrl(next, 'store');
  }

  // Identify "operating today" stores from the most recent retained day.
  const operatingTodayStoreNumbers = useMemo(() => {
    const latest = retentionDates.retentionEnd;
    const set = new Set<string>();
    for (const r of efficiency.dailyStoreRows) {
      if (r.date === latest && r.operatingToday) set.add(r.shopNumber);
    }
    return set;
  }, [efficiency.dailyStoreRows, retentionDates.retentionEnd]);

  // Active stores after applying the city/region/store filter.
  const activeStores = useMemo(
    () => filterStoresByScope(efficiency.hierarchy, filter),
    [efficiency.hierarchy, filter],
  );
  const activeShopNumbers = useMemo(() => new Set(activeStores.map((s) => s.shopNumber)), [activeStores]);

  // Aggregations.
  const filteredDaily = useMemo(
    () => filterDailyRows(efficiency.dailyStoreRows, filter, activeShopNumbers),
    [efficiency.dailyStoreRows, filter, activeShopNumbers],
  );
  const filteredInterval = useMemo(
    () => filterIntervalRows(efficiency.intervalRows, filter, activeShopNumbers),
    [efficiency.intervalRows, filter, activeShopNumbers],
  );

  const currentAgg = useMemo(() => aggregate(filteredDaily), [filteredDaily]);
  const { wow, mom } = useMemo(
    () => aggregatePriorWindows(efficiency.dailyStoreRows, filter, activeShopNumbers),
    [efficiency.dailyStoreRows, filter, activeShopNumbers],
  );

  // Freshness.
  const dailyFreshness = useMemo(
    () => freshness(efficiency.generatedAt, efficiency.staleThresholdMin),
    [efficiency.generatedAt, efficiency.staleThresholdMin],
  );
  const realtimeFreshness = useMemo(
    () => freshness(realtime.generatedAt, realtime.staleThresholdMin),
    [realtime.generatedAt, realtime.staleThresholdMin],
  );
  const realtimeIsFresh = !realtimeFreshness.isStale;

  // Realtime scoped aggregate — sum over active stores in the byStore array.
  const realtimeScoped = useMemo(() => {
    if (!realtimeIsFresh) return { backlogEquivProducts: null, backlogRatePercent: null };
    let backlogEquiv = 0;
    let totalToday = 0;
    let backlogToday = 0;
    for (const rt of realtime.byStore) {
      if (!activeShopNumbers.has(rt.shopNumber)) continue;
      backlogEquiv += rt.backlogEquivProducts;
      totalToday += rt.totalOrdersToday;
      backlogToday += rt.backlogOrdersToday;
    }
    return {
      backlogEquivProducts: backlogEquiv,
      backlogRatePercent: totalToday > 0 ? (backlogToday / totalToday) * 100 : null,
    };
  }, [realtime.byStore, activeShopNumbers, realtimeIsFresh]);

  // Grain roll-up for the detail table.
  const grainRows = useMemo(
    () => rollUp(filteredDaily, efficiency.hierarchy, grain, realtime, realtimeIsFresh),
    [filteredDaily, efficiency.hierarchy, grain, realtime, realtimeIsFresh],
  );

  // Interval (half-hour) aggregation.
  const intervalSlots = useMemo(() => aggregateInterval(filteredInterval), [filteredInterval]);

  // Range note logic.
  const rangeNote = useMemo(() => {
    if (filter.startDate < retentionDates.retentionStart || filter.endDate > retentionDates.retentionEnd) return 'outside' as const;
    if (filteredDaily.length === 0) return 'empty' as const;
    return null;
  }, [filter, retentionDates, filteredDaily.length]);

  // Export
  function buildCurrentViewExport() {
    const detailRows = grainRows.map((row) => {
      const out: Record<string, string | number> = {};
      out[labels.table.city] = row.cityLabel ?? '';
      if (grain !== 'city') out[labels.table.region] = row.regionLabel ?? '';
      if (grain === 'store') out[labels.table.store] = `${row.shopNumber ?? ''} ${row.shopLabel ?? ''}`.trim();
      for (const key of DETAIL_TABLE_METRIC_COLUMNS) {
        const v =
          key === 'backlogEquivProducts'
            ? row.realtimeBacklogEquivProducts
            : key === 'efficiencyDuration'
              ? row.metrics.efficiencyDurationSec
              : key === 'avgOrderResponse'
                ? row.metrics.avgOrderResponseSec
                : row.metrics.avgEquivMakeTimeSec;
        out[METRICS[key].labelZh] = renderMetricCell(key, v);
      }
      return out;
    });

    const intervalRowsOut = intervalSlots.map((slot) => {
      const out: Record<string, string | number> = { [labels.interval.slot]: slot.slot };
      for (const key of INTERVAL_TABLE_METRIC_COLUMNS) {
        const v =
          key === 'efficiencyDuration' ? slot.efficiencyDurationSec
          : key === 'avgOrderResponse' ? slot.avgOrderResponseSec
          : key === 'avgEquivMakeTime' ? slot.avgEquivMakeTimeSec
          : slot.equivProductsMade;
        out[METRICS[key].labelZh] = renderMetricCell(key, v);
      }
      return out;
    });

    const filename = buildFilename('效能明细', grain, filter.startDate, filter.endDate, 'xlsx');
    downloadXlsx(
      [
        { name: '门店效能', rows: detailRows },
        { name: '时段效能', rows: intervalRowsOut },
      ],
      filename,
    );
  }

  // Full export — same payload for now; auth gate is an additional consent step rather than a different dataset.
  function buildFullExport() {
    buildCurrentViewExport();
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className="container">
          <div className={styles.headerInner}>
            <div className={styles.brand}>
              <span className={styles.brandTitle}>{labels.brand} · {labels.appTitle}</span>
              <span className={styles.brandSubtitle}>{labels.appSubtitle}</span>
            </div>
            <FreshnessBadge freshness={dailyFreshness} />
          </div>
        </div>
      </header>

      <main className={`container ${styles.main} ${dailyFreshness.isStale ? styles.staleOverlay : ''}`}>
        <section className={styles.section}>
          <FilterBar
            filter={filter}
            hierarchy={efficiency.hierarchy}
            retentionStart={retentionDates.retentionStart}
            retentionEnd={retentionDates.retentionEnd}
            operatingTodayStoreNumbers={operatingTodayStoreNumbers}
            rangeNote={rangeNote}
            onChange={setFilter}
            onReset={onReset}
            grain={grain}
            onExport={buildCurrentViewExport}
          />
        </section>

        <section className={styles.section}>
          <KpiGrid
            current={currentAgg}
            wow={wow}
            mom={mom}
            realtimeBacklogEquivProducts={realtimeScoped.backlogEquivProducts}
            realtimeBacklogRatePercent={realtimeScoped.backlogRatePercent}
            realtimeFreshness={realtimeFreshness}
            realtimeAvailable={realtimeIsFresh}
          />
        </section>

        <section className={styles.section}>
          <div className={styles.tabsRow}>
            <GrainTabs grain={grain} onChange={setGrain} />
            <ExportButton
              onExportCurrentView={buildCurrentViewExport}
              onExportFull={buildFullExport}
              requireAuthForFullExport={REQUIRE_AUTH}
            />
          </div>
          <DetailTable rows={grainRows} grain={grain} />
        </section>

        <section className={styles.section}>
          <IntervalTable rows={intervalSlots} />
        </section>

        <section className={styles.section}>
          <div className={chartGridClass}>
            <IntervalCurve slots={intervalSlots} />
            <StoreCurve rows={grainRows} />
          </div>
        </section>
      </main>
    </div>
  );
}

// We don't import the Charts.module.css here; the grid uses a local class.
const chartGridClass = 'efficiency-charts-grid';
