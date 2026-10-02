/**
 * 乌龟 —— 状态机
 *
 * 状态流转（文档 5.2 乌龟行为 / 阶段 6-⑧ 侧视剖面重制）：
 *
 *   SWIM (水里游) ──饿了/该晒背──► CLIMB_OUT (游向岸线 → 爬上坡)
 *        ▲                                   │
 *        │                                   ▼
 *   觅食/待机 ◄── RETURN (走回水边入水) ◄── BASK (岸上/晒台晒太阳)
 *        │
 *        └── 有食物 ──► SEEK_FOOD (追食物)
 *
 * 侧视剖面下的水陆关系：
 *   水 = 水线以下、池底以上的区域；左右两侧是岸；池中央可能有一块晒台。
 *   龟想上岸，先横向游到最近的岸线，再沿着岸坡爬上去（y 贴着地表曲线）。
 *
 * 栖息类型（habitat）决定它平时待在哪：
 *   aquatic 水龟 → 多在深水；semi 半水龟 → 两栖；terrestrial 陆龟 → 基本不下水。
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

    // ── 起始位置：水里的某一处（水龟更靠池心/深处，陆龟更靠岸）
    const s0 = world.waterSpans[Math.floor(Math.random() * world.waterSpans.length)]
      ?? { x0: 0, x1: world.w };
    const inset = 26;
    this.x = rand(s0.x0 + inset, Math.max(s0.x0 + inset + 1, s0.x1 - inset));
    this.vx = rand(-10, 10);
    this.vy = 0;
    this.angle = Math.random() < 0.5 ? 0 : Math.PI;

    // ── 潜水深度（阶段 5-⑭ / 6-⑧）：0 = 紧贴水面，1 = 池底 ──
    const bias = CONFIG.turtle?.depthBias?.[this.habitat] ?? [0.15, 0.65];
    this.depth = opts.landStart ? 0 : rand(bias[0], bias[1]);
    this.depthGoal = this.depth;
    this.vertState = 0;
    this.bubbleT = 0;
    this.roll = 0;
    this.stridePhase = rand(0, Math.PI * 2);
    this._syncYFromDepth();

    // ── 美术（阶段 5-⑬ 新画法）────────────────────────
    this.artSeed = opts.artSeed ?? ((Math.random() * 0xffffffff) >>> 0);
    this.facing = 0;          // 朝向：1 右 / -1 左
    this.pitch = 0;           // 俯仰角（rad）

    // ── 陆龟可以直接从岸上开始（画面更丰富）──────────
    if (this._isLandLover() && Math.random() < 0.5 && !opts.baby) {
      const spot = world.pickLandSpot(this.x, true);
      if (spot) {
        this.x = spot.x;
        this.depth = 0;
        this._standOnLand(spot.y);
        this.state = STATE.BASK;
      } else {
        this.state = STATE.SWIM;
      }
    } else {
      this.state = STATE.SWIM;
    }

    this.stateTime = 0;
    this.hunger = opts.baby ? 0.55 : rand(0.2, 0.6);
    this.flipperPhase = rand(0, Math.PI * 2);
    this.headBob = rand(0, Math.PI * 2);

    // 晒太阳目标点
    this.baskTarget = null;
    // 计时器：多久换一次行为
    this.decisionTimer = rand(3, 8);
    // 繁殖（阶段 5-③）
    this.reproCooldown = opts.baby ? G.turtleReproCooldown : rand(0, G.turtleReproCooldown * 0.5);

    // ── 生命周期（阶段 5-⑥ / 6-⑧ 拉长）───────────────
    this.kind = 'turtle';
    this.dead = false;
    this.generation = opts.generation ?? 1;
    this.birth = opts.birth ?? 0;
    const maxAge = CONFIG.life?.turtleMaxAge ?? [86400, 172800];
    this.maxAge = rand(maxAge[0], maxAge[1]) * (CONFIG.life?.longevity ?? 1);
    this.eaten = 0;
    this.offspring = 0;
    this.dying = false;
    this.dyingTimer = 0;
    this.deathCause = null;
    this.starveTimer = 0;
  }

  /** 是否成年 */
  get isAdult() {
    return this.age >= CONFIG.growth.turtleMaturityAge;
  }

  // ── 地形小工具 ────────────────────────────────────────
  /** 身体（立绘中心）离地多高才像"蹲在地上" */
  _footOffset() {
    return this.size * (CONFIG.art?.turtleScale ?? 0.72) * 0.34;
  }

  /** 水体上界（龟中心能到的最高处：水面下 size*0.3） */
  _waterTopY(x = this.x) {
    return this.world.surfaceAt(x) + this.size * 0.30;
  }

  /** 水体下界（池底上 size*0.34） */
  _waterBotY(x = this.x) {
    return Math.max(this._waterTopY(x) + 6, this.world.groundYAt(x) - this.size * 0.34);
  }

  /** 按当前 depth 把 y 对齐到水层 */
  _syncYFromDepth() {
    const x = this.x;
    const top = this._waterTopY(x);
    const bot = this._waterBotY(x);
    this.y = top + (bot - top) * clamp(this.depth, 0, 1);
  }

  /** 用当前 y 反推 depth（约束过 y 之后要保持一致） */
  _syncDepthFromY() {
    const top = this._waterTopY();
    const bot = this._waterBotY();
    this.depth = clamp((this.y - top) / Math.max(6, bot - top), 0, 1);
  }

  /** 站到岸上：y 贴地表曲线，身体略高于地面 */
  _standOnLand(groundY) {
    this.y = groundY - this._footOffset();
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

  /** 按栖息类型挑一个目标深度 */
  _pickDepthGoal() {
    const [lo, hi] = CONFIG.turtle?.depthBias?.[this.habitat] ?? [0.15, 0.65];
    const r = Math.random();
    // 所有龟都会周期性上浮换气
    if (r < 0.22) return rand(0.02, 0.14);
    // 水龟：更长时间待在深水
    if (this.habitat === 'aquatic' && r < 0.58) return rand(Math.min(hi - 0.10, 0.94), hi);
    return rand(lo, hi);
  }

  /** 选择一个岸上目标（左右岸 / 晒台里就近的干地） */
  _pickBaskTarget(preferNear = true) {
    const W = this.world;
    // 已经站在某块岸/台上时，只挑"同一块陆地"上的落点：
    // 否则龟会朝着隔着水面的另一块岸直走，卡在水缘来回抽（2026-10-02 修复）
    const z = W.landZoneAt(this.x);
    const spot = z ? W.pickLandSpotInZone(z) : W.pickLandSpot(this.x, preferNear);
    if (spot) this.baskTarget = { x: spot.x, y: spot.y, zone: spot.zone };
    else this.baskTarget = null;
    return this.baskTarget;
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
    const px0 = this.x;
    const pa0 = this.angle;
    this._grow(dt);
    // ── 死亡动画优先（阶段 5-⑥）────────────────────
    if (this.dying) { this._updateDying(dt); return; }
    this.stateTime += dt;
    this.decisionTimer -= dt;
    this.hunger = clamp(this.hunger + T.hungerDecay * dt, 0, 1);

    // 饿死计时：饥饿满格持续 turtleStarveDeath 秒
    if (this.hunger >= 1) {
      this.starveTimer += dt;
      if (this.starveTimer >= (CONFIG.life?.turtleStarveDeath ?? 7200)) this.startDeath('starve');
    } else {
      this.starveTimer = 0;
    }

    const W = this.world;
    const target = this._nearestFood(foods);
    const eatR = T.eatRadius + this.size * 0.3;

    // ── 状态决策 ───────────────────────────────────────
    switch (this.state) {
      case STATE.SWIM: {
        if (target && target.d < 300 && this.hunger > 0.28) {
          this.state = STATE.SEEK_FOOD;
          this.stateTime = 0;
        } else if (this.decisionTimer <= 0) {
          // 按 habitat 决定"是否上岸"（陆龟几乎必上，水龟几乎不上；夜晚/雨天不晒背）
          const nightFactor = env.isNight ? 0 : (env.rain ? 0.15 : 1);
          if (Math.random() < this.behavior.baskingChance * nightFactor) {
            if (this._pickBaskTarget(true)) {
              this.state = STATE.CLIMB_OUT;
              this.stateTime = 0;
            }
          }
          // 爱待水的龟决策更频繁但停留更久（等效更长时间泡水）
          this.decisionTimer = rand(4, 10) * this.behavior.waterBias;
        }
        // 下潜/上浮决策（阶段 5-⑭）：偶尔潜入深处，再上浮换气
        if (Math.random() < dt * 0.14) this.depthGoal = this._pickDepthGoal();
        this._swim(dt);
        break;
      }

      case STATE.SEEK_FOOD: {
        if (!target || target.d > 380) {
          this.state = STATE.SWIM;
          break;
        }
        const f = target.food;
        // 食物在岸上 → 爬上去（水龟不太饿就不费劲）
        if (W.isLand(f.x, f.y) || !W.isWater(f.x, f.y)) {
          if (this.habitat === 'aquatic' && this.hunger < 0.8) {
            this.state = STATE.SWIM;
            break;
          }
          if (!this.baskTarget || Math.abs(this.baskTarget.x - f.x) > 20) {
            this.baskTarget = { x: f.x, y: W.groundYAt(f.x) };
          }
          this.state = STATE.CLIMB_OUT;
          break;
        }
        // 水中（浮面饲料也在水线上）→ 上浮到水面去吃
        this.depthGoal = 0.0;
        this._swim(dt);
        if (target.d < eatR) {
          f.eat();
          this.eaten++;
          this.hunger = clamp(this.hunger - CONFIG.food.amountPerPellet / 100, 0, 1);
          this.state = STATE.SWIM;
        }
        break;
      }

      case STATE.CLIMB_OUT: {
        const tgt = this.baskTarget;
        if (!tgt) { this.state = STATE.SWIM; break; }
        if (W.isLandColumn(this.x)) {
          const z = W.landZoneAt(this.x);
          if (z && (tgt.x < z.x0 || tgt.x > z.x1)) {
            // 目标在"另一块岸"上 → 就近改到本块陆地（不下水绕路，免得卡水缘）
            this.baskTarget = W.pickLandSpotInZone(z);
            break;
          }
          // 已经上岸：沿地表走向目标（身体贴着岸坡/台面）
          // 注意用"可达目标"：身体有宽度，x 会被 clamp 到 [size, w-size]，
          // 若目标落在这个边距里（如贴屏幕边的岸），用原始 tgt.x 会永远差着十几像素
          // 够不到，龟就一直卡在 climb_out（2026-10-02 修复）。
          const gx = clamp(tgt.x, this.size, W.w - this.size);
          const dx = gx - this.x;
          if (Math.abs(dx) < 12) {
            this.state = STATE.BASK;
            this.stateTime = 0;
            const [lo, hi] = this.behavior.baskDuration;
            this._baskGoal = rand(lo, hi);
            break;
          }
          const spd = T.swimSpeed * (0.55 + 0.45 * this.behavior.landSpeedScale);
          this.x += Math.sign(dx) * Math.min(Math.abs(dx), spd * dt);
          const g = W.groundYAt(this.x);
          // 平滑贴地（爬坡）
          this.y += (g - this._footOffset() - this.y) * Math.min(1, dt * 6);
          this.angle = dx >= 0 ? 0 : Math.PI;
          this.depth = 0;
        } else {
          // 还在水里：先横向游到最近的岸线
          const sp = W.shorePointNear(this.x);
          const z = W.landZoneAt(sp.x);
          if (z && (tgt.x < z.x0 || tgt.x > z.x1)) {
            // 目标不在这段岸上 → 改为登岸附近的落点
            this.baskTarget = W.pickLandSpotInZone(z);
            break;
          }
          this._moveToward(sp.x, sp.y, dt, T.swimSpeed * 1.1);
          this.depthGoal = 0;
          // 顺手吃路过的食物
          if (target && target.d < eatR + 4) {
            target.food.eat();
            this.eaten++;
            this.hunger = clamp(this.hunger - CONFIG.food.amountPerPellet / 100, 0, 1);
          }
        }
        break;
      }

      case STATE.BASK: {
        const goal = this._baskGoal ?? rand(8, 16);
        if (this.stateTime > (env.isNight ? goal * 0.3 : goal)) {
          this.state = STATE.RETURN;
          this.stateTime = 0;
          // 陆龟"回水"常常只是换个岸上位置继续待着（少数时候才真下水泡一泡）
          this._landOnlyReturn = this.habitat === 'terrestrial' && Math.random() < 0.72;
        } else {
          // 小范围爬动（陆龟稍快）
          const spd = T.crawlSpeed * this.behavior.landSpeedScale;
          this.x += Math.cos(this.angle) * spd * 0.6 * dt;
          // 别爬出干地范围
          const z = tgt2zone(W, this.x);
          if (z) this.x = clamp(this.x, z.dx0 + 4, Math.max(z.dx0 + 5, z.dx1 - 4));
          else this.x = clamp(this.x, 6, W.w - 6);
          const g = W.groundYAt(this.x);
          this.y += (g - this._footOffset() - this.y) * Math.min(1, dt * 6);
          if (Math.random() < dt * 0.3) this.angle += rand(-1, 1);
          // 直立走路：让 angle 别飘成竖直
          this.angle = Math.cos(this.angle) >= 0 ? 0 : Math.PI;
          this.depth = 0;
        }
        // 岸上/晒台上有食物就爬过去
        if (target && target.d < 220 && this.hunger > 0.22) {
          this.baskTarget = { x: target.food.x, y: W.groundYAt(target.food.x) };
          this.state = STATE.CLIMB_OUT;
          break;
        }
        // ── 产蛋判定（阶段 5-③）──────────────────────
        if (this.isAdult
            && this.hunger < CONFIG.growth.reproHungerMax
            && this.reproCooldown <= 0
            && this.onLayEggs
            && Math.random() < CONFIG.growth.turtleEggChance * dt * 10) {
          if (this.onLayEggs(this)) {
            this.hunger = clamp(this.hunger + 0.3, 0, 1);
            this.reproCooldown = CONFIG.growth.turtleReproCooldown;
          }
        }
        break;
      }

      case STATE.RETURN: {
        if (this.habitat === 'terrestrial' && this._landOnlyReturn) {
          this._pickBaskTarget(false);      // 换个岸/去晒台
          this.state = STATE.CLIMB_OUT;
          break;
        }
        const wp = W.waterEntryNear(this.x);
        const distX = Math.abs(wp.x - this.x);
        // 已经到水边（或这一列已是水）→ 入水
        if (!W.isLandColumn(this.x) || distX < 8) {
          this.x += Math.sign(wp.x - this.x) * Math.min(distX, T.swimSpeed * dt);
          this.state = STATE.SWIM;
          this.stateTime = 0;
          this.decisionTimer = rand(4, 10) * this.behavior.waterBias;
          this.depthGoal = rand(0.15, 0.5);
          this._syncYFromDepth();
          this.vx = Math.sign(wp.x - this.x || 1) * rand(5, 12);
        } else {
          // 沿地表走向入水点
          const spd = T.swimSpeed * (0.6 + 0.4 * this.behavior.landSpeedScale);
          this.x += Math.sign(wp.x - this.x) * Math.min(distX, spd * dt);
          const g = W.groundYAt(this.x);
          this.y += (g - this._footOffset() - this.y) * Math.min(1, dt * 6);
          this.angle = wp.x >= this.x ? 0 : Math.PI;
          this.depth = 0;
        }
        break;
      }
    }

    // 移动后重新对齐：在水里 → y 必须落在水层内（并回收 depth）
    const waterState = this.state === STATE.SWIM || this.state === STATE.SEEK_FOOD;
    const inWaterCol = W.isWaterColumn(this.x);
    if (waterState) {
      if (!inWaterCol) {
        // 被挤到岸上 → 拉回最近的水域
        const c = W.constrainToWater(this.x, this.y, this.size * 0.5);
        this.x = c.x; this.y = c.y;
      } else {
        const c = W.constrainToWater(this.x, this.y, this.size * 0.45);
        this.x = c.x; this.y = c.y;
      }
      this._syncDepthFromY();
    } else {
      // 陆上 / 过界状态：只做池塘兜底
      this.x = clamp(this.x, this.size, W.w - this.size);
      if (W.isLandColumn(this.x)) {
        const g = W.groundYAt(this.x);
        const want = g - this._footOffset();
        this.y += (want - this.y) * Math.min(1, dt * 4);
      } else {
        // 跨水陆边界途中：别掉到池底以下
        this.y = Math.min(this.y, W.groundYAt(this.x) - 4);
        this.y = Math.max(this.y, 8);
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

    // ── 光标反应：轻微好奇靠近 ──────────────────────────
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

    // 水龟不该被卡在岸上：若在干地上且不是主动上岸状态，拉回水里
    if (this.habitat === 'aquatic'
        && this.state !== STATE.CLIMB_OUT
        && this.state !== STATE.BASK
        && !inWaterCol) {
      const c = W.constrainToWater(this.x, this.y, this.size * 0.5);
      this.x = c.x; this.y = c.y;
      this.state = STATE.SWIM;
    }

    // ── 朝向与俯仰（阶段 5-⑬：侧视立绘不随 angle 整体旋转）──
    const dxf = this.x - px0;
    if (dxf > 0.02) this.facing = 1;
    else if (dxf < -0.02) this.facing = -1;
    else if (!this.facing) this.facing = Math.cos(this.angle) >= 0 ? 1 : -1;

    // ── 潜水深度推进（阶段 5-⑭）──────────────────────────
    const nowInWater = waterState && W.isWater(this.x, this.y);
    if (nowInWater) {
      const prevDepth = this.depth;
      const rate = this.depthGoal < this.depth ? 1.6 : 0.9;   // 上浮比下潜更急
      this.depth += (this.depthGoal - this.depth) * Math.min(1, dt * rate);
      this._syncYFromDepth();
      const dv = (this.depth - prevDepth) / Math.max(dt, 1e-4);
      this.vertState = dv < -0.08 ? -1 : dv > 0.08 ? 1 : 0;
      this.bubbleT += dt;
      if (this.vertState === -1 && this.bubbleT > 0.22) this.bubbleT = 0;
    } else {
      this.depth += (0 - this.depth) * Math.min(1, dt * 3);
      this.vertState = 0;
    }
    this.depth = clamp(this.depth, 0, 1);

    // 俯仰：垂直速度 + 上浮/下潜意图
    const diveLean = this.vertState * 0.16;
    const vyNow = nowInWater ? this.vy : 0;
    const targetPitch = clamp(vyNow / 130, -1, 1) * 0.19 + diveLean;
    this.pitch += (targetPitch - this.pitch) * Math.min(1, dt * (this.vertState ? 3.2 : 5));

    // 转向侧倾（roll）
    let dAng = this.angle - pa0;
    while (dAng > Math.PI) dAng -= Math.PI * 2;
    while (dAng < -Math.PI) dAng += Math.PI * 2;
    const targetRoll = clamp(dAng / Math.max(dt, 1e-4) * 0.05, -0.34, 0.34);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 4);

    // 划水/步态相位
    const spd = Math.abs(this.vx);
    const paddleRate = nowInWater
      ? 1.6 + clamp(spd / 26, 0, 1.4) * 2.6
      : 1.1;
    this.flipperPhase += dt * paddleRate * 2.4;
    this.stridePhase += dt * 2.0;
    this.headBob += dt * 1.6;
  }

  _swim(dt) {
    // 横向随机漫游
    if (Math.random() < dt * 0.5) this.vx += rand(-14, 14);
    this.vx *= 0.99;
    const max = CONFIG.turtle.swimSpeed;
    this.vx = clamp(this.vx, -max, max);
    this.x += this.vx * dt;

    // 纵向由 depthGoal 驱动（浮上来吃东西 / 下潜巡游）
    const top = this._waterTopY();
    const bot = this._waterBotY();
    const ty = top + (bot - top) * clamp(this.depthGoal, 0, 1);
    const rate = this.depthGoal < this.depth ? 1.6 : 0.9;
    this.y += (ty - this.y) * Math.min(1, dt * rate);

    if (Math.abs(this.vx) > 1) {
      this.angle = this.vx >= 0 ? 0 : Math.PI;
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
    this.dyingTimer = CONFIG.life?.dyingDuration ?? 3.0;
  }

  /** 死亡动画：水中翻肚上浮 / 岸上静卧，渐隐 */
  _updateDying(dt) {
    this.dyingTimer -= dt;
    if (this.world.isWater(this.x, this.y)) {
      const surface = this.world.surfaceAt(this.x) + 14;
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

  /** 皮肤：品种字段 + 个体种子 → 画法参数 */
  _skin() {
    if (!this._skinP || this._skinSeed !== this.artSeed) {
      this._skinP = turtleArt(this.species, this.artSeed);
      this._skinSeed = this.artSeed;
    }
    return this._skinP;
  }

  draw(ctx) {
    const P = this._skin();
    // 深度缩放：越深看得越小（透视）
    const depthShrink = 1 - this.depth * 0.16;
    const S = this.size * (CONFIG.art?.turtleScale ?? 0.72) * depthShrink;

    ctx.save();
    if (this.dying) {
      const D = CONFIG.life?.dyingDuration ?? 3.0;
      ctx.globalAlpha = clamp(this.dyingTimer / (D * 0.45), 0, 1);
    }
    ctx.translate(this.x, this.y);

    if (this.dying) {
      ctx.scale(this.facing || 1, -1);
      ctx.rotate(Math.sin(this.flipperPhase * 0.8) * 0.05);
      drawSideTurtle(ctx, S, this.flipperPhase * 0.3, { ...P, shadow: false });
    } else {
      ctx.scale(this.facing || 1, 1);
      ctx.rotate(this.pitch + this.roll * 0.5);
      const paddling = this.state === STATE.SWIM || this.state === STATE.SEEK_FOOD;
      let legAmp = 1, ph = this.flipperPhase;
      if (paddling) {
        if (this.vertState < 0) { legAmp = 0.78; ph = this.flipperPhase * 0.7; }
        else if (this.vertState > 0) { legAmp = 1.25; ph = this.flipperPhase * 1.35; }
      } else {
        legAmp = 0.28; ph = this.stridePhase;
      }
      const bob = paddling && this.vertState === 0
        ? Math.sin(this.headBob * 1.3) * S * 0.035 * (1 - this.depth) : 0;
      ctx.translate(0, bob);
      drawSideTurtle(ctx, S, ph, { ...P, legAmp });
    }
    ctx.restore();

    // 晒背标记（岸上/晒台时头顶小太阳）
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

/** 找到包含 x 的干地区段（BASK 时防止爬出自己的岸/台面） */
function tgt2zone(world, x) {
  for (const z of world.landZones) {
    if (x >= z.x0 - 2 && x <= z.x1 + 2) return z;
  }
  return null;
}

// ══════════════════════════════════════════════════════════
//  龟 蛋（阶段 5-③）
// ══════════════════════════════════════════════════════════
/**
 * 埋在岸上沙土里的一窝蛋（1~3 枚）。
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
    // 蛋必须埋在干地上（岸/晒台），别掉进水里
    const maxY = world.groundYAt(this.x) - 2;
    this.y = clamp(y, 10, Math.max(12, maxY));
    this.incubation = CONFIG.growth.eggIncubation * rand(0.9, 1.15);
    this.hatched = false;
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
      const g = ctx.createRadialGradient(x - 1, y - 1.5, 0.5, x, y, e.r * 1.3);
      g.addColorStop(0, '#f7f0e0');
      g.addColorStop(1, '#d9c9a8');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, e.r, e.r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.ellipse(x - e.r * 0.3, y - e.r * 0.35, e.r * 0.3, e.r * 0.18, -0.4, 0, Math.PI * 2);
      ctx.fill();
      if (cracking) {
        ctx.strokeStyle = 'rgba(90,70,40,0.75)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        const j = Math.sin(e.phase + this.age * 6) * 1.2;
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
