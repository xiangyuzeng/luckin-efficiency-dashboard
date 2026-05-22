// Payload data contract — emitted by pipeline, consumed by client, validated by scripts/validate_payload.ts.

export type ISO8601 = string;
export type ISODate = string;
export type ShopNo = string;

// 48 half-hour slots, fixed strings, used both for the IntervalTable rows and the IntervalCurve x-axis.
export const HALF_HOUR_SLOTS = [
  '00:00','00:30','01:00','01:30','02:00','02:30',
  '03:00','03:30','04:00','04:30','05:00','05:30',
  '06:00','06:30','07:00','07:30','08:00','08:30',
  '09:00','09:30','10:00','10:30','11:00','11:30',
  '12:00','12:30','13:00','13:30','14:00','14:30',
  '15:00','15:30','16:00','16:30','17:00','17:30',
  '18:00','18:30','19:00','19:30','20:00','20:30',
  '21:00','21:30','22:00','22:30','23:00','23:30',
] as const;
export type HalfHourSlot = (typeof HALF_HOUR_SLOTS)[number];

// Per-metric source confidence. Surfaces in tooltips and switches values to 'pending' display when null.
export type SourceConfidence =
  | 'confirmed'
  | 'pipeline-mapping'
  | 'pipeline-constant'
  | 'derived'
  | 'pending';

export type MetricFormat = 'duration' | 'count' | 'percent';
export type MetricComparison = 'wow' | 'mom';

export type MetricKey =
  | 'efficiencyDuration'
  | 'avgOrderResponse'
  | 'avgEquivMakeTime'
  | 'backlogEquivProducts'
  | 'backlogRate'
  | 'equivProductsMade';

export interface MetricDefinition {
  key: MetricKey;
  labelZh: string;
  format: MetricFormat;
  comparisons: MetricComparison[];
  goodDirection: 'down';
  source: SourceConfidence;
  tooltipZh: string;
  formulaZh: string;
  decimals?: number;
}

// Hierarchy: City → Region → Store. Ships in efficiency.json so client tab roll-ups are correct.
export interface StoreNode {
  shopNumber: ShopNo;
  shopNameEn: string;
  shopNameZh: string | null;
  cityId: string;
  regionId: string;
  status: 'active' | 'closed';
}

export interface RegionNode {
  id: string;
  cityId: string;
  labelZh: string;
  labelEn: string;
  storeNumbers: ShopNo[];
}

export interface CityNode {
  id: string;
  labelZh: string;
  labelEn: string;
  regions: RegionNode[];
}

export interface Hierarchy {
  cities: CityNode[];
  stores: StoreNode[];
  source: 'pipeline-constant' | 'shop-info';
}

// Raw per-day per-store numerators/denominators. Aggregation always Σnum/Σden, never naive average.
export interface DailyStoreRow {
  date: ISODate;
  shopNumber: ShopNo;
  operatingToday: boolean;

  totalOrders: number;
  completedOrders: number;
  backlogOrders: number;

  responseSecondsSum: number;
  responseOrdersCount: number;

  makeSecondsSum: number;
  equivProductsMadeSum: number;

  freshMadeCount: number;
  purchasedCount: number;
}

// Per-day × per-half-hour × per-store rows. Aggregated client-side over (range × grain).
export interface IntervalRow {
  date: ISODate;
  slot: HalfHourSlot;
  shopNumber: ShopNo;

  responseSecondsSum: number;
  responseOrdersCount: number;
  makeSecondsSum: number;
  equivProductsMadeSum: number;
  hasProducts: boolean;
}

export interface ComparisonWindow {
  startDate: ISODate;
  endDate: ISODate;
}

export interface ComparisonWindows {
  primary: ComparisonWindow;
  wow: ComparisonWindow;
  mom: ComparisonWindow;
}

export interface EfficiencyPayload {
  schemaVersion: 1;
  generatedAt: ISO8601;
  timezone: 'US/Eastern';
  retentionDays: number;
  backlogThresholdMin: number;
  staleThresholdMin: number;

  hierarchy: Hierarchy;
  dailyStoreRows: DailyStoreRow[];
  intervalRows: IntervalRow[];
  comparisonWindows: ComparisonWindows;

  sources: Partial<Record<MetricKey, SourceConfidence>>;
}

export interface RealtimeStoreRow {
  shopNumber: ShopNo;
  backlogEquivProducts: number;
  backlogOrdersOpen: number;
  totalOrdersToday: number;
  backlogOrdersToday: number;
}

export interface RealtimePayload {
  schemaVersion: 1;
  generatedAt: ISO8601;
  backlogThresholdMin: number;
  staleThresholdMin: number;

  global: {
    backlogEquivProducts: number;
    backlogOrdersOpen: number;
    totalOrdersToday: number;
    backlogOrdersToday: number;
    backlogRatePercent: number | null;
  };

  byStore: RealtimeStoreRow[];
}

// Aggregated metric values for one displayed slice (KPI cards, a table row, a tab grain row).
export interface AggregatedMetrics {
  efficiencyDurationSec: number | null;
  avgOrderResponseSec: number | null;
  avgEquivMakeTimeSec: number | null;
  backlogRate: number | null;
  equivProductsMade: number;
  totalOrders: number;
  backlogOrders: number;
  operating: boolean;
}

// Filter scope captured from URL state.
export interface FilterScope {
  startDate: ISODate;
  endDate: ISODate;
  cityId: string | null;     // null = 全部
  regionId: string | null;
  shopNumber: ShopNo | null;
}

export type Grain = 'city' | 'region' | 'store';

// A roll-up row rendered in the DetailTable. Identity columns are populated per the grain.
export interface GrainRow {
  key: string;                         // stable id for sort + react key
  cityId: string | null;
  cityLabel: string | null;
  regionId: string | null;
  regionLabel: string | null;
  shopNumber: ShopNo | null;
  shopLabel: string | null;
  metrics: AggregatedMetrics;
  // Realtime overlay — null if no realtime row matches this scope (e.g. stale).
  realtimeBacklogEquivProducts: number | null;
}
