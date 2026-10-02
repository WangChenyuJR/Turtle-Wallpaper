/**
 * 昼夜循环 —— 阶段 5-④
 *
 * 一天分四时段（dayT 0~1）：
 *
 *   0.00~0.08  dawn  黎明   天空橙粉、太阳升起
 *   0.08~0.50  day   白天   全亮度
 *   0.50~0.62  dusk  黄昏   天空橙紫、太阳落下
 *   0.62~1.00  night 夜晚   深蓝、月亮星星、生物变慢
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
import { rand } from './utils.js';

// 时段定义（dayT 区间 + 展示信息）
export const PHASES = [
  { id: 'dawn',  label: '黎明', icon: '🌅', from: 0.00, to: 0.08 },
  { id: 'day',   label: '白天', icon: '☀️', from: 0.08, to: 0.50 },
  { id: 'dusk',  label: '黄昏', icon: '🌇', from: 0.50, to: 0.62 },
  { id: 'night', label: '夜晚', icon: '🌙', from: 0.62, to: 1.00 },
];

// 天空颜色（顶部/底部）随时段插值
const SKY_STOPS = [
  { t: 0.00, top: '#3a4a7a', bot: '#e8926b' },   // 黎明：深蓝→橙
  { t: 0.06, top: '#8fb6d9', bot: '#ffd9a8' },   // 黎明末
  { t: 0.14, top: '#a8cfe8', bot: '#cfe3ef' },   // 白天
  { t: 0.46, top: '#a8cfe8', bot: '#cfe3ef' },   // 白天末
  { t: 0.56, top: '#6b6a9e', bot: '#f0956a' },   // 黄昏
  { t: 0.64, top: '#17233f', bot: '#3a3550' },   // 入夜
  { t: 0.90, top: '#0d1730', bot: '#232946' },   // 深夜
  { t: 1.00, top: '#3a4a7a', bot: '#e8926b' },   // 循环回黎明
];

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
  }

  /** 一天进度 0~1 */
  get dayT() {
    return (this.time % this.dayLength) / this.dayLength;
  }

  /** 当前时段 */
  get phase() {
    const t = this.dayT;
    return PHASES.find((p) => t >= p.from && t < p.to) ?? PHASES[1];
  }

  /** 全局光强 0~1 */
  get light() {
    const t = this.dayT;
    if (t < 0.08) return 0.55 + (t / 0.08) * 0.45;            // 黎明渐亮
    if (t < 0.50) return 1.0;                                  // 白天
    if (t < 0.62) return 1.0 - ((t - 0.50) / 0.12) * 0.72;     // 黄昏渐暗
    if (t < 0.94) return 0.28;                                 // 夜晚
    return 0.28 + ((t - 0.94) / 0.06) * 0.27;                  // 破晓前
  }

  /** 是否夜晚（龟不晒背） */
  get isNight() {
    return this.dayT >= 0.58 && this.dayT < 0.97;
  }

  /** 手动设置一天进度（0~1） */
  setDayT(t) {
    this.time = (t % 1) * this.dayLength;
  }

  update(dt) {
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

  /** 全屏色罩（在所有场景内容之后、HUD 之前调用） */
  drawOverlay(ctx, world) {
    const light = this.light;
    if (light >= 0.999) return;   // 正午不用罩

    const t = this.dayT;
    // 夜晚深蓝罩
    if (t >= 0.55 || t < 0.05) {
      const a = Math.min(0.42, (1 - light) * 0.58);
      ctx.fillStyle = `rgba(${NIGHT_TINT},${a.toFixed(3)})`;
      ctx.fillRect(0, 0, world.w, world.h);
    }
    // 晨昏暖橙罩（很淡，只染氛围）
    const warmWindow = (t > 0.0 && t < 0.10) || (t > 0.50 && t < 0.64);
    if (warmWindow) {
      // 越接近 0.05 / 0.56 越浓
      const center = t < 0.3 ? 0.05 : 0.56;
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

  /** 月亮：夜空弧线轨迹 + 柔光 */
  _drawMoon(ctx, world, alpha) {
    const t = this.dayT;
    // 夜晚 0.62~1.00 → 月亮走一段弧（含黎明前可见）
    const p = (t - 0.60) / 0.42;              // 0~1
    if (p < -0.05 || p > 1.1) return;
    const mx = world.w * (0.12 + p * 0.76);
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
    // 月体
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
    ctx.restore();
  }

  /** 太阳：白天弧线 + 光晕 */
  _drawSun(ctx, world) {
    const t = this.dayT;
    const p = (t - 0.02) / 0.58;              // 0~1 全程
    if (p < 0 || p > 1) return;
    const sx = world.w * (0.08 + p * 0.84);
    const sy = world.bankY * (0.86 - Math.sin(p * Math.PI) * 0.66);
    const r = Math.min(22, world.bankY * 0.14);

    ctx.save();
    const halo = ctx.createRadialGradient(sx, sy, r * 0.3, sx, sy, r * 3.2);
    halo.addColorStop(0, 'rgba(255,236,170,0.5)');
    halo.addColorStop(1, 'rgba(255,236,170,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe9a0';
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
