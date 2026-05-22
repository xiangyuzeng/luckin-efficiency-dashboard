// Static payload loaders. Both JSON files are committed to the repo and bundled at build time
// so the client never makes a network call to a database.

import efficiencyJson from '@/data/efficiency.json';
import realtimeJson from '@/data/realtime.json';
import type { EfficiencyPayload, RealtimePayload } from '@/lib/types';

export function loadEfficiency(): EfficiencyPayload {
  return efficiencyJson as unknown as EfficiencyPayload;
}

export function loadRealtime(): RealtimePayload {
  return realtimeJson as unknown as RealtimePayload;
}
