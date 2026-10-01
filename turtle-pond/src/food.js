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

    // 轻微摆动
    this.x += Math.sin(this.phase + this.y * 0.05) * 6 * dt;
    this.phase += dt * 2;
    if (this.splash > 0) this.splash = Math.max(0, this.splash - dt * 2.5);
  }

  draw(ctx) {
    if (this.eaten) return;

    // 入水溅射圈
    if (this.splash > 0) {
      ctx.save();
      ctx.globalAlpha = this.splash * 0.5;
      ctx.strokeStyle = '#d6f0f8';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, (1 - this.splash) * 16 + 3, ((1 - this.splash) * 16 + 3) * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 快消失时闪烁
    const alpha = this.life < 4 ? (0.35 + 0.65 * Math.abs(Math.sin(this.life * 8))) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    // 阴影
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.arc(this.x + 0.8, this.y + 1.2, this.r, 0, Math.PI * 2);
    ctx.fill();
    // 颗粒
    const g = ctx.createRadialGradient(this.x - this.r * 0.3, this.y - this.r * 0.3, 0.5, this.x, this.y, this.r);
    g.addColorStop(0, '#f5dc95');
    g.addColorStop(1, CONFIG.colors.food);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.r, 0, Math.PI * 2);
    ctx.fill();
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
    W.addRipple(fx, fy, 1.3);
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
