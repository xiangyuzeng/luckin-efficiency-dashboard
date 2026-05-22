// METRICS registry — single source of truth for KPI cards and table columns.
// Every efficiency metric on this board is "lower is better" (goodDirection: 'down').

import type { MetricDefinition, MetricKey } from '@/lib/types';

export const BACKLOG_THRESHOLD_MIN = 10;

export const METRICS: Record<MetricKey, MetricDefinition> = {
  efficiencyDuration: {
    key: 'efficiencyDuration',
    labelZh: '效能时长',
    format: 'duration',
    comparisons: ['wow', 'mom'],
    goodDirection: 'down',
    source: 'confirmed',
    tooltipZh: '单均接单响应时长 + 平均等效制作时长',
    formulaZh: '单均接单响应 + 平均等效制作',
  },
  avgOrderResponse: {
    key: 'avgOrderResponse',
    labelZh: '单均接单响应时长',
    format: 'duration',
    comparisons: ['wow', 'mom'],
    goodDirection: 'down',
    source: 'confirmed',
    tooltipZh: '订单支付完成到咖啡师接单的平均时长',
    formulaZh: '∑(accept_time − pay_time) / 已完成订单数',
  },
  avgEquivMakeTime: {
    key: 'avgEquivMakeTime',
    labelZh: '平均等效制作时长',
    format: 'duration',
    comparisons: ['wow', 'mom'],
    goodDirection: 'down',
    source: 'pipeline-mapping',
    tooltipZh: '咖啡师接单到制作完成的等效平均时长（现制+0.25×外购）',
    formulaZh: '∑(finish_time − accept_time) / 制作完成的等效商品数',
  },
  backlogEquivProducts: {
    key: 'backlogEquivProducts',
    labelZh: '压单等效商品数',
    format: 'count',
    comparisons: [],
    goodDirection: 'down',
    source: 'confirmed',
    tooltipZh: '当前开放或已超时未完成订单对应的等效商品数（实时快照）',
    formulaZh: '现制商品数 + 0.25 × 外购商品数（实时）',
  },
  backlogRate: {
    key: 'backlogRate',
    labelZh: '压单率',
    format: 'percent',
    comparisons: ['wow', 'mom'],
    goodDirection: 'down',
    source: 'confirmed',
    tooltipZh: `压单订单数 / 总订单数（压单：完成耗时或开放时长 > ${BACKLOG_THRESHOLD_MIN} 分钟）`,
    formulaZh: '压单订单数 / 总订单数',
    decimals: 2,
  },
  equivProductsMade: {
    key: 'equivProductsMade',
    labelZh: '制作完成等效商品数',
    format: 'count',
    comparisons: [],
    goodDirection: 'down',
    source: 'pipeline-mapping',
    tooltipZh: '该时段内制作完成的等效商品数：现制 + 0.25 × 外购',
    formulaZh: '现制 + 0.25 × 外购',
  },
};

// KPI cards in render order (matches the mockup).
export const KPI_CARD_ORDER: MetricKey[] = [
  'efficiencyDuration',
  'avgOrderResponse',
  'avgEquivMakeTime',
  'backlogEquivProducts',
  'backlogRate',
];

// Metric columns in the detail table (identity columns are grain-dependent and rendered separately).
export const DETAIL_TABLE_METRIC_COLUMNS: MetricKey[] = [
  'backlogEquivProducts',
  'efficiencyDuration',
  'avgOrderResponse',
  'avgEquivMakeTime',
];

// Metric columns in the interval (half-hour) table.
export const INTERVAL_TABLE_METRIC_COLUMNS: MetricKey[] = [
  'efficiencyDuration',
  'avgOrderResponse',
  'avgEquivMakeTime',
  'equivProductsMade',
];
