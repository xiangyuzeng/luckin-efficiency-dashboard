'use client';

import { ComparisonBadge } from './ComparisonBadge';
import { KpiCard, kpiStyles } from './KpiCard';
import { RealtimeFreshnessBadge } from '@/components/FreshnessBadge/RealtimeFreshnessBadge';
import { KPI_CARD_ORDER, METRICS } from '@/lib/metrics';
import type { AggregatedMetrics, MetricKey } from '@/lib/types';
import type { Freshness } from '@/lib/freshness';

interface Props {
  current: AggregatedMetrics;
  wow: AggregatedMetrics;
  mom: AggregatedMetrics;
  realtimeBacklogEquivProducts: number | null;
  realtimeBacklogRatePercent: number | null;
  realtimeFreshness: Freshness | null;
  realtimeAvailable: boolean;
}

function pickValue(key: MetricKey, m: AggregatedMetrics, realtime: { backlog: number | null; rate: number | null }): number | null {
  switch (key) {
    case 'efficiencyDuration':
      return m.efficiencyDurationSec;
    case 'avgOrderResponse':
      return m.avgOrderResponseSec;
    case 'avgEquivMakeTime':
      return m.avgEquivMakeTimeSec;
    case 'backlogEquivProducts':
      return realtime.backlog;
    case 'backlogRate':
      // Prefer realtime backlog rate (already a fraction) over daily aggregation, when available.
      return realtime.rate !== null ? realtime.rate / 100 : m.backlogRate;
    default:
      return null;
  }
}

function pickDelta(key: MetricKey, current: AggregatedMetrics, prior: AggregatedMetrics): number | null {
  switch (key) {
    case 'efficiencyDuration':
      if (current.efficiencyDurationSec === null || prior.efficiencyDurationSec === null) return null;
      return current.efficiencyDurationSec - prior.efficiencyDurationSec;
    case 'avgOrderResponse':
      if (current.avgOrderResponseSec === null || prior.avgOrderResponseSec === null) return null;
      return current.avgOrderResponseSec - prior.avgOrderResponseSec;
    case 'avgEquivMakeTime':
      if (current.avgEquivMakeTimeSec === null || prior.avgEquivMakeTimeSec === null) return null;
      return current.avgEquivMakeTimeSec - prior.avgEquivMakeTimeSec;
    case 'backlogRate':
      if (current.backlogRate === null || prior.backlogRate === null) return null;
      return current.backlogRate - prior.backlogRate;
    default:
      return null;
  }
}

export function KpiGrid({
  current, wow, mom,
  realtimeBacklogEquivProducts, realtimeBacklogRatePercent,
  realtimeFreshness, realtimeAvailable,
}: Props) {
  const realtime = { backlog: realtimeBacklogEquivProducts, rate: realtimeBacklogRatePercent };
  return (
    <div className={kpiStyles.fiveUp}>
      {KPI_CARD_ORDER.map((key) => {
        const metric = METRICS[key];
        const value = pickValue(key, current, realtime);

        let footer: React.ReactNode = null;
        if (key === 'backlogEquivProducts') {
          footer = (
            <div className={kpiStyles.realtimeSlot}>
              <RealtimeFreshnessBadge freshness={realtimeFreshness} available={realtimeAvailable} />
            </div>
          );
        } else if (metric.comparisons.length > 0) {
          footer = (
            <div className={kpiStyles.badges}>
              {metric.comparisons.includes('wow') && (
                <ComparisonBadge
                  kind="wow"
                  delta={pickDelta(key, current, wow)}
                  format={metric.format}
                  decimals={metric.decimals}
                  goodDirection={metric.goodDirection}
                />
              )}
              {metric.comparisons.includes('mom') && (
                <ComparisonBadge
                  kind="mom"
                  delta={pickDelta(key, current, mom)}
                  format={metric.format}
                  decimals={metric.decimals}
                  goodDirection={metric.goodDirection}
                />
              )}
            </div>
          );
        }

        return <KpiCard key={key} metric={metric} value={value} footer={footer} />;
      })}
    </div>
  );
}
