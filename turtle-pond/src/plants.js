/**
 * 植物系统 —— 阶段 5-②
 *
 * 按生长区域分三类，各自沿"岸线 / 泥沼线"自然分布：
 *
 *   岸边植物（bank）   ：芦苇、香蒲、狗尾草 —— 长在岸上，随风摇摆
 *   浮叶植物（surface）：睡莲、荷花          —— 浮在水面，被生物推开
 *   沉水植物（submerged）：水草、苦草        —— 长在水底，随水流摆动
 *
 * 设计要点：
 *   · 所有植物都有摇摆动画（相位 + 风速），"活的"画面
 *   · 浮叶植物会挡视线，生物经过时轻轻推开（复用浮萍的推开思路）
 *   · 提供 shelter（遮蔽点）查询：鱼群在附近会更放松（降低躲避强度）
 *   · 数据驱动：PLANT_SPECIES 里加一条即新增一种植物
 */

import { CONFIG } from './config.js';
import {
  rand, randInt, clamp, dist2,
  seededRandom, rngRange, rngInt, blobShape, blobPath,
} from './utils.js';

/** 颜色明暗调整：'#rrggbb' × factor（>1 提亮，<1 压暗）→ 'rgb(r,g,b)' */
function tint(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

// ══════════════════════════════════════════════════════════
//  植 物 品 种
// ══════════════════════════════════════════════════════════
/**
 * kind  —— 生长方式
 *   'bank'      岸边挺水/陆生（芦苇、香蒲）
 *   'surface'   水面浮叶（睡莲、荷花）
 *   'submerged' 沉水（水草）
 *
 * sway   —— 摆动幅度（0 不摆，越大越明显）
 * count  —— 默认生成数量
 * shelter—— 是否提供遮蔽（鱼群躲藏点）
 */
export const PLANT_SPECIES = {
  // ── 岸边 ──────────────────────────────────────────
  reed: {
    id: 'reed',
    label: '芦苇',
    kind: 'bank',
    color: '#6f8b4a',
    colorDark: '#556e37',
    tipColor: '#a3b878',
    count: 26,
    height: [40, 82],
    width: 3.2,
    sway: 8,
    shelter: false,
    weight: 3,
  },
  cattail: {
    id: 'cattail',
    label: '香蒲',
    kind: 'bank',
    color: '#5f7a3e',
    colorDark: '#485e2c',
    tipColor: '#8a6b3a',      // 蒲棒褐色
    count: 10,
    height: [52, 96],
    width: 2.6,
    sway: 6,
    shelter: false,
    weight: 2,
  },
  banksideGrass: {
    id: 'banksideGrass',
    label: '狗尾草',
    kind: 'bank',
    color: '#7d9a4e',
    colorDark: '#5f7a37',
    tipColor: '#b9c98a',
    count: 34,
    height: [14, 30],
    width: 2.0,
    sway: 5,
    shelter: false,
    weight: 4,
  },

  // ── 水面浮叶 ──────────────────────────────────────
  lilypad: {
    id: 'lilypad',
    label: '睡莲',
    kind: 'surface',
    color: '#4f8a3f',
    colorDark: '#3c6b30',
    flower: '#f3d7e8',
    flowerCore: '#e8c14a',
    count: 9,
    size: [16, 30],
    sway: 1.4,
    shelter: true,
    weight: 3,
  },
  lotus: {
    id: 'lotus',
    label: '荷花',
    kind: 'surface',
    color: '#4a7f3a',
    colorDark: '#375f2b',
    flower: '#f2a6c0',
    flowerCore: '#f5e07a',
    count: 4,
    size: [24, 42],
    sway: 1.0,
    shelter: true,
    weight: 1,
  },

  // ── 沉水 ──────────────────────────────────────────
  eelgrass: {
    id: 'eelgrass',
    label: '水草',
    kind: 'submerged',
    color: '#3f7a4a',
    colorDark: '#2d5c37',
    tipColor: '#6fa878',
    count: 30,
    height: [30, 70],
    width: 3.0,
    sway: 7,
    shelter: true,
    weight: 4,
  },
};

// 默认植物群落（品种 → 数量；缺省用品种自带 count）
export const DEFAULT_PLANTS = {
  reed: 26,
  cattail: 10,
  banksideGrass: 34,
  lilypad: 9,
  lotus: 4,
  eelgrass: 30,
};

// ══════════════════════════════════════════════════════════
//  单 株 植 物
// ══════════════════════════════════════════════════════════
export class Plant {
  constructor(world, species, zone) {
    this.world = world;
    this.sp = species;
    // 与鱼/龟统一叫法（fish.species / turtle.species）——两处都保留，
    // 谁引用都不会拿到 undefined（老代码用 .sp，新代码建议用 .species）
    this.species = species;
    this.kind = species.kind;
    this.zone = zone;                  // 'bank' | 'surface' | 'submerged'

    this.phase = rand(0, Math.PI * 2);
    this.swayPhase = rand(0, Math.PI * 2);
    this.hueJitter = rand(-6, 6);
    this.scale = rand(0.82, 1.18);

    // 外形随机种子：同一株读档后形状完全一致（save.js 会持久化 seed）
    this.seed = randInt(1, 0x7ffffffe);
    this._buildShape();

    // 位置（按区域分别放置）
    this._place();

    // 浮叶植物可被推动的偏移量（不是硬位置）
    this.ox = 0; this.oy = 0;
    this.pushVx = 0; this.pushVy = 0;
    this.rot = rand(0, Math.PI * 2);
  }

  _place() {
    const W = this.world;
    const sp = this.sp;
    if (this.kind === 'bank') {
      this.x = rand(W.w * 0.02, W.w * 0.98);
      // 岸边植物靠近岸线分布（下缘贴岸线）
      const line = W.bankLineAt(this.x);
      this.y = line - rand(2, 16);
      this.height = rand(sp.height[0], sp.height[1]) * this.scale;
    } else if (this.kind === 'surface') {
      this.x = rand(W.w * 0.06, W.w * 0.94);
      // 浮叶偏向靠岸的浅水区（视觉层次）
      const top = W.bankLineAt(this.x);
      const bot = W.marshLineAt(this.x);
      this.y = clamp(top + (bot - top) * rand(0.08, 0.46), top + 10, bot - 20);
      this.size = rand(sp.size[0], sp.size[1]) * this.scale;
      this.hasFlower = Math.random() < 0.45;
    } else { // submerged
      this.x = rand(W.w * 0.05, W.w * 0.95);
      this.y = W.marshLineAt(this.x) - rand(4, 26);
      this.height = rand(sp.height[0], sp.height[1]) * this.scale;
    }
  }

  /** 每帧更新摇摆 + 被推动（浮叶） */
  update(dt, time, movers) {
    // 摇摆由渲染时用 time 计算，这里只做浮叶的物理推动
    if (this.kind !== 'surface') return;

    // 生物经过把浮叶推开
    let ax = 0, ay = 0;
    const px = this.x + this.ox, py = this.y + this.oy;
    for (const m of movers) {
      const d2 = dist2(px, py, m.x, m.y);
      const rr = this.size + (m.size ?? 10);
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = (1 - d / rr) * 26;
        ax += ((px - m.x) / d) * f;
        ay += ((py - m.y) / d) * f;
      }
    }
    this.pushVx += ax * dt;
    this.pushVy += ay * dt;
    // 阻尼 + 回弹到原位
    this.pushVx *= 0.88;
    this.pushVy *= 0.88;
    this.pushVx += -this.ox * 3.2 * dt;
    this.pushVy += -this.oy * 3.2 * dt;
    this.ox += this.pushVx * dt;
    this.oy += this.pushVy * dt;
    // 限制最大漂移
    const maxOff = 26;
    this.ox = clamp(this.ox, -maxOff, maxOff);
    this.oy = clamp(this.oy, -maxOff, maxOff);
  }

  /** 当前实际位置（含浮叶偏移） */
  get px() { return this.x + this.ox; }
  get py() { return this.y + this.oy; }

  draw(ctx, time) {
    switch (this.kind) {
      case 'bank': this._drawBankPlant(ctx, time); break;
      case 'surface': this._drawSurfacePlant(ctx, time); break;
      case 'submerged': this._drawSubmerged(ctx, time); break;
    }
  }

  /** 摇摆偏移：正弦 + 相位 */
  _sway(time, amp) {
    return Math.sin(time * 0.9 + this.swayPhase) * amp
         + Math.sin(time * 2.3 + this.phase) * amp * 0.3;
  }

  // ══ 随机外形 ══════════════════════════════════════════
  /**
   * 生成这株植物的随机外形参数（全部是归一化比例，绘制时再乘实际尺寸）。
   * 只依赖 seed 与品种 —— 读档 reseed 后可以完全复现同款形状。
   * 目的：每株叶形/花瓣/叶片都长得不一样，不再"清一色几何图形"。
   */
  _buildShape() {
    const rng = seededRandom(this.seed);
    const R = (lo, hi) => rngRange(rng, lo, hi);
    const RI = (lo, hi) => rngInt(rng, lo, hi);
    const id = this.sp?.id;
    const S = {};

    if (this.kind === 'surface') {
      // 叶片：椭圆化 + 谐波波浪边 + 随机朝向缺口（睡莲 V 口大，荷花浅口）
      S.sx = R(0.84, 1.18);
      S.sy = R(0.82, 1.10);
      S.harm = [R(0.05, 0.13), R(0.03, 0.08), R(0.015, 0.05)];
      S.hphase = [R(0, Math.PI * 2), R(0, Math.PI * 2), R(0, Math.PI * 2)];
      S.notchA = R(0, Math.PI * 2);
      S.notchW = id === 'lotus' ? R(0.08, 0.2) : R(0.26, 0.42);
      S.veins = RI(7, 12);
      S.veinA = R(0, Math.PI * 2);
      // 花：花瓣数/长短/宽窄/朝向逐瓣随机，双层
      S.flowerRot = R(0, Math.PI * 2);
      S.flowerOx = R(-0.06, 0.06);
      S.flowerOy = R(-0.06, 0.06);
      S.petals = id === 'lotus' ? RI(9, 13) : RI(6, 9);
      S.petalJit = []; S.petalLen = []; S.petalWid = [];
      for (let i = 0; i < 16; i++) {
        S.petalJit.push(R(-0.14, 0.14));
        S.petalLen.push(R(0.82, 1.14));
        S.petalWid.push(R(0.26, 0.44));
      }
      const core = blobShape(rng, 2, 0.12, 0.3);
      S.coreAmps = core.amps; S.corePhases = core.phases;
      S.stamens = RI(6, 10);
    } else if (this.kind === 'submerged') {
      // 叶片束：根数/长度/粗细/倾斜/弯曲逐根随机，部分带侧小叶
      // lean/curve 给足幅度，避免"一排整齐直线"
      const n = RI(3, 8);
      S.blades = [];
      for (let i = 0; i < n; i++) {
        S.blades.push({
          off: (i - (n - 1) / 2) * R(2.0, 4.4) + R(-1.6, 1.6),
          len: R(0.45, 1.1),
          w: R(0.55, 1.35),
          lean: R(-0.34, 0.34),
          curve: R(0.25, 0.95),
          dark: rng() < 0.45,
          phase: R(0, Math.PI * 2),
          leaflet: rng() < 0.55 ? RI(1, 2) : 0,
        });
      }
    } else {
      // 岸边：茎数/高矮/倾斜随机；蒲棒与狗尾穗走不规则轮廓
      const n = id === 'banksideGrass' ? RI(3, 5) : RI(2, 3);
      S.stalks = [];
      for (let i = 0; i < n; i++) {
        S.stalks.push({
          off: (i - (n - 1) / 2) * R(2.2, 3.8) + R(-1.2, 1.2),
          len: R(0.72, 1.0),
          lean: R(-0.1, 0.1),
          dark: rng() < 0.45,
          w: R(0.75, 1.15),
        });
      }
      const tip = blobShape(rng, 3, 0.12, 0.28);
      S.tipAmps = tip.amps; S.tipPhases = tip.phases;
      S.tipRot = R(0, Math.PI * 2);
      S.tipRx = R(0.85, 1.15);
      S.tipRy = R(0.85, 1.15);
    }

    this.shape = S;
  }

  /** 用已有 seed 重建外形（读档还原同款形状用） */
  reseed(seed) {
    this.seed = seed;
    this._buildShape();
  }

  /** 叶片半径随角度的起伏（1 = 基准半径）——叶脉长度也跟随它，不会穿出叶外 */
  _leafK(t) {
    const S = this.shape;
    return 1 + S.harm[0] * Math.sin(t * 3 + S.hphase[0])
           + S.harm[1] * Math.sin(t * 5 + S.hphase[1])
           + S.harm[2] * Math.sin(t * 7 + S.hphase[2]);
  }

  /**
   * 叶形路径：椭圆化 + 波浪边 + 从叶心切开的缺口（真实莲叶的 V 口）。
   * @param {number} r 基准半径
   * @param {number} [scale] 整体缩放（描边高光时用 0.96 之类）
   */
  _leafPath(ctx, r, scale = 1) {
    const S = this.shape;
    const start = S.notchA + S.notchW;
    const end = S.notchA - S.notchW + Math.PI * 2;
    const steps = 42;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let i = 0; i <= steps; i++) {
      const t = start + (end - start) * (i / steps);
      const k = this._leafK(t) * scale;
      ctx.lineTo(Math.cos(t) * r * k * S.sx, Math.sin(t) * r * k * S.sy);
    }
    ctx.closePath();
  }

  // ── 岸边植物：随机茎数/高矮/倾斜，蒲棒与狗尾穗走不规则轮廓 ──
  _drawBankPlant(ctx, time) {
    const sp = this.sp;
    const S = this.shape;
    const h = this.height;
    const baseY = this.y;
    const x = this.x;

    ctx.save();
    ctx.lineCap = 'round';
    const tips = [];
    S.stalks.forEach((s, i) => {
      const sway = this._sway(time + i * 0.35, sp.sway);
      const len = h * s.len;
      const tipX = x + s.off + sway * (0.6 + i * 0.2) + s.lean * len;
      const tipY = baseY - len;
      tips.push({ tipX, tipY, sway });
      ctx.strokeStyle = s.dark ? sp.colorDark : sp.color;
      ctx.lineWidth = sp.width * s.w;
      ctx.beginPath();
      ctx.moveTo(x + s.off, baseY);
      ctx.quadraticCurveTo(x + s.off + sway * 0.4, baseY - len * 0.55, tipX, tipY);
      ctx.stroke();
    });

    if (sp.id === 'cattail') {
      // 香蒲蒲棒：不规则椭圆团 + 顶端细茎
      const t0 = tips[0];
      ctx.fillStyle = sp.tipColor;
      blobPath(ctx, t0.tipX, t0.tipY + 9 * S.tipRy,
        3.1 * S.tipRx, 9.5 * S.tipRy, S.tipAmps, S.tipPhases, S.tipRot);
      ctx.fill();
      ctx.strokeStyle = sp.colorDark;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(t0.tipX, t0.tipY);
      ctx.lineTo(t0.tipX + t0.sway * 0.2, t0.tipY - 7 * S.tipRy);
      ctx.stroke();
    } else if (sp.id === 'banksideGrass') {
      // 狗尾草：每根茎一个毛茸茸的不规则穗 + 向外发散的毛须
      ctx.globalAlpha = 0.85;
      for (const t of tips) {
        ctx.fillStyle = sp.tipColor;
        blobPath(ctx, t.tipX, t.tipY + 3,
          2.3 * S.tipRx, 6.5 * S.tipRy, S.tipAmps, S.tipPhases, S.tipRot + t.sway * 0.02);
        ctx.fill();
        ctx.strokeStyle = sp.tipColor;
        ctx.lineWidth = 0.6;
        for (let k = 0; k < 3; k++) {
          const a = -Math.PI / 2 + (k - 1) * 0.55 + S.tipRot;
          ctx.beginPath();
          ctx.moveTo(t.tipX, t.tipY + 3);
          ctx.lineTo(t.tipX + Math.cos(a) * 8 * S.tipRx + t.sway * 0.3,
                     t.tipY + 3 + Math.sin(a) * 8 * S.tipRy);
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ── 水面浮叶：莲叶 + 可选花（外形随机，不再是正圆）──
  _drawSurfacePlant(ctx, time) {
    const sp = this.sp;
    const S = this.shape;
    const x = this.px, y = this.py;
    const r = this.size;
    const bob = Math.sin(time * 1.1 + this.swayPhase) * sp.sway;
    const rot = this.rot + Math.sin(time * 0.4 + this.phase) * 0.05;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(rot);

    // 水下茎蔓（淡淡的，也带点随机弯曲）
    ctx.strokeStyle = sp.colorDark;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(r * 0.2 * S.sx, r * 0.9, r * 0.1 * S.sx, r * 1.6);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 叶下阴影（垫出厚度感，形状与叶一致）
    ctx.save();
    ctx.translate(r * 0.07, r * 0.14);
    this._leafPath(ctx, r);
    ctx.fillStyle = 'rgba(10, 30, 20, 0.26)';
    ctx.fill();
    ctx.restore();

    // 叶片本体：椭圆化 + 波浪边 + 随机缺口（不再是完美正圆）
    const g = ctx.createLinearGradient(-r * S.sx, -r * S.sy, r * S.sx, r * S.sy);
    g.addColorStop(0, tint(sp.color, 1.12));
    g.addColorStop(1, tint(sp.color, 0.84));
    ctx.fillStyle = g;
    this._leafPath(ctx, r);
    ctx.fill();

    // 叶脉：从叶心放射，长度跟随波浪边缘（不会穿出叶外），避开缺口扇区
    ctx.strokeStyle = sp.colorDark;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = Math.max(0.7, r * 0.035);
    const nv = S.veins;
    const a0 = S.notchA + S.notchW + 0.15;
    const a1 = S.notchA - S.notchW - 0.15 + Math.PI * 2;
    for (let i = 0; i < nv; i++) {
      const t = a0 + (a1 - a0) * (i / (nv - 1));
      const k = this._leafK(t) * 0.9;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(t) * r * k * S.sx, Math.sin(t) * r * k * S.sy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 外缘描边（深色收边）+ 内侧高光（随波浪边走）
    ctx.strokeStyle = sp.colorDark;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 1.2;
    this._leafPath(ctx, r);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = 1;
    this._leafPath(ctx, r, 0.93);
    ctx.stroke();

    // 花：双层花瓣、长短宽窄逐瓣随机，花心为不规则小团
    if (this.hasFlower) {
      const base = r * (sp.id === 'lotus' ? 0.52 : 0.44);
      ctx.save();
      ctx.translate(S.flowerOx * r, S.flowerOy * r);
      ctx.rotate(S.flowerRot);
      for (let ring = 0; ring < 2; ring++) {
        const count = ring === 0 ? S.petals : Math.max(3, Math.round(S.petals * 0.6));
        const len0 = base * (ring === 0 ? 1 : 0.62);
        ctx.fillStyle = ring === 0 ? sp.flower : tint(sp.flower, 0.88);
        for (let i = 0; i < count; i++) {
          const a = (i / count) * Math.PI * 2 + ring * 0.5 + S.petalJit[i % S.petalJit.length];
          const len = len0 * S.petalLen[(i + ring * 3) % S.petalLen.length];
          const wid = len * S.petalWid[(i * 2 + ring) % S.petalWid.length];
          ctx.save();
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(len * 0.45, -wid, len, -wid * 0.1);
          ctx.quadraticCurveTo(len * 0.5, wid * 0.9, 0, 0);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
      // 花心：不规则团 + 花蕊点
      ctx.fillStyle = sp.flowerCore;
      blobPath(ctx, 0, 0, base * 0.34, base * 0.3, S.coreAmps, S.corePhases, S.flowerRot * 1.7);
      ctx.fill();
      ctx.fillStyle = 'rgba(120, 84, 30, 0.8)';
      for (let i = 0; i < S.stamens; i++) {
        const a = (i / S.stamens) * Math.PI * 2 + 0.6;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * base * 0.2, Math.sin(a) * base * 0.2,
          Math.max(0.7, base * 0.045), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
  }

  // ── 沉水植物：水底向上飘的水草束（叶片根数/形态逐根随机）──
  _drawSubmerged(ctx, time) {
    const sp = this.sp;
    const h = this.height;
    const baseY = this.y;
    const x = this.x;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.82;
    for (const b of this.shape.blades) {
      const sway = this._sway(time + b.phase, sp.sway);
      const bh = h * b.len;
      const tipX = x + b.off + sway * (0.6 + b.curve * 0.5) + b.lean * bh;
      const tipY = baseY - bh;
      ctx.strokeStyle = b.dark ? sp.colorDark : sp.color;
      ctx.lineWidth = sp.width * b.w;
      ctx.beginPath();
      ctx.moveTo(x + b.off, baseY);
      ctx.quadraticCurveTo(
        x + b.off + sway * 0.5 * b.curve, baseY - bh * 0.5,
        tipX, tipY
      );
      ctx.stroke();

      // 侧小叶：从主叶 55% / 77% 高度处斜出，左右交替
      for (let L = 0; L < b.leaflet; L++) {
        const t0 = 0.55 + L * 0.22;
        const bx = x + b.off + (tipX - (x + b.off)) * t0;
        const by = baseY - bh * t0;
        const side = L % 2 === 0 ? 1 : -1;
        const ll = bh * (0.15 + b.curve * 0.1);
        ctx.lineWidth = sp.width * 0.6;
        ctx.strokeStyle = b.dark ? sp.color : sp.colorDark;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(
          bx + side * ll * 0.5, by - ll * 0.4,
          bx + side * ll + sway * 0.3, by - ll * 0.85
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════
//  植 物 群 落 管 理 器
// ══════════════════════════════════════════════════════════
export class PlantField {
  constructor(world, population = DEFAULT_PLANTS) {
    this.world = world;
    this.plants = [];
    this.build(population);
  }

  /** 按群落配置重建 */
  build(population = DEFAULT_PLANTS) {
    this.plants.length = 0;
    for (const [id, n] of Object.entries(population)) {
      const sp = PLANT_SPECIES[id];
      if (!sp) continue;
      const zone = sp.kind === 'bank' ? 'bank' : (sp.kind === 'surface' ? 'surface' : 'submerged');
      for (let i = 0; i < n; i++) {
        this.plants.push(new Plant(this.world, sp, zone));
      }
    }
  }

  /**
   * 单株投放（"添加植物"用）——把点击位置吸附到该品种应处的层：
   *   bank      岸边：贴该 x 处的岸线，往上长
   *   surface   浮叶：落在这段水面的浅水区
   *   submerged 沉水：贴该 x 处的泥沼线，往上飘
   * @param {string} id 品种 id
   * @param {number} x 点击的 x
   * @param {number} [y] 点击的 y（仅浮叶参考深度）
   * @returns {Plant|null}
   */
  addPlant(id, x, y) {
    const sp = PLANT_SPECIES[id];
    if (!sp) return null;
    const W = this.world;
    const zone = sp.kind === 'bank' ? 'bank' : (sp.kind === 'surface' ? 'surface' : 'submerged');
    const p = new Plant(W, sp, zone);
    const cx = clamp(x, 8, W.w - 8);
    if (sp.kind === 'bank') {
      p.x = cx;
      p.y = W.bankLineAt(cx) - rand(2, 16);
      p.height = rand(sp.height[0], sp.height[1]) * p.scale;
    } else if (sp.kind === 'surface') {
      const top = W.bankLineAt(cx), bot = W.marshLineAt(cx);
      p.x = cx;
      // 落在点击的深度上，但夹在靠岸浅水区（8%~46%）
      const t = clamp((y - top) / Math.max(1, bot - top), 0.08, 0.46);
      p.y = clamp(top + (bot - top) * t, top + 10, bot - 20);
      p.size = rand(sp.size[0], sp.size[1]) * p.scale;
      p.hasFlower = Math.random() < 0.45;
    } else {
      p.x = cx;
      p.y = W.marshLineAt(cx) - rand(4, 26);
      p.height = rand(sp.height[0], sp.height[1]) * p.scale;
    }
    this.plants.push(p);
    return p;
  }

  /** 分层：岸边植物最靠后画，浮叶在最前 */
  byKind(kind) {
    return this.plants.filter((p) => p.sp.kind === kind);
  }

  update(dt, time, movers) {
    for (const p of this.plants) p.update(dt, time, movers);
  }

  /** 画某一层（'bank' | 'surface' | 'submerged'） */
  drawLayer(ctx, time, kind) {
    for (const p of this.plants) {
      if (p.sp.kind === kind) p.draw(ctx, time);
    }
  }

  /** 统计各品种数量 */
  population() {
    const out = {};
    for (const p of this.plants) out[p.sp.id] = (out[p.sp.id] || 0) + 1;
    return out;
  }

  /** 遮蔽点列表（供鱼群躲避用）：返回 {x,y,r} */
  shelters() {
    return this.plants
      .filter((p) => p.sp.shelter)
      .map((p) => ({ x: p.px ?? p.x, y: p.py ?? p.y, r: (p.size ?? p.height ?? 20) * 1.3 }));
  }

  /** 判断某点是否在植物遮蔽范围内 */
  isSheltered(x, y) {
    for (const p of this.plants) {
      if (!p.sp.shelter) continue;
      const r = (p.size ?? p.height ?? 20) * 1.3;
      if (dist2(x, y, p.px ?? p.x, p.py ?? p.y) < r * r) return true;
    }
    return false;
  }
}
