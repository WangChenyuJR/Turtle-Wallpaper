/**
 * 分解者 —— 阶段 5-⑦
 *
 * 生态闭环的最后一环：
 *   · Remains 遗骸   —— 生物死亡入档后，池塘里留下的淡淡残影（缓慢分解或被吃）
 *   · Snail   螺蛳   —— 岸边/水底缓慢爬行，啃食遗骸（加速分解）
 *   · Shrimp  小虾   —— 水中弹射游动，捡食沉底的食物颗粒
 *
 * 分解者不繁殖、不死亡（常驻种群），只负责"打扫"。
 */

import { CONFIG } from './config.js';
import { organicPath } from './creature-art.js';
import { rand, randInt, dist2, clamp } from './utils.js';

// ══════════════════════════════════════════════════════════
//  遗 骸
// ══════════════════════════════════════════════════════════
export class Remains {
  constructor(world, kind, size, x, y, stayY = null) {
    this.world = world;
    this.kind = kind;               // 'fish' | 'turtle'
    this.size = size;
    this.x = clamp(x, 12, world.w - 12);
    // 水里沉到泥沼线上；岸上离世的（龟）留在原地
    this.y = stayY ?? (world.marshLineAt(this.x) - rand(2, 8));
    this.decay = 1;                 // 1 → 0
    this.phase = rand(0, Math.PI * 2);
    this.gone = false;
    this.eatenBits = 0;             // 被啃次数（视觉：越来越小）
  }

  update(dt) {
    // 自然分解（被螺蛳啃会额外加速，由 Snail 调 nibble()）
    this.decay -= dt / (CONFIG.scavengers.remainsDecay ?? 75);
    if (this.decay <= 0) this.gone = true;
  }

  /** 被螺蛳啃一口 */
  nibble(amount = 0.06) {
    this.decay -= amount;
    this.eatenBits++;
    if (this.decay <= 0) this.gone = true;
  }

  draw(ctx, time) {
    const a = Math.max(0, this.decay) * 0.5;
    if (a <= 0.01) return;
    const s = this.size * (0.55 + this.decay * 0.45);
    const sway = Math.sin(time * 0.8 + this.phase) * 2;

    ctx.save();
    ctx.translate(this.x + sway, this.y);
    ctx.globalAlpha = a;
    if (this.kind === 'fish') {
      // 鱼骨：脊线 + 刺 + 头骨
      ctx.strokeStyle = '#d8d2c0';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(-s, 0);
      ctx.lineTo(s * 0.6, 0);
      ctx.stroke();
      for (let i = -3; i <= 3; i++) {
        const px = i * s * 0.16;
        const h = s * (0.34 - Math.abs(i) * 0.07);
        ctx.beginPath();
        ctx.moveTo(px, -h);
        ctx.lineTo(px, h);
        ctx.stroke();
      }
      ctx.fillStyle = '#d8d2c0';
      ctx.beginPath();
      ctx.ellipse(s * 0.72, 0, s * 0.2, s * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 龟壳残片：半透明的空壳轮廓
      ctx.strokeStyle = '#cfc6a8';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.5, s * 0.38, 0, Math.PI * 0.95, Math.PI * 2.05);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.3, s * 0.22, 0, Math.PI, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════
//  螺 蛳（岸边/水底爬行，啃遗骸）
// ══════════════════════════════════════════════════════════
export class Snail {
  constructor(world, zone = 'bottom') {
    this.world = world;
    this.zone = zone;              // 'bank' 石头区 | 'bottom' 泥沼底
    this.size = rand(4.5, 7);
    this.shellHue = rand(20, 60);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.speed = CONFIG.scavengers.snailSpeed * rand(0.7, 1.3);
    this.phase = rand(0, Math.PI * 2);
    this._place();
    this.target = null;            // 正在啃的遗骸
    this.restTimer = rand(1, 4);
    this._nibbleTimer = rand(0.3, 0.8);   // 啃食冷却（防每帧一口瞬间啃光）
  }

  _place() {
    const W = this.world;
    this.x = rand(W.w * 0.05, W.w * 0.95);
    if (this.zone === 'bank') {
      // 岸边（贴近岸线）
      this.y = W.bankLineAt(this.x) - rand(0, 10);
    } else {
      // 水底（泥沼线上方一点点）
      this.y = W.marshLineAt(this.x) - rand(2, 6);
    }
  }

  update(dt, remains) {
    this.phase += dt;
    const W = this.world;

    // 找最近的可啃遗骸
    if (!this.target || this.target.gone) {
      this.target = null;
      let bestD = 130 * 130;
      for (const r of remains) {
        if (r.gone || r.decay < 0.05) continue;
        const d2 = dist2(this.x, this.y, r.x, r.y);
        if (d2 < bestD) { bestD = d2; this.target = r; }
      }
    }

    if (this.target) {
      // 爬向遗骸
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > this.size * 0.9) {
        this.x += (dx / d) * this.speed * dt;
        this.y += (dy / d) * this.speed * dt;
      } else {
        // 到嘴边：啃（限频，约每 0.5~1s 一口）
        this._nibbleTimer -= dt;
        if (this._nibbleTimer <= 0) {
          this._nibbleTimer = rand(0.5, 1.0);
          this.target.nibble(0.05 + Math.random() * 0.03);
        }
      }
      this.dir = dx >= 0 ? 1 : -1;
    } else {
      // 漫步（走走停停）
      this.restTimer -= dt;
      if (this.restTimer <= 0) {
        this.restTimer = rand(0.8, 3);
        if (Math.random() < 0.3) this.dir *= -1;
      }
      if (this.restTimer < 2) {
        this.x += this.dir * this.speed * dt;
      }
    }

    // 按区域约束
    if (this.zone === 'bottom') {
      this.x = clamp(this.x, 8, W.w - 8);
      this.y = W.marshLineAt(this.x) - rand(2, 5);   // 贴底
    } else {
      this.x = clamp(this.x, 8, W.w - 8);
      this.y = clamp(this.y, 10, Math.max(12, W.bankLineAt(this.x) - 2));
    }
  }

  draw(ctx, time) {
    const s = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.dir, 1);
    // 足（腹足：有机轮廓 + 墨线，阶段 5-⑬ 统一画法）
    ctx.save();
    ctx.translate(s * 0.2, 0);
    organicPath(ctx, s * 0.72, s * 0.30, 23, { low: 0.05, high: 0.015 });
    ctx.fillStyle = '#9a8f74';
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,56,32,0.5)';
    ctx.lineWidth = Math.max(0.8, s * 0.028);
    ctx.stroke();
    ctx.restore();
    // 壳（螺旋：有机外缘 + 径向渐变 + 墨线）
    const wobble = Math.sin(this.phase * 2) * 0.06;
    ctx.save();
    ctx.translate(0, -s * 0.3);
    organicPath(ctx, s * 0.52, s * 0.48 * (1 + wobble), 31 + (Math.round(this.shellHue) % 16), {
      low: 0.035, high: 0.012,
    });
    const g = ctx.createRadialGradient(-s * 0.15, -s * 0.12, s * 0.1, 0, 0, s * 0.62);
    g.addColorStop(0, `hsl(${this.shellHue}, 32%, 64%)`);
    g.addColorStop(1, `hsl(${this.shellHue}, 38%, 38%)`);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = 'rgba(70,56,32,0.6)';
    ctx.lineWidth = Math.max(0.9, s * 0.034);
    ctx.stroke();
    // 螺纹
    ctx.strokeStyle = 'rgba(60,45,25,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.32, s * 0.28, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // 触角
    ctx.strokeStyle = '#8a7f66';
    ctx.lineWidth = Math.max(0.8, s * 0.045);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s * 0.6, -s * 0.1);
    ctx.quadraticCurveTo(s * 0.8, -s * 0.3, s * 0.95, -s * 0.42);
    ctx.moveTo(s * 0.62, -s * 0.02);
    ctx.quadraticCurveTo(s * 0.84, -s * 0.1, s * 1.0, -s * 0.2);
    ctx.stroke();
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════
//  小 虾（水中弹射游动，捡食沉底食物）
// ══════════════════════════════════════════════════════════
export class Shrimp {
  constructor(world) {
    this.world = world;
    this.size = rand(4, 6.5);
    this.x = rand(world.w * 0.1, world.w * 0.9);
    this.y = rand(world.waterTop + 40, world.waterBottom - 20);
    this.vx = rand(-8, 8);
    this.vy = rand(-4, 4);
    this.angle = rand(0, Math.PI * 2);
    this.burstTimer = rand(1, 4);       // 弹射冷却
    this.phase = rand(0, Math.PI * 2);
    this.target = null;
  }

  update(dt, sunkFoods) {
    this.phase += dt;
    const W = this.world;

    // 找沉底食物（接近泥沼线的颗粒）
    if (!this.target || this.target.eaten) {
      this.target = null;
      let bestD = 150 * 150;
      for (const f of sunkFoods) {
        if (f.eaten) continue;
        const d2 = dist2(this.x, this.y, f.x, f.y);
        if (d2 < bestD) { bestD = d2; this.target = f; }
      }
    }

    if (this.target) {
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 5) {
        this.vx = (dx / d) * CONFIG.scavengers.shrimpBurst * 0.5;
        this.vy = (dy / d) * CONFIG.scavengers.shrimpBurst * 0.5;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
      } else {
        this.target.eat();          // 吃掉
        this.target = null;
        // 吃完小弹跳后退
        this.vx = rand(-30, 30);
        this.vy = rand(-20, 10);
      }
    } else {
      // 随机弹射
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = rand(1.2, 4);
        const a = rand(0, Math.PI * 2);
        this.vx = Math.cos(a) * CONFIG.scavengers.shrimpBurst;
        this.vy = Math.sin(a) * CONFIG.scavengers.shrimpBurst * 0.4;
      }
      this.vx *= 0.94;
      this.vy *= 0.94;
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    if (Math.hypot(this.vx, this.vy) > 6) {
      const t = Math.atan2(this.vy, this.vx);
      let dd = t - this.angle;
      while (dd > Math.PI) dd -= Math.PI * 2;
      while (dd < -Math.PI) dd += Math.PI * 2;
      this.angle += dd * Math.min(1, dt * 6);
    }

    // 约束在水中
    const c = W.constrainToWater(this.x, this.y, 10);
    this.x = c.x;
    this.y = c.y;
  }

  draw(ctx) {
    const s = this.size;
    ctx.save();
    ctx.translate(this.x, this.y);
    // 虾身体朝向按速度；静止时朝右
    const facing = this.vx >= 0 ? 1 : -1;
    ctx.scale(facing, 1);
    ctx.rotate(facing * this.angle * 0.15);

    // 弯月形身体（分节）
    ctx.fillStyle = 'rgba(240,170,140,0.92)';
    ctx.beginPath();
    ctx.moveTo(-s * 0.9, 0);
    ctx.quadraticCurveTo(0, -s * 0.75, s * 0.95, -s * 0.1);
    ctx.quadraticCurveTo(0, -s * 0.28, -s * 0.9, 0);
    ctx.closePath();
    ctx.fill();
    // 分节线
    ctx.strokeStyle = 'rgba(190,110,85,0.55)';
    ctx.lineWidth = 0.8;
    for (let i = -2; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.34, -s * 0.52 + Math.abs(i) * 0.1);
      ctx.lineTo(i * s * 0.34, -s * 0.1);
      ctx.stroke();
    }
    // 触须
    ctx.strokeStyle = 'rgba(240,170,140,0.75)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(s * 0.85, -s * 0.12);
    ctx.lineTo(s * 1.5, -s * 0.42);
    ctx.moveTo(s * 0.85, -s * 0.1);
    ctx.lineTo(s * 1.55, -s * 0.12);
    ctx.stroke();
    // 小眼睛
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(s * 0.72, -s * 0.3, Math.max(0.8, s * 0.09), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ══════════════════════════════════════════════════════════
//  分解者群落管理
// ══════════════════════════════════════════════════════════
export class ScavengerField {
  constructor(world) {
    this.world = world;
    this.snails = [];
    this.shrimps = [];
    for (let i = 0; i < (CONFIG.scavengers.snails ?? 6); i++) {
      this.snails.push(new Snail(world, i % 3 === 0 ? 'bank' : 'bottom'));
    }
    for (let i = 0; i < (CONFIG.scavengers.shrimps ?? 8); i++) {
      this.shrimps.push(new Shrimp(world));
    }
  }

  /**
   * @param {Remains[]} remains 遗骸列表
   * @param {Food[]} foods 全部食物（虾只挑沉底的）
   * @param {object} worldRef 泥沼线判断用
   */
  update(dt, remains, foods) {
    const W = this.world;
    const sunk = foods.filter((f) => !f.eaten && f.y > W.marshLineAt(f.x) - 26);
    for (const s of this.snails) s.update(dt, remains);
    for (const s of this.shrimps) s.update(dt, sunk);
    for (const r of remains) r.update(dt);
  }

  draw(ctx, time, layer = 'bottom') {
    // layer 'bottom'：遗骸+螺蛳（水下层）；layer 'top'：虾（水中层）
    if (layer === 'bottom') {
      for (const s of this.snails) s.draw(ctx, time);
    } else {
      for (const s of this.shrimps) s.draw(ctx);
    }
  }

  population() {
    return { snails: this.snails.length, shrimps: this.shrimps.length };
  }
}
