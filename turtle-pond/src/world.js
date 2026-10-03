/**
 * 场景世界 —— 侧视剖面（阶段 6-⑧ 重制）
 *
 * 坐标系：左上角 (0,0)，y 向下为正
 *
 *  ┌──────────────────────────────────────────────┐ y = 0
 *  │              空气（天空 / 昼夜）                │
 *  │  ▒▒岸▒▒      ← 荷叶浮在这条线上 →      ▒▒岸▒▒ │
 *  ╞══════════════════════════════════════════════╡ y = waterY ← 水线
 *  │              水体（鱼 / 潜水的龟）             │
 *  │                   ▓晒台▓                      │
 *  ├──────────────────────────────────────────────┤ y = bedY   ← 池底
 *  │              淤泥 / 沉积 / 螺蛳                │
 *  └──────────────────────────────────────────────┘ y = height
 *
 * 关键：整场地形由**一条地表曲线** `groundYAt(x)` 描述 ——
 *   · 左右两侧地表高于水线  → 那部分就是「岸」
 *   · 池心地表低于水线      → 那是「池底」
 *   · 池中央再隆起一块露出水面的台地 → 「晒台」
 * 而「水」= 地表在水线以下的那部分区域。
 *
 * 对外保留旧方法名（bankLineAt / isWater / isBank / constrainToWater …），
 * 语义按新地形重解释，其它模块不用大改：
 *   bankLineAt(x)  = min(水线, 地表) → 池中是水线、岸上是地表（"水面/地面的上边界"）
 *   marshLineAt(x) = groundYAt(x)   → 池中是池底、岸上是地表
 *   isBank(x,y)    = isLand(x,y)    → 站在干地上
 */
import { CONFIG } from './config.js';
import { rand, randInt, clamp, blobShape, blobPath } from './utils.js';
import { WaterWaveField } from './waterwave.js';
import { makePondTextures, tileTexture, tileTextureFaded } from './terrain-tex.js';

const smoothstep = (t) => {
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/** 地形扫描步长（px）：用来找"哪些列是水 / 哪些列是陆" */
const SCAN_STEP = 2;

export class World {
  constructor(width, height) {
    this.tex = null;
    this._texReady = false;
    this._decorReady = false;
    this.w = width; this.h = height;
    this.resize(width, height);

    // 一维水面波场（阶段 8-④）：逐帧求解 1D 波动方程。
    // 侧视剖面下水只有"沿 x 的高度"这一个自由度 —— 波只能水平传播，
    // 物理上不可能出现"以扰动点为中心的同心环"（那是俯视水面的现象）。
    const nat = CONFIG.natural ?? {};
    this.wave = new WaterWaveField(width, height, nat.waveCell ?? 4, {
      damping: nat.waveDamping ?? 0.985,
      ambientGap: nat.waveAmbientGap ?? 0.35,
      ambientStr: nat.waveAmbientStr ?? 0.09,
    });
    // 只有水面列才允许环境微扰（岸上不波动）
    this.wave.ambientFilter = (x) => this.isWaterColumn(x);

    this._buildTerrain();
    this._buildRipples();
  }

  /** 惰性生成程序纹理（首次渲染时调用，避免拖慢构造 / 无 DOM 测试环境降级） */
  _ensureTextures() {
    if (this._texReady) return;
    try {
      this.tex = makePondTextures();
    } catch (e) {
      this.tex = null;
    }
    this._texReady = true;
  }

  // ════════════════════════════════════════════════════════
  //  几 何
  // ════════════════════════════════════════════════════════
  resize(width, height) {
    this.w = width;
    this.h = height;
    const L = CONFIG.layout ?? {};
    const noiseStep = 8;   // 起伏噪声的采样间隔（px）

    // ── 关键高度 ───────────────────────────────────────
    this.waterY = Math.round(height * (L.waterY ?? 0.34));        // 水线
    this.bedY = Math.round(height * (L.bedY ?? 0.82));            // 池底
    this.bankTopY = Math.round(height * (L.bankTopY ?? 0.15));    // 岸顶地表
    // 兜底：水线必须在岸顶之下、池底之上
    this.waterY = clamp(this.waterY, this.bankTopY + 40, height - 60);
    this.bedY = clamp(this.bedY, this.waterY + 50, height - 30);

    // 兼容旧字段
    this.bankY = this.waterY;          // 天空高度（= 水线）
    this.marshY = this.bedY;
    this.waterTop = this.waterY;
    this.waterBottom = this.bedY;
    this.waterHeight = Math.max(1, this.bedY - this.waterY);

    // ── 岸坡控制点（t = 从屏幕边缘算起，占 bankSpan 的比例）──
    // 阶段 6-⑨：从"岸顶→陡岸线→陡池壁"改成"缓台→缓坡入水→浅滩→池壁"，
    // 目的是把**水线上下各留一段缓坡**——龟爬上岸不必翻一道坎，
    // 视觉上也是真实河岸（近岸一大片浅水）。各段比例见 CONFIG.layout.bank。
    const BK = L.bank ?? {};
    const wY = this.waterY, bY = this.bedY;
    const sr = clamp(L.shoreRatio ?? 0.4, 0.12, 0.92);
    this.shoreRatio = sr;
    const minRun = clamp(BK.minRun ?? 2.2, 1, 6);   // 坡的"缓"下限 = 水平跨度 ÷ 落差

    // 岸坡横向跨度：按画面宽给（上限 w×0.46，免得两岸各自铺开把水面挤没）
    this.bankSpan = clamp(Math.max(70, this.w * (L.bankSpan ?? 0.24)), 70, this.w * 0.46);

    // 落差还要服从"缓坡"约束：落差 ≤ 可用水平跨度(sr×bankSpan) ÷ minRun。
    // 竖屏（如 1000×1400）宽度不够摊开一条缓坡时，这里会自动压低岸顶、
    // 让出一点天空 —— 宁可天空多留一点，也不做一道竖直的坎给龟爬。
    const maxDrop = (sr * this.bankSpan) / minRun;
    const drop = Math.min(Math.max(24, wY - this.bankTopY), Math.max(24, maxDrop));
    this.bankTopY = Math.round(wY - drop);

    const tY = this.bankTopY;
    const shelfSpan = clamp(BK.shelfRatio ?? 0.58, 0.2, 0.95) * sr;
    this._bankPts = [
      { t: 0, y: tY },
      { t: shelfSpan, y: tY + (wY - tY) * (BK.shelfDrop ?? 0.15) }, // 岸顶缓台
      { t: sr, y: wY },                                             // 岸线（正好落在水线）
      // ── 水下：先一大段浅滩（缓），再折向池壁 ──
      { t: sr + (1 - sr) * (BK.shoalSpan ?? 0.34), y: wY + (bY - wY) * (BK.shoalDrop ?? 0.13) },
      { t: sr + (1 - sr) * (BK.wallSpan ?? 0.66), y: wY + (bY - wY) * (BK.wallDrop ?? 0.55) },
      { t: 1, y: bY },                                              // 池底
    ];

    // ── 晒台 ──────────────────────────────────────────
    const P = L.platform ?? {};
    const pfOn = P.enabled !== false;
    const halfW = Math.max(24, this.w * (P.width ?? 0.15) / 2);
    this.platform = {
      on: pfOn,
      cx: this.w * (P.x ?? 0.5),
      halfW,
      topY: Math.min(this.waterY - 16, height * (P.topY ?? 0.235)),
    };
    this.platform.on = pfOn && this.platform.topY < this.waterY - 8;

    // ── 起伏噪声（一次生成、反复采样 → 地形稳定不抖动）──
    this._noiseN = Math.ceil(width / noiseStep) + 2;
    this._noise = new Float32Array(this._noiseN);
    this._noise2 = new Float32Array(this._noiseN);
    for (let i = 0; i < this._noiseN; i++) {
      this._noise[i] = Math.random() * 2 - 1;
      this._noise2[i] = Math.random() * 2 - 1;
    }
    this._noiseStep = noiseStep;

    this._scanSpans();

    // 纹理密度依赖尺寸，resize 需重建（构造时会再调一次，幂等）
    if (this._decorReady) this._buildTerrain();
    // 波场网格依赖尺寸
    if (this.wave) this.wave.resize(width, height);
  }

  _noiseAt(x, seed = 0) {
    const arr = seed ? this._noise2 : this._noise;
    const t = clamp(x / this._noiseStep, 0, this._noiseN - 1.001);
    const i = Math.floor(t);
    const f = t - i;
    const a = arr[i], b = arr[Math.min(i + 1, this._noiseN - 1)];
    return a + (b - a) * f;
  }

  /** 岸坡地表：u = 距屏幕边缘的距离 / bankSpan（0 = 边缘，1 = 岸坡末端） */
  _bankProfileY(u) {
    u = clamp(u, 0, 1);
    const pts = this._bankPts;
    let i = 0;
    while (i < pts.length - 2 && u > pts[i + 1].t) i++;
    const a = pts[i], b = pts[i + 1];
    const span = Math.max(1e-6, b.t - a.t);
    const t = clamp((u - a.t) / span, 0, 1);
    return a.y + (b.y - a.y) * smoothstep(t);
  }

  /**
   * 地表高度（整场地形就靠这一条曲线）
   *   · 靠边 → 岸坡（高于水线）
   *   · 中间 → 池底（低于水线）
   *   · 晒台范围内取更"高"的那个面
   */
  groundYAt(x) {
    const bump = CONFIG.layout?.hump ?? 4;
    const n = this._noiseAt(x);
    let y;
    // 阶段 8-⑦：**右岸默认取消**（用户："缓坡多了水的部分就变少了，尽量让水体占更多"）——
    // 只在左侧保留一条供龟上岸的缓坡，水面一路铺到画面右边缘。
    // 想恢复对称右岸：CONFIG.layout.rightBank.enabled = true。
    const rbOn = CONFIG.layout?.rightBank?.enabled === true;
    if (x <= this.bankSpan) {
      y = this._bankProfileY(x / this.bankSpan) + n * bump * 0.5;
    } else if (rbOn && x >= this.w - this.bankSpan) {
      y = this._bankProfileY((this.w - x) / this.bankSpan) + n * bump * 0.5;
    } else {
      y = this.bedY + n * bump;
    }
    const p = this.platform;
    if (p.on) {
      const d = Math.abs(x - p.cx) / p.halfW;
      if (d < 1) {
        // 台面平坦（d<0.58），边缘缓降到池底
        const e = d < 0.58 ? 1 : 1 - smoothstep((d - 0.58) / 0.42);
        const floor = this.bedY + n * bump;
        const py = floor + (p.topY - floor) * e + (e > 0.9 ? n * 1.4 : 0);
        if (py < y) y = py;
      }
    }
    return y;
  }

  /**
   * 水线（略起伏，不是一条死直线）
   *
   * ⚠️ 这里必须和地表用**同一组噪声**（seed 0），不能用独立的一路：
   * 岸线附近两者数值很接近，同相噪声会互相抵消，水陆边界才是干净的一条线。
   * 若各用各的随机起伏，"水缘外侧第一块陆地"会随机地高出水线几十像素
   * —— 岸坡越缓越明显（2026-10-02 阶段 6-⑨ 把坡放缓后踩到：
   * `shorePointNear` 的落点飘到水线上方 48px，`_diag_sideview` 直接抓出来）。
   */
  surfaceAt(x) {
    const amp = (CONFIG.layout?.hump ?? 4) * 0.55;
    return this.waterY + this._noiseAt(x) * amp;
  }

  /** 上边界 = min(水线, 地表)：池中是水线，岸上是地表 */
  bankLineAt(x) { return Math.min(this.surfaceAt(x), this.groundYAt(x)); }

  /** 下边界 = 地表：池中是池底，岸上是地表 */
  marshLineAt(x) { return this.groundYAt(x); }

  /** 扫描出"哪些列是水 / 哪些列是陆"，并算出可站的干地范围 */
  _scanSpans() {
    const spans = [];
    let cur = null;
    const n = Math.floor(this.w / SCAN_STEP);
    for (let i = 0; i <= n; i++) {
      const x = Math.min(this.w, i * SCAN_STEP);
      const isW = this.groundYAt(x) > this.surfaceAt(x) + 2;
      if (isW) {
        if (!cur) cur = { x0: x, x1: x };
        else cur.x1 = x;
      } else if (cur) {
        spans.push(cur); cur = null;
      }
    }
    if (cur) spans.push(cur);
    this.waterSpans = spans.filter((s) => s.x1 - s.x0 >= 10);
    if (!this.waterSpans.length) this.waterSpans = [{ x0: this.w * 0.5 - 1, x1: this.w * 0.5 + 1 }];
    this.waterLeftX = this.waterSpans[0].x0;
    this.waterRightX = this.waterSpans[this.waterSpans.length - 1].x1;

    // 陆地 = 水列的补集；再切出"干地子段"（地表高出水线 dryBand 以上）
    const dryBand = CONFIG.layout?.dryBand ?? 18;
    const zones = [];
    let px = 0;
    for (const s of this.waterSpans) {
      if (s.x0 - px > 8) zones.push({ x0: px, x1: s.x0 });
      px = s.x1;
    }
    if (this.w - px > 8) zones.push({ x0: px, x1: this.w });
    for (const z of zones) {
      let d0 = null, d1 = null;
      for (let x = z.x0; x <= z.x1; x += SCAN_STEP) {
        if (this.surfaceAt(x) - this.groundYAt(x) >= dryBand) {
          if (d0 === null) d0 = x;
          d1 = x;
        }
      }
      if (d0 === null) { d0 = z.x0; d1 = z.x1; }
      z.dx0 = d0; z.dx1 = d1;
      z.mid = (d0 + d1) / 2;
      // 台地 / 岸 的区分（晒台在池中央，左右岸靠边）
      z.kind = (z.dx0 > this.w * 0.25 && z.dx1 < this.w * 0.75) ? 'platform' : 'bank';
    }
    this.landZones = zones;
  }

  /** 某列是否有水 */
  isWaterColumn(x) {
    return this.groundYAt(x) > this.surfaceAt(x) + 2;
  }

  /**
   * 判断点是否在水面可游区域。
   *
   * ⚠️ 上下两个边界的存在理由不一样，别随手改：
   *   · 上边界 `y > s + 3`：为了让**浮在水面的饲料**（落在水线下 ~4px）也算在水里，
   *     否则鱼龟永远吃不到它。代价是"水线以上 3px"成了既不算水也不算陆的空档，
   *     由 `isLand` 的过渡带负责兜住（见下）。
   *   · 下边界本来是 `y < g - 4`（池底上方留 4px），阶段 8-⑧ 收到 `y < g`：
   *     那 4px 同样是空档 —— 龟贴着池底游时会被判成"既不在水也不在岸"
   *     （实测残留 48~128 帧全在 climb_out 的贴底时刻）。水本来就该铺满到池底。
   */
  isWater(x, y) {
    if (x < 0 || x > this.w || y < 0 || y > this.h) return false;
    const s = this.surfaceAt(x);
    const g = this.groundYAt(x);
    if (g <= s + 2) return false;         // 该列地表在水线之上 → 没有水
    return y > s + 3 && y <= g;
  }

  /**
   * 判断点是否"站在干地上"（岸 / 晒台）。
   * 容差 TOL 是为了让龟的"身体中心"（比脚高一点）也算踩在地上。
   *
   * ⚠️ 阶段 8-⑧ 补上水陆之间的过渡带：
   * 水列的判据是"y 比水线深 3px 以上才算水"（`isWater` 留这 3px 是为了让浮在
   * 水面的饲料也算在水里）。于是水线上下那几像素**既不算水也不算陆** ——
   * 而龟在上岸 / 回水途中（climb_out / return）身体中心必然扫过这段，
   * 就会被判成"既不在水也不在岸"（实测：跑 2 分钟有 1616 帧卡在这个空档里）。
   * 现在把"贴着水线以上一个身位内"归到陆地，与 `isWater` 无缝衔接。
   */
  isLand(x, y) {
    const g = this.groundYAt(x);
    const s = this.surfaceAt(x);
    // 分支判据与 isLandColumn 完全一致（isWaterColumn）—— 否则列判定与点判定
    // 会在水线附近差出几像素，又是一条新的空档。
    if (this.isWaterColumn(x)) {
      // 水列：只认"贴着水线上方"的这一条过渡带；再往上是空气，不算地面
      return y >= s - 30 && y <= s + 4;
    }
    const TOL = 28;
    return y >= g - TOL && y <= g + 26;
  }

  /** 旧名兼容：岸边 = 干地 */
  isBank(x, y) { return this.isLand(x, y); }

  /** 是否在池底的淤泥里（地表之下） */
  isMarsh(x, y) { return y >= this.groundYAt(x) - 4; }

  /** 把点约束到水面区域内（返回的点保证仍落在 isWater 范围内） */
  constrainToWater(x, y, margin = 8) {
    const m = Math.max(8, margin);
    let cx = clamp(x, m, this.w - m);
    // ① 找最近的水域横向区段
    let span = this.waterSpans[0];
    let bd = Infinity;
    for (const s of this.waterSpans) {
      const lo = s.x0 + m, hi = s.x1 - m;
      if (hi <= lo) continue;
      const d = cx < lo ? lo - cx : cx > hi ? cx - hi : 0;
      if (d < bd) { bd = d; span = s; }
    }
    cx = clamp(cx, span.x0 + m, Math.max(span.x0 + m, span.x1 - m));

    // ② 靠岸的水太薄（放不下 margin）→ 往池心挪，直到这一列的水够厚
    const need = m * 2 + 10;
    const mid = (span.x0 + span.x1) / 2;
    const dir = cx < mid ? 1 : -1;
    let guard = 0;
    while (guard++ < 80 && this.groundYAt(cx) - this.surfaceAt(cx) < need) {
      const nx = cx + dir * 8;
      if (nx <= span.x0 || nx >= span.x1) break;
      cx = nx;
    }
    cx = clamp(cx, 1, this.w - 1);

    const top = this.surfaceAt(cx) + m;
    const bot = this.groundYAt(cx) - Math.max(6, m * 0.6);
    let cy = clamp(y, top, Math.max(top, bot));
    // ③ 兜底：真出现"水太薄"的极端情况，也别吐出一个不在水里的点
    if (!(this.groundYAt(cx) - this.surfaceAt(cx) > 12)) {
      cx = clamp(mid, 1, this.w - 1);
      const t2 = this.surfaceAt(cx) + 8;
      const b2 = this.groundYAt(cx) - 6;
      cy = clamp(cy, t2, Math.max(t2, b2));
    }
    return { x: cx, y: cy };
  }

  /**
   * 最近的水体墙面（阶段 8-③）
   *
   * 侧视剖面下，"墙"其实只有两种：
   *   ① **水面** —— 法线朝下，把生物往水里推；
   *   ② **地表曲线** —— 池底 / 岸坡 / 晒台顶 / 晒台侧壁**本来就是同一条 `groundYAt`**，
   *      区别只在局部坡度（平的是池底，陡的是岸坡与晒台侧壁）。
   * 所以只要给出"向外法线 + 穿透深度"，生物就能做沿墙滑行。
   *
   * ⚠ 坡度用 **±3px 滑动窗口**估：地形自带 `hump*0.5 = ±2px` 的起伏噪声，
   *   相邻两点差分算出的法线会随机乱抖（同"量坡度必须用滑动窗口"那条教训）。
   *
   * @param {number} x,y 生物位置
   * @param {number} margin 身体半径（穿透按身体边缘算）
   * @returns {{hit:boolean, nx:number, ny:number, depth:number, kind:string}}
   *          `kind`: 'surface' | 'wall'（陡坡/晒台侧壁）| 'ground'（缓坡/池底）| 'none'
   */
  wallInfo(x, y, margin = 8) {
    let depth = 0, nx = 0, ny = 0, kind = 'none';
    const take = (d, ax, ay, k) => {
      if (d > depth) { depth = d; nx = ax; ny = ay; kind = k; }
    };

    // ① 水面：法线朝下
    const dTop = (this.surfaceAt(x) + margin) - y;
    if (dTop > 0) take(dTop, 0, 1, 'surface');

    // ② 地表曲线：**穿透 = 身体半径 − 到地表的垂直距离**（注意方向：
    //    生物在水里，y 比 g(x) 小，`(g - y)` 是"离地还有多远"，
    //    远大于 margin 时说明它好端端地待在水里，不该算碰墙）
    const g = this.groundYAt(x);
    const slope = (this.groundYAt(x + 3) - this.groundYAt(x - 3)) / 6;
    const inv = 1 / Math.hypot(1, slope);
    const dG = margin - (g - y) * inv;
    if (dG > 0) take(dG, slope * inv, -inv, Math.abs(slope) > 0.6 ? 'wall' : 'ground');

    return { hit: depth > 0, nx, ny, depth, kind };
  }

  /**
   * 墙体响应（阶段 8-③）—— 在水里撞墙时"**沿墙滑行**"，而不是"贴墙下滑 / 撞一下掉头"。
   *
   * 旧做法（fish.js）：`constrainToWater` 硬钳制位置 + `vx/vy *= -0.5` 整体反向。
   * 因为钳制是轴对齐的，沿斜岸时表现为"贴着墙往下滑"，正面则是"撞一下掉头"。
   *
   * 现在分三层：
   *   ① **真反射**：只把**法向**速度按恢复系数 e 反向，切向速度**全保留**
   *      （v' = v − (1+e)·(v·n)·n；e = 0.32 → 保留约 68% 切向速度）
   *   ② **软避让**：进入 margin 内就沿法线加力，穿透越深越强（Boids 式墙避让）
   *   ③ **角落脱困**：法向仍在往里钻、切向几乎不动 → 沿墙切向给一记随机助推（带冷却）
   *
   * ⚠ **只有 SWIM / SEEK_FOOD 可以调用**。CLIMB_OUT / BASK / RETURN 是
   *   "故意穿越水陆边界"的状态机，给它们加墙约束会让整段 climb_out 卡死（历史踩坑）。
   *
   * @param {{x:number,y:number,vx:number,vy:number}} body 会被就地修改 vx/vy
   * @param {number} margin 身体半径
   * @param {{bounce?:number, push?:number, dt?:number, unstick?:number, stuckAfter?:number}} [opts]
   * @returns {{hit:boolean,nx:number,ny:number,depth:number,kind:string}} 供调用方处理竖直维度
   */
  wallResponse(body, margin = 10, opts = {}) {
    const info = this.wallInfo(body.x, body.y, margin);
    if (!info.hit) { body._wallStuckT = 0; return info; }

    const dt = opts.dt ?? 1 / 60;
    const e = opts.bounce ?? CONFIG.natural?.wallBounce ?? 0.32;
    const push = opts.push ?? CONFIG.natural?.wallPush ?? 90;

    // ① 真反射（只反法向）
    const vn = body.vx * info.nx + body.vy * info.ny;
    if (vn < 0) {
      body.vx -= (1 + e) * vn * info.nx;
      body.vy -= (1 + e) * vn * info.ny;
    }

    // ② 软避让
    const k = Math.min(1, info.depth / Math.max(1, margin)) * push * dt;
    body.vx += info.nx * k;
    body.vy += info.ny * k;

    // ③ 角落脱困
    const vn2 = body.vx * info.nx + body.vy * info.ny;
    const vt = Math.max(0, Math.hypot(body.vx, body.vy) - Math.abs(vn2));
    if (vn2 < -1 && vt < 4) {
      body._wallStuckT = (body._wallStuckT ?? 0) + dt;
      if (body._wallStuckT > (opts.stuckAfter ?? 0.6)) {
        body._wallStuckT = 0;
        const dir = Math.random() < 0.5 ? 1 : -1;
        const s = opts.unstick ?? 34;
        body.vx += -info.ny * dir * s;      // 切向 = (-ny, nx)
        body.vy += info.nx * dir * s;
      }
    } else {
      body._wallStuckT = 0;
    }
    return info;
  }

  /**
   * 该列是不是陆地（地表露出水面）。
   * 必须是 isWaterColumn 的严格补集：否则水陆之间会留出一条"既不算水也不算陆"
   * 的窄过渡带，龟游到水缘就卡在里面出不来（2026-10-02 修复）。
   */
  isLandColumn(x) { return !this.isWaterColumn(x); }

  /** 最近一段岸线的点（龟上岸时先游到这儿）——必须落在真正的陆地列上 */
  shorePointNear(x) {
    let bestX = null, bd = Infinity, dir = -1;
    for (const s of this.waterSpans) {
      // 左缘 x0：外侧（陆地）在左 → dir=-1；右缘 x1：外侧在右 → dir=+1
      for (const e of [{ x: s.x0, d: -1 }, { x: s.x1, d: 1 }]) {
        // ⚠️ 阶段 8-⑦ 取消右岸后，水域一路铺到画面右缘，那里的 x1 外侧是**屏幕边界**
        //    而不是陆地 —— 龟游过去只会撞墙。所以先探一下外侧有没有岸，没有就跳过这个岸缘。
        const probe = clamp(e.x + e.d * 3, 1, this.w - 1);
        if (!this.isLandColumn(probe)) continue;
        const d = Math.abs(x - e.x);
        if (d < bd) { bd = d; bestX = e.x; dir = e.d; }
      }
    }
    if (bestX === null) {
      // 极端情况：整片水面两侧都顶到屏幕边缘，一个岸都没有 → 退回水域中心，
      // 别返回一个越界的假岸点让龟朝着屏幕外撞。
      const s0 = this.waterSpans[0];
      const cx = (s0.x0 + s0.x1) * 0.5;
      return { x: cx, y: this.surfaceAt(cx) + 8 };
    }
    // 水缘可能落在水陆过渡带上 → 向外一步步挪到真正的陆列，龟才踩得上去
    let sx = bestX;
    let guard = 0;
    while (guard++ < 60 && sx > 1 && sx < this.w - 1 && !this.isLandColumn(sx)) sx += dir * 2;
    sx = clamp(sx, 2, this.w - 2);
    let sy = this.surfaceAt(sx) + 8;
    if (this.isLandColumn(sx) || this.isLand(sx, sy)) {
      // 登岸点必须**贴在水线附近**：晒台侧壁 / 陡岸那种近乎垂直的边缘，
      // 水缘外侧两像素处地表就已经高出水线几十像素（阶段 6-⑨ 实测 1000×1400
      // 下飘到 43px），不夹住的话龟会从水里"瞬移"到台顶。
      const cap = CONFIG.layout?.shoreMaxRise ?? 22;
      const surf = this.surfaceAt(sx);
      sy = clamp(this.groundYAt(sx), surf - cap, surf + cap);
    }
    return { x: sx, y: sy };
  }

  /** 最近的"入水点"（在岸上想回水里时用）：水域边缘稍往里 */
  waterEntryNear(x) {
    let bestX = this.w * 0.5, bd = Infinity;
    for (const s of this.waterSpans) {
      const cands = [
        { e: s.x0, inner: s.x0 + Math.max(14, (s.x1 - s.x0) * 0.12) },
        { e: s.x1, inner: s.x1 - Math.max(14, (s.x1 - s.x0) * 0.12) },
      ];
      for (const c of cands) {
        const d = Math.abs(x - c.e);
        if (d < bd) { bd = d; bestX = c.inner; }
      }
    }
    const wxp = clamp(bestX, 2, this.w - 2);
    return { x: wxp, y: this.surfaceAt(wxp) + 20 };
  }

  /**
   * 挑一个岸上落点（龟晒背 / 产蛋 / 上岸爬行用）
   * @param {number} x 参考位置（离谁近优先）
   * @param {boolean} [preferNear=true] true = 就近；false = 全局随机（换岸玩）
   */
  /** 某块陆地所属的 zone（x 落在 [x0, x1] 内）*/
  landZoneAt(x) {
    for (const z of this.landZones) if (x >= z.x0 && x <= z.x1) return z;
    return null;
  }

  /** 在指定的某块陆地（岸/晒台）里随机取一个落点 */
  pickLandSpotInZone(z) {
    if (!z) return null;
    const pad = Math.min(14, (z.dx1 - z.dx0) * 0.3);
    const tx = rand(z.dx0 + pad, Math.max(z.dx0 + pad + 1, z.dx1 - pad));
    return { x: tx, y: this.groundYAt(tx), zone: z };
  }

  pickLandSpot(x, preferNear = true) {
    const zones = this.landZones;
    if (!zones.length) return null;
    let z;
    if (preferNear) {
      let bd = Infinity; z = zones[0];
      for (const c of zones) {
        const d = Math.abs(c.mid - x);
        if (d < bd) { bd = d; z = c; }
      }
    } else {
      z = zones[Math.floor(Math.random() * zones.length)];
    }
    return this.pickLandSpotInZone(z);
  }

  /** 某个 x 是否在干地上（不含容差），摆放装饰时用 */
  isDryColumn(x) {
    return this.surfaceAt(x) - this.groundYAt(x) >= (CONFIG.layout?.dryBand ?? 18);
  }

  /** 把 x 吸附到最近的干地（小灯/岸边小物件用） */
  landX(x) {
    if (this.isDryColumn(x)) return x;
    const zones = this.landZones;
    if (!zones.length) return x;
    let best = zones[0], bd = Infinity;
    for (const z of zones) {
      const lo = z.dx0, hi = z.dx1;
      const d = x < lo ? lo - x : x > hi ? x - hi : 0;
      if (d < bd) { bd = d; best = z; }
    }
    return clamp(x, best.dx0, Math.max(best.dx0, best.dx1));
  }

  /** 把 x 吸附到水面里（倒影之类的水面物件用） */
  nearWaterX(x) {
    const m = 6;
    let cx = clamp(x, m, this.w - m);
    let span = this.waterSpans[0], bd = Infinity;
    for (const s of this.waterSpans) {
      const lo = s.x0 + m, hi = s.x1 - m;
      if (hi <= lo) continue;
      const d = cx < lo ? lo - cx : cx > hi ? cx - hi : 0;
      if (d < bd) { bd = d; span = s; }
    }
    return clamp(cx, span.x0 + m, Math.max(span.x0 + m, span.x1 - m));
  }

  // ════════════════════════════════════════════════════════
  //  装 饰 物（草/石/卵石/气泡/淤泥…）
  // ════════════════════════════════════════════════════════
  _buildTerrain() {
    this._decorReady = true;

    // ── 岸顶草丛：成簇分布在干地上 ────────────────────
    this.grassTufts = [];
    const zones = this.landZones;
    const perZone = Math.max(10, Math.round(this.w / 150));
    for (const z of zones) {
      const w = Math.max(20, z.dx1 - z.dx0);
      const clumps = Math.max(4, Math.round(perZone * (w / this.w) * 3));
      for (let c = 0; c < clumps; c++) {
        const cx = rand(z.dx0, z.dx1);
        const cy = this.groundYAt(cx) - rand(0, 4);
        const blades = Math.round(rand(3, 6));
        const baseHue = rand(74, 106);
        for (let b = 0; b < blades; b++) {
          this.grassTufts.push({
            x: cx + rand(-7, 7),
            y: cy - rand(0, 3),
            h: rand(7, 24),
            lean: rand(-4.5, 4.5),
            hue: baseHue + rand(-6, 6),
            sat: rand(30, 52),
            lig: rand(24, 44),
            w: rand(1.1, 2.2),
            phase: rand(0, Math.PI * 2),
          });
        }
      }
    }

    // ── 岸顶石头 ──────────────────────────────────────
    this.rocks = [];
    const rockN = Math.max(8, Math.round(this.w / 190));
    for (let i = 0; i < rockN; i++) {
      const z = zones.length ? zones[i % zones.length] : { dx0: 0, dx1: this.w };
      const x = rand(z.dx0, z.dx1);
      const r = rand(4, 13);
      this.rocks.push({
        x,
        y: this.groundYAt(x) - rand(0, r * 0.5),
        r,
        rot: rand(0, Math.PI),
        shade: rand(0.62, 0.95),
        warm: rand(0.85, 1.12),
        pts: this._rockOutline(r),
      });
    }

    // ── 岸顶细碎卵石 ──────────────────────────────────
    this.pebbles = [];
    const pebN = Math.max(20, Math.round(this.w / 55));
    for (let i = 0; i < pebN; i++) {
      const z = zones.length ? zones[i % zones.length] : { dx0: 0, dx1: this.w };
      const x = rand(z.dx0, z.dx1);
      this.pebbles.push({
        x,
        y: this.groundYAt(x) - rand(-1, 10),
        r: rand(0.8, 2.6),
        rot: rand(0, Math.PI),
        lig: rand(0.72, 1.15),
        ...this._blobParams(2, 0.12, 0.30),
      });
    }

    // ── 岸顶沙粒噪点 ──────────────────────────────────
    this.sandGrain = [];
    const grainN = Math.round((this.w * this.bankSpan) / 420);
    for (let i = 0; i < grainN; i++) {
      const z = zones.length ? zones[i % zones.length] : { dx0: 0, dx1: this.w };
      const x = rand(z.dx0, z.dx1);
      this.sandGrain.push({
        x,
        y: this.groundYAt(x) - rand(-2, 26),
        r: rand(0.4, 1.3),
        dark: Math.random() < 0.55,
        a: rand(0.05, 0.18),
      });
    }

    // ── 断面上的石头（岸体切面上嵌着的石块）────────────
    this.bankStones = [];
    const stoneN = Math.max(6, Math.round(this.w / 260));
    for (let i = 0; i < stoneN; i++) {
      const left = i % 2 === 0;
      const x = left ? rand(2, this.waterLeftX * 0.9) : rand(this.w - this.waterLeftX * 0.9, this.w - 2);
      const g = this.groundYAt(x);
      this.bankStones.push({
        x,
        y: rand(g + 18, this.h - 10),
        rx: rand(7, 20),
        ry: rand(4, 11),
        ...this._blobParams(2, 0.10, 0.26),
        shade: rand(0.72, 1.05),
      });
    }

    // ── 池底气泡 ──────────────────────────────────────
    this.bubbles = [];
    const bubN = Math.max(14, Math.round(this.w / 90));
    for (let i = 0; i < bubN; i++) {
      const s = this.waterSpans[i % this.waterSpans.length];
      const x = rand(s.x0 + 6, Math.max(s.x0 + 7, s.x1 - 6));
      const floor = this.groundYAt(x);
      const big = Math.random() < 0.4;
      this.bubbles.push({
        x,
        y: rand(floor - 6, floor - (big ? 30 : 10)),
        r: big ? rand(2.6, 5.4) : rand(1.0, 2.4),
        phase: rand(0, Math.PI * 2),
        speed: big ? rand(0.28, 0.6) : rand(0.6, 1.4),
        rise: big ? rand(3, 8) : 0,
        drift: rand(-3, 3),
        ...this._blobParams(2, 0.10, 0.24),
      });
    }

    // ── 水底沉积颗粒 ──────────────────────────────────
    this.silt = [];
    const siltN = Math.round((this.w * this.waterHeight) / 1400);
    for (let i = 0; i < siltN; i++) {
      const s = this.waterSpans[i % this.waterSpans.length];
      const x = rand(s.x0 + 4, Math.max(s.x0 + 5, s.x1 - 4));
      const floor = this.groundYAt(x);
      this.silt.push({
        x,
        y: rand(floor - 34, floor - 4),
        r: rand(0.5, 2.0),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.1, 0.35),
        drift: rand(1.5, 5),
      });
    }

    // ── 水底零星螺壳 / 枯枝剪影 ───────────────────────
    this.bottomDebris = [];
    const debN = Math.max(6, Math.round(this.w / 260));
    for (let i = 0; i < debN; i++) {
      const s = this.waterSpans[i % this.waterSpans.length];
      const x = rand(s.x0 + 6, Math.max(s.x0 + 7, s.x1 - 6));
      this.bottomDebris.push({
        x,
        y: this.groundYAt(x) - rand(2, 8),
        r: rand(3, 9),
        rot: rand(-0.5, 0.5),
        twig: Math.random() < 0.5,
      });
    }

    // ── 淤泥团 / 泥线小丘（贴池底）────────────────────
    this.mudClumps = [];
    this.mudEdges = [];
    for (const s of this.waterSpans) {
      const span = s.x1 - s.x0;
      const n1 = Math.max(6, Math.round(span / 60));
      for (let i = 0; i < n1; i++) {
        const x = rand(s.x0, s.x1);
        this.mudClumps.push({
          x,
          y: this.groundYAt(x) - rand(1, 10),
          rx: rand(6, 26),
          ry: rand(2.5, 9),
          ...this._blobParams(3, 0.10, 0.30),
          alpha: rand(0.08, 0.22),
          dark: Math.random() < 0.6,
        });
      }
      const n2 = Math.max(5, Math.round(span / 110));
      for (let i = 0; i < n2; i++) {
        const x = rand(s.x0, s.x1);
        this.mudEdges.push({
          x,
          y: this.groundYAt(x) - rand(-1, 3),
          rx: rand(5, 15),
          ry: rand(2.5, 7),
          ...this._blobParams(2, 0.12, 0.30),
        });
      }
    }
  }

  /** 生成一组不规则轮廓参数（blobPath 用） */
  _blobParams(count = 2, ampLo = 0.10, ampHi = 0.28) {
    const shp = blobShape(Math.random, count, ampLo, ampHi);
    return { amps: shp.amps, phases: shp.phases, rot: rand(0, Math.PI * 2) };
  }

  /** 生成石头的不规则轮廓（归一化多边形，半径扰动） */
  _rockOutline(r) {
    const n = 7;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const rr = r * rand(0.72, 1.12);
      pts.push({ a: ang, r: rr });
    }
    return pts;
  }

  _buildRipples() {
    this.ripples = [];    // 入水溅射（阶段 8-④ 起是"水花 + 短横痕"，不再是同心环）
    this.footprints = []; // 岸上爬行脚印（阶段 5-⑭）
    this.wakeTrails = []; // 拖尾痕迹（阶段 8-④）：鼠标划过 / 生物游动身后留下的痕
    this.stirBits = [];   // 水下搅动粒子（阶段 8-④）：鼠标在深水推水翻起的泥沙与气泡
    // 环境上升气泡（阶段 8-⑨）：池底偶发冒一串，升到水面"啵"一声破掉
    this.ambBubbles = [];
    this._ambBubT = 1 + Math.random() * 2;
  }

  // ════════════════════════════════════════════════════════
  //  脚 印
  // ════════════════════════════════════════════════════════
  /**
   * 岸上爬行脚印（阶段 5-⑭；8-⑧ 起按侧视存几何）。
   * @param {number} x,y 落点
   * @param {number} angle 行进方向（rad，屏幕坐标）
   * @param {number} size 乌龟体型（决定脚印大小）
   * @param {number} side 左右侧（-1/1）
   */
  addFootprint(x, y, angle, size, side = 1) {
    if (!this.isLand(x, y)) return;
    // 靠水线近的算"湿印"，颜色更深
    const wet = this.surfaceAt(x) - this.groundYAt(x) < 30;
    // 阶段 8-⑧：脚印是画在**地表**上的痕迹，所以倾斜角取**地形坡度**
    // （旧版直接 rotate(angle) 是俯视语义 —— 朝右走时脚印整体转了 90°，
    //  看着像一列歪着插进土里的爪子）。顺便记下水平行进方向，
    // 侧视图里"往左走 / 往右走"决定坑口那撮堆土偏哪一边。
    const slope = (this.groundYAt(x + 4) - this.groundYAt(x - 4)) / 8;
    this.footprints.push({
      x, y, angle, side,
      rot: Math.atan(slope),
      dir: Math.cos(angle) >= 0 ? 1 : -1,
      size: clamp(size * 0.38, 3.6, 11),
      wet,
      life: 1,                       // 1 → 0 淡出
      decay: wet ? 0.055 : 0.032,
    });
    if (this.footprints.length > 90) this.footprints.shift();
  }

  _updateFootprints(dt) {
    for (let i = this.footprints.length - 1; i >= 0; i--) {
      const f = this.footprints[i];
      f.life -= f.decay * dt;
      if (f.life <= 0) this.footprints.splice(i, 1);
    }
  }

  /**
   * 画脚印（阶段 5-⑭；8-⑧ 由"俯视爪印"改成"侧视踩痕"）
   *
   * 旧画法 = 旋转的椭圆形脚掌 + 三个脚趾圆 + 一道弧，是**从上往下看**的爪印。
   * 场景改成侧视剖面后它就不成立了：从侧面看土地，看不到脚掌形状和脚趾，
   * 能看到的只有"地表被踩出一串浅浅的凹坑"。所以现在只画三样东西：
   *   ① 踩实的暗色凹痕（横向拉长、纵向压得很薄 —— 宽高比 ≈ 4:1）
   *   ② 后缘被脚带起来的一小撮土（侧视才有的"推土"感）
   *   ③ 坑口的浅色高光边（凹坑下沿的亮边）
   * 整体顺着地形坡度躺下（`rot`），而不是顺着俯视行进方向转。
   */
  _drawFootprints(ctx) {
    if (!this.footprints.length) return;
    ctx.save();
    for (const f of this.footprints) {
      const a = f.life * (f.wet ? 0.5 : 0.4);
      if (a <= 0.01) continue;
      const s = f.size * (0.6 + f.life * 0.4);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot ?? 0);           // 顺着坡面躺下

      // ① 踩实的暗色凹痕
      ctx.globalAlpha = a;
      ctx.fillStyle = f.wet ? '#2b2820' : '#423c2c';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.25, s * 0.30, 0, 0, Math.PI * 2);
      ctx.fill();

      // ② 后缘堆起的一小撮土
      ctx.globalAlpha = a * 0.5;
      ctx.fillStyle = f.wet ? '#6d6248' : '#8f8360';
      ctx.beginPath();
      ctx.ellipse(-(f.dir ?? 1) * s * 0.75, -s * 0.16, s * 0.6, s * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();

      // ③ 坑口的浅色高光边
      ctx.globalAlpha = a * 0.42;
      ctx.strokeStyle = f.wet ? '#9a8d6c' : '#c0b188';
      ctx.lineWidth = Math.max(0.7, s * 0.10);
      ctx.beginPath();
      ctx.ellipse(0, s * 0.14, s * 1.15, s * 0.26, 0, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.stroke();

      ctx.restore();
    }
    ctx.restore();
  }

  // ════════════════════════════════════════════════════════
  //  水 面 扰 动
  // ════════════════════════════════════════════════════════
  addRipple(x, y, strength = 1) {
    if (this.wave) this.wave.disturb(x, y, strength * 1.2, 2 + Math.round(strength));
    this.ripples.push({
      x, y,
      r: 2,
      maxR: 20 * strength,
      alpha: 0.40 * strength,
      speed: 40,
    });
    if (this.ripples.length > 24) this.ripples.shift();
  }

  /**
   * 鼠标尾迹 —— 沿移动线段连续扰动波场，并留下一条拖尾痕迹。
   *
   * 阶段 8-④ 起**按深度分层**：
   *   · 光标在水线附近（±`wakeBand`）→ 这是"在水面上拖拽"：真的扰动水面 + 留拖尾痕；
   *   · 光标在更深处 → 交给 `addUnderwaterStir`（翻泥沙气泡，几乎不碰水面）。
   * 旧版对水里任何位置都无条件扰动，于是"池底游的鱼也在水面荡出环"。
   */
  addWake(x0, y0, x1, y1, speed = 0) {
    if (!this.wave) return;
    const nat = CONFIG.natural ?? {};
    if (nat.wake === false) return;
    const k = nat.waveCursorStr ?? 0.55;
    const s = clamp(k * (0.4 + speed / 1400), k * 0.4, k * 1.6);
    const rad = nat.waveCursorRadius ?? 1;
    if (!this.isWater(x1, y1)) return;

    // 离水线太远 → 算水下，改走搅动（不在水面留痕）。
    // 阶段 8-⑨：由"事件点爆一坨"改成分段撒粒子 —— 拖拽轨迹沿线连续，
    // 且粒子带上拖动方向的初速（真的是"被推开的水"），观感帧率随渲染帧走。
    const band = nat.wakeBand ?? 34;
    if (Math.abs(y1 - this.surfaceAt(x1)) > band) {
      this.addUnderwaterStirLine(x0, y0, x1, y1, speed);
      return;
    }

    this.wave.disturbLine(x0, y0, x1, y1, s, rad);
    this._pushWake(x0, x1, s, false);
  }

  /**
   * 拖尾痕迹入列 —— 一条 [x0, x1] 的水平痕，随时间**往后拉长、变淡**。
   * 拖拽感就来自这里：痕迹留在身后，而不是从一点向四周扩散。
   * @param {number} x0,x1 痕迹两端（像素）
   * @param {number} str 初始强度
   * @param {boolean} creature 生物留下的（更宽更缓）；false = 鼠标
   * @param {number} [depth] 离水线深度（px，>0 在水面下）；越深越淡
   */
  _pushWake(x0, x1, str, creature, depth = 0) {
    const nat = CONFIG.natural ?? {};
    if (nat.wake === false) return;
    let a = x0, b = x1;
    if (b < a) { const t = a; a = b; b = t; }
    if (b - a < 1.5) return;                       // 太短不留痕
    const maxLife = creature ? (nat.wakeLife ?? 2.4) : (nat.wakeLifeCursor ?? 1.5);
    this.wakeTrails.push({
      x0: a, x1: b,
      // 移动方向：痕迹向"身后"拉长（正在向右走 → 左端继续向左长）
      dir: x1 >= x0 ? 1 : -1,
      str, depth, creature,
      life: maxLife, maxLife,
    });
    const cap = nat.wakeCap ?? 90;
    if (this.wakeTrails.length > cap) {
      this.wakeTrails.splice(0, this.wakeTrails.length - cap);
    }
  }

  _updateWakes(dt) {
    if (!this.wakeTrails.length) return;
    const grow = CONFIG.natural?.wakeGrow ?? 11;
    for (let i = this.wakeTrails.length - 1; i >= 0; i--) {
      const w = this.wakeTrails[i];
      w.life -= dt;
      if (w.life <= 0) { this.wakeTrails.splice(i, 1); continue; }
      const d = grow * dt;
      if (w.dir > 0) w.x0 -= d; else w.x1 += d;    // 向后拉长
      w.str *= 0.995;
    }
  }

  /**
   * 水下搅动（阶段 8-④ 新增交互）—— 鼠标在深水推水：翻起泥沙与气泡，
   * 水面只被"轻轻拱一下"（真实搅动多少会带一点水面扰动，但绝不成环）。
   * 粒子放独立的 `stirBits`，不去污染常驻的 bubbles/silt 装饰。
   */
  addUnderwaterStir(x, y, strength = 1) {
    const nat = CONFIG.natural ?? {};
    if (nat.wake === false || nat.underwaterStir === false) return;
    if (!this.isWater(x, y)) return;
    const k = (nat.stirStrength ?? 1) * clamp(strength, 0.2, 2);

    const bn = 1 + Math.round(k * 2);
    for (let i = 0; i < bn; i++) {
      const life = rand(0.9, 1.8);
      this.stirBits.push({
        kind: 'bubble',
        x: x + rand(-8, 8), y: y + rand(-5, 5),
        vx: rand(-16, 16), vy: -rand(18, 46) * (0.6 + k * 0.5),
        r: rand(0.9, 2.6), life, maxLife: life, seed: rand(0, 6.28),
      });
    }
    const sn = 2 + Math.round(k * 3);
    for (let i = 0; i < sn; i++) {
      const life = rand(0.7, 1.5);
      this.stirBits.push({
        kind: 'silt',
        x: x + rand(-14, 14), y: y + rand(-4, 14),
        vx: rand(-26, 26), vy: -rand(6, 20),
        r: rand(0.7, 2.2), life, maxLife: life, seed: rand(0, 6.28),
      });
    }
    this._capStirBits();

    // 水面影响极弱（指数随深度衰减）
    if (this.wave) {
      const d = Math.max(0, this.surfaceAt(x) - y);
      this.wave.disturb(x, 0, k * 0.06 * Math.exp(-d / 90), 3);
    }
  }

  /**
   * 分段水下搅动（阶段 8-⑨）—— 供**渲染帧驱动**的鼠标拖拽调用。
   *
   * 与 `addUnderwaterStir`（定点爆一坨）的区别：
   *   · 粒子沿 [p0 → p1] 线段均匀撒开 —— 拖得越长，痕迹越长，不会断成一粒粒；
   *   · 粒子初速带**拖动方向**的分量（速度越快推得越猛）—— 读起来是"手在推水"，
   *     而不是"原地冒泡"；
   *   · 每帧数量有上限，快拖也不会一帧塞爆粒子池。
   */
  addUnderwaterStirLine(x0, y0, x1, y1, speed = 0) {
    const nat = CONFIG.natural ?? {};
    if (nat.wake === false || nat.underwaterStir === false) return;
    if (!this.isWater(x1, y1)) return;
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 0.5) return;
    const k = (nat.stirStrength ?? 1) * clamp(0.4 + speed / 900, 0.4, 1.8);
    const dirx = (x1 - x0) / dist, diry = (y1 - y0) / dist;
    const push = clamp(speed * 0.07, 6, 85);      // 拖拽带起的水流初速（px/s）
    const ux = this.isWater(x0, y0) ? x0 : x1;    // 起点落在岸上就从终点开始撒
    const uy = this.isWater(x0, y0) ? y0 : y1;

    const bn = Math.min(5, Math.max(1, Math.round((dist / 16) * k)));
    for (let i = 0; i < bn; i++) {
      const t = Math.random();
      const life = rand(0.9, 1.8);
      this.stirBits.push({
        kind: 'bubble',
        x: ux + (x1 - ux) * t + rand(-6, 6), y: uy + (y1 - uy) * t + rand(-4, 4),
        vx: dirx * push * rand(0.3, 0.9) + rand(-12, 12),
        vy: diry * push * rand(0.3, 0.9) - rand(16, 42),
        r: rand(0.9, 2.6), life, maxLife: life, seed: rand(0, 6.28),
      });
    }
    const sn = Math.min(7, Math.max(1, Math.round((dist / 11) * k)));
    for (let i = 0; i < sn; i++) {
      const t = Math.random();
      const life = rand(0.7, 1.5);
      this.stirBits.push({
        kind: 'silt',
        x: ux + (x1 - ux) * t + rand(-10, 10), y: uy + (y1 - uy) * t + rand(-3, 10),
        vx: dirx * push * rand(0.4, 1.1) + rand(-20, 20),
        vy: diry * push * rand(0.4, 1.1) - rand(6, 22),
        r: rand(0.7, 2.2), life, maxLife: life, seed: rand(0, 6.28),
      });
    }
    this._capStirBits();

    // 水面影响极弱（指数随深度衰减）
    if (this.wave) {
      const d = Math.max(0, this.surfaceAt(x1) - y1);
      this.wave.disturb(x1, 0, k * 0.06 * Math.exp(-d / 90), 3);
    }
  }

  /** stirBits 粒子池上限（阶段 8-⑨：尾流也走这里，帽子放宽一点） */
  _capStirBits() {
    const cap = CONFIG.natural?.stirCap ?? 320;
    if (this.stirBits.length > cap) {
      this.stirBits.splice(0, this.stirBits.length - cap);
    }
  }

  /**
   * 游动尾流（阶段 8-⑨）—— 鱼 / 龟在水中游过时，身后留下**看得见的水流**：
   *   · 一条向后飘散的短流痕（kind 'flow'：直线拉出、快速淡去）；
   *   · 偶尔卷起一两粒小气泡（尾鳍/划水把空气卷进水里）。
   * 由 main 侧按"每只生物自己的速度 × 累积器"逐帧调用，速度越快撒得越密。
   * @param {number} x,y 生物当前位置
   * @param {number} vx,vy 生物速度
   * @param {number} size 生物体型（px）
   * @param {'fish'|'turtle'} [kind] 龟更大更宽、气泡更多
   */
  addSwimTrail(x, y, vx, vy, size, kind = 'fish') {
    const nat = CONFIG.natural ?? {};
    if (nat.enabled === false || nat.swimTrail === false) return;
    if (!this.isWater(x, y)) return;
    const sp = Math.hypot(vx, vy);
    if (sp < 6) return;
    const isT = kind === 'turtle';
    const ux = vx / sp, uy = vy / sp;
    const body = isT ? size * 0.6 : size * 0.55;

    // ① 流痕：贴在身后一点，沿行进方向的反向拉出一条淡亮水痕
    const life = rand(0.4, 0.75);
    this.stirBits.push({
      kind: 'flow',
      x: x - ux * body * rand(0.4, 0.9) + rand(-2, 2),
      y: y - uy * body * rand(0.4, 0.9) + rand(-3, 3),
      ang: Math.atan2(vy, vx),
      len: clamp(sp * 0.10, 4, 22) * (isT ? 1.6 : 1),
      wid: (isT ? 2.4 : 1.5) * clamp(size / 10, 0.5, 1.7),
      vx: -vx * 0.10 + rand(-4, 4),
      vy: -vy * 0.10 - rand(2, 7),
      life, maxLife: life, seed: rand(0, 6.28),
    });
    // ② 尾流气泡：快游/大龟更容易卷气
    const bubChance = nat.swimBubbleChance ?? (isT ? 0.22 : 0.09);
    if (Math.random() < bubChance) {
      const blife = rand(1.0, 2.0);
      this.stirBits.push({
        kind: 'bubble',
        x: x - ux * body + rand(-3, 3), y: y - uy * body + rand(-2, 2),
        vx: -ux * sp * 0.06 + rand(-6, 6),
        vy: -uy * sp * 0.06 - rand(10, 26),
        r: rand(0.7, isT ? 2.2 : 1.6), life: blife, maxLife: blife, seed: rand(0, 6.28),
      });
    }
    this._capStirBits();
  }

  /**
   * 换气气泡（阶段 8-⑨）—— 乌龟憋够了浮上来之前先吐一串泡，鱼偶尔也冒一粒。
   * 位置取生物"嘴部"近似（体前侧），气泡大一点、带明显的上浮初速。
   */
  addBreathBubbles(x, y, size, facing = 1) {
    const nat = CONFIG.natural ?? {};
    if (nat.enabled === false || nat.breathBubbles === false) return;
    if (!this.isWater(x, y)) return;
    const n = 2 + Math.round(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const life = rand(1.4, 2.6);
      this.stirBits.push({
        kind: 'bubble',
        x: x + facing * size * 0.55 + rand(-3, 3),
        y: y - size * 0.2 + rand(-3, 1),
        vx: facing * rand(2, 9) + rand(-3, 3),
        vy: -rand(22, 40),
        r: rand(1.3, 3.0), life, maxLife: life, seed: rand(0, 6.28),
      });
    }
    this._capStirBits();
  }

  /**
   * 环境上升气泡（阶段 8-⑨）—— 池底偶发冒一串小气泡，摇摇晃晃升到水面破掉：
   * 破的时候给波场一个**极轻**的顶升 + 一圈很快消散的微涟漪，水面"活"但不闹。
   */
  _updateAmbientBubbles(dt) {
    const nat = CONFIG.natural ?? {};
    if (nat.ambientBubbles === false) return;
    if (!this.ambBubbles) this.ambBubbles = [];

    // 冒泡：每隔一阵在随机水列的池底冒 1~3 个
    this._ambBubT = (this._ambBubT ?? 2) - dt;
    if (this._ambBubT <= 0) {
      const gapMin = nat.bubGapMin ?? 1.3, gapMax = nat.bubGapMax ?? 4.2;
      this._ambBubT = rand(gapMin, gapMax);
      const spans = this.waterSpans;
      if (spans.length) {
        const s = spans[Math.floor(Math.random() * spans.length)];
        const x = rand(s.x0 + 8, Math.max(s.x0 + 9, s.x1 - 8));
        const y0 = this.groundYAt(x) - rand(2, 8);
        const n = 1 + (Math.random() < 0.35 ? 1 : 0) + (Math.random() < 0.12 ? 1 : 0);
        for (let i = 0; i < n; i++) {
          this.ambBubbles.push({
            x: x + rand(-5, 5), y: y0 - i * rand(4, 9),
            r: rand(1.2, 3.2),
            vy: -rand(5, 12),
            sway: rand(0, 6.28), swayAmp: rand(3, 9), swaySp: rand(1.4, 3.0),
          });
        }
      }
    }

    // 上浮：浮力 ∝ 半径，终端速度随半径变大；到水面"啵"
    for (let i = this.ambBubbles.length - 1; i >= 0; i--) {
      const b = this.ambBubbles[i];
      const term = -(16 + b.r * 4.5);
      b.vy = Math.max(term, b.vy - 30 * dt);       // vy 负 = 向上，逐渐加速到终端速度
      b.sway += b.swaySp * dt;
      b.x += Math.sin(b.sway) * b.swayAmp * dt;
      b.y += b.vy * dt;
      const srf = this.surfaceAt(b.x) + 2;
      if (b.y <= srf) {
        // 破裂：极轻的水面顶升（强度 ∝ 半径）+ 一圈微涟漪
        if (this.wave) this.wave.disturb(b.x, 0, Math.min(0.06, 0.016 * b.r), 1);
        if (this.isWaterColumn(b.x)) {
          this.ripples.push({
            x: b.x, y: srf, r: 1, maxR: 3 + b.r * 2.6,
            alpha: 0.13, speed: 26,
          });
          if (this.ripples.length > 24) this.ripples.shift();
        }
        this.ambBubbles.splice(i, 1);
      }
    }
  }

  /** 环境气泡绘制 —— 细圈 + 高光点，升得快时轻微拉长（水阻的椭圆感） */
  _drawAmbientBubbles(ctx) {
    if (!this.ambBubbles || !this.ambBubbles.length) return;
    ctx.save();
    this._waterPath(ctx);
    ctx.clip();
    for (const b of this.ambBubbles) {
      const stretch = Math.min(0.45, Math.max(0, -b.vy / 90));
      ctx.globalAlpha = 0.34;
      ctx.strokeStyle = '#eaf9ff';
      ctx.lineWidth = Math.max(0.7, b.r * 0.38);
      ctx.beginPath();
      ctx.ellipse(b.x, b.y, b.r, b.r * (1 + stretch), 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.32, Math.max(0.4, b.r * 0.26), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _updateStirBits(dt) {
    if (!this.stirBits.length) return;
    for (let i = this.stirBits.length - 1; i >= 0; i--) {
      const p = this.stirBits[i];
      p.life -= dt;
      if (p.life <= 0) { this.stirBits.splice(i, 1); continue; }
      // 气泡持续上浮并左右飘；泥沙先被推起、再受重力沉回去；
      // 流痕（8-⑨）没有浮力也没有重力 —— 只是被留下来的水，慢慢减速、轻轻上飘
      if (p.kind === 'bubble') {
        p.vy -= 26 * dt;
        p.vx += Math.sin(p.seed + p.life * 6) * 8 * dt;
      } else if (p.kind === 'flow') {
        p.vx *= 0.92; p.vy *= 0.92;
        p.vy -= 5 * dt;
      } else {
        p.vy += 46 * dt;
      }
      if (p.kind !== 'flow') { p.vx *= 0.97; p.vy *= 0.985; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      // 别钻出水线，也别穿过池底
      const srf = this.surfaceAt(p.x) + 1;
      if (p.y < srf) p.y = srf;
      const flr = this.groundYAt(p.x) - 1;
      if (p.y > flr) { p.y = flr; p.vy *= -0.25; }
    }
  }

  _drawStirBits(ctx) {
    if (!this.stirBits.length) return;
    ctx.save();
    this._waterPath(ctx);
    ctx.clip();
    for (const p of this.stirBits) {
      const a = (p.life / p.maxLife) ** 2;
      if (a <= 0.02) continue;
      if (p.kind === 'flow') {
        // 流痕（8-⑨）：一条向后飘的短水痕 —— 外层软晕 + 内芯亮线，越长越淡
        const dx = Math.cos(p.ang), dy = Math.sin(p.ang);
        const L = p.len * (0.55 + a * 0.45);
        const wob = Math.sin(p.seed + p.life * 9) * 1.2;
        ctx.globalAlpha = a * 0.16;
        ctx.strokeStyle = '#d8f2fb';
        ctx.lineWidth = p.wid * 2.2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + wob);
        ctx.lineTo(p.x - dx * L, p.y + wob - dy * L);
        ctx.stroke();
        ctx.globalAlpha = a * 0.30;
        ctx.strokeStyle = '#f2fcff';
        ctx.lineWidth = p.wid;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - dx * L * 0.8, p.y - dy * L * 0.8);
        ctx.stroke();
      } else if (p.kind === 'bubble') {
        ctx.globalAlpha = a * 0.72;
        ctx.strokeStyle = '#eaf9ff';
        ctx.lineWidth = Math.max(0.7, p.r * 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(p.x - p.r * 0.3, p.y - p.r * 0.32, Math.max(0.4, p.r * 0.26), 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = '#b9a276';
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * 拖尾痕迹绘制 —— 贴着水线的一条细亮痕，两端透明、整体随时间消失。
   * 这就是"拖拽感"的来源：痕迹**留在身后**，而不是从一点向外扩。
   */
  _drawWakeTrails(ctx) {
    if (!this.wakeTrails.length) return;
    const amp = CONFIG.natural?.waveAmp ?? 6;
    ctx.save();
    ctx.lineCap = 'round';
    for (const w of this.wakeTrails) {
      const t = w.life / w.maxLife;
      const a = t * t * (w.creature ? 0.42 : 0.62)
        * clamp(1 - Math.abs(w.depth) / 40, 0, 1);
      if (a <= 0.012) continue;
      const x0 = Math.max(0, w.x0), x1 = Math.min(this.w, w.x1);
      if (x1 - x0 < 2) continue;
      const cx = (x0 + x1) / 2;
      if (!this.isWaterColumn(cx)) continue;

      // 横向渐变：中部最亮 → 两端透明（"拉长变淡"的观感）
      const g = ctx.createLinearGradient(x0, 0, x1, 0);
      g.addColorStop(0, 'rgba(226,246,252,0)');
      g.addColorStop(0.45, `rgba(240,252,255,${a.toFixed(3)})`);
      g.addColorStop(1, 'rgba(226,246,252,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = (w.creature ? 1.5 : 2.1) + w.str * 1.4;
      ctx.beginPath();
      for (let x = x0; x <= x1; x += 6) {
        const y = this.surfaceAt(x) + 1.4 + this.wave.heightAt(x) * amp * 0.5;
        x === x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // 痕迹末端几粒更亮的泡沫点（"刚被推开"的证据）
      ctx.globalAlpha = a * 0.9;
      ctx.fillStyle = '#ffffff';
      for (let k = 1; k <= 3; k++) {
        const px = w.dir > 0 ? x1 - (k - 1) * 7 : x0 + (k - 1) * 7;
        if (px < x0 || px > x1) continue;
        ctx.beginPath();
        ctx.arc(px, this.surfaceAt(px) + 1, 1.5 - k * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  update(dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += rp.speed * dt;
      rp.alpha -= 1.1 * dt;
      if (rp.alpha <= 0 || rp.r >= rp.maxR) this.ripples.splice(i, 1);
    }
    if (this.wave) this.wave.update(dt);
    this._updateFootprints(dt);
    this._updateWakes(dt);       // 拖尾痕迹（阶段 8-④）
    this._updateStirBits(dt);    // 水下搅动粒子（阶段 8-④）
    this._updateAmbientBubbles(dt); // 环境上升气泡（阶段 8-⑨）
    for (const b of this.bubbles) b.phase += b.speed * dt;
    for (const s of this.silt) s.phase += s.speed * dt;
  }

  // ════════════════════════════════════════════════════════
  //  路 径 工 具
  // ════════════════════════════════════════════════════════
  /** 水面多边形（每段水域一条子路径：水线 → 池底） */
  _waterPath(ctx) {
    ctx.beginPath();
    for (const s of this.waterSpans) {
      const x0 = s.x0, x1 = s.x1;
      ctx.moveTo(x0, this.surfaceAt(x0));
      for (let x = x0; x <= x1; x += 6) ctx.lineTo(x, this.surfaceAt(x));
      ctx.lineTo(x1, this.surfaceAt(x1));
      ctx.lineTo(x1, this.groundYAt(x1));
      for (let x = x1; x >= x0; x -= 6) ctx.lineTo(x, this.groundYAt(x));
      ctx.closePath();
    }
  }

  /** 水线（只有水面那一条线，岸段跳过） */
  surfacePath(ctx) {
    ctx.beginPath();
    for (const s of this.waterSpans) {
      let first = true;
      for (let x = s.x0; x <= s.x1; x += 6) {
        const y = this.surfaceAt(x);
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
    }
  }

  /** 地表曲线（整场地形轮廓） */
  _groundPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, this.groundYAt(0));
    for (let x = 0; x <= this.w; x += 6) ctx.lineTo(x, this.groundYAt(x));
  }

  // ════════════════════════════════════════════════════════
  //  渲 染
  // ════════════════════════════════════════════════════════
  draw(ctx, time) {
    this._ensureTextures();
    this._drawEarth(ctx, time);        // 剖面土体（岸 + 池底，最底层）
    this._drawWater(ctx, time);        // 水体（水色分层 + 流动纹理 + 光柱）
    this._drawWaveSurface(ctx, time);  // 一维水面波场的起伏明暗（阶段 8-④）
    this._drawBed(ctx, time);          // 池底淤泥 / 沉积 / 气泡
    this._drawStirBits(ctx);           // 水下搅动粒子（阶段 8-④）
    this._drawAmbientBubbles(ctx);     // 环境上升气泡（阶段 8-⑨）
    this._drawBank(ctx, time);         // 岸顶草皮 / 沙 / 石
    this._drawFootprints(ctx);
    this._drawSurfaceSheet(ctx, time); // 水面"薄层"
    this._drawWakeTrails(ctx);         // 拖尾痕迹（阶段 8-④）
    this._drawRipples(ctx);            // 入水溅射（水花 + 短横痕）
  }

  /** 剖面土体：地表曲线以下全是"切开的土"，越深越暗 */
  _drawEarth(ctx) {
    const C = CONFIG.colors;
    ctx.save();
    this._groundPath(ctx);
    ctx.lineTo(this.w, this.h);
    ctx.lineTo(0, this.h);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, this.bankTopY, 0, this.h);
    g.addColorStop(0, C.soil ?? '#6a5740');
    g.addColorStop(0.45, C.soilWet ?? '#463a29');
    g.addColorStop(1, C.soilDeep ?? '#382f22');
    ctx.fillStyle = g;
    ctx.fill();

    // 断面裁剪：土体纹理 + 石块 + 层理线
    ctx.clip();
    if (CONFIG.natural?.terrainTex !== false && this.tex) {
      tileTexture(ctx, this.tex.mud, 0, this.bankTopY, this.w, this.h - this.bankTopY, 0, 0,
        (CONFIG.natural?.terrainTexAlpha ?? 0.55) * 0.7);
    }
    // 层理：几道横向的深浅带（沉积层的感觉）—— 水上水下都能透出来，
    // 所以压低透明度，靠"隐约"而不是"色块"来表现
    ctx.globalAlpha = 0.11;
    for (let i = 0; i < 5; i++) {
      const y = this.bankTopY + (this.h - this.bankTopY) * ((i + 0.5) / 5)
        + Math.sin(i * 3.1) * 14;
      ctx.fillStyle = i % 2 ? '#2a2216' : '#7a6a4c';
      ctx.fillRect(0, y, this.w, 3 + i * 1.6);
    }
    ctx.globalAlpha = 1;
    // 嵌在断面里的石头
    for (const s of this.bankStones) {
      const c = Math.round(118 * s.shade);
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = `rgb(${Math.round(c * 1.02)},${c},${Math.round(c * 0.9)})`;
      blobPath(ctx, s.x, s.y, s.rx, s.ry, s.amps, s.phases, s.rot);
      ctx.fill();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#e8dfc8';
      blobPath(ctx, s.x - s.rx * 0.2, s.y - s.ry * 0.35, s.rx * 0.5, s.ry * 0.4,
        s.amps, s.phases, s.rot);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /**
   * 一维水面波场渲染（阶段 8-④）
   *
   * 侧视下"水面"就是一条沿 x 起伏的线，所以渲染方式也跟着换了：
   *   · 沿 x 逐段取波场高度 h(x)，把水线画成 `surfaceAt(x) + h(x)·amp` 的起伏曲线；
   *   · 每段的亮度与线宽按**水面斜率**变化（迎光坡亮、背光坡暗）→ 水面有立体感、在动；
   *   · 波谷侧再压一条青暗带，让水面显出"厚度"。
   * 相比旧的 2D 版本：不再需要离屏 ImageData 与逐块梯度采样，
   * 每帧只画 ~240 段线（旧版 42k 格像素），也不可能有同心环。
   */
  _drawWaveSurface(ctx, time) {
    const N = CONFIG.natural || {};
    if (N.enabled === false || N.waveSurface === false) return;
    if (!this.wave || N.wave === false) return;
    if (this.waterBottom - this.waterTop <= 0) return;

    const amp = N.waveAmp ?? 6;
    const seg = Math.max(4, this.wave.cell * 2);

    ctx.save();
    // 裁剪：允许波动略高于水线，但绝不允许画到岸上去
    const head = amp * 1.6;
    ctx.beginPath();
    ctx.moveTo(0, this.surfaceAt(0) - head);
    for (let x = 0; x <= this.w; x += 8) ctx.lineTo(x, this.surfaceAt(x) - head);
    ctx.lineTo(this.w, this.waterBottom);
    ctx.lineTo(0, this.waterBottom);
    ctx.closePath();
    ctx.clip();

    ctx.lineCap = 'round';
    for (let x = 0; x < this.w; x += seg) {
      const x2 = Math.min(this.w, x + seg);
      const mx = (x + x2) * 0.5;
      if (!this.isWaterColumn(mx)) continue;
      const h1 = this.wave.heightAt(x) * amp;
      const h2 = this.wave.heightAt(x2) * amp;
      // 水面法线 (-dh/dx, 1) 与光源方向 (-0.55, -0.83) 的点积 → 迎光/背光
      const slope = (h2 - h1) / Math.max(1, x2 - x);
      const lit = clamp(0.83 - slope * 6, 0, 1);
      const y1 = this.surfaceAt(x) + h1;
      const y2 = this.surfaceAt(x2) + h2;
      const ym = this.surfaceAt(mx) + (h1 + h2) * 0.5;

      // ① 水下暗侧（波谷处偏青暗，让起伏读得出来）
      ctx.globalAlpha = clamp(0.07 + (1 - lit) * 0.24, 0, 0.34);
      ctx.strokeStyle = '#123a4a';
      ctx.lineWidth = 1.7;
      ctx.beginPath();
      ctx.moveTo(x, y1 + 1.7);
      ctx.quadraticCurveTo(mx, ym + 1.7, x2, y2 + 1.7);
      ctx.stroke();

      // ② 水线亮痕（斜率越大越亮越粗 = 波峰附近的高光）
      ctx.globalAlpha = clamp(0.14 + lit * 0.28 + Math.abs(slope) * 0.5, 0, 0.72);
      ctx.strokeStyle = '#f2fbff';
      ctx.lineWidth = 1.1 + Math.min(1.5, Math.abs(slope) * 1.6);
      ctx.beginPath();
      ctx.moveTo(x, y1);
      ctx.quadraticCurveTo(mx, ym, x2, y2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _drawWater(ctx, time) {
    const N = CONFIG.natural || {};
    const nat = N.enabled !== false;
    const C = CONFIG.colors;
    const top = this.waterTop;
    const bot = this.waterBottom;
    const hh = Math.max(1, this.waterHeight);

    ctx.save();
    this._waterPath(ctx);
    ctx.clip();

    // ── 1) 基础水体：竖直三段深浅 ─────────────────────
    const g = ctx.createLinearGradient(0, top, 0, bot);
    if (nat) {
      g.addColorStop(0.00, C.waterShallow);
      g.addColorStop(0.30, C.waterMid);
      g.addColorStop(0.72, C.waterDeep);
      g.addColorStop(1.00, C.waterBottom);
    } else {
      g.addColorStop(0, C.waterTop);
      g.addColorStop(1, C.waterBottom);
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, top - 8, this.w, hh + 16);

    // ── 2) 天空倒影带（紧贴水线的亮带，随时间呼吸）──
    if (nat && N.skyReflect !== false) {
      const a = 0.22 + 0.06 * Math.sin(time * 0.5);
      const rg = ctx.createLinearGradient(0, top, 0, top + hh * 0.34);
      rg.addColorStop(0, `rgba(232,247,252,${(a * 1.5).toFixed(3)})`);
      rg.addColorStop(0.5, `rgba(198,232,244,${(a * 0.6).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(198,232,244,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, top - 4, this.w, hh * 0.36);
    }

    // ── 3) 水面流动纹理 ────────────────────────────────
    if (nat && N.surfaceFlow !== false) {
      this._drawSurfaceFlow(ctx, time);
    } else {
      ctx.globalAlpha = 0.055;
      ctx.strokeStyle = '#bfe6f2';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        const baseY = top + hh * ((i + 0.5) / 6);
        ctx.beginPath();
        for (let x = 0; x <= this.w; x += 12) {
          const y = baseY + Math.sin(x * 0.014 + time * 0.7 + i * 1.7) * 4;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // ── 4) 水下体积：底部轻微压暗 ─────────────────────
    if (nat) {
      const vg = ctx.createLinearGradient(0, top, 0, bot);
      vg.addColorStop(0, 'rgba(10,40,52,0)');
      vg.addColorStop(0.62, 'rgba(10,40,52,0.03)');
      vg.addColorStop(1, 'rgba(8,34,44,0.16)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, top - 8, this.w, hh + 16);
    }

    // ── 5) 阳光穿透光柱 ────────────────────────────────
    if (nat && N.sunShaft !== false) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 5; i++) {
        const sway = Math.sin(time * 0.22 + i * 1.9) * 46;
        const x0 = this.w * (0.1 + i * 0.2) + sway;
        const wid = 42 + 26 * Math.sin(i * 2.1);
        const a = 0.045 + 0.03 * Math.sin(time * 0.4 + i);
        const sg = ctx.createLinearGradient(x0, top, x0 + wid * 0.6, bot);
        sg.addColorStop(0, `rgba(214,246,255,${(a * 1.5).toFixed(3)})`);
        sg.addColorStop(0.55, `rgba(180,232,248,${a.toFixed(3)})`);
        sg.addColorStop(1, 'rgba(150,214,236,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(x0 - wid * 0.5, top);
        ctx.lineTo(x0 + wid * 0.5, top);
        ctx.lineTo(x0 + wid * 1.5, bot);
        ctx.lineTo(x0 + wid * 0.4, bot);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  /** 水面流动纹理：多层不同频率/相位的正弦波，断续出现像真实反光 */
  _drawSurfaceFlow(ctx, time) {
    ctx.save();
    ctx.lineCap = 'round';
    const top = this.waterTop;
    const hh = this.waterHeight;
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const f = (i + 0.5) / rows;
      const baseY = top + hh * (0.03 + f * 0.62);
      const travel = (time * (0.012 + i * 0.004) + i * 0.29) % 1;
      const segStart = travel * this.w * 1.3 - this.w * 0.3;
      const segLen = this.w * (0.18 + 0.22 * Math.abs(Math.sin(i * 2.3 + 1)));
      const a = (0.05 + 0.06 * (1 - f)) * (0.7 + 0.5 * Math.sin(time * 0.8 + i));
      if (a <= 0.012) continue;
      ctx.globalAlpha = a;
      ctx.strokeStyle = i % 2 ? '#e6f6fb' : '#bfe6f2';
      ctx.lineWidth = 0.9 + (1 - f) * 1.2;
      ctx.beginPath();
      let first = true;
      for (let x = segStart; x <= segStart + segLen; x += 9) {
        if (x < -4 || x > this.w + 4) { first = true; continue; }
        const y = baseY
          + Math.sin(x * 0.013 + time * 0.65 + i * 1.4) * (2.4 + (1 - f) * 2.2)
          + Math.sin(x * 0.041 + time * 1.25 + i) * 1.1;
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 水面"薄层"（阶段 6-⑧）—— 侧视 + 一点俯角的关键观感来源：
   * 在水线下方 ~14px 内铺一条亮色薄带（我们能"看到"的那层水面），
   * 边缘带细碎的横向波光，让荷叶/龟看起来是浮在这张面上。
   */
  _drawSurfaceSheet(ctx, time) {
    if (CONFIG.natural?.surfaceSheet === false) return;
    const C = CONFIG.colors;
    ctx.save();
    this._waterPath(ctx);
    ctx.clip();

    const thick = Math.max(8, this.waterHeight * 0.045);
    for (const s of this.waterSpans) {
      // 亮薄带
      ctx.beginPath();
      ctx.moveTo(s.x0, this.surfaceAt(s.x0));
      for (let x = s.x0; x <= s.x1; x += 8) ctx.lineTo(x, this.surfaceAt(x));
      ctx.lineTo(s.x1, this.surfaceAt(s.x1) + thick);
      for (let x = s.x1; x >= s.x0; x -= 8) ctx.lineTo(x, this.surfaceAt(x) + thick);
      ctx.closePath();
      const g = ctx.createLinearGradient(0, this.waterY - 6, 0, this.waterY + thick);
      g.addColorStop(0, 'rgba(240,252,255,0.42)');
      g.addColorStop(0.45, `rgba(200,238,248,0.20)`);
      g.addColorStop(1, 'rgba(180,226,240,0)');
      ctx.fillStyle = g;
      ctx.fill();
    }

    // 横向波光碎条（水面张力的粼粼感）
    ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      const p = (i * 0.618 + time * 0.02) % 1;
      const x = this.waterLeftX + p * (this.waterRightX - this.waterLeftX);
      if (!this.isWaterColumn(x)) continue;
      const y = this.surfaceAt(x) + 2 + ((i * 7) % 5);
      const a = 0.10 + 0.14 * Math.abs(Math.sin(time * 1.3 + i * 1.7));
      ctx.globalAlpha = a;
      ctx.strokeStyle = i % 3 ? '#ffffff' : '#d6f2fa';
      ctx.lineWidth = 1.1 + (i % 3) * 0.5;
      const len = 10 + (i % 5) * 7;
      ctx.beginPath();
      ctx.moveTo(x - len, y);
      ctx.quadraticCurveTo(x, y - 1.6, x + len, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 水线高光（顶边一条亮线，把空气和水分开）
    ctx.strokeStyle = `rgba(255,255,255,${(0.30 + 0.10 * Math.sin(time * 0.9)).toFixed(3)})`;
    ctx.lineWidth = 1.4;
    this.surfacePath(ctx);
    ctx.stroke();
    ctx.restore();

    // 水线附近的空气侧：一点远景柔光（天空与水面的过渡）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const T = Math.max(6, this.waterHeight * 0.03);
    const gg = ctx.createLinearGradient(0, this.waterY - T, 0, this.waterY + 2);
    gg.addColorStop(0, 'rgba(255,255,255,0)');
    gg.addColorStop(1, `rgba(226,244,252,${(0.10 + 0.04 * Math.sin(time * 0.6)).toFixed(3)})`);
    ctx.fillStyle = gg;
    ctx.fillRect(this.waterLeftX, this.waterY - T, this.waterRightX - this.waterLeftX, T + 2);
    ctx.restore();
  }

  /** 池底：淤泥 / 沉积 / 气泡 / 枯枝 */
  _drawBed(ctx, time) {
    const N = CONFIG.natural || {};
    const nat = N.enabled !== false;
    const C = CONFIG.colors;

    ctx.save();
    // 池底罩染（贴地表曲线，每段水域一块）
    // 阶段 8-⑩：原先用**不透明 marsh 色**一铺到底，与水线上方同一片土体的
    // soil 渐变 + 泥纹在岸线处撞出一道垂直硬接缝（同一剖面两种画法）。
    // 改成随深度渐浓的半透明罩染：土体本身的渐变 / 泥纹 / 层理 / 石块全程
    // 连续，水下只是颜色随深度被"水色 + 湿泥"慢慢压暗；岸线附近再沿 x
    // 方向羽化淡入（smoothstep），左右两侧自然衔接。
    ctx.save();
    ctx.beginPath();
    for (const s of this.waterSpans) {
      ctx.moveTo(s.x0, this.groundYAt(s.x0));
      for (let x = s.x0; x <= s.x1; x += 8) ctx.lineTo(x, this.groundYAt(x));
      ctx.lineTo(s.x1, this.h);
      ctx.lineTo(s.x0, this.h);
      ctx.closePath();
    }
    ctx.clip();
    const fadeW = Math.max(90, this.w * 0.055);
    for (const s of this.waterSpans) {
      // 左缘羽化区：逐窄条缩放透明度，避免"水下水色从岸线上凭空开始"
      const fadeEnd = Math.min(s.x0 + fadeW, s.x1);
      for (let x = s.x0; x < fadeEnd; x += 9) {
        const t = (x - s.x0) / fadeW;
        ctx.fillStyle = this._bedTint(ctx, smoothstep(clamp(t, 0, 1)));
        ctx.fillRect(x, this.waterY - 6, 9, this.h - this.waterY + 6);
      }
      if (fadeEnd < s.x1) {
        ctx.fillStyle = this._bedTint(ctx, 1);
        ctx.fillRect(fadeEnd, this.waterY - 6, s.x1 - fadeEnd, this.h - this.waterY + 6);
      }
    }
    ctx.restore();

    // 泥浆纹理：earth 已对**全断面**铺过同相位 mud 纹理，这里不再重复铺
    //（原先从 bedY-20 起铺、相位还和 earth 对不上，在泥面上压出一条横接缝）；
    // 只补一层 silt 淤积纹理，且从 bedY-70 起纵向渐显，避免纹理硬起始。
    if (nat && N.terrainTex !== false && this.tex) {
      ctx.save();
      ctx.beginPath();
      for (const s of this.waterSpans) {
        ctx.moveTo(s.x0, this.groundYAt(s.x0));
        for (let x = s.x0; x <= s.x1; x += 8) ctx.lineTo(x, this.groundYAt(x));
        ctx.lineTo(s.x1, this.h);
        ctx.lineTo(s.x0, this.h);
        ctx.closePath();
      }
      ctx.clip();
      tileTextureFaded(ctx, this.tex.silt, 0, this.bedY - 70, this.w, this.h - this.bedY + 70,
        137, 89, (N.terrainTexAlpha ?? 0.55) * 0.45, this.bedY - 70, this.bedY + 45);
      ctx.restore();
    }

    // 泥面（bedY 淤积线）与水体的过渡：拉长成软渐变（原先 32px 硬带
    // 在泥面上压出一条横向色阶）
    ctx.save();
    for (const s of this.waterSpans) {
      const tg = ctx.createLinearGradient(0, this.bedY - 80, 0, this.bedY + 40);
      tg.addColorStop(0, 'rgba(10,32,40,0)');
      tg.addColorStop(0.5, 'rgba(12,30,34,0.24)');
      tg.addColorStop(1, 'rgba(10,26,30,0.48)');
      ctx.fillStyle = tg;
      ctx.fillRect(s.x0, this.bedY - 80, s.x1 - s.x0, 120);
    }
    ctx.restore();

    // 淤泥团 + 泥线小丘
    ctx.save();
    for (const c of this.mudClumps) {
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = c.dark ? '#191510' : '#5a523a';
      blobPath(ctx, c.x, c.y, c.rx, c.ry, c.amps, c.phases, c.rot);
      ctx.fill();
    }
    ctx.fillStyle = '#332e1f';
    for (const m of this.mudEdges) {
      blobPath(ctx, m.x, m.y, m.rx, m.ry, m.amps, m.phases, m.rot);
      ctx.fill();
    }
    ctx.restore();

    if (nat && N.bottomSilt !== false) {
      ctx.save();
      for (const s of this.silt) {
        const pulse = 0.5 + 0.5 * Math.sin(s.phase);
        ctx.globalAlpha = 0.05 + pulse * 0.11;
        ctx.fillStyle = '#8a8060';
        ctx.beginPath();
        ctx.arc(s.x + Math.sin(s.phase) * s.drift, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const d of this.bottomDebris) {
        ctx.globalAlpha = 0.34;
        ctx.fillStyle = `rgba(24,22,16,0.55)`;
        ctx.save();
        ctx.translate(d.x, d.y);
        ctx.rotate(d.rot);
        ctx.beginPath();
        if (d.twig) {
          ctx.moveTo(-d.r, 0);
          ctx.quadraticCurveTo(0, -d.r * 0.5, d.r, d.r * 0.2);
          ctx.lineWidth = 1.2;
          ctx.strokeStyle = 'rgba(38,32,20,0.6)';
          ctx.stroke();
        } else {
          ctx.ellipse(0, 0, d.r, d.r * 0.42, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.restore();
    }

    // 气泡
    ctx.save();
    for (const b of this.bubbles) {
      const pulse = 0.5 + 0.5 * Math.sin(b.phase);
      let by = b.y;
      if (b.rise) by = b.y - (pulse * b.rise);
      const alpha = (b.r > 2.6 ? 0.10 : 0.06) + pulse * (b.r > 2.6 ? 0.18 : 0.10);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = b.r > 2.6 ? '#8a7f56' : '#6f6a48';
      const br = b.r * (0.8 + pulse * 0.4);
      blobPath(ctx, b.x + Math.sin(b.phase) * b.drift * 0.4, by,
        br, br * 0.85, b.amps, b.phases, b.rot + b.phase * 0.2);
      ctx.fill();
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#c9c08e';
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(b.phase) * b.drift * 0.4 - b.r * 0.28, by - b.r * 0.3,
        b.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /**
   * 水下土体的纵深罩染渐变（岸线 → 池底越来越浓）。
   * 色相全部取自土色系（soilWet / marsh / marshMud），保证与水上部分同源；
   * fade 为岸线羽化系数 0~1，整体缩放各档透明度。
   */
  _bedTint(ctx, fade) {
    const g = ctx.createLinearGradient(0, this.waterY, 0, this.h);
    const a = (v) => (v * fade).toFixed(3);
    g.addColorStop(0.00, `rgba(70,58,41,${a(0.06)})`);   // ≈ soilWet，刚入水几乎不压色
    g.addColorStop(0.30, `rgba(58,48,34,${a(0.36)})`);
    g.addColorStop(0.68, `rgba(58,53,36,${a(0.78)})`);   // ≈ marsh
    g.addColorStop(1.00, `rgba(42,36,25,${a(0.93)})`);   // ≈ marshMud
    return g;
  }

  /** 岸顶：草皮层 + 草叶 + 石头 */
  _drawBank(ctx, time) {
    const N = CONFIG.natural || {};
    const nat = N.enabled !== false;
    const C = CONFIG.colors;
    if (!this.landZones.length) return;
    const thick = CONFIG.layout?.bankTopThick ?? 30;

    // ── 1) 草皮层：贴地表曲线的一条带（岸顶 + 台面）──
    // 下沿不能越过水线（否则会盖在水面上），靠水一端自然收窄
    ctx.save();
    for (const z of this.landZones) {
      ctx.beginPath();
      ctx.moveTo(z.x0, this.groundYAt(z.x0));
      for (let x = z.x0; x <= z.x1; x += 6) ctx.lineTo(x, this.groundYAt(x));
      for (let x = z.x1; x >= z.x0; x -= 6) {
        ctx.lineTo(x, Math.max(this.groundYAt(x),
          Math.min(this.groundYAt(x) + thick, this.surfaceAt(x) + 1)));
      }
      ctx.closePath();
      const g = ctx.createLinearGradient(0, this.bankTopY, 0, this.waterY);
      g.addColorStop(0.00, C.bankGrassDark);
      g.addColorStop(0.30, C.bankGrass);
      g.addColorStop(0.72, C.bankSand);
      g.addColorStop(1.00, C.bankSandDark);
      ctx.fillStyle = g;
      ctx.fill();
    }
    ctx.restore();

    // ── 2) 纹理与噪点（裁在草皮层里）────────────────
    ctx.save();
    ctx.beginPath();
    for (const z of this.landZones) {
      ctx.moveTo(z.x0, this.groundYAt(z.x0) - 2);
      for (let x = z.x0; x <= z.x1; x += 6) ctx.lineTo(x, this.groundYAt(x) - 2);
      for (let x = z.x1; x >= z.x0; x -= 6) {
        ctx.lineTo(x, Math.max(this.groundYAt(x),
          Math.min(this.groundYAt(x) + thick, this.surfaceAt(x) + 1)));
      }
      ctx.closePath();
    }
    ctx.clip();

    if (nat && N.terrainTex !== false && this.tex) {
      for (const z of this.landZones) {
        tileTexture(ctx, this.tex.sand, z.x0, this.bankTopY, z.x1 - z.x0,
          this.waterY - this.bankTopY + 20, 0, 0, (N.terrainTexAlpha ?? 0.55) * 0.8);
      }
    }
    if (nat && N.bankTexture !== false) {
      for (const s of this.sandGrain) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = s.dark ? '#6b5636' : '#f2e6c6';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const p of this.pebbles) {
        const c = Math.round(150 * p.lig);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = `rgb(${c},${c - 8},${c - 26})`;
        blobPath(ctx, p.x, p.y, p.r, p.r * 0.68, p.amps, p.phases, p.rot);
        ctx.fill();
      }
    }
    ctx.restore();

    // ── 3) 湿痕：草皮层靠水那侧压暗一点（水汽）────────
    ctx.save();
    ctx.globalAlpha = nat ? 0.35 : 0.28;
    ctx.strokeStyle = '#79653f';
    ctx.lineWidth = nat ? 6 : 4;
    ctx.lineCap = 'round';
    for (const z of this.landZones) {
      const inner = z.x0 < this.waterLeftX ? z.x1 : z.x0;   // 靠水的一端
      ctx.beginPath();
      for (let x = z.x0; x <= z.x1; x += 8) {
        const y = this.groundYAt(x) + Math.max(0, 24 * (1 - Math.abs(x - inner) / 60));
        x === z.x0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();

    // ── 4) 石头 ─────────────────────────────────────
    for (const r of this.rocks) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#2a2416';
      ctx.beginPath();
      ctx.ellipse(0.8, r.r * 0.62, r.r * 1.02, r.r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      const base = Math.round(112 * r.shade);
      ctx.globalAlpha = 0.94;
      ctx.fillStyle = `rgb(${Math.round(base * r.warm)},${base},${Math.round(base * 0.88)})`;
      ctx.beginPath();
      for (let i = 0; i <= r.pts.length; i++) {
        const p = r.pts[i % r.pts.length];
        const px = Math.cos(p.a) * p.r;
        const py = Math.sin(p.a) * p.r * 0.72;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#fdfbf2';
      ctx.beginPath();
      ctx.ellipse(-r.r * 0.22, -r.r * 0.3, r.r * 0.5, r.r * 0.28, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── 5) 草丛（逐根带风摆）──────────────────────────
    ctx.save();
    ctx.lineCap = 'round';
    for (const t of this.grassTufts) {
      const sway = Math.sin(time * 1.1 + t.phase) * 1.6;
      ctx.strokeStyle = `hsl(${t.hue}, ${t.sat}%, ${t.lig}%)`;
      ctx.lineWidth = t.w;
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.quadraticCurveTo(
        t.x + t.lean * 0.6 + sway * 0.5,
        t.y - t.h * 0.6,
        t.x + t.lean * 1.6 + sway,
        t.y - t.h
      );
      ctx.stroke();
      if (t.h > 14) {
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = `hsl(${t.hue + 8}, ${t.sat}%, ${t.lig + 16}%)`;
        ctx.lineWidth = Math.max(0.8, t.w * 0.6);
        ctx.beginPath();
        ctx.moveTo(t.x + t.lean * 0.9, t.y - t.h * 0.66);
        ctx.lineTo(t.x + t.lean * 1.6 + sway, t.y - t.h);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  /**
   * 落点溅射（阶段 8-④ 重做）
   *
   * 旧版画的是"同心椭圆环 r 逐渐变大"—— 那是俯视水面的现象，
   * 放在侧视剖面里就是最扎眼的违和感。现在改成：
   *   ① 垂直水花：3 条向上溅的短竖线（只有下落才溅得起来）；
   *   ② 横向短痕：贴着水线向两侧摊开的一小段（"被推出去的痕"，不是环）。
   * 溅射的 y 一律归到该 x 的**水线**上：入水本来就发生在水面，
   * 不该跟着施扰点跑到水下十几像素。
   */
  _drawRipples(ctx) {
    if (!this.ripples.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    for (const rp of this.ripples) {
      const k = clamp(rp.r / rp.maxR, 0, 1);
      const a = Math.max(0, rp.alpha) * (1 - k);
      if (a <= 0.012) continue;
      const x = rp.x;
      const y = this.isWaterColumn(x) ? this.surfaceAt(x) + 1 : rp.y;

      // ① 垂直水花
      const hMax = (6 + rp.maxR * 0.32) * (1 - k);
      for (let i = -1; i <= 1; i++) {
        const ox = i * (2.0 + rp.maxR * 0.05);
        ctx.globalAlpha = a * (1 - Math.abs(i) * 0.28);
        ctx.strokeStyle = '#f4fcff';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(x + ox, y);
        ctx.lineTo(x + ox + ox * 0.45, y - hMax * (1 - Math.abs(i) * 0.22));
        ctx.stroke();
      }

      // ② 沿水线摊开的短横痕
      const L = rp.r * 1.7 + 3;
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = '#ddf3fb';
      ctx.lineWidth = 1.35 * (1 - k * 0.5);
      ctx.beginPath();
      ctx.moveTo(x - L, y + 1.1);
      ctx.quadraticCurveTo(x, y + 2.4, x + L, y + 1.1);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
