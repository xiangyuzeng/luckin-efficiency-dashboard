// All user-facing Chinese strings live here. Structured for future English toggle.

export const labels = {
  brand: '瑞幸咖啡 · 北美',
  appTitle: '效能看板',
  appSubtitle: '订单接单与制作耗时、压单实时监控',

  filter: {
    dateRange: '日期范围',
    from: '开始',
    to: '结束',
    city: '城市',
    region: '区域',
    store: '门店',
    all: '全部',
    apply: '应用',
    reset: '重置',
    exportData: '导出数据',
    rangeNoteOutside: '所选日期超出数据保留窗口，自动夹取至最近可用范围。',
    rangeNoteEmpty: '所选日期范围无运营数据。',
    presets: {
      today: '今日',
      yesterday: '昨日',
      last7: '近 7 天',
      last30: '近 30 天',
      last90: '近 90 天',
      last180: '近 180 天',
      custom: '自定义',
    },
  },

  cadence: {
    info: '数据更新频率',
    title: '数据更新频率',
    daily: '日常数据：每日 02:30 EST 自动刷新',
    realtime: '实时压单数据：每 15 分钟刷新',
    timezone: '所有时间为美国东部时间（US/Eastern）',
    close: '关闭',
  },

  comparison: {
    wow: '周同比',
    mom: '月同比',
    noData: '—',
  },

  freshness: {
    updatedJustNow: '数据刚刚更新',
    updatedAgo: (mins: number) => `数据更新于 ${mins} 分钟前`,
    realtimeJustNow: '实时 · 刚刚',
    realtimeAgo: (mins: number) => `实时 · ${mins} 分钟前`,
    stale: '· 显示历史数据',
    realtimeUnavailable: '实时数据暂不可用',
  },

  pending: '数据源待接入',

  // KPI cards (5)
  kpi: {
    efficiencyDuration: '效能时长',
    avgOrderResponse: '单均接单响应时长',
    avgEquivMakeTime: '平均等效制作时长',
    backlogEquivProducts: '压单等效商品数',
    backlogRate: '压单率',
    realtimeBadge: '实时',
  },

  // Tab switcher
  tabs: {
    cityGrain: '城市效能明细',
    regionGrain: '区域效能明细',
    storeGrain: '门店效能明细',
  },

  // Detail table column headers (identity + metric)
  table: {
    city: '城市',
    region: '区域',
    store: '门店',
    backlogEquivProducts: '压单等效商品数',
    efficiencyDuration: '效能时长',
    avgOrderResponse: '单均接单响应时长',
    avgEquivMakeTime: '平均等效制作时长',
    nonOperating: '-',
    noOperatingStores: '所选筛选下无运营门店',
    exportXlsx: '导出 Excel',
    exportCsv: '导出 CSV',
    sortAsc: '升序',
    sortDesc: '降序',
  },

  // Interval (半小时) efficiency table
  interval: {
    title: '时段效能明细',
    subtitle: '所选范围内分时段（半小时）加权汇总',
    slot: '时段',
    efficiencyDuration: '效能时长',
    avgOrderResponse: '单均接单响应时长',
    avgEquivMakeTime: '平均等效制作时长',
    equivProductsMade: '制作完成等效商品数',
  },

  // Charts
  charts: {
    intervalCurveTitle: '效能时长时段曲线',
    intervalCurveSubtitle: '按半小时显示加权效能时长',
    storeCurveTitle: '效能门店曲线',
    storeCurveSubtitle: '按当前维度由慢到快排序',
    legendEfficiency: '效能时长',
    legendResponse: '单均接单响应',
    legendMake: '平均等效制作',
    truncatedHint: '后续时段无商品制作，已自动截断',
  },

  exportGate: {
    title: '完整导出受限',
    body: '完整导出需要授权口令，当前视图导出无需登录。',
    inputPlaceholder: '请输入口令',
    confirm: '确认',
    cancel: '取消',
    error: '口令错误',
  },

  // Source confidence chips (shown in tooltips for transparency)
  source: {
    confirmed: '数据源：已确认',
    pipelineMapping: '数据源：使用现制/外购分类映射（README 中说明）',
    pipelineConstant: '数据源：管道常量（门店地理位置）',
    derived: '数据源：派生信号',
    pending: '数据源待接入',
  },
} as const;
