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
import { rand, randInt, clamp, dist2 } from './utils.js';

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
    this.kind = species.kind;
    this.zone = zone;                  // 'bank' | 'surface' | 'submerged'

    this.phase = rand(0, Math.PI * 2);
    this.swayPhase = rand(0, Math.PI * 2);
    this.hueJitter = rand(-6, 6);
    this.scale = rand(0.82, 1.18);

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

  // ── 岸边植物：细长茎 + 顶端（穗/蒲棒）───────────────
  _drawBankPlant(ctx, time) {
    const sp = this.sp;
    const sway = this._sway(time, sp.sway);
    const h = this.height;
    const baseY = this.y;
    const x = this.x;

    // 主体（几根茎）
    const stalks = this.kind === 'bank' && sp.id === 'banksideGrass' ? 3 : 2;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < stalks; i++) {
      const off = (i - (stalks - 1) / 2) * 3.2;
      const tipX = x + off + sway * (0.6 + i * 0.2);
      const tipY = baseY - h * (1 - i * 0.06);
      ctx.strokeStyle = i === 0 ? sp.color : sp.colorDark;
      ctx.lineWidth = sp.width * (i === 0 ? 1 : 0.8);
      ctx.beginPath();
      ctx.moveTo(x + off, baseY);
      ctx.quadraticCurveTo(x + off + sway * 0.4, baseY - h * 0.55, tipX, tipY);
      ctx.stroke();
    }
    // 香蒲的蒲棒
    if (sp.id === 'cattail') {
      ctx.fillStyle = sp.tipColor;
      const tipX = x + sway * 0.7;
      const tipY = baseY - h;
      ctx.beginPath();
      ctx.ellipse(tipX, tipY + 9, 3.2, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (sp.id === 'banksideGrass') {
      // 狗尾草毛茸茸的穗
      ctx.fillStyle = sp.tipColor;
      ctx.globalAlpha = 0.85;
      const tipX = x + sway * 0.6;
      const tipY = baseY - h;
      ctx.beginPath();
      ctx.ellipse(tipX, tipY + 3, 2.4, 7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  // ── 水面浮叶：莲叶 + 可选花 ────────────────────────
  _drawSurfacePlant(ctx, time) {
    const sp = this.sp;
    const x = this.px, y = this.py;
    const r = this.size;
    const bob = Math.sin(time * 1.1 + this.swayPhase) * sp.sway;
    const rot = this.rot + Math.sin(time * 0.4 + this.phase) * 0.05;

    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(rot);

    // 水下茎蔓（淡淡的）
    ctx.strokeStyle = sp.colorDark;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, r * 1.6);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 叶片（带缺口的莲叶形）
    ctx.fillStyle = sp.color;
    ctx.beginPath();
    ctx.arc(0, 0, r, -Math.PI / 2 + 0.28, -Math.PI / 2 - 0.28 + Math.PI * 2);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();

    // 叶脉
    ctx.strokeStyle = sp.colorDark;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = Math.max(0.8, r * 0.04);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 边缘高光
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.97, 0, Math.PI * 2);
    ctx.stroke();

    // 花
    if (this.hasFlower) {
      const fw = sp.id === 'lotus' ? r * 0.5 : r * 0.42;
      // 花瓣
      ctx.fillStyle = sp.flower;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(Math.cos(a) * fw * 0.5, Math.sin(a) * fw * 0.5,
          fw * 0.5, fw * 0.26, a, 0, Math.PI * 2);
        ctx.fill();
      }
      // 花心
      ctx.fillStyle = sp.flowerCore;
      ctx.beginPath();
      ctx.arc(0, 0, fw * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── 沉水植物：水底向上飘的水草束 ───────────────────
  _drawSubmerged(ctx, time) {
    const sp = this.sp;
    const h = this.height;
    const baseY = this.y;
    const x = this.x;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.82;
    const blades = 4;
    for (let i = 0; i < blades; i++) {
      const off = (i - (blades - 1) / 2) * 3.4;
      const sway = this._sway(time + i * 0.4, sp.sway);
      const bh = h * (0.7 + (i % 2) * 0.3);
      ctx.strokeStyle = i % 2 === 0 ? sp.color : sp.colorDark;
      ctx.lineWidth = sp.width * 0.8;
      ctx.beginPath();
      ctx.moveTo(x + off, baseY);
      ctx.quadraticCurveTo(
        x + off + sway * 0.5, baseY - bh * 0.5,
        x + off + sway, baseY - bh
      );
      ctx.stroke();
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
