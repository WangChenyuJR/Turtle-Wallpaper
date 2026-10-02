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

  // ── 视觉打磨（阶段 5-⑧）──────────────────────────────
  fx: {
    enabled: true,
    shadow: true,       // 生物水下投影（随深度扩散变淡）
    depthFog: true,     // 水下景深冷色雾（越深越浓）
    caustics: true,     // 水面焦散光斑（随昼夜/雨天衰减）
    waterEdge: true,    // 岸线水面高光带
  },

  // ── 音效（阶段 5-⑨）──────────────────────────────────
  audio: {
    enabled: true,
    masterVolume: 0.35,   // 总音量（默认偏轻，壁纸不打扰）
    muted: true,          // 默认静音：需用户在 Lively 设置里打开
    feedSound: true,      // 投喂落水声
    splashSound: true,    // 乌龟入水溅声
    rainSound: true,      // 雨声（雨天自动）
    frogSound: true,      // 蛙鸣（夜晚稀疏）
    ambientSound: true,   // 水塘环境底噪
  },

  // ── 性能（文档 5.3 性能策略）──────────────────────────
  perf: {
    visibleFps: 60,
    coveredFps: 20,
    pauseWhenHidden: true,
  },

  // ── 配色（阶段 5-⑩ 写实化重制）────────────────────────
  // 思路：水体不再是一根竖直渐变，而是「近岸浅色 → 中景主色 → 深水暗色」
  // 三段色 + 天空倒影色，让水面有真实的深浅层次。
  colors: {
    sky: '#cfe3ef',
    // 水面：浅岸边 / 中景 / 深水
    waterShallow: '#6fb4c4',
    waterMid: '#3a7f99',
    waterDeep: '#16414f',
    waterBottom: '#0e2f3c',      // 兼容旧字段（用作最深点）
    waterTop: '#4a8fa8',         // 兼容旧字段（水面平均色）
    skyReflect: '#cfeaf4',       // 天空倒影高光
    // 水下体积色调（用于水底沉积）
    silt: '#4a4636',
    // 岸边
    bankSand: '#c9b48a',
    bankSandDark: '#a8905f',
    bankGrass: '#6f8b4a',
    bankGrassDark: '#4f6b34',
    // 水底泥沼
    marsh: '#3a3524',
    marshMud: '#2a2419',
    duckweed: '#7fb04a',
    food: '#e8c46a',
    plantBank: '#6f8b4a',
    plantSurface: '#4f8a3f',
    plantSubmerged: '#3f7a4a',
  },

  // ── 写实化视觉（阶段 5-⑩）────────────────────────────
  // 控制本次新增的"自然拟真"图层：水色分层、表面流动纹理、
  // 沙粒噪点、湿泥暗带、水下沉积颗粒、光标尾迹等。
  // 每一项都可单独关掉做性能对比（也可整体随 fx.enabled 关闭）。
  natural: {
    enabled: true,
    waterLayers: true,     // 水面三段深浅分层 + 天空倒影
    surfaceFlow: true,     // 水面流动纹理（多频噪声波纹）
    skyReflect: true,      // 天空倒影带
    bottomSilt: true,      // 水底沉积颗粒/泥沙浊度
    bankTexture: true,     // 岸边沙粒与湿泥纹理
    cursorWake: true,      // 鼠标水面尾迹（真实波动方程）
    cursorWakeMinDist: 6,  // 光标移动多少像素才补一次扰动
    // ── 真实波动方程水场（阶段 5-⑪）──────────────────
    wave: true,            // 总开关：关掉退回旧的多频波纹
    waveCell: 7,           // 波场网格每格像素（越小越精细越费）
    waveBlock: 6,          // 渲染块大小（每块读一次梯度着色）
    waveSurface: true,     // 是否渲染波场的折射明暗
    // ── 程序化地表纹理（阶段 5-⑪）────────────────────
    terrainTex: true,      // 岸边/水底是否叠加程序化泥/沙纹理
    terrainTexAlpha: 0.55, // 纹理叠加强度
  },
};
