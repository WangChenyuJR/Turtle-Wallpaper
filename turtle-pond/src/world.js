/**
 * 场景世界 —— 岸边区 / 水面区 / 泥沼区 三区划分与渲染
 *
 * 坐标系：左上角 (0,0)，y 向下为正
 *
 *  ┌──────────────────────────────┐  y = 0
 *  │        岸边区（沙 + 草）        │
 *  ├──────────────────────────────┤  y = bankY   ← 岸线
 *  │                              │
 *  │        水面区（乌龟+鱼）        │
 *  │                              │
 *  ├──────────────────────────────┤  y = marshY  ← 泥沼线
 *  │        泥沼区（浑浊泥）         │
 *  └──────────────────────────────┘  y = height
 */

import { CONFIG } from './config.js';
import { rand, clamp } from './utils.js';

export class World {
  constructor(width, height) {
    this.resize(width, height);
    this._buildTerrain();
    this._buildRipples();
  }

  resize(width, height) {
    this.w = width;
    this.h = height;
    this.bankY = Math.round(height * CONFIG.layout.bankRatio);
    this.marshY = Math.round(height * (1 - CONFIG.layout.marshRatio));
    this.waterTop = this.bankY;
    this.waterBottom = this.marshY;
    this.waterHeight = this.marshY - this.bankY;

    // 岸线起伏（让边界自然，不是一条直线）
    this.bankProfile = [];
    this.marshProfile = [];
    const seg = 40;
    for (let i = 0; i <= seg; i++) {
      this.bankProfile.push(rand(-7, 7));
      this.marshProfile.push(rand(-6, 6));
    }
    this.seg = seg;
  }

  /** 岸线 y（带起伏），x 为像素 */
  bankLineAt(x) {
    return this.bankY + this._sample(this.bankProfile, x);
  }

  /** 泥沼线 y（带起伏） */
  marshLineAt(x) {
    return this.marshY + this._sample(this.marshProfile, x);
  }

  _sample(profile, x) {
    const t = clamp(x / this.w, 0, 1) * this.seg;
    const i = Math.floor(t);
    const f = t - i;
    const a = profile[i] ?? 0;
    const b = profile[Math.min(i + 1, this.seg)] ?? 0;
    return a + (b - a) * f;
  }

  /** 判断点是否在水面可游区域 */
  isWater(x, y) {
    return y > this.bankLineAt(x) + 6 && y < this.marshLineAt(x) - 6;
  }

  /** 判断点是否在岸边（陆地） */
  isBank(x, y) {
    return y <= this.bankLineAt(x) + 6;
  }

  /** 判断点是否在泥沼 */
  isMarsh(x, y) {
    return y >= this.marshLineAt(x) - 6;
  }

  /** 把点约束到水面区域内 */
  constrainToWater(x, y, margin = 8) {
    const cx = clamp(x, margin, this.w - margin);
    const top = this.bankLineAt(cx) + margin;
    const bot = this.marshLineAt(cx) - margin;
    return { x: cx, y: clamp(y, top, Math.max(top, bot)) };
  }

  _buildTerrain() {
    // 岸边草丛随机分布点
    this.grassTufts = [];
    for (let i = 0; i < 90; i++) {
      const x = rand(0, this.w);
      const y = rand(0, this.bankLineAt(x) - 4);
      this.grassTufts.push({
        x, y,
        h: rand(7, 18),
        lean: rand(-3, 3),
        hue: rand(80, 105),
      });
    }

    // 岸边石头
    this.rocks = [];
    for (let i = 0; i < 14; i++) {
      const x = rand(0, this.w);
      this.rocks.push({
        x,
        y: rand(this.bankLineAt(x) - 12, this.bankLineAt(x) + 2),
        r: rand(5, 14),
        shade: rand(0.6, 0.9),
      });
    }

    // 泥沼气泡
    this.bubbles = [];
    for (let i = 0; i < 26; i++) {
      const x = rand(0, this.w);
      this.bubbles.push({
        x,
        y: rand(this.marshLineAt(x), this.h),
        r: rand(1.5, 4.5),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.3, 1.0),
      });
    }
  }

  _buildRipples() {
    this.ripples = [];
  }

  /** 在指定位置生成涟漪（投喂/光标划过时调用） */
  addRipple(x, y, strength = 1) {
    this.ripples.push({
      x, y,
      r: 2,
      maxR: 26 * strength,
      alpha: 0.55 * strength,
      speed: 34,
    });
    if (this.ripples.length > 40) this.ripples.shift();
  }

  update(dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += rp.speed * dt;
      rp.alpha -= 0.55 * dt;
      if (rp.alpha <= 0 || rp.r >= rp.maxR) this.ripples.splice(i, 1);
    }
    for (const b of this.bubbles) {
      b.phase += b.speed * dt;
    }
  }

  // ────────────────────────────────────────────────────────
  //  渲染
  // ────────────────────────────────────────────────────────

  draw(ctx, time) {
    this._drawWater(ctx, time);
    this._drawMarsh(ctx);
    this._drawBank(ctx);
    this._drawRipples(ctx);
  }

  _drawWater(ctx, time) {
    const g = ctx.createLinearGradient(0, this.waterTop, 0, this.waterBottom);
    g.addColorStop(0, CONFIG.colors.waterTop);
    g.addColorStop(1, CONFIG.colors.waterBottom);
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, this.bankLineAt(0));
    for (let x = 0; x <= this.w; x += 8) ctx.lineTo(x, this.bankLineAt(x));
    for (let x = this.w; x >= 0; x -= 8) ctx.lineTo(x, this.marshLineAt(x));
    ctx.closePath();
    ctx.fill();

    // 水面高光波纹（轻微、不连续）
    ctx.save();
    ctx.globalAlpha = 0.055;
    ctx.strokeStyle = '#bfe6f2';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 6; i++) {
      const baseY = this.waterTop + this.waterHeight * ((i + 0.5) / 6);
      // 分段绘制，让波纹断续出现而不是整条横线
      const segStart = ((i * 0.37 + time * 0.01) % 1) * this.w - this.w * 0.2;
      const segEnd = segStart + this.w * (0.35 + 0.12 * Math.sin(i * 2.7));
      ctx.beginPath();
      let first = true;
      for (let x = segStart; x <= segEnd; x += 12) {
        if (x < 0 || x > this.w) continue;
        const y = baseY + Math.sin(x * 0.014 + time * 0.7 + i * 1.7) * 4;
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawMarsh(ctx) {
    const g = ctx.createLinearGradient(0, this.marshY - 10, 0, this.h);
    g.addColorStop(0, CONFIG.colors.marsh);
    g.addColorStop(1, CONFIG.colors.marshMud);
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, this.marshLineAt(0));
    for (let x = 0; x <= this.w; x += 8) ctx.lineTo(x, this.marshLineAt(x));
    ctx.lineTo(this.w, this.h);
    ctx.lineTo(0, this.h);
    ctx.closePath();
    ctx.fill();

    // 泥沼气泡
    ctx.save();
    for (const b of this.bubbles) {
      const pulse = 0.5 + 0.5 * Math.sin(b.phase);
      ctx.globalAlpha = 0.10 + pulse * 0.16;
      ctx.fillStyle = '#7a6f4a';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.8 + pulse * 0.4), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawBank(ctx) {
    // 沙地
    const g = ctx.createLinearGradient(0, 0, 0, this.bankY);
    g.addColorStop(0, CONFIG.colors.bankGrass);
    g.addColorStop(0.45, CONFIG.colors.bankSand);
    g.addColorStop(1, '#b8a075');
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.w, 0);
    ctx.lineTo(this.w, this.bankLineAt(this.w));
    for (let x = this.w; x >= 0; x -= 8) ctx.lineTo(x, this.bankLineAt(x));
    ctx.closePath();
    ctx.fill();

    // 岸边湿泥过渡带
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#8a7550';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, this.bankLineAt(0));
    for (let x = 0; x <= this.w; x += 8) ctx.lineTo(x, this.bankLineAt(x));
    ctx.stroke();
    ctx.restore();

    // 石头
    for (const r of this.rocks) {
      ctx.fillStyle = `rgba(${Math.round(110 * r.shade)},${Math.round(104 * r.shade)},${Math.round(92 * r.shade)},0.9)`;
      ctx.beginPath();
      ctx.ellipse(r.x, r.y, r.r, r.r * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      ctx.beginPath();
      ctx.ellipse(r.x - r.r * 0.25, r.y - r.r * 0.28, r.r * 0.45, r.r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 草丛
    ctx.save();
    ctx.lineCap = 'round';
    for (const t of this.grassTufts) {
      ctx.strokeStyle = `hsl(${t.hue}, 38%, ${34 + (t.hue - 80) * 0.4}%)`;
      ctx.lineWidth = 1.6;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath();
        ctx.moveTo(t.x + k * 2, t.y);
        ctx.quadraticCurveTo(
          t.x + k * 2 + t.lean,
          t.y - t.h * 0.6,
          t.x + k * 2 + t.lean * 1.8,
          t.y - t.h
        );
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawRipples(ctx) {
    ctx.save();
    for (const rp of this.ripples) {
      ctx.globalAlpha = Math.max(0, rp.alpha);
      ctx.strokeStyle = '#d6f0f8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.42, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
