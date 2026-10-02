/**
 * 浮萍 —— 漂在水面的小植物
 * 缓慢漂移，乌龟/鱼经过时会被推开
 */

import { CONFIG } from './config.js';
import { rand, randInt, clamp, blobShape, blobPath } from './utils.js';

export class Duckweed {
  constructor(world) {
    this.world = world;
    this.reset(true);
  }

  reset(initial = false) {
    const W = this.world;
    const s = W.waterSpans[Math.floor(Math.random() * W.waterSpans.length)] ?? { x0: 0, x1: W.w };
    this.x = rand(s.x0 + 6, Math.max(s.x0 + 7, s.x1 - 6));
    // 浮萍贴着水线漂（侧视下就是水面上的一个个小点）
    this.y = W.surfaceAt(this.x) + (initial ? rand(0, 4) : 2);
    this.r = rand(CONFIG.duckweed.minSize, CONFIG.duckweed.maxSize);
    this.vx = rand(-1, 1) * CONFIG.duckweed.driftSpeed;
    this.vy = 0;
    this.phase = rand(0, Math.PI * 2);
    this.rot = rand(0, Math.PI * 2);
    this.rotSpeed = rand(-0.15, 0.15);
    this.leafCount = randInt(2, 4);
    const shp = blobShape(Math.random, 2, 0.14, 0.32);
    this.leafAmps = shp.amps;
    this.leafPhases = shp.phases;
    this.leafAspect = rand(0.55, 0.85);
  }

  update(dt, movers) {
    const W = this.world;

    // 缓慢漂移
    this.x += this.vx * dt;
    this.rot += this.rotSpeed * dt;

    // 被生物推开
    for (const m of movers) {
      const dx = this.x - m.x, dy = this.y - m.y;
      const d2 = dx * dx + dy * dy;
      const rr = (m.size || 20) * 0.8 + this.r;
      if (d2 < rr * rr && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (rr - d) / rr * 34 * dt;
        this.x += (dx / d) * push;
        this.y += (dy / d) * push;
      }
    }

    // 别漂出水面；贴回水线
    if (!W.isWaterColumn(this.x)) {
      this.x = W.nearWaterX(this.x);
      this.vx *= -0.5;
    }
    this.x = clamp(this.x, 2, W.w - 2);
    const sy = W.surfaceAt(this.x) + 2 + Math.sin(this.phase) * 1.0;
    this.y += (sy - this.y) * Math.min(1, dt * 4);

    // 被水流轻微扰动
    this.x += Math.sin(this.phase) * 1.5 * dt;
    this.phase += dt * 0.6;
  }

  draw(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.rot);
    ctx.globalAlpha = 0.9;
    for (let i = 0; i < this.leafCount; i++) {
      const a = (i / this.leafCount) * Math.PI * 2 + this.phase * 0.2;
      const lx = Math.cos(a) * this.r * 0.55;
      const ly = Math.sin(a) * this.r * 0.55;
      ctx.fillStyle = i % 2 ? '#6fa03e' : '#7fb04a';
      blobPath(ctx, lx, ly, this.r * 0.62, this.r * 0.62 * this.leafAspect,
        this.leafAmps, this.leafPhases, a);
      ctx.fill();
    }
    // 中心小点（也不规则）
    ctx.fillStyle = '#d8ffb0';
    ctx.globalAlpha = 0.5;
    blobPath(ctx, 0, 0, this.r * 0.15, this.r * 0.12, this.leafAmps, this.leafPhases, this.rot);
    ctx.fill();
    ctx.restore();
  }
}

export class DuckweedField {
  constructor(world, count) {
    this.world = world;
    this.items = [];
    for (let i = 0; i < count; i++) this.items.push(new Duckweed(world));
  }

  update(dt, movers) {
    for (const d of this.items) d.update(dt, movers);
  }

  draw(ctx) {
    // 先画的在后面（简单的深度感）
    for (const d of this.items) d.draw(ctx);
  }
}
