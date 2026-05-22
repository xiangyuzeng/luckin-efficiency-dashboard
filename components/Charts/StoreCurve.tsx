'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { labels } from '@/lib/labels';
import { palette } from '@/lib/tokens';
import { durationTick, durationTooltip } from './axisFormatters';
import type { GrainRow } from '@/lib/types';
import styles from './Charts.module.css';

interface Props {
  rows: GrainRow[];
}

export function StoreCurve({ rows }: Props) {
  // Sort slowest → fastest (highest efficiencyDuration on the left).
  const data = rows
    .filter((r) => r.metrics.efficiencyDurationSec !== null)
    .map((r) => ({
      key: r.key,
      label: r.shopLabel ?? r.regionLabel ?? r.cityLabel ?? r.shopNumber ?? '',
      value: r.metrics.efficiencyDurationSec ?? 0,
    }))
    .sort((a, b) => b.value - a.value);

  // Color: the slowest 1/3 gets danger, middle gets warning, fastest 1/3 success.
  const n = data.length;
  function colorAt(idx: number): string {
    if (idx < n / 3) return palette.danger;
    if (idx < (2 * n) / 3) return palette.warning;
    return palette.success;
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <div className={styles.title}>{labels.charts.storeCurveTitle}</div>
          <div className={styles.subtitle}>{labels.charts.storeCurveSubtitle}</div>
        </div>
      </div>
      <div className={styles.chartHost}>
        {data.length === 0 ? (
          <div className={styles.empty}>{labels.filter.rangeNoteEmpty}</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 8, bottom: 32 }}>
              <CartesianGrid stroke={palette.border} strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: palette.textMuted }}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={50}
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
              />
              <Bar dataKey="value" name={labels.charts.legendEfficiency} radius={[4, 4, 0, 0]} isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={d.key} fill={colorAt(i)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
