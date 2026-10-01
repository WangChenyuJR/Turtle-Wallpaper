/**
 * 物种配置 —— 数据驱动的龟/鱼品种定义（工作文档 阶段 3）
 *
 * 设计目标：
 *   · 新增品种只需在这里加一条，无需改渲染代码
 *   · 支持运行时增删（Lively 面板 / 控制台调用）
 *   · 用户可导入自定义品种（见 user-species.js）
 *
 * 绘制参数说明（2D 矢量绘制，无贴图依赖）：
 *   鱼：body/fin/stripes/sizeScale/speedScale
 *   龟：shell/limb/pattern/sizeScale
 */

// ══════════════════════════════════════════════════════════
//  鱼 品 种
// ══════════════════════════════════════════════════════════
export const FISH_SPECIES = {
  crucian: {
    id: 'crucian',
    label: '鲫鱼',
    body: '#c9a227',
    fin: '#e0bb52',
    stripes: 0,
    belly: '#e8d9a0',
    sizeScale: 1.0,
    speedScale: 1.0,
    weight: 3,            // 随机生成时的权重（越大越常见）
  },
  koi: {
    id: 'koi',
    label: '锦鲤',
    body: '#e07a3f',
    fin: '#f0a06a',
    stripes: 2,
    belly: '#f5cfa8',
    sizeScale: 1.25,
    speedScale: 0.9,
    weight: 2,
  },
  grasscarp: {
    id: 'grasscarp',
    label: '青鱼',
    body: '#4f7f86',
    fin: '#6fa0a6',
    stripes: 0,
    belly: '#a8c4c8',
    sizeScale: 1.1,
    speedScale: 1.0,
    weight: 2,
  },
  whitebait: {
    id: 'whitebait',
    label: '白鲦',
    body: '#cfd8dc',
    fin: '#e8eef0',
    stripes: 1,
    belly: '#f4f8fa',
    sizeScale: 0.72,
    speedScale: 1.35,
    weight: 3,
  },
  goldfish: {
    id: 'goldfish',
    label: '金鱼',
    body: '#e6482e',
    fin: '#ffb08a',
    stripes: 0,
    belly: '#ffd9b0',
    sizeScale: 0.85,
    speedScale: 0.85,
    weight: 2,
    fancyTail: true,      // 长尾（金鱼特征）
  },
  gambusia: {
    id: 'gambusia',
    label: '食蚊鱼',
    body: '#8a9a5b',
    fin: '#b0bf85',
    stripes: 1,
    belly: '#d0d8b0',
    sizeScale: 0.6,
    speedScale: 1.45,
    weight: 2,
  },
};

// ══════════════════════════════════════════════════════════
//  乌 龟 品 种
// ══════════════════════════════════════════════════════════
/**
 * habitat（栖息类型）—— 决定乌龟的行为模式：
 *
 *   aquatic     水龟    几乎不上岸，深水活动，偶晒太阳（如甲鱼、猪鼻龟）
 *   semi        半水龟  水陆两栖，白天上岸晒背，晚上回水（如巴西龟、草龟）
 *   terrestrial 陆龟    极少下水，长时间在岸边爬行觅食（如黄缘、缅甸陆龟）
 *   marsh       沼泽龟  偏爱浅水泥沼区，善潜泥（如枯叶龟）
 *
 * 行为参数（可选，缺省时按 habitat 预设值）：
 *   baskingChance  每次决策时"决定上岸"的概率（0~1）
 *   baskDuration   单次晒背/岸上停留的时长范围 [min, max] 秒
 *   landSpeedScale 岸上爬行速度倍率
 *   waterBias      留在水里的倾向（越大越爱待水）
 */
export const TURTLE_SPECIES = {
  redear: {
    id: 'redear',
    label: '巴西红耳龟',
    habitat: 'semi',
    shell: '#5b7c3a',
    limb: '#4a5a34',
    head: '#5c6e3e',
    pattern: 'rings',
    markColor: '#d94f3d',    // 耳后红斑
    sizeScale: 1.0,
    speedScale: 1.0,
    weight: 3,
  },
  yellowpond: {
    id: 'yellowpond',
    label: '黄缘闭壳龟',
    habitat: 'terrestrial',  // 陆龟：极少下水
    shell: '#6b5a3e',
    limb: '#584a30',
    head: '#6b5a3e',
    pattern: 'rings',
    markColor: '#d9c04f',
    sizeScale: 0.95,
    speedScale: 0.95,
    baskingChance: 0.82,
    baskDuration: [14, 30],
    landSpeedScale: 1.15,
    weight: 2,
  },
  chinese: {
    id: 'chinese',
    label: '中华草龟',
    habitat: 'semi',
    shell: '#3f4a33',
    limb: '#333d2a',
    head: '#44503a',
    pattern: 'stripes',
    markColor: '#8a9a5b',
    sizeScale: 1.05,
    speedScale: 1.0,
    weight: 2,
  },
  softshell: {
    id: 'softshell',
    label: '甲鱼',
    habitat: 'aquatic',      // 水龟：几乎不上岸
    shell: '#5a5340',
    limb: '#4a4536',
    head: '#5a5340',
    pattern: 'smooth',       // 无壳纹、扁平
    markColor: '#7a7358',
    sizeScale: 1.15,
    speedScale: 1.15,
    flat: true,
    baskingChance: 0.06,
    baskDuration: [4, 8],
    waterBias: 2.2,
    weight: 1,
  },
  mapTurtle: {
    id: 'mapTurtle',
    label: '地图龟',
    habitat: 'aquatic',      // 水龟：爱在水里
    shell: '#7a6b45',
    limb: '#5f5438',
    head: '#6b6042',
    pattern: 'lines',
    markColor: '#c9b04f',
    sizeScale: 0.9,
    speedScale: 0.95,
    baskingChance: 0.28,
    baskDuration: [6, 12],
    weight: 2,
  },
  // ── 新增：沼泽/陆生龟，丰富品类 ──────────────────────
  mata: {
    id: 'mata',
    label: '枯叶龟',
    habitat: 'marsh',        // 沼泽龟：偏爱浅水泥沼
    shell: '#5c4a34',
    limb: '#4a3d2c',
    head: '#6b5238',
    pattern: 'smooth',
    markColor: '#7a6244',
    sizeScale: 1.2,
    speedScale: 0.8,
    flat: true,
    baskingChance: 0.12,
    baskDuration: [5, 10],
    waterBias: 1.6,
    weight: 1,
  },
  burmese: {
    id: 'burmese',
    label: '缅甸陆龟',
    habitat: 'terrestrial',  // 纯陆龟：基本不下水
    shell: '#7d6a42',
    limb: '#665736',
    head: '#766440',
    pattern: 'rings',
    markColor: '#c2a95a',
    sizeScale: 1.25,
    speedScale: 0.85,
    baskingChance: 0.9,
    baskDuration: [18, 40],
    landSpeedScale: 0.95,
    waterBias: 0.15,
    weight: 1,
  },
};

// ── habitat 预设参数（品种未显式指定时采用）──────────────
export const HABITAT_PRESETS = {
  aquatic:     { baskingChance: 0.10, baskDuration: [4, 8],   landSpeedScale: 0.85, waterBias: 2.0 },
  semi:        { baskingChance: 0.45, baskDuration: [8, 16],  landSpeedScale: 1.0,  waterBias: 1.0 },
  terrestrial: { baskingChance: 0.85, baskDuration: [16, 34], landSpeedScale: 1.1,  waterBias: 0.3 },
  marsh:       { baskingChance: 0.15, baskDuration: [5, 11],  landSpeedScale: 0.9,  waterBias: 1.5 },
};

/** 取某品种的有效行为参数（品种自身 > habitat 预设 > 全局默认） */
export function turtleBehavior(species) {
  const preset = HABITAT_PRESETS[species?.habitat] ?? HABITAT_PRESETS.semi;
  return {
    baskingChance: species?.baskingChance ?? preset.baskingChance,
    baskDuration: species?.baskDuration ?? preset.baskDuration,
    landSpeedScale: species?.landSpeedScale ?? preset.landSpeedScale,
    waterBias: species?.waterBias ?? preset.waterBias,
    habitat: species?.habitat ?? 'semi',
  };
}

/** 按权重随机挑一个品种 */
function weightedPick(dict) {
  const list = Object.values(dict);
  const total = list.reduce((s, x) => s + (x.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const sp of list) {
    r -= (sp.weight ?? 1);
    if (r <= 0) return sp;
  }
  return list[list.length - 1];
}

export const pickFishSpecies = () => weightedPick(FISH_SPECIES);
export const pickTurtleSpecies = () => weightedPick(TURTLE_SPECIES);

// ══════════════════════════════════════════════════════════
//  生 物 种 群（运行时实例）
// ══════════════════════════════════════════════════════════
/**
 * 用户/场景声明"我想要哪些品种、各多少条"，
 * 由 main.js 据此生成实例，并支持运行时增删。
 */
export const DEFAULT_POPULATION = {
  fish: {
    crucian: 4,
    koi: 2,
    grasscarp: 2,
    whitebait: 3,
    goldfish: 2,
    gambusia: 1,
  },
  turtle: {
    redear: 1,
    chinese: 1,
  },
};
// ══════════════════════════════════════════════════════════
//  自 定 义 品 种（供"自主添加不同种类"用）
// ══════════════════════════════════════════════════════════
/** 注册一个自定义鱼品种 */
export function registerFishSpecies(spec) {
  if (!spec.id) throw new Error('自定义鱼品种必须有 id');
  FISH_SPECIES[spec.id] = {
    stripes: 0,
    sizeScale: 1,
    speedScale: 1,
    weight: 1,
    belly: spec.body ?? '#cccccc',
    fin: spec.fin ?? spec.body ?? '#cccccc',
    ...spec,
    custom: true,
  };
  return FISH_SPECIES[spec.id];
}

/** 注册一个自定义乌龟品种 */
export function registerTurtleSpecies(spec) {
  if (!spec.id) throw new Error('自定义乌龟品种必须有 id');
  TURTLE_SPECIES[spec.id] = {
    habitat: 'semi',         // 未指定时默认半水龟
    pattern: 'rings',
    sizeScale: 1,
    speedScale: 1,
    weight: 1,
    limb: spec.shell ?? '#555555',
    head: spec.shell ?? '#555555',
    markColor: spec.shell ?? '#888888',
    ...spec,
    custom: true,
  };
  return TURTLE_SPECIES[spec.id];
}

/** 列出所有品种（便于控制台/Lively 展示） */
export function listSpecies() {
  return {
    fish: Object.values(FISH_SPECIES).map((s) => ({ id: s.id, label: s.label, custom: !!s.custom })),
    turtle: Object.values(TURTLE_SPECIES).map((s) => ({
      id: s.id, label: s.label, custom: !!s.custom, habitat: s.habitat ?? 'semi',
    })),
  };
}

/** 栖息类型的中文名（供 UI 显示） */
export const HABITAT_LABELS = {
  aquatic: '水龟',
  semi: '半水龟',
  terrestrial: '陆龟',
  marsh: '沼泽龟',
};
