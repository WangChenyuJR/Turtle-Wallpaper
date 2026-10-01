/**
 * 物种研究数据库 —— 由资料调研整理，可直接接入 species.js
 *
 * 用途：
 *   1) 作为「品种百科」数据源，供 UI/设置面板展示（尺寸、适温、食性、习性说明）
 *   2) 作为新增品种的配置模板：把 RESEARCH_* 里的绘制字段摘出来，
 *      即可用 registerTurtleSpecies() / registerFishSpecies() 注册进运行时
 *   3) 记录每个品种的真实世界参数，便于后续做「生态真实性」调整
 *
 * 与 species.js 的关系：
 *   · species.js 只管「怎么画、怎么动」（body/shell/pattern/sizeScale…）
 *   · 本文件补充「是什么、多大、什么习性」的百科信息（info 字段）
 *   · id 与 species.js 保持一致的品种可直接合并；带 ★ 的是本次新调研的品种
 *
 * 整理日期：2026-10-01
 */

// ══════════════════════════════════════════════════════════
//  乌 龟 —— 百科信息 + 绘制配置
// ══════════════════════════════════════════════════════════
/**
 * 每项字段说明：
 *   info.   —— 百科信息（展示用，不参与渲染）
 *     sciName      学名
 *     habitatCn    栖息类型中文（水龟/半水龟/陆龟/沼泽龟/咸水龟）
 *     sizeCm       成体甲长范围 [min, max]
 *     tempC        适温范围 [min, max]
 *     lifespan     寿命
 *     diet         食性
 *     origin       原产地
 *     difficulty   饲养难度（入门/中等/进阶/高）
 *     features     外观/习性特征（字符串数组）
 *   draw.   —— 绘制配置（可直接给 species.js 用）
 *     shell/limb/head/markColor/pattern/flat/sizeScale/speedScale/weight
 *   behavior. —— 行为参数（覆盖 habitat 预设，可选）
 *     baskingChance / baskDuration / landSpeedScale / waterBias
 */
export const TURTLE_RESEARCH = {
  // ── 已有品种（补充 info）────────────────────────────
  redear: {
    id: 'redear',
    label: '巴西红耳龟',
    info: {
      sciName: 'Trachemys scripta elegans',
      habitatCn: '半水龟',
      sizeCm: [20, 30],
      tempC: [22, 28],
      lifespan: '20–40+ 年',
      diet: '杂食（幼体偏肉食）',
      origin: '北美',
      difficulty: '入门',
      features: ['眼后一对红色粗条纹（红耳）', '背甲墨绿，随龄变褐橄榄', '极爱晒背', '生性活泼有攻击性'],
    },
    draw: { shell: '#5b7c3a', limb: '#4a5a34', head: '#5c6e3e', pattern: 'rings', markColor: '#d94f3d', sizeScale: 1.0, speedScale: 1.0, weight: 3 },
    behavior: { habitat: 'semi' },
  },

  // ★ 新增：焦糖巴西龟
  caramelSlider: {
    id: 'caramelSlider',
    label: '焦糖巴西龟',
    info: {
      sciName: 'Trachemys scripta elegans (焦糖色型)',
      habitatCn: '半水龟',
      sizeCm: [20, 28],
      tempC: [22, 28],
      lifespan: '20–40 年',
      diet: '杂食',
      origin: '人工选育',
      difficulty: '入门',
      features: ['黑色素缺失的焦糖/奶油橙色调', '红耳斑淡化为橘黄', '背甲浅金褐', '习性同巴西龟，仅体色不同'],
    },
    draw: { shell: '#c99a5b', limb: '#a87c46', head: '#c49a58', pattern: 'rings', markColor: '#e8a94e', sizeScale: 1.0, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'semi' },
  },

  chinese: {
    id: 'chinese',
    label: '中华草龟',
    info: {
      sciName: 'Mauremys reevesii',
      habitatCn: '半水龟',
      sizeCm: [15, 25],
      tempC: [22, 28],
      lifespan: '30–60+ 年',
      diet: '偏肉食（水生昆虫、小鱼虾）',
      origin: '中国',
      difficulty: '入门',
      features: ['背甲橄榄色，具三条纵棱', '雄龟成年后全身墨化变黑（墨龟）', '头侧及喉部镶边黄纹', '安静，有晒背习惯'],
    },
    draw: { shell: '#3f4a33', limb: '#333d2a', head: '#44503a', pattern: 'stripes', markColor: '#8a9a5b', sizeScale: 1.05, speedScale: 1.0, weight: 2 },
    behavior: { habitat: 'semi' },
  },

  // ★ 新增：金线草龟
  goldLineReeves: {
    id: 'goldLineReeves',
    label: '金线草龟',
    info: {
      sciName: 'Mauremys reevesii (金线色型)',
      habitatCn: '半水龟',
      sizeCm: [15, 25],
      tempC: [22, 28],
      lifespan: '30–60 年',
      diet: '偏肉食',
      origin: '中国',
      difficulty: '入门',
      features: ['盾片沿生长纹呈鲜明金黄色线条（金线）', '底色深褐，金线是核心卖点', '养出金线需充足光照与稳定环境', '习性同草龟'],
    },
    draw: { shell: '#5a4a2e', limb: '#463a24', head: '#514327', pattern: 'lines', markColor: '#e6c04e', sizeScale: 1.05, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'semi' },
  },

  // ★ 新增：黄喉拟水龟（必选）
  yellowthroat: {
    id: 'yellowthroat',
    label: '黄喉拟水龟',
    info: {
      sciName: 'Mauremys mutica',
      habitatCn: '半水龟',
      sizeCm: [15, 21],
      tempC: [18, 32],
      lifespan: '40–50 年',
      diet: '杂食，偏好鱼虾、动物内脏',
      origin: '中国南部 / 日本 / 越南',
      difficulty: '入门',
      features: ['别名石金钱、石龟、小头金龟', '头侧眼后各一条镶黑边淡黄纵纹', '喉部淡黄故名「黄喉」', '腹甲浅黄具黑斑（无斑者称象牙板）'],
    },
    draw: { shell: '#7a6a3a', limb: '#5f5230', head: '#8a8040', pattern: 'lines', markColor: '#e8d24e', sizeScale: 1.0, speedScale: 1.0, weight: 2 },
    behavior: { habitat: 'semi' },
  },

  mapTurtle: {
    id: 'mapTurtle',
    label: '地图龟',
    info: {
      sciName: 'Graptemys spp.',
      habitatCn: '水龟',
      sizeCm: [15, 30],
      tempC: [24, 28],
      lifespan: '20–40 年',
      diet: '肉食（螺、贝、水生昆虫）',
      origin: '北美',
      difficulty: '中等',
      features: ['背甲波浪/网状花纹', '中央有齿状脊棱', '雌性明显大于雄性', '需流动水'],
    },
    draw: { shell: '#7a6b45', limb: '#5f5438', head: '#6b6042', pattern: 'lines', markColor: '#c9b04f', sizeScale: 0.9, speedScale: 0.95, weight: 2 },
    behavior: { habitat: 'aquatic', baskingChance: 0.28, baskDuration: [6, 12] },
  },

  softshell: {
    id: 'softshell',
    label: '中华鳖（甲鱼）',
    info: {
      sciName: 'Pelodiscus sinensis',
      habitatCn: '水龟',
      sizeCm: [26, 34],
      tempC: [25, 32],
      lifespan: '可达 60 年',
      diet: '肉食为主（鱼虾、软体动物）',
      origin: '中国 / 东亚',
      difficulty: '中等',
      features: ['软壳无角质盾片（革质皮肤）', '背甲边缘肉质「裙边」', '管状鼻孔，善潜泥仅露鼻', '体型扁平，夜间觅食'],
    },
    draw: { shell: '#5a5340', limb: '#4a4536', head: '#5a5340', pattern: 'smooth', markColor: '#7a7358', sizeScale: 1.15, speedScale: 1.15, flat: true, weight: 1 },
    behavior: { habitat: 'aquatic', baskingChance: 0.06, baskDuration: [4, 8], waterBias: 2.2 },
  },

  mata: {
    id: 'mata',
    label: '枯叶龟',
    info: {
      sciName: 'Chelus fimbriata',
      habitatCn: '沼泽龟',
      sizeCm: [40, 45],
      tempC: [26, 28],
      lifespan: '40–75 年',
      diet: '肉食（咽部负压吸食小鱼）',
      origin: '南美亚马逊',
      difficulty: '高',
      features: ['极度拟态枯叶', '背甲棕褐有棱脊、颈侧肉须', '头扁平三角', '浅水泥沼静伏伏击'],
    },
    draw: { shell: '#5c4a34', limb: '#4a3d2c', head: '#6b5238', pattern: 'smooth', markColor: '#7a6244', sizeScale: 1.2, speedScale: 0.8, flat: true, weight: 1 },
    behavior: { habitat: 'marsh', baskingChance: 0.12, baskDuration: [5, 10], waterBias: 1.6 },
  },

  yellowpond: {
    id: 'yellowpond',
    label: '黄缘闭壳龟',
    info: {
      sciName: 'Cuora flavomarginata',
      habitatCn: '陆龟 / 半水',
      sizeCm: [15, 20],
      tempC: [20, 28],
      lifespan: '40–50 年',
      diet: '杂食偏动物性（蚯蚓、蜗牛）',
      origin: '中国 / 中国台湾 / 日本',
      difficulty: '中高',
      features: ['盾片中央金黄色环带', '腹甲可闭合如门', '喜阴凉、昼伏夜出', '湿度要求 70%–80%'],
    },
    draw: { shell: '#6b5a3e', limb: '#584a30', head: '#6b5a3e', pattern: 'rings', markColor: '#d9c04f', sizeScale: 0.95, speedScale: 0.95, weight: 2 },
    behavior: { habitat: 'terrestrial', baskingChance: 0.82, baskDuration: [14, 30], landSpeedScale: 1.15 },
  },

  burmese: {
    id: 'burmese',
    label: '缅甸陆龟',
    info: {
      sciName: 'Indotestudo elongata',
      habitatCn: '陆龟',
      sizeCm: [25, 30],
      tempC: [26, 30],
      lifespan: '50–80 年',
      diet: '植食为主（蔬果、牧草）',
      origin: '东南亚',
      difficulty: '中等',
      features: ['纯陆生，基本不下水', '背甲高拱、长椭圆形', '盾片具同心环纹', '底色黄褐'],
    },
    draw: { shell: '#7d6a42', limb: '#665736', head: '#766440', pattern: 'rings', markColor: '#c2a95a', sizeScale: 1.25, speedScale: 0.85, weight: 1 },
    behavior: { habitat: 'terrestrial', baskingChance: 0.9, baskDuration: [18, 40], landSpeedScale: 0.95, waterBias: 0.15 },
  },

  // ★ 新增：沼泽侧颈龟（必选）
  helmetedSideNeck: {
    id: 'helmetedSideNeck',
    label: '沼泽侧颈龟',
    info: {
      sciName: 'Pelomedusa subrufa',
      habitatCn: '半水龟（侧颈）',
      sizeCm: [14, 30],
      tempC: [22, 28],
      lifespan: '30–50 年',
      diet: '杂食且贪食（鱼虾、贝、昆虫）',
      origin: '非洲撒哈拉以南 / 马达加斯加',
      difficulty: '入门',
      features: ['别名钢盔侧颈龟', '头部侧弯缩入（侧颈特征）', '背甲棕色长方形、中央扁平', '干季钻泥夏眠', '受惊排麝香味液体'],
    },
    draw: { shell: '#6b5340', limb: '#584432', head: '#7a6550', pattern: 'smooth', markColor: '#d8c9a0', sizeScale: 1.0, speedScale: 0.95, weight: 2 },
    behavior: { habitat: 'semi' },
    // 侧颈动画标记（供渲染层识别）
    sideNeck: true,
  },

  // ★ 新增：圆澳侧颈龟（必选）
  redbellySideNeck: {
    id: 'redbellySideNeck',
    label: '圆澳侧颈龟',
    info: {
      sciName: 'Emydura subglobosa',
      habitatCn: '水龟（侧颈）',
      sizeCm: [20, 30],
      tempC: [25, 30],
      lifespan: '30–50 年',
      diet: '肉食（鱼虾、甲壳、昆虫）',
      origin: '澳洲 / 新几内亚',
      difficulty: '入门',
      features: ['别名红腹侧颈龟、红纹曲颈龟', '背甲棕红、边缘橘红', '幼体腹甲猩红 → 成体淡粉', '眼斜上方一对淡黄条纹', '不可与鱼混养'],
    },
    draw: { shell: '#8a4a3a', limb: '#6e3d30', head: '#7a503f', pattern: 'smooth', markColor: '#e0735a', sizeScale: 1.0, speedScale: 1.0, weight: 2 },
    behavior: { habitat: 'aquatic', baskingChance: 0.22, baskDuration: [6, 12] },
    sideNeck: true,
  },

  // ★ 新增：钻纹龟（7 亚种，必选）
  //   共同点：唯一咸水龟；背甲同心圆/钻石纹；两性异形（♀≈♂×2）
  terrapin: {
    id: 'terrapin',
    label: '北部钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin terrapin',
      habitatCn: '咸水龟',
      sizeCm: [10, 24],
      tempC: [20, 28],
      lifespan: '25–40 年',
      diet: '肉食（贝、蟹、虾、螺、小鱼）',
      origin: '美国东部（麻省—北卡）',
      difficulty: '中高',
      features: ['唯一生活在咸水/半咸水的龟', '背甲同心圆「钻纹」图案', '雌性体型约为雄性 2 倍', 'IUCN 易危（VU）'],
    },
    draw: { shell: '#6e6a5a', limb: '#726a58', head: '#8a8470', pattern: 'rings', markColor: '#cfc08a', sizeScale: 0.95, speedScale: 1.0, weight: 2 },
    behavior: { habitat: 'aquatic', baskingChance: 0.35, baskDuration: [8, 14] },
    subSpecies: 'terrapin',
  },
  terrapinCarolina: {
    id: 'terrapinCarolina',
    label: '卡罗莱那钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin centrata',
      habitatCn: '咸水龟', sizeCm: [10, 24], tempC: [20, 28], lifespan: '25–40 年',
      diet: '肉食', origin: '美国东南（佐治亚—北卡）', difficulty: '中高',
      features: ['背甲脊棱较低平', '底色橄榄褐', '腹甲橙黄至灰绿'],
    },
    draw: { shell: '#7a7156', limb: '#6a6248', head: '#8f8870', pattern: 'rings', markColor: '#d0b878', sizeScale: 0.95, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'aquatic' }, subSpecies: 'terrapinCarolina',
  },
  terrapinMississippi: {
    id: 'terrapinMississippi',
    label: '密西西比钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin pileata',
      habitatCn: '咸水龟', sizeCm: [10, 24], tempC: [20, 28], lifespan: '25–40 年',
      diet: '肉食', origin: '美国（阿拉巴马—得州）', difficulty: '中高',
      features: ['尾半脊棱形成明显圆凸瘤', '头颈四肢近乎全黑', '底色最深'],
    },
    draw: { shell: '#4f4b40', limb: '#3c382f', head: '#4a463c', pattern: 'rings', markColor: '#c8a860', sizeScale: 0.95, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'aquatic' }, subSpecies: 'terrapinMississippi',
  },
  terrapinTexas: {
    id: 'terrapinTexas',
    label: '得克萨斯钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin littoralis',
      habitatCn: '咸水龟', sizeCm: [10, 24], tempC: [20, 28], lifespan: '25–40 年',
      diet: '肉食', origin: '美国（路易斯安那—得州）', difficulty: '中高',
      features: ['腹甲与头顶色较浅', '背甲浅褐灰', '斑点较少'],
    },
    draw: { shell: '#8a8470', limb: '#7a745e', head: '#a09880', pattern: 'rings', markColor: '#ddd0a0', sizeScale: 0.95, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'aquatic' }, subSpecies: 'terrapinTexas',
  },
  terrapinOrnate: {
    id: 'terrapinOrnate',
    label: '锦钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin macrospilota',
      habitatCn: '咸水龟', sizeCm: [10, 24], tempC: [20, 28], lifespan: '25–40 年',
      diet: '肉食', origin: '美国佛罗里达西岸', difficulty: '中高',
      features: ['脊棱全程明显窄尖', '盾片中央黄至橙色', '色彩最华丽'],
    },
    draw: { shell: '#7a6a48', limb: '#6a5a3c', head: '#8a7a54', pattern: 'rings', markColor: '#e8b84e', sizeScale: 0.95, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'aquatic' }, subSpecies: 'terrapinOrnate',
  },
  terrapinMangrove: {
    id: 'terrapinMangrove',
    label: '红树林钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin rhizophorarum',
      habitatCn: '咸水龟', sizeCm: [10, 22], tempC: [20, 28], lifespan: '25–40 年',
      diet: '肉食', origin: '美国佛罗里达 Keys', difficulty: '中高',
      features: ['背甲窄长', '脊棱整条圆凸', '头和前肢少有黑斑'],
    },
    draw: { shell: '#5a5546', limb: '#4a463a', head: '#6a6456', pattern: 'rings', markColor: '#cbb87a', sizeScale: 0.9, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'aquatic' }, subSpecies: 'terrapinMangrove',
  },
  terrapinEastFlorida: {
    id: 'terrapinEastFlorida',
    label: '东佛罗里达钻纹龟',
    info: {
      sciName: 'Malaclemys terrapin tequesta',
      habitatCn: '咸水龟', sizeCm: [10, 24], tempC: [20, 28], lifespan: '25–40 年',
      diet: '肉食', origin: '美国佛罗里达东岸', difficulty: '中高',
      features: ['类似锦钻纹', '但尾半脊棱呈凸瘤', '背甲褐色'],
    },
    draw: { shell: '#6e6550', limb: '#5e5544', head: '#807660', pattern: 'rings', markColor: '#d4c088', sizeScale: 0.95, speedScale: 1.0, weight: 1 },
    behavior: { habitat: 'aquatic' }, subSpecies: 'terrapinEastFlorida',
  },
};

// ══════════════════════════════════════════════════════════
//  鱼 类 —— 百科信息 + 绘制配置
// ══════════════════════════════════════════════════════════
/**
 * info. 补充字段：
 *   waterLayer   水层（上/中/下）
 *   pH           适宜 pH
 *   schooling    群游建议（最少条数）
 */
export const FISH_RESEARCH = {
  crucian: {
    id: 'crucian', label: '鲫鱼',
    info: { sciName: 'Carassius auratus (野生型)', waterLayer: '中下层', sizeCm: [15, 25], tempC: [0, 32], pH: [6.5, 8.5], origin: '欧亚', difficulty: '易', diet: '杂食', schooling: 3, features: ['极耐温耐低氧', '体侧扁银灰', '常成群活动'] },
    draw: { body: '#c9a227', fin: '#e0bb52', stripes: 0, belly: '#e8d9a0', sizeScale: 1.0, speedScale: 1.0, weight: 3 },
  },
  koi: {
    id: 'koi', label: '锦鲤',
    info: { sciName: 'Cyprinus carpio', waterLayer: '中下层', sizeCm: [20, 50], tempC: [18, 24], pH: [6.5, 8.0], origin: '亚洲（选育）', difficulty: '中等', diet: '杂食', schooling: 1, features: ['红白/三色斑纹', '尾鳍宽大', '温和、能认人'] },
    draw: { body: '#e07a3f', fin: '#f0a06a', stripes: 2, belly: '#f5cfa8', sizeScale: 1.25, speedScale: 0.9, weight: 2 },
  },
  grasscarp: {
    id: 'grasscarp', label: '青鱼',
    info: { sciName: 'Mylopharyngodon piceus', waterLayer: '下层', sizeCm: [60, 100], tempC: [20, 32], pH: [7.0, 8.5], origin: '中国长江水系', difficulty: '中等', diet: '肉食（喜食螺蛳）', schooling: 1, features: ['俗称螺蛳青', '体圆筒青黑', '一般不游近水面', '最大可达 70kg'] },
    draw: { body: '#4f7f86', fin: '#6fa0a6', stripes: 0, belly: '#a8c4c8', sizeScale: 1.1, speedScale: 1.0, weight: 2 },
  },
  whitebait: {
    id: 'whitebait', label: '白鲦',
    info: { sciName: 'Hemiculter leucisculus', waterLayer: '上层', sizeCm: [10, 18], tempC: [15, 30], pH: [6.5, 8.0], origin: '东亚', difficulty: '易', diet: '杂食', schooling: 5, features: ['极活泼游速快', '体细长银白', '喜水面活动'] },
    draw: { body: '#cfd8dc', fin: '#e8eef0', stripes: 1, belly: '#f4f8fa', sizeScale: 0.72, speedScale: 1.35, weight: 3 },
  },
  goldfish: {
    id: 'goldfish', label: '金鱼',
    info: { sciName: 'Carassius auratus (观赏型)', waterLayer: '中层', sizeCm: [10, 30], tempC: [18, 26], pH: [6.0, 8.0], origin: '中国', difficulty: '易', diet: '杂食', schooling: 2, features: ['长尾鳍', '体圆润', '排泄量大需强过滤'] },
    draw: { body: '#e6482e', fin: '#ffb08a', stripes: 0, belly: '#ffd9b0', sizeScale: 0.85, speedScale: 0.85, weight: 2, fancyTail: true },
  },
  gambusia: {
    id: 'gambusia', label: '食蚊鱼',
    info: { sciName: 'Gambusia affinis', waterLayer: '上层', sizeCm: [3, 6], tempC: [16, 30], pH: [6.5, 8.5], origin: '中北美', difficulty: '易', diet: '杂食（食蚊幼虫）', schooling: 5, features: ['大量捕食孑孓', '胎生繁殖快', '耐污耐低氧'] },
    draw: { body: '#8a9a5b', fin: '#b0bf85', stripes: 1, belly: '#d0d8b0', sizeScale: 0.6, speedScale: 1.45, weight: 2 },
  },

  // ★ 新增
  guppy: {
    id: 'guppy', label: '孔雀鱼',
    info: { sciName: 'Poecilia reticulata', waterLayer: '中上层', sizeCm: [3, 6], tempC: [22, 28], pH: [7.0, 8.5], origin: '南美', difficulty: '易', diet: '杂食', schooling: 3, features: ['雄鱼尾鳍华丽', '胎生、繁殖力极强', '活泼好动'] },
    draw: { body: '#e05a7a', fin: '#ffb0c4', stripes: 0, belly: '#ffe0e8', sizeScale: 0.65, speedScale: 1.3, weight: 3, fancyTail: true },
  },
  zebrafish: {
    id: 'zebrafish', label: '斑马鱼',
    info: { sciName: 'Danio rerio', waterLayer: '中上层', sizeCm: [4, 5], tempC: [18, 28], pH: [6.5, 7.5], origin: '南亚', difficulty: '易', diet: '杂食', schooling: 5, features: ['体侧蓝白横条纹', '活泼群游', '开缸试水首选'] },
    draw: { body: '#5b7fbf', fin: '#8fa8d8', stripes: 4, belly: '#d8e2f0', sizeScale: 0.7, speedScale: 1.3, weight: 3 },
  },
  betta: {
    id: 'betta', label: '泰国斗鱼',
    info: { sciName: 'Betta splendens', waterLayer: '中上层', sizeCm: [6, 7], tempC: [24, 30], pH: [6.5, 7.5], origin: '东南亚', difficulty: '易（单养）', diet: '肉食', schooling: 1, features: ['有迷鳃器官可直接呼吸空气', '雄性必须单养、好斗', '鳍极大极飘'] },
    draw: { body: '#7a3f8f', fin: '#c060d0', stripes: 0, belly: '#d8a0e0', sizeScale: 0.8, speedScale: 0.8, weight: 1, solitary: true },
  },
  neonTetra: {
    id: 'neonTetra', label: '红绿灯鱼',
    info: { sciName: 'Paracheirodon innesi', waterLayer: '中层', sizeCm: [3, 4], tempC: [22, 26], pH: [6.0, 7.0], origin: '南美亚马逊', difficulty: '中', diet: '杂食', schooling: 10, features: ['红蓝霓虹纵带', '群游效果最佳', '对水质较敏感'] },
    draw: { body: '#3fa8d9', fin: '#8fd0e8', stripes: 2, belly: '#e04b5a', sizeScale: 0.62, speedScale: 1.2, weight: 3 },
  },
};

// ══════════════════════════════════════════════════════════
//  工 具 函 数
// ══════════════════════════════════════════════════════════

/** 只取绘制配置（可直接喂给 registerTurtleSpecies / registerFishSpecies） */
export function turtleDrawConfig(id) {
  const r = TURTLE_RESEARCH[id];
  return r ? { id: r.id, label: r.label, ...r.draw, ...(r.behavior || {}), ...(r.sideNeck ? { sideNeck: true } : {}) } : null;
}
export function fishDrawConfig(id) {
  const r = FISH_RESEARCH[id];
  return r ? { id: r.id, label: r.label, ...r.draw } : null;
}

/** 列出全部品种的百科摘要（供 UI 面板 / 控制台） */
export function listTurtleInfo() {
  return Object.values(TURTLE_RESEARCH).map((r) => ({
    id: r.id, label: r.label, habitat: r.behavior?.habitat ?? 'semi', ...r.info,
  }));
}
export function listFishInfo() {
  return Object.values(FISH_RESEARCH).map((r) => ({ id: r.id, label: r.label, ...r.info }));
}

/** 钻纹龟 7 亚种（收集系统用） */
export function terrapinSubSpecies() {
  return Object.values(TURTLE_RESEARCH)
    .filter((r) => r.subSpecies)
    .map((r) => ({ id: r.id, label: r.label, sciName: r.info.sciName, features: r.info.features }));
}

/** 将本次新调研的品种注册进 species.js 运行时（需传入 register* 函数） */
export function registerResearchedInto({ registerFishSpecies, registerTurtleSpecies } = {}) {
  const added = { turtle: [], fish: [] };
  if (registerTurtleSpecies) {
    for (const r of Object.values(TURTLE_RESEARCH)) {
      const cfg = turtleDrawConfig(r.id);
      if (cfg) { registerTurtleSpecies(cfg); added.turtle.push(r.id); }
    }
  }
  if (registerFishSpecies) {
    for (const r of Object.values(FISH_RESEARCH)) {
      const cfg = fishDrawConfig(r.id);
      if (cfg) { registerFishSpecies(cfg); added.fish.push(r.id); }
    }
  }
  return added;
}

export default { TURTLE_RESEARCH, FISH_RESEARCH, turtleDrawConfig, fishDrawConfig, listTurtleInfo, listFishInfo, terrapinSubSpecies, registerResearchedInto };
