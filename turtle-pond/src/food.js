/**
 * 食物（饲料颗粒）
 * 投喂后从落点缓慢下沉，被鱼/龟吃掉或超时溶解
 * 参考 deskworlds 的 food.js 行为
 */

import { CONFIG } from './config.js';
import { rand } from './utils.js';

export class Food {
  constructor(x, y) {
    this.x = x + rand(-6, 6);
    this.y = y;
    this.r = rand(2.2, 3.6);
    this.vy = 0;
    this.maxVy = CONFIG.food.sinkSpeed * rand(0.7, 1.2);
    this.life = CONFIG.food.lifetime;
    this.eaten = false;
    this.phase = rand(0, Math.PI * 2);
    this.splash = 1;      // 入水溅射动画
    this.rot = rand(0, Math.PI * 2);   // 颗粒自转角
    this.spin = rand(-1.6, 1.6);       // 自转角速度
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

    // 缓慢下沉，到底部泥沼就停住（会被泥沼吸收）
    const bottom = world.marshLineAt(this.x) - 6;
    if (this.y < bottom) {
      this.vy = Math.min(this.vy + 26 * dt, this.maxVy);
      this.y += this.vy * dt;
    } else {
      this.y = bottom;
      this.vy = 0;
      // 停在泥底会加速溶解
      this.life -= dt * 0.5;
    }

    // 轻微摆动 + 缓慢自转（水下悬浮感）
    this.x += Math.sin(this.phase + this.y * 0.05) * 6 * dt;
    this.phase += dt * 2;
    this.rot += this.spin * dt * 0.5;
    if (this.splash > 0) this.splash = Math.max(0, this.splash - dt * 2.5);
  }

  draw(ctx) {
    if (this.eaten) return;

    // 入水溅射圈（双圈 + 中心小亮点，更像真实落水）
    if (this.splash > 0) {
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

    // 下沉拖尾（快速下落时在身后留一道淡淡的轨迹）
    if (this.vy > 6) {
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

    // 快溶解时抖动/闪烁
    const dying = this.life < 4;
    const alpha = dying ? (0.35 + 0.65 * Math.abs(Math.sin(this.life * 8))) : 1;
    const jx = dying ? Math.sin(this.life * 30) * 0.6 : 0;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 柔和投影（不再用硬阴影圆）
    const shG = ctx.createRadialGradient(this.x + 0.6, this.y + 1.6, 0.4, this.x + 0.6, this.y + 1.6, this.r * 1.5);
    shG.addColorStop(0, 'rgba(0,0,0,0.26)');
    shG.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shG;
    ctx.beginPath();
    ctx.ellipse(this.x + 0.6, this.y + 1.6, this.r * 1.5, this.r * 0.95, 0, 0, Math.PI * 2);
    ctx.fill();

    // 不规则颗粒本体（哑光质感，不透明）
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

    // 顶面柔光（哑光高光，一小片而非亮点）
    ctx.globalAlpha = alpha * 0.5;
    ctx.fillStyle = '#fff4cf';
    ctx.beginPath();
    ctx.ellipse(-this.r * 0.28, -this.r * 0.32, this.r * 0.38, this.r * 0.24, -0.4, 0, Math.PI * 2);
    ctx.fill();

    // 溶解碎屑（快消失时飘出的小颗粒）
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

  /** 在 (x,y) 撒一把饲料 */
  feed(x, y, count = CONFIG.food.pelletsPerFeed) {
    const W = this.world;
    // 投喂点必须在水中，否则落到最近的岸线内侧
    let fx = x, fy = y;
    if (!W.isWater(fx, fy)) {
      fy = W.bankLineAt(fx) + 20;
      fx = Math.min(Math.max(fx, 10), W.w - 10);
    }
    for (let i = 0; i < count; i++) {
      this.items.push(new Food(fx, fy - rand(0, 6)));
    }
    // 投喂落水：生成一簇同心涟漪，比单圈更有"撒食入水"的感觉
    W.addRipple(fx, fy, 1.3);
    W.addRipple(fx + rand(-10, 10), fy + rand(-3, 3), 0.8);
    W.addRipple(fx + rand(-14, 14), fy + rand(-4, 4), 0.55);
    return { x: fx, y: fy };
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const f = this.items[i];
      f.update(dt, this.world);
      if (f.eaten) this.items.splice(i, 1);
    }
  }

  draw(ctx) {
    for (const f of this.items) f.draw(ctx);
  }

  get aliveCount() {
    return this.items.length;
  }
}
