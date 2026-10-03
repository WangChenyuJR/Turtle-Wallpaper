/**
 * 小鱼 —— Boids 群集算法
 *
 * 三条基本规则（文档 2.2 参考 boids-in-the-blue）：
 *   分离 Separation  —— 别挤在一起
 *   对齐 Alignment   —— 跟邻居同向
 *   凝聚 Cohesion    —— 往邻居中心靠
 * 额外行为：
 *   随机游走、漫游目标点、偏好水层（阶段 8-⑧：别再黏成一团）
 *   避墙、避光标、追食物、饥饿
 *
 * 【阶段 8-⑧ 为什么必须改】用户："鱼儿们老是过一会儿就黏成一团，运动不够随机。"
 * 原来 14 条鱼的参数**完全一样**：同样的感知半径、同样的权重、没有随机项，
 * 于是它们对同一套力做出一模一样的响应，几条鱼一靠近就再也分不开
 * （凝聚 + 对齐是正反馈，没有个体差异就没有任何东西能打破它）。
 * 现在三招：
 *   ① **个体个性**（`_traits()`）：感知半径 / 三个权重 / 游走幅度 / 偏好水层
 *      逐条不同，由 `artSeed` 派生 → 读档后性格与外形一致；
 *   ② **随机游走 wander**：方向角自己慢慢漂，每条鱼的角与漂移速度都不同
 *      —— 这是"运动随机"的来源，也让任何成团趋势被持续打散；
 *   ③ **拥挤抑制凝聚**：邻居一多就主动削弱凝聚，挤到极限时反号互推，
 *      团没法越滚越紧；外加"漫游目标点"让每条鱼有自己的路线。
 */

import { CONFIG } from './config.js';
import { rand, randInt, limit, clamp, seededRandom, rngRange } from './utils.js';
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

  /**
   * 个体个性（阶段 8-⑧）—— 每条鱼"性格"不同，才不会整齐划一地黏成一团。
   *
   * ⚠️ 全部由 `artSeed` 派生（**不是** Math.random）：外形种子会写进存档，
   * 所以读档后这条鱼的性格与外形完全对得上，不会"换了另一条鱼"。
   * 惰性 + 按种子缓存（和 `_skin()` 同一套路），这样 artSeed 被存档回填后也能重算。
   *
   * 字段分两类：
   *   · 性格常量（感知/权重/深度偏好/漫游半径与间隔）—— 只读，派生自种子
   *   · 可变状态（游走角 wanderA、漫游倒计时 roamT 与目标点、遮蔽平滑量 shelterMix）
   */
  _traits() {
    if (!this._tr || this._trSeed !== this.artSeed) {
      const F = CONFIG.fish;
      const gap = F.roamGap ?? [6, 18];
      const rng = seededRandom((this.artSeed ^ 0x5bf03635) >>> 0);
      const R = (lo, hi) => rngRange(rng, lo, hi);
      this._tr = {
        // 有的合群、有的独来独往：感知半径与三个权重逐条不同
        percScale: R(0.70, 1.30),
        sepScale: R(0.80, 1.40),
        spcScale: R(0.75, 1.25),
        aliScale: R(0.45, 1.15),
        cohScale: R(0.15, 0.85),
        // 随机游走：幅度与漂移速度都不同 → 方向不会同步
        wanderAmp: R(0.30, 0.90),
        wanderJit: R(0.55, 1.40),
        // 偏好水层（0 = 贴水面，1 = 贴池底）
        depthPref: R(0.12, 0.88),
        // 漫游目标点
        roamR: R(0.55, 1.30),
        roamGap: R(gap[0], gap[1]),
        // ── 可变状态 ──
        wanderA: rng() * Math.PI * 2,
        roamT: R(0, 5),
        roamX: 0, roamY: 0, hasRoam: false,
        shelterMix: 0,
      };
      this._trSeed = this.artSeed;
    }
    return this._tr;
  }

  /** 计算所有行为力的合力 */
  flock(fishes, cursor, foods, dt, plants = null) {
    const F = CONFIG.fish;
    const T = this._traits();
    const W = this.world;
    let ax = 0, ay = 0;

    // ── 遮蔽区：平滑过渡 ────────────────────────────────
    // 阶段 8-⑧：侧视图里荷叶浮在水面、叶柄在水下，鱼从荷叶"后面"（画面更深处）
    // 经过只是在 2D 投影上重叠，并不真的撞到。所以遮蔽只做**很轻**的"放松"，
    // 而且必须渐变 —— 硬边界会让鱼一跨线就突然换一套躲避强度。
    const shelRaw = plants ? (plants.isSheltered(this.x, this.y) ? 1 : 0) : 0;
    T.shelterMix += (shelRaw - T.shelterMix) * Math.min(1, dt * 1.2);
    this.shelterMix = T.shelterMix;
    const calm = 1 - (1 - (CONFIG.plants?.shelterCalm ?? 0.4)) * T.shelterMix;
    this.sheltered = T.shelterMix > 0.5;

    // ── Boids 三力 + 两个尺度的「排斥」────────────────────
    // ⚠️ 8-⑧ 修掉一个隐蔽 bug：老写法 `sepX -= (o.x−this.x)/d²` **没有归一化**，
    //    量级只有 1/d（20px 处 ≈ 0.05），而 `limit()` 是"只封顶、不放大" ——
    //    于是"分离力"实际上一直是 0，separationForce 怎么调都没用，
    //    鱼贴到 1px 也不会被推开（对照实测：120 秒后最近邻 1px、全池重叠成一个点）。
    // 现在改成**两个尺度、都先把方向归一化再乘强度**：
    //    ① 贴身排斥 `separation`（默认 10px，强度 1.0）—— 防止完全重叠；
    //    ② 个人空间 `spacing`（默认 62px，强度 0.5）—— 温和互斥，防止挤成一坨。
    // 两者**都只是转向力（软）**，没有任何位置级硬推 ——
    // 侧视图里"能不能重叠"看的是有没有硬推，所以鱼依然可以短暂擦身而过。
    let sepX = 0, sepY = 0, sepN = 0;
    let spcX = 0, spcY = 0, spcN = 0;
    let aliX = 0, aliY = 0, aliN = 0;
    let cohX = 0, cohY = 0, cohN = 0;

    // 感知半径 / 两个排斥半径逐条不同（完全一样必然同步成一个团）
    const perc = F.perception * T.percScale;
    const perc2 = perc * perc;
    const sepR = F.separation * T.sepScale;
    const sep2 = sepR * sepR;
    const spcR = (F.spacing ?? 62) * T.spcScale;
    const spc2 = spcR * spcR;
    const range2 = perc2 > spc2 ? perc2 : spc2;   // 个人空间可能比感知半径还大

    for (const o of fishes) {
      if (o === this || o.dead || o.dying) continue;
      const d2 = dist2(this.x, this.y, o.x, o.y);
      if (d2 > range2 || d2 === 0) continue;

      const d = Math.sqrt(d2);
      // ① 贴身排斥：单位向量（**归一化是重点**，否则力小到等于没有）
      if (d2 < sep2) {
        sepX -= (o.x - this.x) / d;
        sepY -= (o.y - this.y) / d;
        sepN++;
      }
      // ② 个人空间：越近越强，到半径边缘线性归零（软过渡，不会有硬边界）
      if (d2 < spc2) {
        const w = 1 - d / spcR;
        spcX -= ((o.x - this.x) / d) * w;
        spcY -= ((o.y - this.y) / d) * w;
        spcN++;
      }
      if (d2 > perc2) continue;                   // 对齐/凝聚仍只认感知半径内
      aliX += o.vx; aliY += o.vy; aliN++;
      cohX += o.x; cohY += o.y; cohN++;
    }

    if (sepN > 0) {
      const m = Math.hypot(sepX, sepY);
      if (m > 1e-6) {
        const f = F.maxForce * (F.separationForce ?? 1.0) * T.sepScale;
        ax += (sepX / m) * f; ay += (sepY / m) * f;
      }
    }
    if (spcN > 0) {
      const m = Math.hypot(spcX, spcY);
      if (m > 1e-6) {
        // 门控：邻居太少时**不出力**（只有一两条鱼相遇就该能擦身/重叠过去），
        // 数量上去（真要扎堆了）才出全力。`spacingEdge` = 达到满力所需的邻居数。
        // 这是"能重叠"(8-⑧) 与 "别黏成一团"(8-⑪) 两个诉求的调和点：
        // 前者管"偶尔相遇"，后者管"持续成团"，靠邻居数区分。
        const edge = Math.max(2, F.spacingEdge ?? 3);
        const gate = clamp((spcN - 1) / (edge - 1), 0, 1);
        if (gate > 0) {
          const f = F.maxForce * (F.spacingForce ?? 0.5) * T.spcScale * gate;
          ax += (spcX / m) * f; ay += (spcY / m) * f;
        }
      }
    }
    if (aliN > 0) {
      const s = limit(aliX / aliN - this.vx, aliY / aliN - this.vy, F.maxForce * 0.7 * T.aliScale);
      ax += s.x; ay += s.y;
    }
    if (cohN > 0) {
      // 阶段 8-⑧：凝聚是"黏成一团"的元凶 —— 邻居一多就主动抑制它，
      // 挤到极限时甚至反号（互相推开），团就没法越滚越紧。
      // 注意这与"减小体积碰撞"不冲突：那边管的是**硬推开**，这里管的是**别主动聚**。
      const crowdN = F.crowdN ?? 5;
      const crowd = clamp(1 - (aliN - crowdN) / crowdN, -0.6, 1);
      const gain = (T.cohScale / 0.5) * crowd;
      const tx = cohX / cohN - this.x, ty = cohY / cohN - this.y;
      const s = limit(tx, ty, F.maxForce * 0.6);
      ax += s.x * 0.5 * gain; ay += s.y * 0.5 * gain;
    }

    // ── 随机游走 wander（阶段 8-⑧）───────────────────────
    // 方向角自己缓慢地漂（角速度小 → 是"随机的巡游"而不是"发抖"），
    // 每条鱼的起始角、漂移速度都不同 → 一池鱼不可能收敛到同一个方向。
    if (F.wander !== false) {
      T.wanderA += rand(-1, 1) * (F.wanderJitter ?? 0.9) * T.wanderJit * dt;
      const wa = (F.wanderAmp ?? 0.55) * T.wanderAmp;
      ax += Math.cos(T.wanderA) * F.maxForce * wa;
      ay += Math.sin(T.wanderA) * F.maxForce * wa;
    }

    // ── 漫游目标点：每条鱼隔一阵换一个"想去的地方" ──────────
    // 让鱼"走出自己的路线"最有效的一招：有目标点的鱼自己巡游，
    // 而不是被邻居牵着走。目标点必须是真正有水的地方（挑不到就沿用旧点）。
    if (F.roam !== false) {
      T.roamT -= dt;
      if (T.roamT <= 0) {
        T.roamT = T.roamGap * rand(0.75, 1.3);
        const rMax = (F.roamRadius ?? 200) * T.roamR;
        for (let k = 0; k < 8; k++) {
          const a = rand(0, Math.PI * 2);
          const r = rMax * rand(0.3, 1);
          // 8-⑭：35% 概率直接在全池随机取目标 x（不受"从当前位置出发"限制），
          // 保证每条鱼都会定期横穿整个池塘；其余仍按相对半径挑近点。
          // （可配置：8-⑪ 的"老行为"对照实验要把它关掉，否则旧参数也全池漫游、
          //   聚团现象复现不出来，对照锚失效。）
          const tx = Math.random() < (F.roamAbsolute ?? 0.35)
            ? rand(40, W.w - 40)
            : clamp(this.x + Math.cos(a) * r, 6, W.w - 6);
          // 8-⑬ 剖面水体：下界用剖面地板（池底）—— 鱼能游进岸坡前的"土"里
          const s = W.surfaceAt(tx), g = W.swimFloorY(tx);
          if (g - s < 30) continue;                       // 那一列水深不够，换一个
          const ty = rand(s + 14, Math.max(s + 15, g - 14));
          if (W.isWater(tx, ty)) { T.roamX = tx; T.roamY = ty; T.hasRoam = true; break; }
        }
      }
      if (T.hasRoam) {
        const dx = T.roamX - this.x, dy = T.roamY - this.y;
        const d = Math.hypot(dx, dy);
        if (d < 22) {
          T.roamT = Math.min(T.roamT, 0.2);               // 快到了就早点换下一个点
        } else {
          // 8-⑭：长距离目标（>260px，多半是全池绝对取的点）给 1.8 倍牵引，
          // 让鱼"认真赶路"横穿池塘 —— 0.28× 的温吞力会被游走噪声吃掉，
          // 个体差异大的鱼有的 150 秒只挪 180px（用户："只在很小的范围活动"）。
          const boost = d > 260 ? 1.8 : 1;
          const f = F.maxForce * (F.roamForce ?? 0.28) * boost;
          ax += (dx / d) * f;
          ay += (dy / d) * f;
        }
      }
    }

    // ── 偏好水层：每条鱼有自己的"舒适深度" ──────────────────
    // 免得一池鱼全挤在同一水平线上（那看起来也像"黏成一团"）。
    if ((F.depthPull ?? 0) > 0) {
      const s = W.surfaceAt(this.x), g = W.swimFloorY(this.x);   // 8-⑬ 剖面地板
      const wantY = s + (g - s) * T.depthPref;
      ay += clamp((wantY - this.y) / 40, -1, 1) * F.maxForce * F.depthPull;
    }

    // ── 避墙 ───────────────────────────────────────────
    // 8-⑭：改成**渐进式**——离墙越近推力越大。旧版是恒力 1.2×maxForce，
    // 而群体外推合力（贴身 1.0 + 个人空间 0.9 + 漫游/游走）能到 ~2.5×，
    // 结果鱼一旦被挤到墙边就再也回不来（实测 45 秒后 8/10 条钉死在
    // x=10 / x=w-10，速度仍朝墙里顶——用户："只在很小的水域范围活动"）。
    // 现在墙面处推力 ≈ 3.4×，必然压过外推合力 → 鱼在离墙一段距离处稳住，
    // 之后由漫游目标接管，继续巡游全域。
    const m = 42;
    const top = W.surfaceAt(this.x);          // 8-⑬：游泳区上界就是水线
    const bot = W.swimFloorY(this.x);         //      下界是剖面地板（池底）
    if (this.x < m) ax += F.maxForce * (1.2 + 3.2 * (1 - this.x / m));
    if (this.x > W.w - m) ax -= F.maxForce * (1.2 + 3.2 * (1 - (W.w - this.x) / m));
    if (this.y < top + m) ay += F.maxForce * (1.4 + 3.2 * (1 - (this.y - top) / m));
    if (this.y > bot - m) ay -= F.maxForce * (1.4 + 3.2 * (1 - (bot - this.y) / m));

    // ── 避光标 ─────────────────────────────────────────
    if (cursor.active) {
      const d2c = dist2(this.x, this.y, cursor.x, cursor.y);
      const r = F.cursorAvoid;
      if (d2c < r * r && d2c > 1) {
        const d = Math.sqrt(d2c);
        // 在植物遮蔽中更放松（躲避力度削弱；calm 在上面按 shelterMix 平滑算好）
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

    // ── 墙体交互（阶段 8-③）：沿墙滑行，而不是"撞停 / 掉头往下" ──
    // 旧版是硬钳制 + `vx/vy *= -0.5` 整体反向；现在先做**切向全保留**的反射
    // 与软避让（进入身体半径内沿法线加力），硬钳制只留作位置兜底、不再改速度方向。
    this.world.wallResponse(this, 12, { dt });

    const c = this.world.constrainToWater(this.x, this.y, 10);
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
