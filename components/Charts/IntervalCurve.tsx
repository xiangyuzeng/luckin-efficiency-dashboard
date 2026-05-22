'use client';

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { labels } from '@/lib/labels';
import { palette } from '@/lib/tokens';
import type { IntervalSlotAggregate } from '@/lib/aggregate';
import { lastSlotWithProductsIndex } from '@/lib/aggregate';
import { durationTick, durationTooltip } from './axisFormatters';
import styles from './Charts.module.css';

interface Props {
  slots: IntervalSlotAggregate[];
}

export function IntervalCurve({ slots }: Props) {
  const cutoff = lastSlotWithProductsIndex(slots);
  const visible = slots.slice(0, cutoff);
  const truncated = cutoff > 0 && cutoff < slots.length;

  const data = visible.map((s) => ({
    slot: s.slot,
    efficiencyDuration: s.efficiencyDurationSec ?? null,
    avgOrderResponse: s.avgOrderResponseSec ?? null,
    avgEquivMakeTime: s.avgEquivMakeTimeSec ?? null,
  }));

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>{labels.charts.intervalCurveTitle}</div>
          <div className={styles.subtitle}>{labels.charts.intervalCurveSubtitle}</div>
        </div>
      </div>
      <div className={styles.chartHost}>
        {data.length === 0 ? (
          <div className={styles.empty}>{labels.filter.rangeNoteEmpty}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="slot"
                tick={{ fontSize: 11, fill: palette.textMuted }}
                interval={Math.max(0, Math.floor(data.length / 12) - 1)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: palette.textMuted }}
                tickFormatter={durationTick}
                domain={[0, 'dataMax']}
                width={64}
              />
              <Tooltip
                formatter={(v: number | string) => durationTooltip(v)}
                contentStyle={{ borderRadius: 8, borderColor: palette.border }}
                labelStyle={{ color: palette.textMuted }}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="efficiencyDuration"
                name={labels.charts.legendEfficiency}
                stroke={palette.primary}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avgOrderResponse"
                name={labels.charts.legendResponse}
                stroke={palette.accent}
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
              <Line
                type="monotone"
                dataKey="avgEquivMakeTime"
                name={labels.charts.legendMake}
                stroke={palette.primaryLight}
                strokeWidth={1.5}
                strokeDasharray="2 2"
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      {truncated && <div className={styles.hint}>{labels.charts.truncatedHint}</div>}
    </div>
  );
}
