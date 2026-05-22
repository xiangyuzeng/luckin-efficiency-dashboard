import { formatDuration } from '@/lib/formatters';

export function durationTick(value: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return formatDuration(value);
}

export function durationTooltip(value: number | string | undefined): string {
  if (value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
  return formatDuration(Number(value));
}
