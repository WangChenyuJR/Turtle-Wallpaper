/**
 * 昼夜循环 —— 阶段 5-④
 *
 * 一天分四时段（dayT 0~1，dayT = 当地小时 / 24，即 dayT×24 = 几点钟）：
 *
 *   0.194~0.278  dawn  黎明   04:40~06:40
 *   0.278~0.736  day   白天   06:40~17:40
 *   0.736~0.819  dusk  黄昏   17:40~19:40
 *   0.819~0.194  night 夜晚   19:40~次日 04:40（跨 0 点）
 *
 * 时间来源（CONFIG.daynight.source）：
 *   · 'system'（默认）—— 读电脑系统时钟：dayT = 当地 0:00~24:00 归一化。
 *                        早上 6 点天开始亮、正午最亮、晚上 23 点最暗，与真实生活同步。
 *   · 'cycle'         —— 加速循环：dayLength 秒走完一天，供观赏/测试（N 键快进即此模式）。
 *
 * 输出两样东西：
 *   · light  0~1 全局光强（生物活跃度跟着变）
 *   · 渲染：天空（太阳/月亮/星星）+ 全屏色罩
 *
 * 生物影响：
 *   · 鱼速度 ×(nightFishSpeed + (1-nightFishSpeed)×light)
 *   · 龟夜晚不上岸晒背（baskFactor=0），岸上的会加速回水
 */

import { CONFIG } from './config.js';
import { rand, clamp } from './utils.js';

/** 夹到 0~1（本地小工具，避免到处写 Math.min/max） */
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

const DAY_SECONDS = 86400;   // 一天秒数
/** 钟点 → dayT（本地时间 h:m 归一化），用它写边界才不会差几秒 */
const T = (h, m = 0) => (h * 3600 + m * 60) / DAY_SECONDS;

// 时段定义：边界全部按"真实钟点"写，dayT×24 就是几点。
//   04:40 天亮 → 06:40 全亮 → 17:40 转暗 → 19:40 入夜 → 次日 04:40
export const PHASES = [
  { id: 'dawn',  label: '黎明', icon: '🌅', from: T(4, 40), to: T(6, 40) },
  { id: 'day',   label: '白天', icon: '☀️', from: T(6, 40), to: T(17, 40) },
  { id: 'dusk',  label: '黄昏', icon: '🌇', from: T(17, 40), to: T(19, 40) },
  { id: 'night', label: '夜晚', icon: '🌙', from: T(19, 40), to: 1 },
];

const NIGHT_PHASE = PHASES[3];
const DAWN_FROM = T(4, 40), DAY_FROM = T(6, 40);     // 天亮起 / 全亮起
const DUSK_FROM = T(17, 40), NIGHT_FROM = T(19, 40); // 转暗起 / 入夜起
const NIGHT_LIGHT = 0.28;                            // 夜晚最低光强

// 天空颜色（顶部/底部）随时段插值；t=1.00 必须与 t=0.00 一致，循环才无缝
const SKY_STOPS = [
  { t: 0,          top: '#0d1730', bot: '#232946' },   // 00:00 深夜
  { t: T(3, 30),   top: '#0d1730', bot: '#232946' },   // 03:30 仍是深夜
  { t: T(5, 5),    top: '#3a4a7a', bot: '#e8926b' },   // 05:05 天边泛橙
  { t: T(6, 10),   top: '#8fb6d9', bot: '#ffd9a8' },   // 06:10 黎明末
  { t: T(7, 30),   top: '#a8cfe8', bot: '#cfe3ef' },   // 07:30 白天
  { t: T(16, 40),  top: '#a8cfe8', bot: '#cfe3ef' },   // 16:40 白天末
  { t: T(18, 15),  top: '#6b6a9e', bot: '#f0956a' },   // 18:15 黄昏
  { t: T(19, 45),  top: '#17233f', bot: '#3a3550' },   // 19:45 入夜
  { t: 1,          top: '#0d1730', bot: '#232946' },   // 24:00 深夜（接回 0.00）
];

// 太阳/月亮弧线的可见区间（dayT）
const SUN_FROM = T(4, 34), SUN_TO = T(19, 55);       // 04:34 露出 → 19:55 落下
const MOON_FROM = T(19, 12), MOON_TO = T(5, 11) + 1; // 19:12 升起 → 次日 05:11（跨 0 点）

const SYS_POLL = 0.25;       // 系统时间采样间隔（秒）：没必要每帧去问一次 Date
const MANUAL_HOLD = 300;     // setDayT 之后临时脱离系统时间的秒数（看完自动回到真实时间）

// 夜晚色罩颜色（叠加全屏）
const NIGHT_TINT = '16,28,64';   // 深蓝 rgb
const WARM_TINT = '255,140,70';  // 晨昏暖橙 rgb

/** 在 SKY_STOPS 里插值出天空两色 */
function skyColorsAt(t) {
  for (let i = 0; i < SKY_STOPS.length - 1; i++) {
    const a = SKY_STOPS[i], b = SKY_STOPS[i + 1];
    if (t >= a.t && t <= b.t) {
      const f = (t - a.t) / (b.t - a.t || 1);
      return { top: mixHex(a.top, b.top, f), bot: mixHex(a.bot, b.bot, f) };
    }
  }
  return { top: SKY_STOPS[0].top, bot: SKY_STOPS[0].bot };
}

function mixHex(h1, h2, f) {
  const n1 = parseInt(h1.slice(1), 16), n2 = parseInt(h2.slice(1), 16);
  const r = Math.round(((n1 >> 16) & 255) * (1 - f) + ((n2 >> 16) & 255) * f);
  const g = Math.round(((n1 >> 8) & 255) * (1 - f) + ((n2 >> 8) & 255) * f);
  const b = Math.round((n1 & 255) * (1 - f) + (n2 & 255) * f);
  return `rgb(${r},${g},${b})`;
}

export class DayNight {
  constructor(startT = 0.15) {
    const C = CONFIG.daynight;
    this.dayLength = C.dayLength;
    this.time = startT * C.dayLength;   // 用 dayT 初始化
    this.speed = 1;                     // 时间流速倍率（N 键快进）
    this._stars = null;                 // 星星（惰性生成）
    // 时间来源：system = 跟随电脑时钟；cycle = 加速循环
    this.source = C.source === 'cycle' ? 'cycle' : 'system';
    this._sysAcc = 0;                   // 系统时间采样计时
    this._sysDayT = this.readSystemDayT();
    this._manualHold = 0;               // >0 时暂时不跟随系统时间（setDayT 之后）
    this._lockedT = null;               // 手动锁定的时刻（配合 _manualHold）
  }

  /**
   * 从电脑时钟算出 dayT（0~1）：当地 0:00 = 0，12:00 = 0.5，24:00 = 1。
   * timeOffsetHours 可以把昼夜整体平移（例如 +2 让天黑得晚一些）。
   */
  readSystemDayT() {
    const d = new Date();
    const secs = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000;
    const off = CONFIG.daynight?.timeOffsetHours ?? 0;
    let t = secs / DAY_SECONDS + off / 24;
    t -= Math.floor(t);                 // 归一到 [0,1)
    return t;
  }

  /** 一天进度 0~1（system 模式下由电脑时钟决定） */
  get dayT() {
    if (this._manualHold > 0 && this._lockedT != null) return this._lockedT;
    if (this.source === 'system') return this._sysDayT;
    return (this.time % this.dayLength) / this.dayLength;
  }

  /** 是否跟随系统时钟 */
  get isSystemTime() { return this.source === 'system'; }

  /** 当前一天的钟点，形如 "22:41"（system 模式下就是电脑真实时间） */
  get clockText() {
    const secs = Math.floor(this.dayT * DAY_SECONDS);
    const hh = String(Math.floor(secs / 3600) % 24).padStart(2, '0');
    const mm = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /** 当前时段 */
  get phase() {
    const t = this.dayT;
    if (t < PHASES[0].from) return NIGHT_PHASE;   // 00:00~04:40 仍是夜晚
    return PHASES.find((p) => t >= p.from && t < p.to) ?? PHASES[1];
  }

  /** 全局光强 0~1 */
  get light() {
    const t = this.dayT;
    if (t < DAWN_FROM) return NIGHT_LIGHT;                              // 00:00~04:40 深夜
    if (t < DAY_FROM) return NIGHT_LIGHT + ((t - DAWN_FROM) / (DAY_FROM - DAWN_FROM)) * (1 - NIGHT_LIGHT);
    if (t < DUSK_FROM) return 1.0;                                      // 06:40~17:40 白天
    if (t < NIGHT_FROM) return 1.0 - ((t - DUSK_FROM) / (NIGHT_FROM - DUSK_FROM)) * (1 - NIGHT_LIGHT);
    return NIGHT_LIGHT;                                                 // 19:40~24:00 夜晚
  }

  /** 是否夜晚（龟不晒背、鱼变慢）—— 19:40 之后到次日 04:40 */
  get isNight() {
    const t = this.dayT;
    return t >= NIGHT_FROM || t < DAWN_FROM;
  }

  /**
   * 手动设置一天进度（0~1）。
   * system 模式下这会让昼夜临时"脱档"（MANUAL_HOLD 秒内不跟随电脑时钟），
   * 供 ?t=0.75 这类预览用；到期后自动回到真实时间。
   */
  setDayT(t) {
    const v = ((t % 1) + 1) % 1;
    this.time = v * this.dayLength;
    if (this.source === 'system') {
      this._manualHold = MANUAL_HOLD;
      this._lockedT = v;        // 锁住这一刻（否则内部相位推进会把 dayT 拖走）
      this._sysDayT = v;
    }
  }

  /**
   * 切换时间来源：'system' 跟随电脑时钟 / 'cycle' 加速循环。
   * 切换时以"当前显示的时刻"为起点，画面不跳变。
   */
  setSource(src) {
    const next = src === 'cycle' ? 'cycle' : 'system';
    if (next === this.source) return this.source;
    const cur = this.dayT;
    this.time = cur * this.dayLength;
    this.source = next;
    this._manualHold = 0;
    this._lockedT = null;
    this._sysAcc = 0;
    if (next === 'system') this._sysDayT = this.readSystemDayT();
    return this.source;
  }

  update(dt) {
    if (this.source === 'system') {
      // 跟随电脑时钟：定期重采样即可（不必每帧）
      this._sysAcc += dt;
      if (this._sysAcc >= SYS_POLL) {
        this._sysAcc = 0;
        this._sysDayT = this.readSystemDayT();
      }
      if (this._manualHold > 0) {
        this._manualHold = Math.max(0, this._manualHold - dt);
        if (this._manualHold === 0) this._lockedT = null;   // 到期 → 交还给电脑时间
      }
    }
    // time 始终推进：cycle 模式下它就是真正的时钟；
    // system 模式下它只当内部相位用（星星闪烁、云影等动画不会停）
    this.time += dt * this.speed;
  }

  update2(dt) { this.update(dt); }   // 兼容别名

  // ── 渲染 ─────────────────────────────────────────────
  /** 天空（替代原来 main 里的纯色天空块），画 0 ~ bankY */
  drawSky(ctx, world) {
    const { top, bot } = skyColorsAt(this.dayT);
    const g = ctx.createLinearGradient(0, 0, 0, world.bankY);
    g.addColorStop(0, top);
    g.addColorStop(1, bot);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.bankY);

    // 地平线霞光：贴着水线的一道横向柔光 —— 不画日轮也能读出"光从哪边来"
    this._drawHorizonGlow(ctx, world);

    // 夜晚元素：星星 + 月亮
    if (this.light < 0.62) {
      const nightA = (0.62 - this.light) / 0.62;   // 0~1
      this._drawStars(ctx, world, nightA);
      this._drawMoon(ctx, world, nightA);
    }
    // 白天元素：太阳
    if (this.light > 0.45) {
      this._drawSun(ctx, world);
    }
  }

  /**
   * 地平线霞光（阶段 6-⑨）
   *
   * 贴着水线的一道横向压扁的暖光：太阳低垂时（日出/日落）最浓，
   * 正午几乎看不见；夜里彻底收掉。它替代了"必须画个太阳"的作用 ——
   * 光团的位置跟着太阳的方位角走，所以观感上仍然是"太阳在哪边"。
   */
  _drawHorizonGlow(ctx, world) {
    if (CONFIG.daynight?.horizonGlow === false) return;
    const t = this.dayT;
    const p = (t - SUN_FROM) / (SUN_TO - SUN_FROM);   // 0 = 日出，1 = 日落
    if (p < -0.22 || p > 1.22) return;                // 太阳深埋地平线下 → 不画

    const pp = clamp01(p);
    const cx = world.w * (0.08 + pp * 0.84);          // 与日轮同一条轨迹
    const elev = Math.sin(pp * Math.PI);              // 太阳高度 0（地平线）~ 1（中天）
    const low = Math.pow(1 - elev, 1.5);              // 越低越浓
    const a = (0.05 + 0.30 * low) * this.light;
    if (a < 0.012) return;

    const rx = world.w * 0.46;
    const ry = Math.max(28, world.bankY * 0.60);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, world.w, world.bankY);             // 只落在天空里
    ctx.clip();
    ctx.translate(cx, world.bankY - ry * 0.16);
    ctx.scale(1, ry / rx);                            // 横向压扁成"地平线一带"
    const g = ctx.createRadialGradient(0, 0, rx * 0.04, 0, 0, rx);
    g.addColorStop(0.00, `rgba(255,198,124,${a.toFixed(3)})`);
    g.addColorStop(0.34, `rgba(255,172,98,${(a * 0.48).toFixed(3)})`);
    g.addColorStop(0.70, `rgba(255,158,90,${(a * 0.16).toFixed(3)})`);
    g.addColorStop(1.00, 'rgba(255,150,80,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 全屏色罩（在所有场景内容之后、HUD 之前调用）
   * @param {CanvasRenderingContext2D} ctx
   * @param {object} world
   * @param {number} [lightOverride] 覆盖环境光强（岸边小灯点亮时传入"补光后"的亮度，
   *                                 夜色罩会随之变淡 —— 这就是"开灯照亮水塘"的观感来源）
   */
  drawOverlay(ctx, world, lightOverride) {
    const light = lightOverride ?? this.light;
    if (light >= 0.999) return;   // 正午不用罩

    const t = this.dayT;
    // 夜色深蓝罩：天光弱下来才上，越暗越浓
    if (light < 0.92) {
      const a = Math.min(0.42, (1 - light) * 0.58);
      if (a > 0.004) {
        ctx.fillStyle = `rgba(${NIGHT_TINT},${a.toFixed(3)})`;
        ctx.fillRect(0, 0, world.w, world.h);
      }
    }
    // 晨昏暖橙罩（很淡，只染氛围）：黎明 05:24 / 黄昏 18:36 前后最浓
    const warmWindow = (t > 0.19 && t < 0.29) || (t > 0.72 && t < 0.85);
    if (warmWindow) {
      const center = t < 0.5 ? 0.225 : 0.775;
      const d = Math.abs(t - center);
      const a = Math.max(0, 0.16 - d * 1.6);
      if (a > 0.005) {
        ctx.fillStyle = `rgba(${WARM_TINT},${a.toFixed(3)})`;
        ctx.fillRect(0, 0, world.w, world.h);
      }
    }
  }

  /** 星星：固定伪随机点，闪烁 */
  _drawStars(ctx, world, alpha) {
    if (!this._stars) {
      this._stars = [];
      let seed = 42;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < 46; i++) {
        this._stars.push({
          fx: rnd(),                       // 0~1 相对坐标
          fy: rnd() * 0.85,
          r: 0.6 + rnd() * 1.2,
          tw: rnd() * Math.PI * 2,         // 闪烁相位
        });
      }
    }
    ctx.save();
    ctx.fillStyle = '#e8f0ff';
    const time = this.time;
    for (const s of this._stars) {
      const tw = 0.55 + 0.45 * Math.sin(time * 1.7 + s.tw);
      ctx.globalAlpha = alpha * tw * 0.9;
      ctx.beginPath();
      ctx.arc(s.fx * world.w, s.fy * world.bankY * 0.9, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 月亮：夜空弧线轨迹 + 柔光（19:12 升起 → 次日 05:11 落下） */
  _drawMoon(ctx, world, alpha) {
    const t = this.dayT;
    const span = MOON_TO - MOON_FROM;
    let p = (t - MOON_FROM) / span;
    if (p < 0) p += 1 / span;                 // 跨 0 点：凌晨的月亮还在天上
    if (p < 0 || p > 1.06) return;
    const mx = world.w * (0.12 + Math.min(1, p) * 0.76);
    const my = world.bankY * (0.62 - Math.sin(Math.min(1, Math.max(0, p)) * Math.PI) * 0.5);
    const r = Math.min(26, world.bankY * 0.16);

    ctx.save();
    ctx.globalAlpha = alpha;
    // 柔光
    const halo = ctx.createRadialGradient(mx, my, r * 0.4, mx, my, r * 2.6);
    halo.addColorStop(0, 'rgba(230,240,255,0.30)');
    halo.addColorStop(1, 'rgba(230,240,255,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(mx, my, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // 月体（阶段 6-⑨：默认只留月晕不画月轮，同太阳的处理）
    if (CONFIG.daynight?.showMoonDisc === true) {
      ctx.fillStyle = '#eef3fc';
      ctx.beginPath();
      ctx.arc(mx, my, r, 0, Math.PI * 2);
      ctx.fill();
      // 缺角（阴影圆偏移）
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = alpha * 0.85;
      ctx.beginPath();
      ctx.arc(mx + r * 0.42, my - r * 0.28, r * 0.88, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 太阳：白天弧线 + 光晕（04:34 露出 → 19:55 落下）
   *
   * 阶段 6-⑨：默认**不画实心日轮**，只留一团沿轨迹移动的柔光
   * （"太阳不一定要显示出来，有个光线的变化即可"）。
   * 关掉圆盘后辉光放大到 5 倍半径，天空看起来就是"这边亮、那边暗"。
   * 想看见日轮 → CONFIG.daynight.showSunDisc: true。
   */
  _drawSun(ctx, world) {
    const t = this.dayT;
    const p = (t - SUN_FROM) / (SUN_TO - SUN_FROM);   // 0~1 全程
    if (p < 0 || p > 1) return;
    const disc = CONFIG.daynight?.showSunDisc === true;
    const sx = world.w * (0.08 + p * 0.84);
    const sy = world.bankY * (0.86 - Math.sin(p * Math.PI) * 0.66);
    const r = Math.min(22, world.bankY * 0.14);

    ctx.save();
    const haloR = r * (disc ? 3.2 : 5.0);
    const halo = ctx.createRadialGradient(sx, sy, r * 0.3, sx, sy, haloR);
    halo.addColorStop(0, disc ? 'rgba(255,236,170,0.50)' : 'rgba(255,242,200,0.40)');
    halo.addColorStop(0.42, disc ? 'rgba(255,236,170,0.16)' : 'rgba(255,228,156,0.14)');
    halo.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, haloR, 0, Math.PI * 2);
    ctx.fill();
    if (disc) {
      ctx.fillStyle = '#ffe9a0';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
