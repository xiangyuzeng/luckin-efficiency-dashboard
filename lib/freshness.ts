import type { ISO8601 } from '@/lib/types';

export interface Freshness {
  generatedAt: ISO8601;
  ageMinutes: number;
  isStale: boolean;
}

export function freshness(generatedAt: ISO8601, staleMin: number, now: Date = new Date()): Freshness {
  const generated = new Date(generatedAt).getTime();
  const ageMs = now.getTime() - generated;
  const ageMinutes = Math.max(0, Math.round(ageMs / 60000));
  return {
    generatedAt,
    ageMinutes,
    isStale: ageMinutes > staleMin,
  };
}
