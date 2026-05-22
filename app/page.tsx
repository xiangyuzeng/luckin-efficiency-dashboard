import { EfficiencyBoard } from './EfficiencyBoard';
import { loadEfficiency, loadRealtime } from '@/lib/loaders';

// Server component shell. The board is statically prerendered with default URL state;
// after hydration, EfficiencyBoard reads window.location.search and applies any URL filters.
export default function Page() {
  const efficiency = loadEfficiency();
  const realtime = loadRealtime();
  return <EfficiencyBoard efficiency={efficiency} realtime={realtime} />;
}
