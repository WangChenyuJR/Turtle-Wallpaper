/**
 * 小鱼 —— Boids 群集算法
 *
 * 三条基本规则（文档 2.2 参考 boids-in-the-blue）：
 *   分离 Separation  —— 别挤在一起
 *   对齐 Alignment   —— 跟邻居同向
 *   凝聚 Cohesion    —— 往邻居中心靠
 * 额外行为：
 *   避墙、避光标、追食物、饥饿
 */

import { CONFIG } from './config.js';
import { rand, randInt, limit, clamp } from './utils.js';
import { pickFishSpecies, FISH_SPECIES } from './species.js';
import { dist2 } from './utils.js';

export class Fish {
  /**
   * @param {World} world
   * @param {object} [species] 指定品种；不传则按权重随机
   * @param {object} [opts] { baby: boolean } 幼苗模式（繁殖用）
   */
  constructor(world, species = null, opts = {}) {
    this.world = world;
    this.species = species ?? pickFishSpecies();

    // ── 成长系统（阶段 5-③）──────────────────────────
    const G = CONFIG.growth;
    const base = randInt(CONFIG.fish.minSize, CONFIG.fish.maxSize);
    this.adultSize = base * (this.species.sizeScale ?? 1);
    this.age = opts.baby ? 0 : G.fishMaturityAge * rand(1.0, 2.2);  // 初始种群全是成年
    this.size = opts.baby
      ? this.adultSize * G.babySizeRatio
      : this.adultSize;
    this._applySpeed();

    // 位置与速度
    const w = world.w, h = world.h;
    this.x = rand(w * 0.1, w * 0.9);
    this.y = rand(world.waterTop + 30, world.waterBottom - 30);
    const a = rand(0, Math.PI * 2);
    this.vx = Math.cos(a) * this.maxSpeed * 0.5;
    this.vy = Math.sin(a) * this.maxSpeed * 0.5;

    this.angle = a;          // 朝向（用于绘制）
    this.tailPhase = rand(0, Math.PI * 2);
    this.hunger = opts.baby ? 0.5 : rand(0.1, 0.5);
    this.dead = false;
    // 繁殖
    this.reproCooldown = opts.baby ? G.fishReproCooldown : rand(0, G.fishReproCooldown);
  }

  /** 依当前体型换算速度（成长时体型变化需重算） */
  _applySpeed() {
    this.maxSpeed = CONFIG.fish.maxSpeed
      * (1.25 - (this.size / CONFIG.fish.maxSize) * 0.5)
      * (this.species.speedScale ?? 1);
  }

  /** 是否成年 */
  get isAdult() {
    return this.age >= CONFIG.growth.fishMaturityAge;
  }

  /** 每帧成长：年龄推进、体型向成年尺寸靠拢 */
  _grow(dt) {
    const G = CONFIG.growth;
    this.age += dt;
    this.reproCooldown = Math.max(0, this.reproCooldown - dt);
    if (!this.isAdult) {
      const t = Math.min(1, this.age / G.fishMaturityAge);
      // 幼年→成年平滑过渡
      this.size = this.adultSize * (G.babySizeRatio + (1 - G.babySizeRatio) * t);
      this._applySpeed();
    }
  }

  /** 计算所有行为力的合力 */
  flock(fishes, cursor, foods, dt, plants = null) {
    const F = CONFIG.fish;
    let ax = 0, ay = 0;

    // 是否处于植物遮蔽区（在遮蔽区里更放松：少躲避、游得慢）
    const sheltered = plants ? plants.isSheltered(this.x, this.y) : false;
    this.sheltered = sheltered;

    // ── Boids 三力 ─────────────────────────────────────
    let sepX = 0, sepY = 0, sepN = 0;
    let aliX = 0, aliY = 0, aliN = 0;
    let cohX = 0, cohY = 0, cohN = 0;

    const perc2 = F.perception * F.perception;
    const sep2 = F.separation * F.separation;

    for (const o of fishes) {
      if (o === this || o.dead) continue;
      const d2 = dist2(this.x, this.y, o.x, o.y);
      if (d2 > perc2 || d2 === 0) continue;

      // 分离
      if (d2 < sep2) {
        sepX -= (o.x - this.x) / d2;
        sepY -= (o.y - this.y) / d2;
        sepN++;
      }
      // 对齐
      aliX += o.vx; aliY += o.vy; aliN++;
      // 凝聚
      cohX += o.x; cohY += o.y; cohN++;
    }

    if (sepN > 0) {
      const s = limit(sepX / sepN, sepY / sepN, F.maxForce * 1.6);
      ax += s.x; ay += s.y;
    }
    if (aliN > 0) {
      const s = limit(aliX / aliN - this.vx, aliY / aliN - this.vy, F.maxForce * 0.7);
      ax += s.x; ay += s.y;
    }
    if (cohN > 0) {
      const tx = cohX / cohN - this.x, ty = cohY / cohN - this.y;
      const s = limit(tx, ty, F.maxForce * 0.6);
      ax += s.x * 0.5; ay += s.y * 0.5;
    }

    // ── 避墙 ───────────────────────────────────────────
    const W = this.world;
    const m = 42;
    const top = W.bankLineAt(this.x);
    const bot = W.marshLineAt(this.x);
    if (this.x < m) ax += F.maxForce * 1.2;
    if (this.x > W.w - m) ax -= F.maxForce * 1.2;
    if (this.y < top + m) ay += F.maxForce * 1.4;
    if (this.y > bot - m) ay -= F.maxForce * 1.4;

    // ── 避光标 ─────────────────────────────────────────
    if (cursor.active) {
      const d2c = dist2(this.x, this.y, cursor.x, cursor.y);
      const r = F.cursorAvoid;
      if (d2c < r * r && d2c > 1) {
        const d = Math.sqrt(d2c);
        // 在植物遮蔽中更放松（躲避力度削弱）
        const calm = sheltered ? (CONFIG.plants?.shelterCalm ?? 0.4) : 1;
        const f = (1 - d / r) * F.cursorAvoidForce * calm;
        ax += ((this.x - cursor.x) / d) * f;
        ay += ((this.y - cursor.y) / d) * f;
      }
    }

    // ── 追食物 ─────────────────────────────────────────
    let target = null, bestD = Infinity;
    for (const fd of foods) {
      if (fd.eaten) continue;
      // 食物在水面或泥沼也可被鱼感知（鱼不上岸）
      if (!W.isWater(fd.x, fd.y)) continue;
      const d2f = dist2(this.x, this.y, fd.x, fd.y);
      const range = this.hunger > 0.35 ? 150 : 110;
      if (d2f < range * range && d2f < bestD) {
        bestD = d2f; target = fd;
      }
    }
    if (target) {
      const d = Math.sqrt(bestD) || 1;
      const urgency = 0.8 + this.hunger * 1.4;
      const f = F.maxForce * urgency;
      ax += ((target.x - this.x) / d) * f;
      ay += ((target.y - this.y) / d) * f;

      // 够近就吃掉
      if (d < F.eatRadius + this.size * 0.3) {
        target.eat();
        this.hunger = clamp(this.hunger - CONFIG.food.amountPerPellet / 100, 0, 1);
        this.size = Math.min(this.size + 0.06, CONFIG.fish.maxSize + 6);
      }
    }

    // ── 应用力 ─────────────────────────────────────────
    this.vx += ax * dt;
    this.vy += ay * dt;

    const sp = Math.hypot(this.vx, this.vy);
    const maxSp = this.maxSpeed * (0.75 + this.hunger * 0.6);
    if (sp > maxSp) {
      this.vx = (this.vx / sp) * maxSp;
      this.vy = (this.vy / sp) * maxSp;
    } else if (sp < this.maxSpeed * 0.25) {
      // 防止停住
      const a2 = Math.atan2(this.vy, this.vx);
      this.vx += Math.cos(a2) * this.maxSpeed * 0.2 * dt * 10;
      this.vy += Math.sin(a2) * this.maxSpeed * 0.2 * dt * 10;
    }

    this.hunger = clamp(this.hunger + F.hungerDecay * dt, 0, 1);
    this.tailPhase += dt * (3 + sp * 0.09);
  }

  update(dt) {
    // 成长（年龄/体型/繁殖冷却）
    this._grow(dt);

    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // 硬约束到水面
    const c = this.world.constrainToWater(this.x, this.y, 10);
    if (c.x !== this.x) this.vx *= -0.5;
    if (c.y !== this.y) this.vy *= -0.5;
    this.x = c.x;
    this.y = c.y;

    // 朝向平滑跟随速度方向
    if (Math.hypot(this.vx, this.vy) > 1) {
      const target = Math.atan2(this.vy, this.vx);
      let d = target - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * Math.min(1, dt * 8);
    }
  }

  /** 动画帧序号（供导出脚本逐帧截图识别） */
  get animFrame() {
    return Math.round(Math.abs(this.tailPhase) * 3);
  }

  draw(ctx) {
    const L = this.size * 1.6;
    const W = this.size * 0.62;
    const sp = this.species;
    const baby = !this.isAdult;

    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // 幼苗更透亮
    if (baby) ctx.globalAlpha = 0.85;

    const wig = Math.sin(this.tailPhase) * 0.5;
    const tailLen = sp.fancyTail ? 1.35 : 0.95;

    // 尾鳍
    ctx.fillStyle = sp.fin;
    ctx.globalAlpha = sp.fancyTail ? 0.85 : 1;
    ctx.beginPath();
    ctx.moveTo(-L * 0.5, 0);
    ctx.lineTo(-L * tailLen, -W * (sp.fancyTail ? 1.1 : 0.75) + wig * W);
    ctx.lineTo(-L * 0.85, 0);
    ctx.lineTo(-L * tailLen, W * (sp.fancyTail ? 1.1 : 0.75) + wig * W);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // 身体
    ctx.fillStyle = sp.body;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.5, W * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // 腹部浅色高光
    if (sp.belly) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = sp.belly;
      ctx.beginPath();
      ctx.ellipse(L * 0.05, W * 0.16, L * 0.34, W * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 条纹
    if (sp.stripes > 0) {
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < sp.stripes; i++) {
        const px = -L * 0.15 + i * L * 0.25;
        ctx.beginPath();
        ctx.moveTo(px, -W * 0.42);
        ctx.lineTo(px - L * 0.08, W * 0.42);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 背鳍
    ctx.fillStyle = sp.fin;
    ctx.beginPath();
    ctx.moveTo(-L * 0.08, -W * 0.42);
    ctx.lineTo(L * 0.08, -W * 0.42);
    ctx.lineTo(-L * 0.01, -W * 0.85);
    ctx.closePath();
    ctx.fill();

    // 眼睛（幼苗眼睛相对更大，更显可爱）
    const eyeScale = baby ? 1.6 : 1.0;
    ctx.fillStyle = '#0d0d0d';
    ctx.beginPath();
    ctx.arc(L * 0.3, -W * 0.12, Math.max(1.2, W * 0.14) * eyeScale, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(L * 0.33, -W * 0.16, Math.max(0.5, W * 0.06) * eyeScale, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
