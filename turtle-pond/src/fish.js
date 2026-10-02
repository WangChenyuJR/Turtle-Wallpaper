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
import { drawSideFish, fishArt } from './creature-art.js';

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

    this.angle = a;          // 游动方向（物理层仍用）
    this.tailPhase = rand(0, Math.PI * 2);

    // ── 美术（阶段 5-⑬ 新画法）────────────────────────
    this.artSeed = opts.artSeed ?? ((Math.random() * 0xffffffff) >>> 0);  // 个体外观种子（存档持久化）
    this.facing = Math.cos(a) >= 0 ? 1 : -1;   // 朝向：1 右 / -1 左
    this.pitch = 0;                            // 俯仰角（rad，随垂直速度轻微摆动）
    this.hunger = opts.baby ? 0.5 : rand(0.1, 0.5);
    this.dead = false;
    // 繁殖
    this.reproCooldown = opts.baby ? G.fishReproCooldown : rand(0, G.fishReproCooldown);

    // ── 生命周期（阶段 5-⑥）──────────────────────────
    this.kind = 'fish';
    this.generation = opts.generation ?? 1;      // 世代：初始种群=1，后代+1
    this.birth = opts.birth ?? 0;                // 出生时刻（水塘内秒）
    const maxAge = CONFIG.life?.fishMaxAge ?? [7200, 10800];
    this.maxAge = rand(maxAge[0], maxAge[1]);
    this.eaten = 0;                              // 吃食计数（档案统计）
    this.offspring = 0;                          // 繁殖后代数（主循环回填）
    // 死亡流程：dying（翻肚漂浮渐隐）→ dead（等待主循环收殓入档）
    this.dying = false;
    this.dyingTimer = 0;
    this.deathCause = null;
    this.starveTimer = 0;
  }

  /** 依当前体型换算速度（成长时体型变化需重算） */
  _applySpeed() {
    this.maxSpeed = CONFIG.fish.maxSpeed
      * (1.25 - (this.size / CONFIG.fish.maxSize) * 0.5)
      * (this.species.speedScale ?? 1);
    // 幼鱼更灵活（小而快，逃生加成）
    if (!this.isAdult) this.maxSpeed *= CONFIG.growth.fryEscapeSpeed ?? 1;
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
    // 寿终正寝（阶段 5-⑥）
    if (!this.dying && this.age >= this.maxAge) this.startDeath('old');
    if (this.dying) return;
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
      if (o === this || o.dead || o.dying) continue;
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
        this.eaten++;
        this.hunger = clamp(this.hunger - CONFIG.food.amountPerPellet / 100, 0, 1);
        this.size = Math.min(this.size + 0.06, CONFIG.fish.maxSize + 6);
      }
    }

    // ── 应用力 ─────────────────────────────────────────
    this.vx += ax * dt;
    this.vy += ay * dt;

    const sp = Math.hypot(this.vx, this.vy);
    // 光强影响活跃度（夜晚变慢）；幼鱼有逃生加成（含在 maxSpeed 里）
    const light = this.lightLevel ?? 1;
    const maxSp = this.maxSpeed * (0.75 + this.hunger * 0.6) * (0.6 + 0.4 * light);
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

    // ── 死亡动画优先（阶段 5-⑥）────────────────────
    if (this.dying) { this._updateDying(dt); return; }

    // 饿死计时：饥饿满格持续 fishStarveDeath 秒
    if (this.hunger >= 1) {
      this.starveTimer += dt;
      if (this.starveTimer >= (CONFIG.life?.fishStarveDeath ?? 90)) this.startDeath('starve');
    } else {
      this.starveTimer = 0;
    }

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

    // ── 朝向与俯仰（阶段 5-⑬：侧视立绘不随 angle 整体旋转）──
    if (this.vx > 2) this.facing = 1;
    else if (this.vx < -2) this.facing = -1;
    const targetPitch = clamp(this.vy / (this.maxSpeed ?? 40), -1, 1) * 0.16;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);
  }

  // ── 生命周期（阶段 5-⑥）────────────────────────────
  /** 进入死亡流程：cause = 'old' | 'starve' */
  startDeath(cause = 'old') {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.deathCause = cause;
    this.dyingTimer = CONFIG.life?.dyingDuration ?? 2.5;
  }

  /** 死亡动画：翻肚缓缓浮向水面，渐隐 */
  _updateDying(dt) {
    this.dyingTimer -= dt;
    const surface = this.world.bankLineAt(this.x) + 12;
    this.y += (surface - this.y) * Math.min(1, dt * 0.9);
    this.x += Math.sin(this.dyingTimer * 2.4) * 6 * dt;
    if (this.dyingTimer <= 0) this.dead = true;
  }

  /** 一生快照（写入生命档案） */
  profile() {
    return {
      eaten: this.eaten,
      offspring: this.offspring,
      size: Math.round(this.adultSize * 10) / 10,
    };
  }

  /** 动画帧序号（供导出脚本逐帧截图识别） */
  get animFrame() {
    return Math.round(Math.abs(this.tailPhase) * 3);
  }

  /** 皮肤：品种字段 + 个体种子 → 画法参数（缓存到实例） */
  _skin() {
    if (!this._skinP || this._skinSeed !== this.artSeed) {
      this._skinP = fishArt(this.species, this.artSeed);
      this._skinSeed = this.artSeed;
    }
    return this._skinP;
  }

  draw(ctx) {
    const P = this._skin();
    const S = this.size * (CONFIG.art?.fishScale ?? 1.5);
    const baby = !this.isAdult;

    ctx.save();
    ctx.translate(this.x, this.y);

    // 死亡渐隐（阶段 5-⑥）：停摆 + 淡出；幼苗更透亮
    if (this.dying) {
      const D = CONFIG.life?.dyingDuration ?? 2.5;
      ctx.globalAlpha = clamp(this.dyingTimer / (D * 0.45), 0, 1);
    } else if (baby) {
      ctx.globalAlpha = 0.85;
    }

    if (this.dying) {
      // 翻肚漂浮：垂直镜像（肚朝天）+ 慢摆
      ctx.scale(this.facing || 1, -1);
      ctx.rotate(Math.sin(this.tailPhase * 0.8) * 0.05);
      drawSideFish(ctx, S, this.tailPhase, P);
      // 泛白
      ctx.fillStyle = 'rgba(235,240,242,0.4)';
      ctx.beginPath();
      ctx.ellipse(0, 0, S * 0.5, S * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 侧视立绘：水平镜像 + 轻微俯仰（阶段 5-⑬）
      ctx.scale(this.facing || 1, 1);
      ctx.rotate(this.pitch ?? 0);
      drawSideFish(ctx, S, this.tailPhase, P);
    }

    ctx.restore();
  }
}
