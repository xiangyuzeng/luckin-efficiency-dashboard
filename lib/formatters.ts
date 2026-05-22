import type { MetricFormat } from '@/lib/types';

export const PENDING_DISPLAY = '数据源待接入';
export const EMPTY_DISPLAY = '—';
export const NONOPERATING_DISPLAY = '-';

const PERCENT_FORMATTER = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const COUNT_FORMATTER = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
});

// "03'14"" — minutes apostrophe, seconds double-prime.
export function formatDuration(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return EMPTY_DISPLAY;
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  // s == 60 can happen when rounding 59.5+ — fold up.
  const totalM = s === 60 ? m + 1 : m;
  const totalS = s === 60 ? 0 : s;
  const mm = String(totalM).padStart(2, '0');
  const ss = String(totalS).padStart(2, '0');
  return `${sign}${mm}'${ss}"`;
}

// Signed delta — adds explicit + sign for positives, used by ComparisonBadge.
export function formatDurationDelta(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return EMPTY_DISPLAY;
  if (seconds === 0) return `00'00"`;
  const sign = seconds > 0 ? '+' : '-';
  return `${sign}${formatDuration(Math.abs(seconds))}`;
}

export function formatPercent(value: number | null, decimals = 2): string {
  if (value === null || Number.isNaN(value)) return EMPTY_DISPLAY;
  const formatter = decimals === 2
    ? PERCENT_FORMATTER
    : new Intl.NumberFormat('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      });
  return `${formatter.format(value * 100)}%`;
}

export function formatPercentDelta(value: number | null, decimals = 2): string {
  if (value === null || Number.isNaN(value)) return EMPTY_DISPLAY;
  if (value === 0) return '0.00%';
  const sign = value > 0 ? '+' : '-';
  return `${sign}${formatPercent(Math.abs(value), decimals)}`;
}

export function formatCount(value: number | null): string {
  if (value === null || Number.isNaN(value)) return EMPTY_DISPLAY;
  return COUNT_FORMATTER.format(Math.round(value));
}

export function formatMetricValue(value: number | null, format: MetricFormat, decimals?: number): string {
  switch (format) {
    case 'duration':
      return formatDuration(value);
    case 'percent':
      return formatPercent(value, decimals ?? 2);
    case 'count':
      return formatCount(value);
    default:
      return value === null ? EMPTY_DISPLAY : String(value);
  }
}

export function formatMetricDelta(value: number | null, format: MetricFormat, decimals?: number): string {
  switch (format) {
    case 'duration':
      return formatDurationDelta(value);
    case 'percent':
      return formatPercentDelta(value, decimals ?? 2);
    case 'count':
      return value === null ? EMPTY_DISPLAY : (value >= 0 ? `+${formatCount(value)}` : `-${formatCount(Math.abs(value))}`);
    default:
      return value === null ? EMPTY_DISPLAY : String(value);
  }
}

// MM/DD/YYYY — spec display format
export function formatDateUS(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m ?? ''}/${d ?? ''}/${y ?? ''}`;
}

// MM-DD-YYYY for filenames
export function dateUsCompact(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${m ?? ''}-${d ?? ''}-${y ?? ''}`;
}
