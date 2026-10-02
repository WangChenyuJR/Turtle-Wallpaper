/**
 * 乌龟水塘动态壁纸 —— 全局配置
 * 所有可调参数集中在这里，方便后续用 LivelyProperties.json 暴露给用户
 */

export const CONFIG = {
  // ── 区域划分（按宽高比例，0~1）────────────────────────
  // 岸边区：上方带状；泥沼区：下方浑浊带；其余为水面
  layout: {
    bankRatio: 0.22,      // 岸边区高度占比（顶部）
    marshRatio: 0.20,     // 泥沼区高度占比（底部）
  },

  // ── 鱼 ────────────────────────────────────────────────
  fish: {
    count: 14,
    minSize: 6,
    maxSize: 13,
    maxSpeed: 46,          // px/s
    maxForce: 42,          // 转向力上限
    perception: 62,        // 感知半径
    separation: 26,        // 分离距离
    cursorAvoid: 92,       // 避让光标半径
    cursorAvoidForce: 190,
    hungerDecay: 0.055,    // 每秒饥饿增长
    eatRadius: 11,         // 吃食判定半径
  },

  // ── 乌龟 ──────────────────────────────────────────────
  turtle: {
    count: 2,
    size: 34,
    swimSpeed: 22,
    crawlSpeed: 11,
    eatRadius: 16,
    hungerDecay: 0.04,
    shellColors: ['#5b7c3a', '#6b5a3e', '#4a6b4a'],
  },

  // ── 浮萍 ──────────────────────────────────────────────
  duckweed: {
    count: 60,
    minSize: 3,
    maxSize: 8,
    driftSpeed: 5,
  },

  // ── 植物（阶段 5-②）──────────────────────────────────
  plants: {
    enabled: true,
    // 每株植物的"风力"全局倍率（影响摇摆幅度）
    windScale: 1.0,
    // 鱼群进入遮蔽范围内的躲避削弱系数（0~1，越小越放松）
    shelterCalm: 0.4,
  },

  // ── 食物 ──────────────────────────────────────────────
  food: {
    sinkSpeed: 18,
    lifetime: 30,          // 存活秒数（文档要求：吃完/超时消失）
    pelletsPerFeed: 10,
    amountPerPellet: 26,   // 每颗恢复的饱食度
  },

  // ── 天气（阶段 5-⑤）──────────────────────────────────
  weather: {
    enabled: true,
    rainFoodDropInterval: 4,   // 雨天每隔几秒"雨水冲落"一颗天然食物
  },

  // ── 生命与死亡（阶段 5-⑥）────────────────────────────
  life: {
    fishMaxAge: [7200, 10800],      // 鱼寿命 2~3 小时（秒）
    turtleMaxAge: [14400, 21600],   // 龟寿命 4~6 小时
    fishStarveDeath: 90,            // 鱼饥饿满格持续 90s 饿死
    turtleStarveDeath: 240,         // 龟饿死时长
    dyingDuration: 2.5,             // 死亡动画秒数（翻肚漂浮渐隐）
    archiveCap: 200,                // 生命档案上限（FIFO）
    persist: true,                  // localStorage 持久化
  },

  // ── 分解者（阶段 5-⑦）────────────────────────────────
  scavengers: {
    snails: 6,             // 螺蛳数量（岸边/水底，清理遗骸）
    shrimps: 8,            // 小虾数量（水中，吃沉底食物）
    snailSpeed: 3.2,
    shrimpBurst: 90,       // 虾弹射速度
    remainsDecay: 75,      // 遗骸自然分解秒数（被吃更快）
  },

  // ── 昼夜循环（阶段 5-④）──────────────────────────────
  daynight: {
    enabled: true,
    dayLength: 480,        // 一天 = 480 秒（8 分钟）
    startT: 0.18,          // 开局时刻（0~1，0.18≈上午）
    nightFishSpeed: 0.55,  // 夜晚鱼速度倍率下限
  },

  // ── 成长与繁殖（阶段 5-③）────────────────────────────
  growth: {
    fishMaturityAge: 100,      // 鱼成熟秒数（幼苗→成年）
    turtleMaturityAge: 240,    // 龟成熟秒数
    babySizeRatio: 0.42,       // 幼体起始体型 = 成年体型 × 该比例
    reproHungerMax: 0.38,      // 饥饿度低于此值才可能繁殖（要吃饱）
    fishReproCooldown: 50,     // 鱼繁殖冷却（秒）
    turtleReproCooldown: 150,  // 龟产蛋冷却（秒）
    fishReproChance: 0.05,     // 鱼每次判定繁殖概率（条件满足时）
    turtleEggChance: 0.30,     // 龟晒背时产蛋判定概率
    eggsPerClutch: [1, 3],     // 每窝蛋数 [min, max]
    eggIncubation: 90,         // 龟蛋孵化秒数
    fishCap: 60,               // 鱼数量上限（防卡顿）
    turtleCap: 8,              // 龟数量上限
    fryEscapeSpeed: 1.25,      // 幼鱼速度加成（小而灵活）
  },

  // ── 性能（文档 5.3 性能策略）──────────────────────────
  perf: {
    visibleFps: 60,
    coveredFps: 20,
    pauseWhenHidden: true,
  },

  // ── 配色 ──────────────────────────────────────────────
  colors: {
    sky: '#cfe3ef',
    waterTop: '#4a8fa8',
    waterBottom: '#1e4a5f',
    bankSand: '#c9b48a',
    bankGrass: '#6f8b4a',
    marsh: '#3a3524',
    marshMud: '#2a2419',
    duckweed: '#7fb04a',
    food: '#e8c46a',
    plantBank: '#6f8b4a',
    plantSurface: '#4f8a3f',
    plantSubmerged: '#3f7a4a',
  },
};
