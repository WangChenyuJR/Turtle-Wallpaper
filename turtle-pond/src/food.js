/**
 * 食物（饲料颗粒）—— 阶段 6-⑧ 改为**浮面饲料**
 *
 * 喂食时粮不下沉：颗粒落在水面上慢慢漂，等着鱼和龟游上来吃。
 * 落在岸上的饲料则停在岸上（陆龟/半水龟会上岸捡）。
 * 想回到旧行为：CONFIG.food.float = false。
 */

import { CONFIG } from './config.js';
import { rand, clamp } from './utils.js';

/** 浮在水面上时的 y 偏移（略低于水线，看起来"半浮"着） */
const FLOAT_OFFSET = 4;

export class Food {
  constructor(x, y, opts = {}) {
    this.x = x + rand(-6, 6);
    this.y = y;
    this.r = rand(2.2, 3.6);
    this.vy = 0;
    this.vx = rand(-4, 4);
    this.maxVy = CONFIG.food.sinkSpeed * rand(0.7, 1.2);
    this.life = CONFIG.food.lifetime;
    this.eaten = false;
    this.phase = rand(0, Math.PI * 2);
    this.splash = opts.splash === false ? 0 : 1;   // 入水溅射动画
    this.rot = rand(0, Math.PI * 2);
    this.spin = rand(-1.6, 1.6);
    // 浮面时的小幅摆动
    this.driftPhase = rand(0, Math.PI * 2);
    this.driftSpeed = CONFIG.food.driftSpeed ?? 8;
    // 不规则颗粒轮廓（归一化，采一次固定不变）
    this.shape = [];
    const n = 6 + Math.round(rand(0, 2));
    for (let i = 0; i < n; i++) {
      this.shape.push(rand(0.78, 1.18));
    }
  }

  eat() {
    this.eaten = true;
  }

  update(dt, world) {
    if (this.eaten) return;

    this.life -= dt;
    if (this.life <= 0) { this.eaten = true; return; }
    this.phase += dt * 2;
    this.rot += this.spin * dt * 0.5;
    if (this.splash > 0) this.splash = Math.max(0, this.splash - dt * 2.5);

    const floating = CONFIG.food?.float !== false;
    // 8-⑬ 剖面水体：飘不飘在水面看 y 相对水线，不看视觉水列 ——
    // 岸坡土前（剖面水体）撒的饲料也浮在水面上，不会被当成"掉岸上"吸上岸坡
    const onWater = !world || this.y > world.surfaceAt(this.x) - 2;

    if (floating) {
      if (onWater) {
        // ── 浮在水面：随水漂 + 轻微摆动 ──────────────
        this.driftPhase += dt * 0.8;
        this.vx += Math.sin(this.driftPhase) * 6 * dt;
        this.vx *= 0.985;
        this.vx = clamp(this.vx, -this.driftSpeed, this.driftSpeed);
        this.x += this.vx * dt;
        // 别漂出水面
        if (!world.isWaterColumn(this.x)) {
          const bx = world.nearWaterX(this.x);
          this.x = bx - (bx - this.x) * 0.5;
          this.vx *= -0.4;
        }
        const sy = world.surfaceAt(this.x) + FLOAT_OFFSET;
        this.y += (sy - this.y) * Math.min(1, dt * 6);
        this.vy = 0;
      } else {
        // ── 掉在岸上：停在干地上 ────────────────────
        const gy = world.groundYAt(this.x) - this.r * 0.6;
        this.y += (gy - this.y) * Math.min(1, dt * 6);
        this.vx *= 0.9;
        this.x += this.vx * dt;
        this.vy = 0;
      }
      return;
    }

    // ── 旧行为：缓慢下沉，到底部泥沼就停住 ────────────
    const bottom = world.marshLineAt(this.x) - 6;
    if (this.y < bottom) {
      this.vy = Math.min(this.vy + 26 * dt, this.maxVy);
      this.y += this.vy * dt;
    } else {
      this.y = bottom;
      this.vy = 0;
      this.life -= dt * 0.5;
    }
    this.x += Math.sin(this.phase + this.y * 0.05) * 6 * dt;
  }

  draw(ctx, world) {
    if (this.eaten) return;
    const onWater = !world || world.isWaterColumn(this.x);

    // 入水溅射圈
    if (this.splash > 0 && onWater) {
      const k = 1 - this.splash;
      ctx.save();
      ctx.globalAlpha = this.splash * 0.55;
      ctx.strokeStyle = '#d6f0f8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, k * 15 + 3, (k * 15 + 3) * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = this.splash * 0.32;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, k * 8 + 1.5, (k * 8 + 1.5) * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 下沉拖尾（仅旧的下沉模式）
    if (!CONFIG.food?.float && this.vy > 6) {
      const tailLen = Math.min(this.vy * 0.9, 12);
      const tg = ctx.createLinearGradient(0, this.y - tailLen, 0, this.y);
      tg.addColorStop(0, 'rgba(232,196,106,0)');
      tg.addColorStop(1, 'rgba(232,196,106,0.22)');
      ctx.save();
      ctx.fillStyle = tg;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y - tailLen * 0.5, this.r * 0.5, tailLen * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const dying = this.life < 4;
    const alpha = dying ? (0.35 + 0.65 * Math.abs(Math.sin(this.life * 8))) : 1;
    const jx = dying ? Math.sin(this.life * 30) * 0.6 : 0;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 柔和投影
    const shG = ctx.createRadialGradient(this.x + 0.6, this.y + 1.6, 0.4, this.x + 0.6, this.y + 1.6, this.r * 1.5);
    shG.addColorStop(0, 'rgba(0,0,0,0.26)');
    shG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shG;
    ctx.beginPath();
    ctx.ellipse(this.x + 0.6, this.y + 1.6, this.r * 1.5, this.r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // 浮在水面时，颗粒周围一圈微波（水面张力的感觉）
    if (onWater && CONFIG.food?.float !== false) {
      ctx.globalAlpha = alpha * 0.35;
      ctx.strokeStyle = '#e6f6fb';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y + 1, this.r * 1.9, this.r * 0.9, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    // 不规则颗粒本体
    ctx.translate(this.x + jx, this.y);
    ctx.rotate(this.rot);
    ctx.beginPath();
    const n = this.shape.length;
    for (let i = 0; i <= n; i++) {
      const p = this.shape[i % n];
      const a = (i / n) * Math.PI * 2;
      const px = Math.cos(a) * this.r * p;
      const py = Math.sin(a) * this.r * p;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();

    const g = ctx.createLinearGradient(-this.r, -this.r, this.r, this.r);
    g.addColorStop(0, '#f7e3a4');
    g.addColorStop(0.55, CONFIG.colors.food);
    g.addColorStop(1, '#c39a4a');
    ctx.fillStyle = g;
    ctx.fill();

    // 顶面柔光
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = '#fff4cf';
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.28, -this.r * 0.32, this.r * 0.38, this.r * 0.24, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // 溶解碎屑
    if (dying) {
      ctx.globalAlpha = alpha * 0.6;
      ctx.fillStyle = '#d8b876';
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + this.life * 4;
        const d = (4 - this.life) * 2.2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * d, Math.sin(a) * d, 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }
}

export class FoodManager {
  constructor(world) {
    this.world = world;
    this.items = [];
  }

  /**
   * 在 (x,y) 撒一把饲料。
   * · 点在水面/水面上方 → 撒在水面（浮着）
   * · 点在岸上       → 撒在岸顶干地上（岸上的龟能捡）
   */
  feed(x, y, count = CONFIG.food.pelletsPerFeed) {
    const W = this.world;
    let fx = clamp(x, 10, W.w - 10);
    const onLand = W.isDryColumn(fx) || (!W.isWaterColumn(fx) && y < W.groundYAt(fx));
    let fy;
    if (onLand) {
      fy = W.groundYAt(fx) - 3;
    } else {
      fx = W.nearWaterX(fx);
      fy = W.surfaceAt(fx) + 4;
    }
    for (let i = 0; i < count; i++) {
      this.items.push(new Food(fx, fy - rand(0, 6)));
    }
    if (!onLand) {
      // 投喂落水：一簇同心涟漪
      W.addRipple(fx, fy, 1.3);
      W.addRipple(fx + rand(-10, 10), fy + rand(-3, 3), 0.8);
      W.addRipple(fx + rand(-14, 14), fy + rand(-4, 4), 0.55);
    }
    return { x: fx, y: fy, onLand };
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.update(dt, this.world);
      if (f.eaten) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const f of this.items) f.draw(ctx, this.world);
  }

  get aliveCount() {
    return this.items.length;
  }
}
