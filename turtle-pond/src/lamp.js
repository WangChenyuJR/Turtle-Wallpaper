/**
 * 悬空吊灯 —— 阶段 6-⑥（手动开关的人工照明）
 *                6-⑦（高斯柔光 / 更大光照范围 / 多盏灯）
 *                8-⑦（岸边立式庭院灯 → **吊线垂下的吊灯**）
 *
 * 为什么要有它：昼夜改成"跟随电脑真实时间"之后，深夜是真的黑。
 * 灯是水塘里唯一的人工物，用户想亮就亮、想灭就灭：
 *
 *   · 开关：鼠标点某一盏（点哪盏亮哪盏）/ 键盘 I（一起开关）/ Lively 设置
 *   · 外观：**吊线从画面上方垂下来的一排吊灯**（吊绳 + 吊环 + 喇叭口朝下的灯罩）
 *   · 点亮分两层：
 *       1) 局部暖光（本文件）—— 高斯柔光晕 + 水面光池 + 水面倒影光柱
 *       2) 全局补光（main.js）—— 把"环境光下限"抬到 CONFIG.lamp.lift，
 *          夜色罩随之变淡、焦散变亮、鱼也不那么迟钝
 *
 * 【为什么改成吊灯（阶段 8-⑦）】用户原话："灯可以用那种悬空一排的灯，
 * 这样就不需要地面了。" 取消右岸之后左侧只剩一条缓坡，立式庭院灯要么挤在坡上、
 * 要么得吸到那块仅存的干地上（旧实现的 `landX()` 就是这么干的），
 * 灯位被地形绑死、还得给每盏灯配一块地面投影。吊灯把这条依赖彻底切断：
 * 灯位只由画面宽度决定（等距一排），竖直位置只由"天空留白"决定，
 * 与地形再无关系 —— 地形怎么改，灯都不会插进土里或浮在空气里。
 *
 * 【为什么写成"高斯"】早期版本用 3~4 档色标描一个圆，肉眼看得出同心色环，
 * 最外圈还是一刀切的硬边。现在把 exp(-k·t²) 采样成 26 档色标写进径向渐变：
 * 中心最亮 → 平滑衰减 → 边缘精确归零，等效于一张高斯模糊过的光斑，
 * 铺得再大也不会出现色带或硬边。k 由 CONFIG.lamp.softness 控制（越小越糊）。
 *
 * 【多盏灯】CONFIG.lamp.count 1~5 盏，围绕 xRatio 以 spread 对称排开，
 * 每盏的灯罩大小、吊绳长度、倾角都略有差异（不是复制粘贴）。
 * 光晕是 lighter 叠加的，交叠处自然更亮，所以这里加了个总数归一化，
 * 免得灯一多就白成一片。
 *
 * 白天开灯也有微光（按 CONFIG.lamp.dayGlow 衰减），不会"看起来没生效"。
 *
 * 性能：每盏每帧 4 个渐变 + ~18 条 fillRect；3 盏 ≈ 12 渐变 / 54 矩形，
 * 相对整帧水面渲染可忽略。
 */

import { CONFIG } from './config.js';
import { clamp } from './utils.js';

const GLOW_RAMP = 3.0;      // 开关灯渐亮/渐灭速度（越大越快）
const GAUSS_STOPS = 26;     // 高斯色标档数：>20 档基本看不出色带
const SYM_STOPS = 18;       // 对称（横向软边）高斯色标档数
const MAX_COUNT = 5;        // 最多几盏

// 多盏时的大小差异：完全一样会像复制粘贴
const SCALE_PAT = [1.00, 0.90, 1.07, 0.95, 1.03];
// 每盏固定的微小倾角（弧度，≈±1.7°）：吊绳自然垂着不会完全笔直，
// 整排看过去"一株一株"的，不像复制粘贴。**必须是常量**（不含时间），
// 否则绘制位置与点击判定对不上（"点得到的地方就是画出来的地方"是硬约束）。
const TILT_PAT = [0.000, 0.030, -0.024, 0.016, -0.013];

// ── 高斯色标工具 ─────────────────────────────────────────

/** [r,g,b] 按 f 混合（f 会被夹到 0~1） */
function mixRgb(a, b, f) {
  const k = clamp(f, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * k),
    Math.round(a[1] + (b[1] - a[1]) * k),
    Math.round(a[2] + (b[2] - a[2]) * k),
  ];
}

/** 两个 #rrggbb 按 f 混合（0=全 a，1=全 b） */
function mixHex(a, b, f) {
  const n1 = parseInt(a.slice(1), 16), n2 = parseInt(b.slice(1), 16);
  const r = Math.round(((n1 >> 16) & 255) * (1 - f) + ((n2 >> 16) & 255) * f);
  const g = Math.round(((n1 >> 8) & 255) * (1 - f) + ((n2 >> 8) & 255) * f);
  const bl = Math.round((n1 & 255) * (1 - f) + (n2 & 255) * f);
  return `rgb(${r},${g},${bl})`;
}

/**
 * 把高斯衰减写进一个渐变的色标里 —— 这就是"柔光/模糊"观感的来源。
 *
 *   径向（sym=false）：t 从 0 走到 1 = 从圆心走到边缘，f(0)=1、f(1)=0
 *   对称（sym=true）  ：u 从 -1 经 0 到 +1，两端为 0、正中为 1（横向软边用）
 *
 * f 用归一化高斯 (exp(-k·u²) - e^-k)/(1 - e^-k)，好处是**边缘精确落到 0**，
 * 不会像原始高斯那样在末端留 0.02 的台阶（那会在屏幕上留一圈淡环）。
 * 颜色同时从 inner 渐变到 outer（越靠外越黄），像真实灯光光谱散开。
 *
 * @param {CanvasGradient} g
 * @param {{k?:number, peak?:number, inner?:number[], outer?:number[], n?:number, sym?:boolean}} o
 */
function pushGauss(g, o = {}) {
  const k = o.k ?? 4.2;
  const peak = o.peak ?? 1;
  const inner = o.inner ?? [255, 247, 228];
  const outer = o.outer ?? [255, 184, 92];
  const n = o.n ?? GAUSS_STOPS;
  const sym = !!o.sym;
  const e = Math.exp(-k);
  const inv = 1 / (1 - e);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = sym ? (t - 0.5) * 2 : t;
    const a = (Math.exp(-k * u * u) - e) * inv * peak;
    const c = mixRgb(inner, outer, Math.pow(Math.abs(u), 0.8));
    g.addColorStop(t, `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(4)})`);
  }
}

// ── 单盏灯 ───────────────────────────────────────────────

/** 一盏悬空吊灯：几何 + 开关 + 绘制 */
export class LampFixture {
  /**
   * @param {import('./world.js').World} world
   * @param {{xRatio?:number, scale?:number, phase?:number, tilt?:number}} [o]
   */
  constructor(world, o = {}) {
    this.world = world;
    this.xRatio = clamp(o.xRatio ?? 0.8, 0.02, 0.98);
    this.scale = o.scale ?? 1;          // 大小差异（0.85~1.1）
    this.phase = o.phase ?? 0;          // 灯丝闪烁相位（每盏错开，别一起"呼吸"）
    this.tilt = o.tilt ?? 0;            // 固定微倾角（弧度，常量，见 TILT_PAT）
    this.on = !!CONFIG.lamp?.on;        // 是否点亮（用户手动控制）
    this.glow = this.on ? 1 : 0;        // 平滑后的实际发光量 0~1
    this._hits = 0;                     // 点击命中次数（诊断用）
  }

  _cfg() { return CONFIG.lamp ?? {}; }

  /** 灯是否可用（Lively 里可以整个关掉） */
  get enabled() { return this._cfg().enabled !== false; }

  /**
   * 灯的横坐标：**只由画面宽度决定**（阶段 8-⑦）。
   * 旧版是 `world.landX(w * xRatio)`（吸附到最近的干地）—— 取消右岸后
   * 全画面只剩左边一条缓坡，吸附会把所有灯挤成一堆。吊灯不落地，不需要吸附。
   */
  get x() { return clamp(this.world.w * this.xRatio, 4, this.world.w - 4); }

  /** 灯的整体尺寸（px）：只受画面高度约束，小窗口也不会把灯罩顶出天空 */
  get h() {
    const want = (this._cfg().height ?? 96) * this.scale;
    return Math.max(22, Math.min(want, this.world.h * 0.16));
  }

  /** 灯泡中心 y：吊绳把它吊在天空中（**必须留在岸顶以上**，否则会插进土里） */
  get bulbY() {
    const c = this._cfg();
    const base = this.world.h * clamp(c.hang ?? 0.11, 0.02, 0.45);
    // 吊绳长度也带一点个体差异（scale 大的吊得略低），整排才有层次
    const off = (this.scale - 1) * this.world.h * 0.030;
    const maxY = Math.max(22, this.world.bankTopY - this.h * 0.30);
    return clamp(base + off, 16, maxY);
  }

  /** 灯光落点 y：水面（灯在水域上方时）或地表（灯在岸坡上方时）—— 光池/倒影的基准线 */
  get poolY() {
    const x = this.x;
    return Math.max(this.world.surfaceAt(x), this.world.groundYAt(x));
  }

  /** 吊绳起点 y：画到画面外一点点，看起来就是"从上方垂下来" */
  get cordTopY() { return -Math.max(18, this.world.h * 0.05); }

  /** 关键几何（绘制与点击判定共用，保证"点得到的地方就是画出来的地方"） */
  geom() {
    const x = this.x, h = this.h, bulbY = this.bulbY;
    const shadeH = h * 0.30;                     // 灯罩高度（吊灯罩比旧庭院灯罩矮胖）
    const shadeTopY = bulbY - shadeH * 0.60;     // 灯泡偏灯罩上半，光从下方喇叭口撒出
    const shadeBotY = shadeTopY + shadeH;
    const capY = shadeTopY - h * 0.055;          // 罩顶的吊环座
    const cordTopY = this.cordTopY;
    // 整盏绕吊点旋转 tilt 角 → 灯罩中心的实际横坐标（点击/光晕都以它为准）
    const sx = x + Math.sin(this.tilt) * (bulbY - cordTopY);
    return {
      x, sx, h, bulbY, poolY: this.poolY,
      cordTopY, capY, shadeH, shadeTopY, shadeBotY,
      wTop: h * 0.155,     // 灯罩上宽（吊环那端）
      wBot: h * 0.300,     // 灯罩下宽（喇叭口）
      cordW: Math.max(1.4, h * 0.020),   // 吊绳粗细
    };
  }

  // ── 开关 ──────────────────────────────────────────────
  /** 反相 */
  toggle() { this.on = !this.on; return this.on; }

  /** 直接设定 */
  set(v) { this.on = !!v; return this.on; }

  get isOn() { return this.on; }

  /** 读档用：立刻把发光量对齐到开关状态（别让灯慢慢亮起来） */
  snapGlow() { this.glow = this.on ? 1 : 0; return this.glow; }

  /**
   * 点击命中判定：只有**灯罩那一小块**可点（吊绳细、天空大片留白不该抢点击），
   * 四周外扩一点方便点。判定框以倾斜后的灯罩中心 `sx` 为准，和画出来的位置一致。
   * @returns {boolean}
   */
  hitTest(px, py) {
    if (!this.enabled) return false;
    const g = this.geom();
    const padX = Math.max(12, g.wBot * 0.70);
    const top = g.shadeTopY - g.h * 0.10;
    const bot = g.shadeBotY + g.h * 0.09;
    const hit = px > g.sx - padX && px < g.sx + padX && py > top && py < bot;
    if (hit) this._hits++;
    return hit;
  }

  /**
   * 实际发光强度（含环境衰减）
   * @param {number} ambient 环境光 0(深夜)~1(正午)
   * @param {number} [extra] 额外乘数（灯组归一化 / 诊断用）
   */
  intensityAt(ambient, extra = 1) {
    const c = this._cfg();
    const day = clamp(c.dayGlow ?? 0.22, 0, 1);
    // 环境越暗，灯光越显眼；白天只保留 dayGlow 那一点
    const atten = day + (1 - day) * (1 - clamp(ambient ?? 1, 0, 1));
    return clamp(this.glow * (c.brightness ?? 1) * atten * extra, 0, 3);
  }

  update(dt) {
    const target = this.on ? 1 : 0;
    const k = Math.min(1, dt * GLOW_RAMP);
    this.glow += (target - this.glow) * k;
    if (Math.abs(this.glow - target) < 0.002) this.glow = target;
  }

  // ── 渲染 ①：灯体（画在岸边场景层，会被夜色罩压暗 —— 对，灯柱本来就该暗） ──
  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} ambient 环境光（决定灯罩玻璃的亮度）
   * @param {number} [extra] 灯组归一化系数
   */
  drawBody(ctx, ambient, extra = 1) {
    if (!this.enabled) return;
    const g = this.geom();
    const lum = this.intensityAt(ambient, extra);
    const { x, h, capY, shadeTopY, shadeBotY, wTop, wBot, cordW, bulbY } = g;

    ctx.save();
    // 整盏绕吊点旋转 tilt（常量）—— 吊绳自然垂下不会完全笔直。
    // 旋转后坐标系原点 = (x, cordTopY)，所以下面的 y 都要减去 cordTopY。
    ctx.translate(x, g.cordTopY);
    ctx.rotate(this.tilt);
    const yy = (v) => v - g.cordTopY;

    // 1) 吊绳：细长渐变矩形，从画面外垂到罩顶吊环
    const cordG = ctx.createLinearGradient(-cordW, 0, cordW, 0);
    cordG.addColorStop(0.00, '#26282c');
    cordG.addColorStop(0.45, '#5a5e66');
    cordG.addColorStop(1.00, '#25272b');
    ctx.fillStyle = cordG;
    ctx.fillRect(-cordW / 2, 0, cordW, yy(capY));

    // 2) 吊环座（罩顶金属件：梯形收口）+ 吊环
    ctx.fillStyle = '#3b3d42';
    ctx.beginPath();
    ctx.moveTo(-wTop * 0.34, yy(capY));
    ctx.lineTo(wTop * 0.34, yy(capY));
    ctx.lineTo(wTop * 0.54, yy(shadeTopY));
    ctx.lineTo(-wTop * 0.54, yy(shadeTopY));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#4a4e55';
    ctx.lineWidth = Math.max(1.2, h * 0.016);
    ctx.beginPath();
    ctx.arc(0, yy(capY) - h * 0.030, Math.max(1.8, h * 0.030), 0, Math.PI * 2);
    ctx.stroke();

    // 3) 灯罩玻璃（上窄下宽的喇叭口朝下 —— 光往下撒）
    ctx.beginPath();
    ctx.moveTo(-wTop / 2, yy(shadeTopY));
    ctx.lineTo(wTop / 2, yy(shadeTopY));
    ctx.lineTo(wBot / 2, yy(shadeBotY));
    ctx.lineTo(-wBot / 2, yy(shadeBotY));
    ctx.closePath();
    ctx.fillStyle = mixHex('#2e3137', '#ffd88a', clamp(lum, 0, 1));
    ctx.fill();

    // 4) 罩内灯丝亮核（开灯时）
    if (lum > 0.02) {
      const prev = ctx.globalCompositeOperation;
      ctx.globalCompositeOperation = 'lighter';
      const cg = ctx.createRadialGradient(0, yy(bulbY), 0, 0, yy(bulbY), h * 0.15);
      cg.addColorStop(0.00, `rgba(255,252,238,${(0.95 * lum).toFixed(3)})`);
      cg.addColorStop(0.45, `rgba(255,224,150,${(0.55 * lum).toFixed(3)})`);
      cg.addColorStop(1.00, 'rgba(255,198,98,0)');
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.ellipse(0, yy(bulbY), wBot * 0.66, Math.max(2, (shadeBotY - shadeTopY) * 0.60), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = prev;
    }

    // 5) 罩体金属边（两条斜边 + 上下沿）
    ctx.strokeStyle = '#292b30';
    ctx.lineWidth = Math.max(1, h * 0.014);
    ctx.beginPath();
    ctx.moveTo(-wTop / 2, yy(shadeTopY)); ctx.lineTo(-wBot / 2, yy(shadeBotY));
    ctx.moveTo(wTop / 2, yy(shadeTopY)); ctx.lineTo(wBot / 2, yy(shadeBotY));
    ctx.moveTo(-wBot / 2, yy(shadeBotY)); ctx.lineTo(wBot / 2, yy(shadeBotY));
    ctx.moveTo(-wTop / 2, yy(shadeTopY)); ctx.lineTo(wTop / 2, yy(shadeTopY));
    ctx.stroke();

    // 6) 喇叭口下沿的暖光沿（开灯时"漏"出来的那一道亮边）
    if (lum > 0.02) {
      ctx.fillStyle = `rgba(255,226,160,${(0.55 * clamp(lum, 0, 1)).toFixed(3)})`;
      ctx.fillRect(-wBot / 2, yy(shadeBotY) - Math.max(1, h * 0.012), wBot, Math.max(1, h * 0.014));
    }

    ctx.restore();
  }

  // ── 渲染 ②：灯光（画在昼夜色罩之后，用 lighter 叠加 = 真的"加光"） ──
  /**
   * 三层高斯柔光叠出"模糊光斑"的观感：
   *   ① 远场柔光（很宽、很淡）—— 决定照明范围
   *   ② 水面光池（压扁的椭圆）—— 灯把它正下方那片水照亮
   *   ③ 灯丝亮核（紧、亮、微闪）—— 灯泡本体
   *
   * 吊灯的光池落在**水面线**上（`poolY`），不再是"灯脚下的地面"。
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} ambient 环境光 0~1
   * @param {number} time 场景时间（秒，用于闪烁与水面摇曳）
   * @param {number} [extra] 灯组归一化系数
   */
  drawGlow(ctx, ambient, time, extra = 1) {
    if (!this.enabled) return;
    const lum = this.intensityAt(ambient, extra);
    if (lum <= 0.012) return;
    const c = this._cfg();
    const { sx: x, h, bulbY, poolY } = this.geom();
    const W = this.world;
    const soft = clamp(c.softness ?? 4.2, 1.2, 12);
    const t = time + this.phase;

    // 光晕半径：比早期版本大了一倍多（"光照范围大一点"）
    const R = Math.max(48, Math.min(W.w * (c.radiusMax ?? 0.55), h * (c.radius ?? 6.5)));

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // ① 远场柔光：一张"糊开"的大光斑
    const halo = ctx.createRadialGradient(x, bulbY, 0, x, bulbY, R);
    pushGauss(halo, {
      k: soft * 0.85, peak: clamp((c.haloPeak ?? 0.15) * lum, 0, 1),
      inner: [255, 238, 200], outer: [255, 170, 82],
    });
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, bulbY, R, 0, Math.PI * 2);
    ctx.fill();

    // ② 水面光池：横向压扁的高斯椭圆（真的像有一片光落在水面上）
    const poolW = R * 0.66;
    const poolH = Math.max(h * 0.24, poolW * 0.30);
    if (poolW > 4) {
      ctx.save();
      ctx.translate(x, poolY + 2);
      ctx.scale(1, poolH / poolW);
      const pool = ctx.createRadialGradient(0, 0, 0, 0, 0, poolW);
      pushGauss(pool, {
        k: soft * 1.10, peak: clamp((c.poolPeak ?? 0.20) * lum, 0, 1),
        inner: [255, 236, 192], outer: [255, 176, 88],
      });
      ctx.fillStyle = pool;
      ctx.beginPath();
      ctx.arc(0, 0, poolW, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ③ 灯丝亮核（带极轻微闪烁，像真的白炽灯）
    const fl = 1 + Math.sin(t * 7.3) * 0.035 + Math.sin(t * 17.7) * 0.018;
    const r2 = Math.max(10, h * 0.60 * fl);
    const core = ctx.createRadialGradient(x, bulbY, 0, x, bulbY, r2);
    pushGauss(core, {
      k: soft * 1.45, peak: clamp((c.corePeak ?? 0.62) * lum, 0, 1),
      inner: [255, 253, 244], outer: [255, 204, 120],
    });
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(x, bulbY, r2, 0, Math.PI * 2);
    ctx.fill();

    // ④ 水面倒影光柱（裁进水多边形里，用横条模拟随波摇曳）
    this._drawReflection(ctx, t, lum, c);

    ctx.restore();
  }

  /** 水面倒影：横向也是高斯软边（不是一条硬边光柱） */
  _drawReflection(ctx, time, lum, c) {
    const W = this.world;
    const { sx: x, h } = this.geom();
    // 吊灯绝大部分时候就吊在水面正上方 → 倒影直接在它正下方；
    // 只有当它悬在左岸坡上空时，才把横坐标吸附到最近的水面。
    const rx = W.isWaterColumn(x) ? x : W.nearWaterX(x);
    const y0 = W.surfaceAt(rx);
    const depth = Math.max(16, (W.waterBottom - y0) * clamp(c.reflectDepth ?? 0.95, 0.2, 1.2));
    const colW = h * clamp(c.reflectWidth ?? 0.62, 0.2, 2) * 0.5;   // 半宽
    if (colW < 3 || depth < 4) return;

    ctx.save();
    if (typeof W._waterPath === 'function') { W._waterPath(ctx); ctx.clip(); }

    // 横向高斯软边：一次建渐变，下面所有横条复用
    const g = ctx.createLinearGradient(rx - colW, 0, rx + colW, 0);
    pushGauss(g, {
      k: 3.2, peak: 1, sym: true, n: SYM_STOPS,
      inner: [255, 230, 182], outer: [255, 164, 78],
    });

    const segs = Math.max(6, Math.round(c.reflectSegs ?? 18));
    const segH = depth / segs;
    for (let i = 0; i < segs; i++) {
      const f = i / segs;
      const wob = Math.sin(time * 1.5 + f * 6.1) * colW * 0.34 * f;
      const w = colW * (0.62 + 0.38 * Math.abs(Math.sin(time * 0.85 + f * 3.1)));
      const a = 0.30 * lum * (1 - f) * (0.5 + 0.5 * Math.abs(Math.sin(time * 2.2 + f * 5.3)));
      if (a <= 0.004) continue;
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.fillStyle = g;
      ctx.fillRect(rx + wob - w, y0 + f * depth, w * 2, Math.max(1.5, segH * 0.82));
    }
    ctx.restore();
  }
}

// ── 灯组 ─────────────────────────────────────────────────

/**
 * 岸边灯组（main.js 挂的就是它）。
 * 对外保留单灯的用法（on / glow / set / toggle / hitTest / geom …），
 * 但内部是 N 盏，可以只开其中几盏。
 */
export class PondLamp {
  /** @param {import('./world.js').World} world */
  constructor(world) {
    this.world = world;
    this._master = !!CONFIG.lamp?.on;
    this._hits = 0;
    this.fixtures = [];
    this.rebuild();
  }

  _cfg() { return CONFIG.lamp ?? {}; }

  /** 灯组是否可用（Lively 里可以整个关掉） */
  get enabled() { return this._cfg().enabled !== false; }

  /** 灯的数量 */
  get count() { return this.fixtures.length; }

  /** 亮着的盏数 */
  get litCount() { return this.fixtures.reduce((n, f) => n + (f.on ? 1 : 0), 0); }

  /**
   * 按 CONFIG.lamp 重新排布灯组（改数量/位置后调用）。
   * 新灯沿用当前"总开关"状态（_master），不会因为改数量就全灭。
   */
  rebuild() {
    const c = this._cfg();
    const n = clamp(Math.round(c.count ?? 3), 1, MAX_COUNT);
    this.fixtures = this._layout(n).map((xr, i) => {
      const f = new LampFixture(this.world, {
        xRatio: xr,
        scale: SCALE_PAT[i % SCALE_PAT.length],
        tilt: TILT_PAT[i % TILT_PAT.length],
        phase: i * 2.7 + xr * 11.3,
      });
      f.on = this._master;
      f.snapGlow();
      return f;
    });
    return this.count;
  }

  /**
   * 灯位排布：`positions` 显式指定优先（长度需 = count），
   * 否则围绕 xRatio 以 spread 对称铺开；只有一盏时就放在 xRatio。
   * @returns {number[]} 每盏的 xRatio
   */
  _layout(n) {
    const c = this._cfg();
    const pos = Array.isArray(c.positions) ? c.positions : null;
    if (pos && pos.length === n) return pos.map((v) => clamp(v, 0.03, 0.97));
    const mid = clamp(c.xRatio ?? 0.5, 0.03, 0.97);
    const sp = clamp(c.spread ?? 0.33, 0, 0.47);
    if (n === 1) return [mid];
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = (i / (n - 1)) * 2 - 1;          // -1 ~ 1
      out.push(clamp(mid + t * sp, 0.03, 0.97));
    }
    return out;
  }

  /**
   * 多盏的亮度归一化：灯越多每盏越弱。
   * 光晕是叠加(lighter)的，不归一化的话 5 盏会把画面糊成一片白。
   */
  get norm() { return 1 / (1 + 0.32 * (this.count - 1)); }

  // ── 开关（对整组）──────────────────────────────────────
  /** 有任意一盏亮 = 整组算"开着" */
  get on() { return this.fixtures.some((f) => f.on); }

  /** 赋值 = 全部一起开关（读档用） */
  set on(v) {
    const b = !!v;
    this.fixtures.forEach((f) => { f.on = b; });
    this._master = b;
  }

  get isOn() { return this.on; }

  /** 整组最亮的发光量（main.js 的全局补光按它插值） */
  get glow() { return this.fixtures.reduce((m, f) => Math.max(m, f.glow), 0); }

  /** 赋值 = 全部设成同一发光量（读档 / 诊断用） */
  set glow(v) { this.fixtures.forEach((f) => { f.glow = v; }); }

  /** 全部开/关，返回整组状态 */
  set(v) {
    this.on = !!v;
    return this.on;
  }

  /** 有亮的就全灭，全灭就全亮 */
  toggle() {
    const next = !this.on;
    this.on = next;
    return this.on;
  }

  /** 单独开关第 i 盏 */
  setAt(i, v) {
    const f = this.fixtures[i];
    if (!f) return false;
    f.on = !!v;
    this._master = this.on;
    return f.on;
  }

  /** 单独反相第 i 盏 */
  toggleAt(i) {
    const f = this.fixtures[i];
    if (!f) return false;
    return this.setAt(i, !f.on);
  }

  /** 每盏的开关状态（存档用） */
  states() { return this.fixtures.map((f) => !!f.on); }

  /** 读档：立刻把发光量对齐到开关状态（别让灯慢慢亮起来） */
  snapGlow() { this.fixtures.forEach((f) => f.snapGlow()); return this.glow; }

  /** 每盏的位置/状态概要（HUD、诊断、pond.lamp() 用） */
  list() {
    return this.fixtures.map((f) => {
      const g = f.geom();
      return {
        x: Math.round(g.sx),        // 灯罩中心（含微倾角后的实际位置）
        y: Math.round(g.bulbY),     // 灯泡中心
        h: Math.round(f.h),
        pool: Math.round(g.poolY),  // 光池落点（水面线）
        on: f.on,
        glow: +f.glow.toFixed(2),
      };
    });
  }

  // ── 命中 ──────────────────────────────────────────────
  /**
   * 点到第几盏（从后往前，后画的在上层）。
   * @returns {number} 索引；没点中返回 -1
   */
  hitIndex(px, py) {
    if (!this.enabled) return -1;
    for (let i = this.fixtures.length - 1; i >= 0; i--) {
      if (this.fixtures[i].hitTest(px, py)) { this._hits++; return i; }
    }
    return -1;
  }

  /** 是否点中了某一盏 */
  hitTest(px, py) { return this.hitIndex(px, py) >= 0; }

  // ── 主循环 ────────────────────────────────────────────
  update(dt) { for (const f of this.fixtures) f.update(dt); }

  /** 灯体：画在岸边场景层（会被夜色罩压暗 —— 对，灯柱本来就该暗） */
  drawBody(ctx, ambient) {
    if (!this.enabled) return;
    const extra = this.norm;
    for (const f of this.fixtures) f.drawBody(ctx, ambient, extra);
  }

  /** 灯光：画在昼夜色罩之后，用 lighter 真的"加光" */
  drawGlow(ctx, ambient, time) {
    if (!this.enabled) return;
    const extra = this.norm;
    for (const f of this.fixtures) f.drawGlow(ctx, ambient, time, extra);
  }

  // ── 兼容单灯时代的取值（取第一盏）──────────────────────
  //    阶段 8-⑦ 起 `baseY`（落地基准）已不存在：吊灯没有"脚下"，
  //    取而代之的 `bulbY` = 灯泡中心 y、`poolY` = 光池落点（水面线）。
  get first() { return this.fixtures[0]; }
  get x() { return this.first ? this.first.geom().sx : 0; }
  get bulbY() { return this.first?.bulbY ?? 0; }
  get poolY() { return this.first?.poolY ?? 0; }
  get h() { return this.first?.h ?? 0; }
  geom() { return this.first.geom(); }

  /** 单盏的发光强度（第一盏；不含灯组归一化 —— 诊断/兼容用） */
  intensityAt(ambient, extra = 1) { return this.first ? this.first.intensityAt(ambient, extra) : 0; }
}
