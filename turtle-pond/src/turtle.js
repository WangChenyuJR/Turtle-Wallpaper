/**
 * 乌龟 —— 状态机
 *
 * 状态流转（文档 5.2 乌龟行为）：
 *
 *   SWIM (水面游动) ──靠近岸边──► CLIMB_OUT (爬上岸)
 *        ▲                              │
 *        │                              ▼
 *   追食物/待机 ◄── RETURN (回水里) ◄── BASK (岸边晒太阳/爬行)
 *        │
 *        └── 有食物 ──► SEEK_FOOD (追食物)
 *
 * 乌龟可以在岸边爬行（陆地），也可以在水里游动。
 */

import { CONFIG } from './config.js';
import { rand, randInt, dist2, clamp, pick } from './utils.js';
import { pickTurtleSpecies, turtleBehavior, HABITAT_LABELS } from './species.js';
import { drawSideTurtle, turtleArt } from './creature-art.js';

const STATE = {
  SWIM: 'swim',
  SEEK_FOOD: 'seek_food',
  CLIMB_OUT: 'climb_out',
  BASK: 'bask',
  RETURN: 'return',
};

export class Turtle {
  /**
   * @param {World} world
   * @param {number} index
   * @param {object} [species] 指定品种；不传则按权重随机
   */
  constructor(world, index = 0, species = null, opts = {}) {
    this.world = world;
    this.id = index;
    const T = CONFIG.turtle;
    const G = CONFIG.growth;
    this.species = species ?? pickTurtleSpecies();

    // ── 成长系统（阶段 5-③）──────────────────────────
    this.adultSize = T.size * rand(0.85, 1.15) * (this.species.sizeScale ?? 1);
    this.age = opts.baby ? 0 : G.turtleMaturityAge * rand(1.0, 2.0);
    this.size = opts.baby ? this.adultSize * G.babySizeRatio : this.adultSize;

    // ── 栖息类型行为参数（阶段 5：陆龟/水龟分类）──────
    this.behavior = turtleBehavior(this.species);
    this.habitat = this.behavior.habitat;

    // 兼容旧的 shellColors 随机（若品种未指定颜色则使用）
    this.shellColor = this.species.shell ?? pick(T.shellColors);

    // 起始位置：陆龟更靠岸，水龟更靠水中央
    const startNearBank = this._isLandLover() ? 0.72 : 0.38;
    this.x = rand(world.w * 0.2, world.w * 0.8);
    this.y = world.waterTop
      + (world.waterBottom - world.waterTop) * rand(0.15, startNearBank);
    this.vx = rand(-10, 10);
    this.vy = rand(-5, 5);
    this.angle = rand(0, Math.PI * 2);

    // 陆龟可直接从岸上开始（增加初始画面多样性）
    if (this._isLandLover() && Math.random() < 0.5 && !opts.baby) {
      this.x = rand(world.w * 0.25, world.w * 0.75);
      this.y = rand(20, Math.max(24, world.bankLineAt(this.x) - 12));
      this.state = STATE.BASK;
    } else {
      this.state = STATE.SWIM;
    }

    this.stateTime = 0;
    this.hunger = opts.baby ? 0.55 : rand(0.2, 0.6);
    this.flipperPhase = rand(0, Math.PI * 2);
    this.headBob = rand(0, Math.PI * 2);

    // ── 美术（阶段 5-⑬ 新画法）────────────────────────
    this.artSeed = opts.artSeed ?? ((Math.random() * 0xffffffff) >>> 0);  // 个体外观种子（存档持久化）
    this.facing = 0;          // 朝向：1 右 / -1 左（update 里按实际位移推断，0 = 未定）
    this.pitch = 0;           // 俯仰角（rad，随垂直速度轻微摆动）

    // 晒太阳目标点（岸边）
    this.baskTarget = null;
    // 计时器：多久换一次行为
    this.decisionTimer = rand(3, 8);
    // 繁殖（阶段 5-③）
    this.reproCooldown = opts.baby ? G.turtleReproCooldown : rand(0, G.turtleReproCooldown * 0.5);

    // ── 生命周期（阶段 5-⑥）──────────────────────────
    this.kind = 'turtle';
    this.dead = false;
    this.generation = opts.generation ?? 1;      // 世代：初始种群=1，后代+1
    this.birth = opts.birth ?? 0;                // 出生时刻（水塘内秒）
    const maxAge = CONFIG.life?.turtleMaxAge ?? [14400, 21600];
    this.maxAge = rand(maxAge[0], maxAge[1]);
    this.eaten = 0;                              // 吃食计数（档案统计）
    this.offspring = 0;                          // 产蛋窝数（主循环回填）
    // 死亡流程：dying（水中翻肚上浮/岸上静卧渐隐）→ dead（等待收殓入档）
    this.dying = false;
    this.dyingTimer = 0;
    this.deathCause = null;
    this.starveTimer = 0;
  }

  /** 是否成年 */
  get isAdult() {
    return this.age >= CONFIG.growth.turtleMaturityAge;
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
      const t = Math.min(1, this.age / G.turtleMaturityAge);
      this.size = this.adultSize * (G.babySizeRatio + (1 - G.babySizeRatio) * t);
    }
  }

  /** 是否偏向陆生（陆龟/半水龟）—— 影响上岸倾向与起始位置 */
  _isLandLover() {
    return this.habitat === 'terrestrial' || this.habitat === 'semi';
  }

  /** 选择一个岸上目标 */
  _pickBaskTarget() {
    const W = this.world;
    const x = clamp(this.x + rand(-W.w * 0.3, W.w * 0.3), 40, W.w - 40);
    const y = rand(20, Math.max(24, W.bankLineAt(x) - 14));
    this.baskTarget = { x, y };
  }

  /** 找最近的食物 */
  _nearestFood(foods) {
    let best = null, bestD = Infinity;
    for (const f of foods) {
      if (f.eaten) continue;
      const d = dist2(this.x, this.y, f.x, f.y);
      if (d < bestD) { bestD = d; best = f; }
    }
    return best ? { food: best, d: Math.sqrt(bestD) } : null;
  }

  update(dt, foods, cursor, turtles, env = { light: 1, isNight: false }) {
    const T = CONFIG.turtle;
    const px0 = this.x;          // 记录本帧起点 → 推断朝向（阶段 5-⑬）
    // 成长（年龄/体型/繁殖冷却）
    this._grow(dt);
    // ── 死亡动画优先（阶段 5-⑥）────────────────────
    if (this.dying) { this._updateDying(dt); return; }
    this.stateTime += dt;
    this.decisionTimer -= dt;
    this.hunger = clamp(this.hunger + T.hungerDecay * dt, 0, 1);

    // 饿死计时：饥饿满格持续 turtleStarveDeath 秒
    if (this.hunger >= 1) {
      this.starveTimer += dt;
      if (this.starveTimer >= (CONFIG.life?.turtleStarveDeath ?? 240)) this.startDeath('starve');
    } else {
      this.starveTimer = 0;
    }

    const W = this.world;
    const inWater = W.isWater(this.x, this.y);   // 本帧「移动前」是否在水里（仅用于泳姿判断）
    const target = this._nearestFood(foods);

    // ── 状态决策 ───────────────────────────────────────
    switch (this.state) {
      case STATE.SWIM: {
        // 饿了且附近有食物 → 追
        if (target && target.d < 260 && this.hunger > 0.3) {
          this.state = STATE.SEEK_FOOD;
          this.stateTime = 0;
        } else if (this.decisionTimer <= 0 && (inWater || this._isLandLover())) {
          // 按 habitat 决定"是否上岸"（陆龟几乎必上，水龟几乎不上；夜晚/雨天不晒背）
          const nightFactor = env.isNight ? 0 : (env.rain ? 0.15 : 1);
          if (Math.random() < this.behavior.baskingChance * nightFactor) {
            this._pickBaskTarget();
            this.state = STATE.CLIMB_OUT;
          }
          // 爱待水的龟决策更频繁但停留更久（等效更长时间泡水）
          this.decisionTimer = rand(4, 10) * this.behavior.waterBias;
        }
        if (inWater) this._swim(dt);
        break;
      }

      case STATE.SEEK_FOOD: {
        if (!target || target.d > 340) {
          this.state = STATE.SWIM;
          break;
        }
        // 食物可能在岸边 → 需要爬上去（水龟不太饿就不费劲）
        if (W.isBank(target.food.x, target.food.y)) {
          if (this.habitat === 'aquatic' && this.hunger < 0.75) {
            this.state = STATE.SWIM;
            break;
          }
          this.state = STATE.CLIMB_OUT;
          this.baskTarget = { x: target.food.x, y: target.food.y };
          break;
        }
        this._moveToward(target.food.x, target.food.y, dt, T.swimSpeed * 1.3);
        if (target.d < T.eatRadius) {
          target.food.eat();
          this.eaten++;
          this.hunger = clamp(this.hunger - CONFIG.food.amountPerPellet / 100, 0, 1);
          this.state = STATE.SWIM;
        }
        break;
      }

      case STATE.CLIMB_OUT: {
        if (!this.baskTarget) { this.state = STATE.SWIM; break; }
        const d = Math.hypot(this.baskTarget.x - this.x, this.baskTarget.y - this.y);
        if (d < 8) {
          this.state = STATE.BASK;
          this.stateTime = 0;
          // 记录本次打算晒多久（按品种）
          const [lo, hi] = this.behavior.baskDuration;
          this._baskGoal = rand(lo, hi);
          break;
        }
        // 水陆过渡：靠近岸线时减速
        this._moveToward(this.baskTarget.x, this.baskTarget.y, dt, T.swimSpeed);
        // 路过的食物顺手吃掉
        if (target && target.d < T.eatRadius + 4) {
          target.food.eat();
          this.eaten++;
          this.hunger = clamp(this.hunger - CONFIG.food.amountPerPellet / 100, 0, 1);
        }
        break;
      }

      case STATE.BASK: {
        // 岸上缓慢爬行 + 晒太阳（时长按品种；夜晚缩短晒背提前回水）
        const goal = this._baskGoal ?? rand(6, 14);
        if (this.stateTime > (env.isNight ? goal * 0.3 : goal)) {
          this.state = STATE.RETURN;
          this.stateTime = 0;
          // 这次回水是"只换个岸边位置"还是"真的下水泡一会"——进 RETURN 时掷一次骰子。
          // （陆龟基本不下水，但少数时候会去浅水里泡一泡）
          this._landOnlyReturn = this.habitat === 'terrestrial' && Math.random() < 0.7;
        } else {
          // 小范围爬动（陆龟爬得快些）
          const spd = T.crawlSpeed * this.behavior.landSpeedScale;
          this.x += Math.cos(this.angle) * spd * 0.35 * dt;
          // 陆龟在岸上纵向游走，半水龟贴岸线
          if (this.habitat === 'terrestrial') {
            this.y += Math.sin(this.angle) * spd * 0.2 * dt;
          }
          const bLine = W.bankLineAt(this.x);
          this.y = clamp(this.y, 14, Math.max(16, bLine - 6));
          if (Math.random() < dt * 0.3) this.angle += rand(-1, 1);
        }
        // 岸边有食物就爬过去
        if (target && target.d < 200 && this.hunger > 0.25) {
          this.state = STATE.SEEK_FOOD;
          break;
        }
        // ── 产蛋判定（阶段 5-③）：成年 + 饱食 + 冷却结束 + 概率 ──
        // 由主循环通过 onLayEggs 回调接收（turtle.js 不持有 eggs 数组）
        if (this.isAdult
            && this.hunger < CONFIG.growth.reproHungerMax
            && this.reproCooldown <= 0
            && this.onLayEggs
            && Math.random() < CONFIG.growth.turtleEggChance * dt * 10) {
          if (this.onLayEggs(this)) {
            // 产蛋成功 → 饥饿上升 + 重置冷却
            this.hunger = clamp(this.hunger + 0.3, 0, 1);
            this.reproCooldown = CONFIG.growth.turtleReproCooldown;
          }
        }
        break;
      }

      case STATE.RETURN: {
        // 陆龟"回水"多数只是换个岸边位置继续待着（这次是否下水在进 RETURN 时已掷过骰子）
        if (this.habitat === 'terrestrial' && this._landOnlyReturn) {
          this._pickBaskTarget();
          this.state = STATE.CLIMB_OUT;
          break;
        }
        const tx = clamp(this.x + Math.cos(this.angle) * 40, 20, W.w - 20);
        // 目标点压在水面以下（水位很浅的窗口也不会指到岸上）
        const ty = Math.max(W.bankLineAt(tx) + 40, W.marshLineAt(tx) - 60);
        this._moveToward(tx, ty, dt, T.swimSpeed);
        // ⚠ 用"移动后"的实时位置判定：
        //   inWater 是本帧开头（移动前）算的，在岸上时恒为 false，
        //   旧写法 inWater && y > 岸线+30 会在岸上永久不成立 → 龟锁死在 RETURN 状态。
        if (W.isWater(this.x, this.y)
            && this.y > W.bankLineAt(this.x) + this.size * 0.4 + 2) {
          this.state = STATE.SWIM;
          this.stateTime = 0;
          this.decisionTimer = rand(4, 10) * this.behavior.waterBias;
          // 入水后顺势向前游一段，别贴着岸线原地打转
          this.vx = Math.cos(this.angle) * rand(4, 12);
          this.vy = rand(3, 10);
        }
        break;
      }
    }

    // ── 避让其它乌龟 ───────────────────────────────────
    for (const o of turtles) {
      if (o === this) continue;
      const d2 = dist2(this.x, this.y, o.x, o.y);
      const min = this.size * 1.1;
      if (d2 < min * min && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const push = (min - d) / min * 26;
        this.x += ((this.x - o.x) / d) * push;
        this.y += ((this.y - o.y) / d) * push;
      }
    }

    // ── 光标反应：轻微好奇靠近（陆龟在岸上也会被光标吸引）──
    if (cursor.active && (this.state === STATE.SWIM || this.state === STATE.BASK)) {
      const d2c = dist2(this.x, this.y, cursor.x, cursor.y);
      const r = 120;
      if (d2c < r * r && d2c > 400) {
        const d = Math.sqrt(d2c);
        const f = (1 - d / r) * (this.state === STATE.BASK ? 7 : 12);
        this.x += ((cursor.x - this.x) / d) * f * dt;
        this.y += ((cursor.y - this.y) / d) * f * dt;
      }
    }

    // ── 边界硬约束 ─────────────────────────────────────
    // 关键：不能拿本帧开头的 inWater 判断"现在在水里"——它是移动前的值。
    // 旧写法在水域外（岸上）把 y 按到 岸线+2，而「入水」的判定线是 岸线+6：
    // 60fps 下每帧只挪 0.37px，永远跨不过那 4px，于是上过岸的龟再也下不了水。
    // 现在按状态区分约束方式：
    //   · swim / seek_food          → 真在水里活动，硬约束进水域
    //   · climb_out / bask / return → 正在跨越水陆边界，只做池塘兜底，不挡路
    const waterState = this.state === STATE.SWIM || this.state === STATE.SEEK_FOOD;
    if (waterState) {
      const c = W.constrainToWater(this.x, this.y, this.size * 0.4);
      this.x = c.x; this.y = c.y;
    } else {
      this.x = clamp(this.x, this.size, W.w - this.size);
      // 晒背时不许被挤推/光标拽下水；上岸与回水途中可自由穿越岸线
      const hi = this.state === STATE.BASK
        ? Math.max(16, W.bankLineAt(this.x) - 6)
        : Math.max(12, W.marshLineAt(this.x) - 8);
      this.y = clamp(this.y, 10, hi);
    }

    // 水龟不该被卡在岸边：若在水域外的岸上且不是主动上岸状态，拉回水里
    if (this.habitat === 'aquatic'
        && this.state !== STATE.CLIMB_OUT
        && this.state !== STATE.BASK
        && W.isBank(this.x, this.y)) {
      this.y = W.bankLineAt(this.x) + this.size * 0.6 + 8;
      this.state = STATE.SWIM;
    }

    // ── 朝向与俯仰（阶段 5-⑬：侧视立绘不随 angle 整体旋转）──
    // 位移推断左右（阈值滤抖动）；垂直速度 → 轻微俯仰角（±11°，平滑过渡）
    const dxf = this.x - px0;
    if (dxf > 0.02) this.facing = 1;
    else if (dxf < -0.02) this.facing = -1;
    else if (!this.facing) this.facing = Math.cos(this.angle) >= 0 ? 1 : -1;
    const targetPitch = clamp(this.vy / 130, -1, 1) * 0.19;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * 5);

    this.flipperPhase += dt * 2.4;
    this.headBob += dt * 1.6;
  }

  _swim(dt) {
    // 水面随机漫游
    if (Math.random() < dt * 0.5) {
      this.vx += rand(-14, 14);
      this.vy += rand(-8, 8);
    }
    this.vx *= 0.99;
    this.vy *= 0.99;
    const sp = Math.hypot(this.vx, this.vy);
    const max = CONFIG.turtle.swimSpeed;
    if (sp > max) { this.vx = this.vx / sp * max; this.vy = this.vy / sp * max; }
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    if (sp > 1) {
      const t = Math.atan2(this.vy, this.vx);
      let d = t - this.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.angle += d * Math.min(1, dt * 3);
    }
  }

  _moveToward(tx, ty, dt, speed) {
    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy) || 1;
    this.x += (dx / d) * speed * dt;
    this.y += (dy / d) * speed * dt;
    const t = Math.atan2(dy, dx);
    let dd = t - this.angle;
    while (dd > Math.PI) dd -= Math.PI * 2;
    while (dd < -Math.PI) dd += Math.PI * 2;
    this.angle += dd * Math.min(1, dt * 5);
  }

  // ── 生命周期（阶段 5-⑥）────────────────────────────
  /** 进入死亡流程：cause = 'old' | 'starve' */
  startDeath(cause = 'old') {
    if (this.dying || this.dead) return;
    this.dying = true;
    this.deathCause = cause;
    this.dyingTimer = CONFIG.life?.dyingDuration ?? 2.5;
  }

  /** 死亡动画：水中翻肚上浮 / 岸上静卧，渐隐 */
  _updateDying(dt) {
    this.dyingTimer -= dt;
    if (this.world.isWater(this.x, this.y)) {
      const surface = this.world.bankLineAt(this.x) + 14;
      this.y += (surface - this.y) * Math.min(1, dt * 0.7);
    }
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
    return Math.round(Math.abs(this.flipperPhase) * 3);
  }

  /** 皮肤：品种字段 + 个体种子 → 画法参数（缓存到实例，seed 变了才重算） */
  _skin() {
    if (!this._skinP || this._skinSeed !== this.artSeed) {
      this._skinP = turtleArt(this.species, this.artSeed);
      this._skinSeed = this.artSeed;
    }
    return this._skinP;
  }

  draw(ctx) {
    const P = this._skin();
    const S = this.size * (CONFIG.art?.turtleScale ?? 0.72);

    ctx.save();
    // 死亡渐隐（阶段 5-⑥）
    if (this.dying) {
      const D = CONFIG.life?.dyingDuration ?? 2.5;
      ctx.globalAlpha = clamp(this.dyingTimer / (D * 0.45), 0, 1);
    }
    ctx.translate(this.x, this.y);

    if (this.dying) {
      // 翻肚上浮：垂直镜像（肚朝天）+ 慢速摇摆
      ctx.scale(this.facing || 1, -1);
      ctx.rotate(Math.sin(this.flipperPhase * 0.8) * 0.05);
      drawSideTurtle(ctx, S, this.flipperPhase * 0.3, { ...P, shadow: false });
    } else {
      // 侧视立绘：水平镜像 + 轻微俯仰，不随 angle 整体旋转（阶段 5-⑬）
      ctx.scale(this.facing || 1, 1);
      ctx.rotate(this.pitch ?? 0);
      // 水里划水快、岸上爬行慢（legAmp 缩小摆幅）
      const paddling = this.state === STATE.SWIM || this.state === STATE.SEEK_FOOD;
      drawSideTurtle(ctx, S, this.flipperPhase, { ...P, legAmp: paddling ? 1 : 0.28 });
    }
    ctx.restore();

    // 晒背标记（岸边时头顶小太阳）—— 位置跟随朝向与新画法头位
    if (this.state === STATE.BASK && !this.dying) {
      ctx.save();
      ctx.globalAlpha = 0.5 + 0.2 * Math.sin(this.headBob * 2);
      ctx.fillStyle = '#ffe9a8';
      ctx.beginPath();
      ctx.arc(this.x + (this.facing || 1) * S * 0.95, this.y - S * 0.66, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

}

// ══════════════════════════════════════════════════════════
//  龟 蛋（阶段 5-③）
// ══════════════════════════════════════════════════════════
/**
 * 埋在岸边沙土里的一窝蛋（1~3 枚）。
 * 孵化倒计时结束后由管理器生成幼龟。
 */
export class Egg {
  /**
   * @param {World} world
   * @param {number} x 产蛋点
   * @param {number} y 产蛋点
   * @param {object} species 母龟品种（决定孵化出的龟种）
   */
  constructor(world, x, y, species) {
    this.world = world;
    this.species = species;
    this.x = clamp(x, 16, world.w - 16);
    this.y = clamp(y, 12, Math.max(14, world.bankLineAt(this.x) - 4));
    this.incubation = CONFIG.growth.eggIncubation * rand(0.9, 1.15);
    this.hatched = false;
    // 蛋簇：2~3 枚小蛋，微错位
    this.eggs = [];
    const n = randInt(CONFIG.growth.eggsPerClutch[0], CONFIG.growth.eggsPerClutch[1]);
    for (let i = 0; i < n; i++) {
      this.eggs.push({
        dx: rand(-7, 7),
        dy: rand(-3, 3),
        r: rand(3.2, 4.4),
        phase: rand(0, Math.PI * 2),
      });
    }
    this.age = 0;
  }

  update(dt) {
    if (this.hatched) return;
    this.age += dt;
    this.incubation -= dt;
    if (this.incubation <= 0) this.hatched = true;
  }

  /** 孵化进度 0~1（用于渲染裂纹） */
  get progress() {
    return Math.min(1, this.age / (CONFIG.growth.eggIncubation * 1.05));
  }

  draw(ctx) {
    if (this.hatched) return;
    const cracking = this.progress > 0.82;

    ctx.save();
    for (const e of this.eggs) {
      const x = this.x + e.dx, y = this.y + e.dy;
      // 蛋体（椭圆，埋一半）
      const g = ctx.createRadialGradient(x - 1, y - 1.5, 0.5, x, y, e.r * 1.3);
      g.addColorStop(0, '#f7f0e0');
      g.addColorStop(1, '#d9c9a8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, e.r, e.r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      // 高光
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(x - e.r * 0.3, y - e.r * 0.35, e.r * 0.3, e.r * 0.18, -0.4, 0, Math.PI * 2);
      ctx.fill();
      // 临孵化裂纹
      if (cracking) {
        ctx.strokeStyle = 'rgba(90,70,40,0.75)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        const j = Math.sin(e.phase + this.age * 6) * 1.2;  // 微颤
        ctx.moveTo(x - e.r * 0.7, y + j);
        ctx.lineTo(x - e.r * 0.2, y - e.r * 0.3 + j);
        ctx.lineTo(x + e.r * 0.3, y + e.r * 0.2 + j);
        ctx.lineTo(x + e.r * 0.7, y - e.r * 0.1 + j);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}

export { STATE };
