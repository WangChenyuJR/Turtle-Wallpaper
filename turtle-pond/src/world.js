/**
 * 场景世界 —— 岸边区 / 水面区 / 泥沼区 三区划分与渲染
 *
 * 坐标系：左上角 (0,0)，y 向下为正
 *
 *  ┌──────────────────────────────┐  y = 0
 *  │        岸边区（沙 + 草）        │
 *  ├──────────────────────────────┤  y = bankY   ← 岸线
 *  │                              │
 *  │        水面区（乌龟+鱼）        │
 *  │                              │
 *  ├──────────────────────────────┤  y = marshY  ← 泥沼线
 *  │        泥沼区（浑浊泥）         │
 *  └──────────────────────────────┘  y = height
 */

import { CONFIG } from './config.js';
import { rand, randInt, clamp, blobShape, blobPath } from './utils.js';
import { WaterWaveField } from './waterwave.js';
import { makePondTextures, tileTexture } from './terrain-tex.js';

export class World {
  constructor(width, height) {
    this.resize(width, height);
    this._buildTerrain();
    this._buildRipples();
    // 真实波动方程水场（阶段 5-⑪）：逐帧求解 2D 波动方程，波与波真实干涉
    this.wave = new WaterWaveField(width, height, CONFIG.natural?.waveCell ?? 7);
    // 只有水面区域才允许环境微扰（岸上不波动）
    this.wave.ambientFilter = (x, y) => this.isWater(x, y);
    // 程序化地表纹理（泥/沙/淤积），首次渲染惰性生成
    this.tex = null;
    this._texReady = false;
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

  resize(width, height) {
    this.w = width;
    this.h = height;
    this.bankY = Math.round(height * CONFIG.layout.bankRatio);
    this.marshY = Math.round(height * (1 - CONFIG.layout.marshRatio));
    this.waterTop = this.bankY;
    this.waterBottom = this.marshY;
    this.waterHeight = this.marshY - this.bankY;

    // 岸线起伏（让边界自然，不是一条直线）
    this.bankProfile = [];
    this.marshProfile = [];
    const seg = 40;
    for (let i = 0; i <= seg; i++) {
      this.bankProfile.push(rand(-7, 7));
      this.marshProfile.push(rand(-6, 6));
    }
    this.seg = seg;

    // 纹理密度依赖尺寸，resize 需重建（构造时会再调一次，幂等）
    if (this.grassTufts) this._buildTerrain();
    // 波场网格依赖尺寸
    if (this.wave) this.wave.resize(width, height);
  }

  /** 岸线 y（带起伏），x 为像素 */
  bankLineAt(x) {
    return this.bankY + this._sample(this.bankProfile, x);
  }

  /** 泥沼线 y（带起伏） */
  marshLineAt(x) {
    return this.marshY + this._sample(this.marshProfile, x);
  }

  _sample(profile, x) {
    const t = clamp(x / this.w, 0, 1) * this.seg;
    const i = Math.floor(t);
    const f = t - i;
    const a = profile[i] ?? 0;
    const b = profile[Math.min(i + 1, this.seg)] ?? 0;
    return a + (b - a) * f;
  }

  /** 判断点是否在水面可游区域 */
  isWater(x, y) {
    return y > this.bankLineAt(x) + 6 && y < this.marshLineAt(x) - 6;
  }

  /** 判断点是否在岸边（陆地） */
  isBank(x, y) {
    return y <= this.bankLineAt(x) + 6;
  }

  /** 判断点是否在泥沼 */
  isMarsh(x, y) {
    return y >= this.marshLineAt(x) - 6;
  }

  /** 把点约束到水面区域内 */
  constrainToWater(x, y, margin = 8) {
    const cx = clamp(x, margin, this.w - margin);
    const top = this.bankLineAt(cx) + margin;
    const bot = this.marshLineAt(cx) - margin;
    return { x: cx, y: clamp(y, top, Math.max(top, bot)) };
  }

  _buildTerrain() {
    // 岸边草丛：成簇分布（不是均匀撒点），每簇 3~6 根草
    this.grassTufts = [];
    const clumps = Math.max(14, Math.round(this.w / 88));
    for (let c = 0; c < clumps; c++) {
      const cx = rand(0, this.w);
      const cy = rand(2, this.bankLineAt(cx) - 6);
      const blades = Math.round(rand(3, 6));
      const baseHue = rand(74, 106);
      for (let b = 0; b < blades; b++) {
        this.grassTufts.push({
          x: cx + rand(-7, 7),
          y: cy + rand(-3, 4),
          h: rand(6, 22),
          lean: rand(-4.5, 4.5),
          hue: baseHue + rand(-6, 6),
          sat: rand(30, 52),
          lig: rand(24, 44),
          w: rand(1.1, 2.2),
          phase: rand(0, Math.PI * 2),
        });
      }
    }

    // 岸边石头：形状不规则（用椭圆 + 随机旋转 + 顶点扰动）
    this.rocks = [];
    const rockN = Math.max(8, Math.round(this.w / 150));
    for (let i = 0; i < rockN; i++) {
      const x = rand(0, this.w);
      const r = rand(4, 13);
      this.rocks.push({
        x,
        y: rand(this.bankLineAt(x) - 14, this.bankLineAt(x) + 2),
        r,
        rot: rand(0, Math.PI),
        shade: rand(0.62, 0.95),
        warm: rand(0.85, 1.12),
        pts: this._rockOutline(r),
      });
    }

    // 岸边细碎卵石 / 贝壳碎屑（拟真细节，不参与碰撞）
    this.pebbles = [];
    const pebN = Math.max(24, Math.round(this.w / 42));
    for (let i = 0; i < pebN; i++) {
      const x = rand(0, this.w);
      this.pebbles.push({
        x,
        y: rand(0, this.bankLineAt(x) - 2),
        r: rand(0.8, 2.6),
        rot: rand(0, Math.PI),
        lig: rand(0.72, 1.15),
        ...this._blobParams(2, 0.12, 0.30),
      });
    }

    // 岸边沙粒噪点（大批量、极低对比度，形成"颗粒感"）
    this.sandGrain = [];
    const grainN = Math.round((this.w * this.bankY) / 520);
    for (let i = 0; i < grainN; i++) {
      const x = rand(0, this.w);
      this.sandGrain.push({
        x,
        y: rand(0, this.bankLineAt(x)),
        r: rand(0.4, 1.3),
        dark: Math.random() < 0.55,
        a: rand(0.05, 0.18),
      });
    }

    // 泥沼气泡：分两类——缓慢上浮的大泡 + 贴着泥面的小闷泡
    this.bubbles = [];
    const bubN = Math.max(18, Math.round(this.w / 62));
    for (let i = 0; i < bubN; i++) {
      const x = rand(0, this.w);
      const top = this.marshLineAt(x);
      const big = Math.random() < 0.4;
      this.bubbles.push({
        x,
        y: rand(top + 3, top + (this.h - top) * (big ? 0.55 : 1)),
        r: big ? rand(2.6, 5.4) : rand(1.0, 2.4),
        phase: rand(0, Math.PI * 2),
        speed: big ? rand(0.28, 0.6) : rand(0.6, 1.4),
        rise: big ? rand(3, 8) : 0,     // 大泡缓缓上浮像素
        drift: rand(-3, 3),
        ...this._blobParams(2, 0.10, 0.24),
      });
    }

    // 水底沉积颗粒（悬浮的泥沙点，营造浑浊体积）
    this.silt = [];
    const siltN = Math.round((this.w * (this.h - this.marshY)) / 900);
    for (let i = 0; i < siltN; i++) {
      const x = rand(0, this.w);
      this.silt.push({
        x,
        y: rand(this.marshLineAt(x) - 24, this.h),
        r: rand(0.5, 2.0),
        phase: rand(0, Math.PI * 2),
        speed: rand(0.1, 0.35),
        drift: rand(1.5, 5),
      });
    }

    // 水底零星螺壳 / 枯枝剪影（贴泥面）
    this.bottomDebris = [];
    const debN = Math.max(6, Math.round(this.w / 220));
    for (let i = 0; i < debN; i++) {
      const x = rand(0, this.w);
      this.bottomDebris.push({
        x,
        y: rand(this.marshLineAt(x) - 6, this.h - 4),
        r: rand(3, 9),
        rot: rand(-0.5, 0.5),
        twig: Math.random() < 0.5,
      });
    }

    // 泥面淤泥团：深浅不一的有机斑块，打破整片同色渐变（外形随机）
    this.mudClumps = [];
    const clumpN = Math.max(28, Math.round(this.w / 34));
    for (let i = 0; i < clumpN; i++) {
      const x = rand(0, this.w);
      const span = Math.max(12, this.h - this.marshLineAt(x) - 8);
      this.mudClumps.push({
        x,
        y: this.marshLineAt(x) + rand(5, span),
        rx: rand(6, 26),
        ry: rand(2.5, 9),
        ...this._blobParams(3, 0.10, 0.30),
        alpha: rand(0.08, 0.22),
        dark: Math.random() < 0.6,
      });
    }

    // 泥沼边缘淤泥小丘：贴着泥线，让水陆边界参差不齐（不是一条顺滑曲线）
    this.mudEdges = [];
    const edgeN = Math.max(20, Math.round(this.w / 70));
    for (let i = 0; i < edgeN; i++) {
      const x = rand(0, this.w);
      this.mudEdges.push({
        x,
        y: this.marshLineAt(x) + rand(-1, 3),
        rx: rand(5, 15),
        ry: rand(2.5, 7),
        ...this._blobParams(2, 0.12, 0.30),
      });
    }
  }

  /** 生成一组不规则轮廓参数（blobPath 用），供泥团/气泡/卵石等随机外形 */
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
    this.ripples = [];    // 仅保留"入水溅射"这类短促视觉圈（非主水面波动）
  }

  /**
   * 扰动水面（投喂 / 生物入水 / 雨滴）
   * 直接落进波动方程场，waves 会真实传播 + 干涉 + 衰减。
   * @param {number} x,y
   * @param {number} strength 强度（1 ≈ 一颗小石子）
   */
  addRipple(x, y, strength = 1) {
    if (this.wave) this.wave.disturb(x, y, strength * 1.2, 2 + Math.round(strength));
    // 保留一圈稍纵即逝的亮环，增强"落点"的即时反馈
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
   * 鼠标尾迹 —— 沿移动线段连续扰动波场，形成真实的连锁波纹（wake）
   * @param {number} x0,y0 上一位置
   * @param {number} x1,y1 当前位置
   * @param {number} speed 光标速度 px/s（越快扰动越强）
   */
  addWake(x0, y0, x1, y1, speed = 0) {
    if (!this.wave) return;
    const s = clamp(0.35 + speed / 1400, 0.35, 1.5);
    // 起点不在水面就跳过（避免岸上拖动也起波）
    if (!this.isWater(x1, y1)) return;
    this.wave.disturbLine(x0, y0, x1, y1, s, 2);
  }

  update(dt) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const rp = this.ripples[i];
      rp.r += rp.speed * dt;
      rp.alpha -= 1.1 * dt;
      if (rp.alpha <= 0 || rp.r >= rp.maxR) this.ripples.splice(i, 1);
    }
    // 推进真实波场（核心）
    if (this.wave) this.wave.update(dt);
    for (const b of this.bubbles) {
      b.phase += b.speed * dt;
    }
    for (const s of this.silt) {
      s.phase += s.speed * dt;
    }
  }

  // ────────────────────────────────────────────────────────
  //  渲染
  // ────────────────────────────────────────────────────────

  draw(ctx, time) {
    this._ensureTextures();
    this._drawWater(ctx, time);
    this._drawWaveSurface(ctx, time);   // 真实波场折射明暗
    this._drawMarsh(ctx, time);
    this._drawBank(ctx, time);
    this._drawRipples(ctx);
  }

  /**
   * 真实波场渲染 —— 把高度梯度当水面斜率做折射着色
   *
   * 性能关键：不在主 canvas 上逐块 fillRect（2.5 万次/帧太贵），
   * 而是在一张低分辨率 offscreen canvas 上用 ImageData 直接写像素
   * （≈1.4 万像素的纯数组运算），最后一次性 drawImage 放大贴回。
   */
  _drawWaveSurface(ctx, time) {
    const N = CONFIG.natural || {};
    if (N.enabled === false || N.waveSurface === false) return;
    if (!this.wave || CONFIG.natural?.wave === false) return;

    const top = this.waterTop;
    const bot = this.waterBottom;
    const wh = bot - top;
    if (wh <= 0) return;

    // offscreen 低分辨率画布（每像素 ≈ waveBlock px），惰性创建/复用
    const block = CONFIG.natural?.waveBlock ?? 6;
    const ow = Math.max(2, Math.ceil(this.w / block));
    const oh = Math.max(2, Math.ceil(wh / block));
    if (!this._waveCv || this._waveCv.width !== ow || this._waveCv.height !== oh) {
      this._waveCv = document.createElement('canvas');
      this._waveCv.width = ow;
      this._waveCv.height = oh;
      this._waveCtx = this._waveCv.getContext('2d');
      this._waveImg = this._waveCtx.createImageData(ow, oh);
    }

    const data = this._waveImg.data;
    const lightDirX = -0.55, lightDirY = -0.83;   // 光从左上来
    let p = 0;
    for (let py = 0; py < oh; py++) {
      const sx = 0, sy = top + (py + 0.5) * block;
      // 预判该行是否落在水面内（粗略：用中线采样即可，精确边界交给 clip）
      for (let px = 0; px < ow; px++) {
        const s = this.wave.sample(sx + (px + 0.5) * block, sy);
        const dot = s.gx * lightDirX + s.gy * lightDirY;
        const v = dot * 2.1 + s.h * 0.45;
        const a = Math.abs(v) * 127;
        if (v > 0) {
          // 波峰：亮青白
          data[p] = 228; data[p + 1] = 248; data[p + 2] = 255;
          data[p + 3] = a > 255 ? 255 : a;
        } else {
          // 波谷：深水色
          data[p] = 10; data[p + 1] = 42; data[p + 2] = 54;
          const a2 = a * 0.85;
          data[p + 3] = a2 > 255 ? 255 : a2;
        }
        p += 4;
      }
    }
    this._waveCtx.putImageData(this._waveImg, 0, 0);

    // 贴回主画布（裁剪进水面多边形）
    ctx.save();
    this._waterPath(ctx);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this._waveCv, 0, top, this.w, wh);
    ctx.restore();
  }

  /** 构建水面多边形路径（岸线 → 泥沼线） */
  _waterPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(0, this.bankLineAt(0));
    for (let x = 0; x <= this.w; x += 6) ctx.lineTo(x, this.bankLineAt(x));
    for (let x = this.w; x >= 0; x -= 6) ctx.lineTo(x, this.marshLineAt(x));
    ctx.closePath();
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
    ctx.clip();     // 全部水面纹理都裁在水里

    // ── 1) 基础水体：竖直三段深浅（近岸/中景/深水）────────
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

    // ── 2) 天空倒影带（紧贴岸线的一条横向亮带，随时间呼吸）──
    if (nat && N.skyReflect !== false) {
      const a = 0.16 + 0.05 * Math.sin(time * 0.5);
      const rg = ctx.createLinearGradient(0, top, 0, top + hh * 0.34);
      rg.addColorStop(0, `rgba(207,234,244,${(a * 1.5).toFixed(3)})`);
      rg.addColorStop(0.5, `rgba(180,220,236,${(a * 0.6).toFixed(3)})`);
      rg.addColorStop(1, 'rgba(180,220,236,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, top - 4, this.w, hh * 0.36);
    }

    // ── 3) 水面流动纹理：多频正弦叠加的横向波纹（分段断续）──
    if (nat && N.surfaceFlow !== false) {
      this._drawSurfaceFlow(ctx, time);
    } else {
      // 关闭自然模式时保留原有的稀疏高光
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

    // ── 4) 水下体积暗角：左右两侧 + 深处更暗，形成"水塘感"──
    if (nat) {
      const vg = ctx.createLinearGradient(0, top, 0, bot);
      vg.addColorStop(0, 'rgba(10,40,52,0)');
      vg.addColorStop(0.62, 'rgba(10,40,52,0.06)');
      vg.addColorStop(1, 'rgba(6,28,38,0.26)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, top - 8, this.w, hh + 16);
    }

    ctx.restore();
  }

  /** 水面流动纹理：5 层不同频率/相位的正弦波，断续出现像真实反光 */
  _drawSurfaceFlow(ctx, time) {
    ctx.save();
    ctx.lineCap = 'round';
    const top = this.waterTop;
    const hh = this.waterHeight;
    const rows = 9;
    for (let i = 0; i < rows; i++) {
      const f = (i + 0.5) / rows;
      const baseY = top + hh * (0.06 + f * 0.86);
      // 每一行断续的起止（缓慢漂移）
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

  _drawMarsh(ctx, time) {
    const N = CONFIG.natural || {};
    const nat = N.enabled !== false;
    const C = CONFIG.colors;

    // 基础泥沼渐变
    const g = ctx.createLinearGradient(0, this.marshY - 14, 0, this.h);
    g.addColorStop(0, C.marsh);
    g.addColorStop(1, C.marshMud);
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, this.marshLineAt(0));
    for (let x = 0; x <= this.w; x += 8) ctx.lineTo(x, this.marshLineAt(x));
    ctx.lineTo(this.w, this.h);
    ctx.lineTo(0, this.h);
    ctx.closePath();
    ctx.fill();

    // ── 程序化泥浆纹理（阶段 5-⑪）：叠加 fBm 生成的泥斑/湿痕 ──
    if (nat && N.terrainTex !== false && this.tex) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, this.marshLineAt(0));
      for (let x = 0; x <= this.w; x += 8) ctx.lineTo(x, this.marshLineAt(x));
      ctx.lineTo(this.w, this.h);
      ctx.lineTo(0, this.h);
      ctx.closePath();
      ctx.clip();
      // 泥浆 + 淤积两层错位叠加（不同平铺偏移 → 不出现明显重复）
      tileTexture(ctx, this.tex.mud, 0, this.marshY - 14, this.w, this.h - this.marshY + 14,
        0, 0, N.terrainTexAlpha ?? 0.55);
      tileTexture(ctx, this.tex.silt, 0, this.marshY - 14, this.w, this.h - this.marshY + 14,
        137, 89, (N.terrainTexAlpha ?? 0.55) * 0.6);
      ctx.restore();
    }

    // 泥面与水体的过渡阴影（水底的暗）
    ctx.save();
    ctx.globalAlpha = 0.30;
    const tg = ctx.createLinearGradient(0, this.marshY - 18, 0, this.marshY + 6);
    tg.addColorStop(0, 'rgba(10,32,40,0.0)');
    tg.addColorStop(1, 'rgba(10,26,30,0.7)');
    ctx.fillStyle = tg;
    ctx.fillRect(0, this.marshY - 18, this.w, 26);
    ctx.restore();

    // 淤泥团 + 泥线小丘（外形随机，泥面不再是一整块平色）
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
      // 沉积泥沙颗粒（半透明悬浮，营造浑浊）
      for (const s of this.silt) {
        const pulse = 0.5 + 0.5 * Math.sin(s.phase);
        ctx.globalAlpha = 0.05 + pulse * 0.11;
        ctx.fillStyle = '#8a8060';
        ctx.beginPath();
        ctx.arc(s.x + Math.sin(s.phase) * s.drift, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 泥底暗斑（不规则浊块）
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

    // 气泡：大泡上浮 + 小泡闷在泥面
    ctx.save();
    for (const b of this.bubbles) {
      const pulse = 0.5 + 0.5 * Math.sin(b.phase);
      let by = b.y;
      if (b.rise) by = b.y - (pulse * b.rise);   // 大泡缓缓上浮
      const alpha = (b.r > 2.6 ? 0.10 : 0.06) + pulse * (b.r > 2.6 ? 0.18 : 0.10);
      ctx.globalAlpha = alpha;
      // 泡体（不规则团，不是正圆）
      ctx.fillStyle = b.r > 2.6 ? '#8a7f56' : '#6f6a48';
      const br = b.r * (0.8 + pulse * 0.4);
      blobPath(ctx, b.x + Math.sin(b.phase) * b.drift * 0.4, by,
        br, br * 0.85, b.amps, b.phases, b.rot + b.phase * 0.2);
      ctx.fill();
      // 泡顶高光（小亮点，让泡有体积）
      ctx.globalAlpha = alpha * 0.8;
      ctx.fillStyle = '#c9c08e';
      ctx.beginPath();
      ctx.arc(b.x + Math.sin(b.phase) * b.drift * 0.4 - b.r * 0.28, by - b.r * 0.3, b.r * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawBank(ctx, time) {
    const N = CONFIG.natural || {};
    const nat = N.enabled !== false;
    const C = CONFIG.colors;

    // ── 基础沙地/草地渐变 ─────────────────────────────
    const g = ctx.createLinearGradient(0, 0, 0, this.bankY);
    if (nat) {
      g.addColorStop(0.00, C.bankGrassDark);
      g.addColorStop(0.34, C.bankGrass);
      g.addColorStop(0.62, C.bankSand);
      g.addColorStop(1.00, C.bankSandDark);
    } else {
      g.addColorStop(0, C.bankGrass);
      g.addColorStop(0.45, C.bankSand);
      g.addColorStop(1, '#b8a075');
    }
    ctx.fillStyle = g;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.w, 0);
    ctx.lineTo(this.w, this.bankLineAt(this.w));
    for (let x = this.w; x >= 0; x -= 6) ctx.lineTo(x, this.bankLineAt(x));
    ctx.closePath();
    ctx.fill();

    ctx.save();
    // 岸边路径裁剪，让纹理不越界
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(this.w, 0);
    ctx.lineTo(this.w, this.bankLineAt(this.w));
    for (let x = this.w; x >= 0; x -= 6) ctx.lineTo(x, this.bankLineAt(x));
    ctx.closePath();
    ctx.clip();

    // ── 程序化沙地纹理（阶段 5-⑪）：fBm 细沙 + 湿泥错位叠加 ──
    if (nat && N.terrainTex !== false && this.tex) {
      tileTexture(ctx, this.tex.sand, 0, 0, this.w, this.bankY + 10, 0, 0, N.terrainTexAlpha ?? 0.55);
      tileTexture(ctx, this.tex.wetmud, 0, 0, this.w, this.bankY + 10, 71, 211,
        (N.terrainTexAlpha ?? 0.55) * 0.45);
    }

    if (nat && N.bankTexture !== false) {
      // 沙粒噪点
      for (const s of this.sandGrain) {
        ctx.globalAlpha = s.a;
        ctx.fillStyle = s.dark ? '#6b5636' : '#f2e6c6';
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      // 细碎卵石（不规则小团）
      for (const p of this.pebbles) {
        const c = Math.round(150 * p.lig);
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = `rgb(${c},${c - 8},${c - 26})`;
        blobPath(ctx, p.x, p.y, p.r, p.r * 0.68, p.amps, p.phases, p.rot);
        ctx.fill();
      }
    }

    // 岸边湿泥过渡带（贴着岸线的一条深色湿痕，宽度随宽度波动）
    ctx.globalAlpha = nat ? 0.42 : 0.35;
    ctx.strokeStyle = '#79653f';
    ctx.lineWidth = nat ? 7 : 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, this.bankLineAt(0) - 1);
    for (let x = 0; x <= this.w; x += 8) {
      ctx.lineTo(x, this.bankLineAt(x) - 1 + Math.sin(x * 0.05) * 0.8);
    }
    ctx.stroke();
    // 湿带内侧更亮的一点反光（水汽）
    if (nat) {
      ctx.globalAlpha = 0.18;
      ctx.strokeStyle = '#c3b78e';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(0, this.bankLineAt(0) + 3);
      for (let x = 0; x <= this.w; x += 10) ctx.lineTo(x, this.bankLineAt(x) + 3);
      ctx.stroke();
    }
    ctx.restore();

    // ── 石头（不规则轮廓 + 顶光 + 底部接触阴影）────────
    for (const r of this.rocks) {
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(r.rot);

      // 接触阴影
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#2a2416';
      ctx.beginPath();
      ctx.ellipse(0.8, r.r * 0.62, r.r * 1.02, r.r * 0.34, 0, 0, Math.PI * 2);
      ctx.fill();

      // 石体
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

      // 顶面受光
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = '#fdfbf2';
      ctx.beginPath();
      ctx.ellipse(-r.r * 0.22, -r.r * 0.3, r.r * 0.5, r.r * 0.28, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // ── 草丛（逐根带风摆，明暗层次）─────────────────────
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
      // 叶尖高光
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

  /** 落点溅射环（短促亮环，增强"有东西落水"的即时反馈；主水面波动已由波场负责） */
  _drawRipples(ctx) {
    if (!this.ripples.length) return;
    ctx.save();
    for (const rp of this.ripples) {
      const k = rp.r / rp.maxR;               // 0→1 生命周期
      ctx.globalAlpha = Math.max(0, rp.alpha) * (1 - k);
      ctx.strokeStyle = '#e6f6fb';
      ctx.lineWidth = 1.4 * (1 - k * 0.6);
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.40, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}
