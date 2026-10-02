/**
 * 视觉打磨 —— 阶段 5-⑧
 *
 * 三层"氛围"效果，全部零依赖、纯 Canvas 2D：
 *
 *  ① 生物阴影（depthShadow）—— 按 y 深度换算投影偏移/模糊/浓度
 *     水面附近的生物影子小而清晰，深处的影子大而弥散（模拟水柱吸水光）
 *
 *  ② 水下景深（depthFog）—— 越靠近水底越偏冷、越被蓝绿雾吃掉
 *     在生物绘制完成后铺一层"按深度加权"的雾，营造水体纵深
 *
 *  ③ 水面焦散（caustics）—— 程序化生成的水面光斑（正弦叠加），
 *     缓慢漂移 + 随昼夜光强/天气衰减，贴在水面上层
 *
 * 所有效果共用 CONFIG.fx 开关，可被 Lively 属性 / 控制台单独关闭做性能对比。
 */

import { CONFIG } from './config.js';

// 一处常数：水体纵深归一化用的采样缓存（避免每帧重建数组）
const FOG_STOPS = 8;

export class FXLayer {
  constructor(world) {
    this.world = world;
    this._causticSeed = 0;
    // 焦散用到的正弦相位（少量固定谐波，成本极低）
    this._waves = [];
    for (let i = 0; i < 5; i++) {
      this._waves.push({
        fx: 0.0032 + i * 0.0011,
        fy: 0.0055 + i * 0.0017,
        sp: 0.12 + i * 0.055,
        amp: 1 / (i + 1.6),
        ph: i * 1.7,
      });
    }
  }

  get enabled() { return CONFIG.fx?.enabled ?? true; }

  /**
   * 水体纵深 t：0 = 水面（岸线），1 = 水底（泥沼线）
   * 生物在岸上时按 0 处理（不受水下雾影响）
   */
  depthAt(y, x) {
    const W = this.world;
    const top = W.bankLineAt(x);
    const bot = W.marshLineAt(x);
    const span = Math.max(1, bot - top);
    return Math.min(1, Math.max(0, (y - top) / span));
  }

  /**
   * ① 生物阴影 —— 在生物本体之前调用
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x:number,y:number,size:number,kind?:string}} c
   */
  drawShadow(ctx, c) {
    if (!this.enabled || !(CONFIG.fx?.shadow ?? true)) return;
    // 岸上生物（龟晒背）不投水下阴影，改为贴地浅影
    const W = this.world;
    const onLand = !W.isWater(c.x, c.y);
    const t = onLand ? 0 : this.depthAt(c.y, c.x);

    const s = c.size;
    // 深处影子更大更淡（水柱扩散）
    const rx = onLand ? s * 0.5 : s * (0.42 + t * 0.34);
    const ry = rx * 0.34;
    const offX = onLand ? s * 0.08 : s * (0.1 + t * 0.08);
    const offY = onLand ? s * 0.1 : s * (0.16 + t * 0.1);
    const alpha = onLand ? 0.16 : 0.26 * (1 - t * 0.45);

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#0a1c24';
    ctx.beginPath();
    ctx.ellipse(c.x + offX, c.y + offY, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * ② 水下景深雾 —— 在生物/遗骸绘制完之后、水面浮叶之前调用
   * 用"下深上浅"的线性渐变盖一层冷色，靠近水底的生物自然被雾吃掉
   */
  drawDepthFog(ctx, light = 1) {
    if (!this.enabled || !(CONFIG.fx?.depthFog ?? true)) return;
    const W = this.world;
    const g = ctx.createLinearGradient(0, W.bankLineAt(W.w * 0.5), 0, W.marshLineAt(W.w * 0.5));
    // 雾色偏水体本色（青绿），白天稍亮、夜晚更暗
    const a = 0.16 * (0.55 + 0.45 * light);
    g.addColorStop(0, `rgba(58,120,138,0)`);
    g.addColorStop(0.45, `rgba(48,104,124,${(a * 0.45).toFixed(3)})`);
    g.addColorStop(1, `rgba(34,72,92,${a.toFixed(3)})`);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, W.bankLineAt(0));
    for (let x = 0; x <= W.w; x += 8) ctx.lineTo(x, W.bankLineAt(x));
    for (let x = W.w; x >= 0; x -= 8) ctx.lineTo(x, W.marshLineAt(x));
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
  }

  /**
   * ③ 水面焦散光斑 —— 在全球最后、色罩之前/之后均可（建议色罩之前）
   * @param {number} time 秒
   * @param {number} light 0~1 昼夜光强
   * @param {boolean} rain 是否下雨（雨天无强光斑）
   */
  drawCaustics(ctx, time, light = 1, rain = false) {
    if (!this.enabled || !(CONFIG.fx?.caustics ?? true)) return;
    if (light < 0.25) return;                 // 夜里几乎无光斑
    const W = this.world;
    const baseA = (rain ? 0.03 : 0.075) * light;

    ctx.save();
    // 只在水面区域叠加
    ctx.beginPath();
    ctx.moveTo(0, W.bankLineAt(0));
    for (let x = 0; x <= W.w; x += 8) ctx.lineTo(x, W.bankLineAt(x));
    for (let x = W.w; x >= 0; x -= 8) ctx.lineTo(x, W.marshLineAt(x));
    ctx.closePath();
    ctx.clip();

    const top = W.waterTop;
    const h = W.waterHeight;
    ctx.globalCompositeOperation = 'lighter';

    // 不等距光带 + 各自独立漂移/明暗（避免"等距扫描线"感）
    const bands = 11;
    for (let b = 0; b < bands; b++) {
      // 每条 band 的固定伪随机参数（seed = b，保证每帧一致不闪烁）
      const s1 = Math.sin(b * 127.1) * 43758.55;
      const s2 = Math.sin(b * 311.7) * 12543.85;
      const j1 = s1 - Math.floor(s1);          // 0~1 伪随机
      const j2 = s2 - Math.floor(s2);
      const y0 = top + h * ((b + 0.35 + j1 * 0.5) / bands)
        + Math.sin(time * (0.16 + j2 * 0.12) + b * 2.13) * 7;   // 缓慢上下漂移
      const drift = time * (8 + b * 3.3);
      // 越深越淡（光从水面射入）
      const depthFade = 1 - (b / bands) * 0.62;
      const alpha = baseA * depthFade * (0.45 + j2 * 0.7);
      if (alpha < 0.008) continue;

      ctx.strokeStyle = `rgba(198,238,248,${alpha.toFixed(3)})`;
      ctx.lineWidth = 1.4 + j1 * 1.8;
      ctx.beginPath();
      let first = true;
      for (let x = -20; x <= W.w + 20; x += 12) {
        let off = 0;
        for (const w of this._waves) {
          off += Math.sin(x * w.fx + y0 * w.fy + time * w.sp * 3 + w.ph + b * 1.9)
            * w.amp * 8.5;                     // 幅度加大，光带扭曲成水纹
        }
        const y = y0 + off + Math.sin((x + drift) * 0.007 + b) * 3.5;
        first ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        first = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * ④ 水面高光带 —— 紧贴岸线的多层水沫/湿痕（水与岸的分界感）
   *    由内到外：水面反光 → 湿漉漉的暗痕 → 细微泡沫点
   */
  drawWaterEdge(ctx, time, light = 1) {
    if (!this.enabled || !(CONFIG.fx?.waterEdge ?? true)) return;
    const W = this.world;
    const brightness = 0.5 + 0.5 * light;

    ctx.save();
    // 1) 水面反光（半透明亮线，随光强呼吸）
    ctx.globalAlpha = 0.30 * brightness;
    ctx.strokeStyle = '#dff4fb';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, W.bankLineAt(0));
    for (let x = 0; x <= W.w; x += 10) {
      ctx.lineTo(x, W.bankLineAt(x) + Math.sin(x * 0.02 + time * 1.1) * 1.6);
    }
    ctx.stroke();

    // 2) 紧贴其上的湿痕暗线（让岸线更有厚度）
    ctx.globalAlpha = 0.16 * brightness;
    ctx.strokeStyle = '#5c7d84';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(0, W.bankLineAt(0) - 1.4);
    for (let x = 0; x <= W.w; x += 10) {
      ctx.lineTo(x, W.bankLineAt(x) - 1.4 + Math.sin(x * 0.02 + time * 1.1 + 1.5) * 1.2);
    }
    ctx.stroke();

    // 3) 岸边零星泡沫点（贴岸线分布的小亮点，缓慢明灭）
    ctx.globalAlpha = 0.18 * brightness;
    ctx.fillStyle = '#eaf7fb';
    for (let i = 0; i < 40; i++) {
      const x = ((i * 137.5) % W.w);
      const y = W.bankLineAt(x) + Math.sin(i * 1.7) * 3;
      const tw = 0.5 + 0.5 * Math.sin(time * 1.6 + i);
      ctx.globalAlpha = 0.10 + tw * 0.16 * brightness;
      ctx.beginPath();
      ctx.arc(x, y, 0.9 + tw * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
