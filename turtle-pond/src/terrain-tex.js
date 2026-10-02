/**
 * 程序化地表纹理 —— 零素材依赖的"泥 / 沙 / 沉积物"质感
 *
 * 为什么不用照片贴图？
 *   现成的 CC0 PBR 贴图（ambientCG / Poly Haven）是给 3D 引擎的，
 *   塞进 Canvas2D 要自己写采样，而且照片质感和当前的绘本矢量画风会打架。
 *   这里改用 **value noise + fBm** 现场生成无缝纹理，风格统一、体积极小（0 字节素材）。
 *
 * 生成一次 → 缓存到离屏 canvas → 每帧只做一次 drawImage（平移错位成无缝平铺）。
 *
 * 三种植被打包：
 *   mud   泥浆（水底沉积：暗、湿、有大块斑驳）
 *   sand  沙地（岸边：细密颗粒 + 轻微起伏）
 *   silt  淤积（水中悬浮的细泥，更浅更朦胧）
 */

/** 确定性伪随机（同一 seed 每次生成一样的纹理，便于测试与复现） */
function hash2(x, y, seed) {
  let h = x * 374761393 + y * 668265263 + seed * 2147483647;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h >>> 0) / 4294967295;
}

/** 平滑插值（smoothstep） */
function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** 二维 value noise，周期 period（保证可无缝平铺） */
function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  // 取模实现无缝：坐标环绕到 [0, period)
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;

  const v00 = hash2(x0, y0, seed);
  const v10 = hash2(x1, y0, seed);
  const v01 = hash2(x0, y1, seed);
  const v11 = hash2(x1, y1, seed);

  const sx = smooth(xf), sy = smooth(yf);
  const a = v00 + (v10 - v00) * sx;
  const b = v01 + (v11 - v01) * sx;
  return a + (b - a) * sy;
}

/** 分形叠加（fBm）：多个倍频噪声叠加，产生自然的粗糙感 */
function fbm(x, y, basePeriod, octaves, seed, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, basePeriod * freq, seed + o * 97) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * 生成一张无缝程序纹理
 * @param {object} opts
 *   size    出图边长（建议 256）
 *   seed    随机种子
 *   base    底色 [r,g,b]
 *   dark    暗部色 [r,g,b]
 *   light   亮部色 [r,g,b]
 *   period  fBm 基础周期（越小斑块越大）
 *   octaves 倍频层数
 *   grain   颗粒强度 0~1
 *   contrast 对比 0~1
 * @returns {HTMLCanvasElement}
 */
export function makeTerrainTexture(opts = {}) {
  const {
    size = 256,
    seed = 1,
    base = [90, 84, 62],
    dark = [42, 38, 28],
    light = [140, 132, 100],
    period = 6,
    octaves = 5,
    grain = 0.5,
    contrast = 0.6,
  } = opts;

  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 大尺度斑驳 + 中尺度起伏
      const nBig = fbm(x / size * period, y / size * period, period, octaves, seed);
      // 细颗粒（高频、低强度）
      const nGrain = valueNoise(x, y, size, seed + 517);
      // 明暗偏向：把 fBm 从 0~1 映射到 [-1,1] 再按对比度拉伸
      let t = (nBig - 0.5) * 2;
      t = Math.max(-1, Math.min(1, t * (0.5 + contrast)));
      // 基础上色：t>0 往亮部混，t<0 往暗部混
      let r, g, b;
      if (t >= 0) {
        r = base[0] + (light[0] - base[0]) * t;
        g = base[1] + (light[1] - base[1]) * t;
        b = base[2] + (light[2] - base[2]) * t;
      } else {
        const k = -t;
        r = base[0] + (dark[0] - base[0]) * k;
        g = base[1] + (dark[1] - base[1]) * k;
        b = base[2] + (dark[2] - base[2]) * k;
      }
      // 叠加颗粒噪点
      const gp = (nGrain - 0.5) * 2 * grain * 42;
      r += gp; g += gp; b += gp;

      const p = (y * size + x) * 4;
      d[p] = Math.max(0, Math.min(255, r));
      d[p + 1] = Math.max(0, Math.min(255, g));
      d[p + 2] = Math.max(0, Math.min(255, b));
      d[p + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

/** 预设：一套协调的半写实「水塘地表」纹理 */
export function makePondTextures() {
  return {
    // 水底泥沼：暗褐、湿润、斑驳
    mud: makeTerrainTexture({
      seed: 11, base: [74, 66, 48], dark: [30, 27, 19], light: [116, 106, 78],
      period: 5, octaves: 5, grain: 0.35, contrast: 0.85,
    }),
    // 岸边沙地：偏黄、细密
    sand: makeTerrainTexture({
      seed: 23, base: [186, 168, 126], dark: [128, 112, 76], light: [222, 208, 168],
      period: 8, octaves: 4, grain: 0.75, contrast: 0.5,
    }),
    // 水中淤积：偏青灰、朦胧
    silt: makeTerrainTexture({
      seed: 37, base: [96, 96, 74], dark: [52, 56, 46], light: [140, 142, 116],
      period: 4, octaves: 6, grain: 0.25, contrast: 0.4,
    }),
    // 岸边湿泥：深色、过渡带
    wetmud: makeTerrainTexture({
      seed: 53, base: [92, 78, 54], dark: [46, 38, 26], light: [132, 116, 84],
      period: 6, octaves: 5, grain: 0.45, contrast: 0.7,
    }),
  };
}

/**
 * 把纹理按 (offsetX,offsetY) 平铺到目标上下文（错位叠加消除接缝感）
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLCanvasElement} tex
 * @param {number} x,y,w,h 目标区域
 * @param {number} offsetX,offsetY 平铺偏移
 * @param {number} alpha 透明度
 */
export function tileTexture(ctx, tex, x, y, w, h, offsetX = 0, offsetY = 0, alpha = 1) {
  const s = tex.width;
  const ox = ((offsetX % s) + s) % s;
  const oy = ((offsetY % s) + s) % s;
  ctx.save();
  ctx.globalAlpha = alpha;
  for (let ty = y - oy; ty < y + h; ty += s) {
    for (let tx = x - ox; tx < x + w; tx += s) {
      ctx.drawImage(tex, tx, ty);
    }
  }
  ctx.restore();
}

export const TERRAIN_TEX_INTERNALS = { hash2, valueNoise, fbm };
