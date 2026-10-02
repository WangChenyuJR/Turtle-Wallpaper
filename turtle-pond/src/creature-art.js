/**
 * 生物美术 —— 「H 档 · 侧视萌化」统一画法（工作文档 阶段 5-⑬）
 *
 * 从 _style_test.html 的 H 档移植（参数化 13 龟种 + 侧视小鱼），作为
 * 水塘里所有生物的唯一渲染入口。设计要点：
 *
 *   · 侧视立绘 —— 头朝右为正向；水下朝向由调用方处理（水平镜像 + 轻微俯仰，
 *     见 turtle.js / fish.js 的 draw），本模块永远画"直立、朝右"的一帧
 *   · 种间特征 —— 皮肤从品种字段派生（artMark 头颈标志 / artPattern 背甲纹样 /
 *     snout 吻端 / flat 扁壳），同套几何、不同特征，一眼能分品种
 *   · 个体差异 —— 每只生物一个 artSeed：色相/明度微偏 + 轮廓种子偏移，
 *     同种不同个体胖瘦、深浅、纹路细节都略有不同（存档持久化）
 *   · 零依赖 —— 纯 Canvas 2D，不读任何图片素材
 */

import { seededRandom as sRand } from './utils.js';

// ══════════════════════════════════════════════════════════
//  色 彩 工 具
// ══════════════════════════════════════════════════════════

/** hex → [r,g,b] */
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hex(r, g, b) {
  const m = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return '#' + m(r) + m(g) + m(b);
}

/** 颜色按比例暗化（远侧肢体 / 背光面 / 纹路派生） */
export function darken(c, f = 0.74) {
  if (c[0] !== '#') return c;                      // 已是 rgb()/rgba() → 原样
  const [r, g, b] = rgb(c);
  return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`;
}

/** hex 向暖白 (255,240,205) 插值 —— 保饱和度的萌系亮色（向纯白插值会灰化） */
export function lighten(c, f = 0.4) {
  if (c[0] !== '#') return c;
  const [r, g, b] = rgb(c);
  const m = (v, w) => Math.round(v + (w - v) * f);
  return hex(m(r, 255), m(g, 240), m(b, 205));
}

/**
 * 个体色差：色相/饱和/明度整体微偏。
 * dh ±14（色相环角度）、ds/dl ±0.10 —— 肉眼"每只不太一样"，但不破坏品种辨认。
 */
function tint(c, dh, ds, dl) {
  if (c[0] !== '#') return c;
  let [r, g, b] = rgb(c).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  h = (h + dh + 360) % 360;
  s = Math.max(0, Math.min(1, s + ds));
  const l2 = Math.max(0, Math.min(1, l + dl));
  // HSL → RGB（标准公式：h 单位为角度，k 走 12 等分色环）
  const a2 = s * Math.min(l2, 1 - l2);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l2 - a2 * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return hex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// ══════════════════════════════════════════════════════════
//  有 机 轮 廓（手绘感的基础件）
// ══════════════════════════════════════════════════════════

/**
 * 手绘有机轮廓：低频歪扭 + 中频鼓瘪 + 高频手抖 + 可选高斯趾瓣，
 * Catmull-Rom 式中点二次贝塞尔平滑闭合。原点为中心。
 * 注意：**只描述路径，不填色**——调用方负责 fill/stroke，且
 * 以原点为中心 ⇒ 调用前必须先 translate 到目标位置。
 */
export function organicPath(ctx, rx, ry, seed, o = {}) {
  const r = sRand(seed);
  const low = o.low ?? 0.03, high = o.high ?? 0.012;
  // 频率必须低于采样极限（N=18 点 → <3 周期/圈），否则路径混叠自交叉、nonzero 填充抵消消失
  const f1 = 2 + Math.floor(r() * 2);   // 2~3：形状级歪扭
  const f2 = 3 + Math.floor(r() * 2);   // 3~4：局部鼓瘪
  const p1 = r() * Math.PI * 2, p2 = r() * Math.PI * 2;
  const N = 18, pts = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const base = (rx * ry) / Math.hypot(ry * Math.cos(t), rx * Math.sin(t));
    let w = 1
      + low * Math.sin(t * f1 + p1)
      + low * 0.55 * Math.sin(t * f2 + p2)
      + (r() - 0.5) * 2 * high;
    if (o.bumps) {
      for (const [bi, ba, bs] of o.bumps) {
        let d = t - bi;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        w += ba * Math.exp(-(d * d) / (2 * bs * bs));
      }
    }
    pts.push([Math.cos(t) * base * w, Math.sin(t) * base * w]);
  }
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  ctx.beginPath();
  const m0 = mid(pts[N - 1], pts[0]);
  ctx.moveTo(m0[0], m0[1]);
  for (let i = 0; i < N; i++) {
    const p = pts[i], q = pts[(i + 1) % N], m = mid(p, q);
    ctx.quadraticCurveTo(p[0], p[1], m[0], m[1]);
  }
  ctx.closePath();
}

/** 复笔描边：同一笔走两遍（宽而淡 + 窄而浓），模拟手绘笔锋的深浅 */
export function organicStroke(ctx, C, lw) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = C.line;
  ctx.globalAlpha = 0.30; ctx.lineWidth = lw * 1.7; ctx.stroke();
  ctx.globalAlpha = 0.90; ctx.lineWidth = lw;       ctx.stroke();
  ctx.globalAlpha = 1;
}

/** 白色贴纸描边：先粗白再细棕（水彩贴纸风的部件级白边） */
export function stickerStroke(ctx, s, lineC) {
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2.4, s * 0.032); ctx.stroke();
  ctx.strokeStyle = lineC;     ctx.lineWidth = Math.max(0.9, s * 0.011); ctx.stroke();
}

/** 统一描边策略：ink = 墨线 / sticker = 白贴纸双描边 / none = 无描边 */
export function sideStroke(ctx, s, P, w = 0.013) {
  if (P.stroke === 'sticker') { stickerStroke(ctx, s, P.C.line); return; }
  if (P.stroke === 'ink') {
    ctx.strokeStyle = P.C.line;
    ctx.lineWidth = Math.max(0.9, s * w);
    ctx.stroke();
  }
}

// ══════════════════════════════════════════════════════════
//  侧 视 龟（H 档）
// ══════════════════════════════════════════════════════════

/** 侧视腿：桨状有机轮廓 + 末端三趾瓣；far = 远侧腿（更暗、更小、露更少） */
export function sideLeg(ctx, s, ph, P, o) {
  const C = P.C;
  const far = !!o.far;
  const so = (P.so ?? 0) * 7;
  const swing = Math.sin(ph + (o.ph0 || 0) + (far ? 0.85 : 0)) * 0.40 * (P.legAmp ?? 1);
  const round = P.round ?? 0.5;
  const rx = s * (round > 0.64 ? 0.082 : 0.076) * (far ? 0.88 : 1);
  const ry = s * (round > 0.64 ? 0.162 : 0.175) * (far ? 0.88 : 1);
  ctx.save();
  ctx.translate(o.x + (far ? -s * 0.035 : 0), s * (far ? 0.165 : 0.205));
  // dir=-1 前腿（腿尖向前下）/+1 后腿（腿尖向后下）；swing 越大划幅越大
  ctx.rotate(o.dir * (0.52 + swing * 0.5));
  organicPath(ctx, rx, ry, 41 + so + (far ? 3 : 0) + (o.dir > 0 ? 0 : 7), {
    low: 0.028, high: 0.010,
    bumps: [[1.12, 0.17, 0.17], [1.57, 0.20, 0.18], [2.02, 0.17, 0.17]],  // 末端三趾瓣
  });
  if (P.grad > 0.4 && !far) {
    const g = ctx.createRadialGradient(-rx * 0.3, -ry * 0.45, s * 0.01, 0, 0, ry * 1.25);
    g.addColorStop(0, C.limbHi); g.addColorStop(1, C.limb);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = far ? darken(C.limb, 0.78) : C.limb;
  }
  ctx.fill();
  if (!far) sideStroke(ctx, s, P, 0.012);
  // 趾瓣分隔（中高细节档）
  if ((P.detail ?? 0.5) > 0.4 && !far) {
    ctx.strokeStyle = 'rgba(0,0,0,0.26)';
    ctx.lineWidth = Math.max(0.7, s * 0.010);
    ctx.lineCap = 'round';
    [-0.28, 0.28].forEach((a) => {
      ctx.beginPath();
      ctx.moveTo(Math.cos(1.57 + a) * rx * 0.55, Math.sin(1.57 + a) * ry * 0.55);
      ctx.lineTo(Math.cos(1.57 + a) * rx * 1.02, Math.sin(1.57 + a) * ry * 1.02);
      ctx.stroke();
    });
  }
  // 四肢鳞纹（最高细节档）
  if ((P.detail ?? 0.5) > 0.85 && !far) {
    ctx.fillStyle = 'rgba(62,50,32,0.22)';
    for (let i = 0; i < 4; i++) {
      const a = 1.57 + (i - 1.5) * 0.30;
      const rr = 0.55 + (i % 2) * 0.14;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * rx * rr, Math.sin(a) * ry * rr, Math.max(0.6, s * 0.007), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * 侧视龟主体（种间特征全走 P）
 * P = { C, headScale, round, grad, stroke, detail, kawaii, blush, shadow, smile,
 *       mark:'throat|ear|line|none', pat:'scutes|rings|lines|rim|smooth',
 *       flat, snout, scutes, so(个体种子偏移) }
 * 原点 = 身体几何中心；头朝右。垂直范围约 [-0.66s, +0.39s]。
 */
export function drawSideTurtle(ctx, s, ph, P) {
  const C = P.C;
  const hs = P.headScale ?? 1.0;
  const round = P.round ?? 0.5;
  const detail = P.detail ?? 0.5;
  const kawaii = P.kawaii ?? 0.5;
  const so = P.so ?? 0;

  // ① 底部软影（体积档）
  if (P.shadow) {
    ctx.fillStyle = 'rgba(88,68,40,0.13)';
    ctx.beginPath();
    ctx.ellipse(0, s * 0.30, s * 0.62, s * 0.085, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ② 远侧腿 → ③ 近侧腿（对角步态：近前+远后同步；都在壳前画，壳盖住腿根）
  sideLeg(ctx, s, ph, P, { x: s * 0.25, dir: -1, far: true, ph0: Math.PI });
  sideLeg(ctx, s, ph, P, { x: -s * 0.27, dir: 1, far: true, ph0: 0 });
  sideLeg(ctx, s, ph, P, { x: s * 0.27, dir: -1, ph0: 0 });
  sideLeg(ctx, s, ph, P, { x: -s * 0.29, dir: 1, ph0: Math.PI });

  // ④ 尾（壳后下方，轻摆）
  ctx.save();
  ctx.translate(-s * 0.46, s * 0.075);
  ctx.rotate(Math.sin(ph * 0.9) * 0.10);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.05);
  ctx.quadraticCurveTo(-s * 0.16, s * 0.005, -s * 0.20, s * 0.10);
  ctx.quadraticCurveTo(-s * 0.10, s * 0.06, 0, s * 0.055);
  ctx.closePath();
  ctx.fillStyle = P.grad > 0.6 ? C.limbHi : C.limb;
  ctx.fill();
  sideStroke(ctx, s, P, 0.011);
  ctx.restore();

  // ⑤ 颈 + 头（先画，壳身随后盖住颈根）
  const bob = Math.sin(ph * 0.62) * s * 0.020;
  const hrx = s * 0.235 * hs;
  const hry = s * 0.205 * hs;
  const hx = s * (0.58 + 0.235 * hs);
  const hy = -s * 0.155 + bob;

  ctx.save();
  ctx.strokeStyle = C.head;
  ctx.lineCap = 'round';
  ctx.lineWidth = s * 0.158 * hs;
  ctx.beginPath();
  ctx.moveTo(s * 0.22, s * 0.01 + bob * 0.3);
  ctx.quadraticCurveTo(s * 0.52, -s * 0.04 + bob * 0.7, hx - hrx * 0.45, hy + hry * 0.05);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(hx, hy);
  organicPath(ctx, hrx, hry, 17 + so, {
    low: 0.024, high: 0.008,
    bumps: [[0, 0.055 + 0.03 * round + (P.snout ?? 0), 0.55]],   // 吻端前凸（甲鱼/枯叶龟更长）
  });
  if (P.grad > 0.4) {
    const g = ctx.createRadialGradient(-hrx * 0.28, -hry * 0.35, s * 0.02, 0, 0, hrx * 1.25);
    g.addColorStop(0, C.headHi); g.addColorStop(1, C.head);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = C.head;
  }
  ctx.fill();
  sideStroke(ctx, s, P, 0.014);

  // ── 头颈品种标志（P.mark）────────────────────────────────
  const mark = P.mark ?? 'throat';
  const mkC = lighten(C.yellow, 0.12);
  ctx.lineCap = 'round';
  if (mark === 'throat') {          // 黄喉：眼后黄纵纹 + 下颌喉部黄（侧面最明显的两条特征）
    ctx.strokeStyle = mkC;
    ctx.lineWidth = Math.max(2, s * 0.046 * hs);
    ctx.beginPath();
    ctx.moveTo(hrx * 0.30, -hry * 0.02);
    ctx.quadraticCurveTo(-hrx * 0.30, hry * 0.16, -hrx * 1.35, hry * 0.18);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.6, s * 0.036 * hs);
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(hrx * 0.70, hry * 0.52);
    ctx.quadraticCurveTo(hrx * 0.30, hry * 0.70, -hrx * 0.10, hry * 0.58);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (mark === 'ear') {      // 耳后斑（巴西红耳 / 焦糖 / 圆澳侧颈）
    ctx.fillStyle = mkC;
    ctx.beginPath();
    ctx.ellipse(-hrx * 0.50, -hry * 0.04, hrx * 0.36, hry * 0.25, -0.20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#fffdf2';
    ctx.beginPath();
    ctx.ellipse(-hrx * 0.56, -hry * 0.08, hrx * 0.19, hry * 0.12, -0.20, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (mark === 'line') {     // 头侧细纵线（草龟 / 地图龟 / 钻纹）
    ctx.strokeStyle = mkC;
    ctx.lineWidth = Math.max(1.1, s * 0.021 * hs);
    ctx.globalAlpha = 0.88;
    [[-0.14, 0.04], [0.24, 0.10]].forEach(([y0, y1]) => {
      ctx.beginPath();
      ctx.moveTo(hrx * 0.92, hry * y0);
      ctx.quadraticCurveTo(hrx * 0.05, hry * (y0 - 0.06), -hrx * 1.30, hry * y1);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
  }

  // 头背碎斑（最高细节档）
  if (detail > 0.85) {
    const r = sRand(53 + so);
    ctx.fillStyle = 'rgba(62,50,32,0.30)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(-hrx * 0.15 + r() * hrx * 0.7, -hry * 0.45 + r() * hry * 0.55,
        Math.max(0.7, s * 0.010), Math.max(0.6, s * 0.008), r() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 眼：侧面单眼（kawaii 档放大 + 双层高光）
  const ex = hrx * 0.40;
  const ey = -hry * 0.24;
  const er = s * (0.038 + 0.024 * kawaii) * Math.max(0.85, hs * 0.9);
  ctx.beginPath(); ctx.arc(ex, ey, er, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2018'; ctx.fill();
  ctx.beginPath(); ctx.arc(ex + er * 0.30, ey - er * 0.34, er * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
  if (kawaii > 0.6) {
    ctx.beginPath(); ctx.arc(ex - er * 0.26, ey + er * 0.30, er * 0.17, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.60)'; ctx.fill();
  }

  // 腮红
  if (P.blush && C.blush) {
    ctx.beginPath();
    ctx.ellipse(hrx * 0.16, hry * 0.32, hrx * 0.26, hry * 0.19, 0, 0, Math.PI * 2);
    ctx.fillStyle = C.blush; ctx.fill();
  }

  // 嘴：微笑弧（smile 档）/ 平嘴
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(0.9, s * 0.012);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (P.smile) {
    ctx.moveTo(hrx * 0.86, hry * 0.10);
    ctx.quadraticCurveTo(hrx * 0.66, hry * 0.42, hrx * 0.40, hry * 0.24);
  } else {
    ctx.moveTo(hrx * 0.84, hry * 0.16);
    ctx.quadraticCurveTo(hrx * 0.70, hry * 0.30, hrx * 0.56, hry * 0.16);
  }
  ctx.stroke();
  // 鼻孔
  ctx.beginPath();
  ctx.arc(hrx * 0.93, hry * 0.02, Math.max(0.6, s * 0.007), 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(60,45,25,0.55)'; ctx.fill();
  ctx.restore();

  // ⑥ 壳（最后绘制，覆盖所有部件根部）——圆滚滚整椭圆（参考图萌系 = 圆顶面包壳）
  const shellRy = (P.flat ? 0.20 : 0.26) + 0.04 * round;
  const shellCy = (P.flat ? -0.24 : -0.36) + shellRy;   // 壳顶固定；扁平种（甲鱼/枯叶）壳顶更低
  ctx.save();
  ctx.translate(0, s * shellCy);
  const shellPath = () => organicPath(ctx, s * 0.56, s * shellRy, 91 + so * 3, { low: 0.018, high: 0.006 });
  shellPath();
  if (P.rimBand) {                      // 扁平档：两段色壳（浅盘 + 深橄榄裙边）
    ctx.fillStyle = C.shell;
    ctx.fill();
    ctx.save(); shellPath(); ctx.clip();
    ctx.fillStyle = C.rim ?? C.shell;
    ctx.fillRect(-s, s * shellRy * 0.55, s * 2, s * 2);
    ctx.restore();
  } else if (P.grad > 0.6) {            // 3D 档：径向渐变
    const g = ctx.createRadialGradient(-s * 0.16, -s * shellRy * 0.42, s * 0.05, 0, 0, s * 0.72);
    g.addColorStop(0, C.shellHi); g.addColorStop(1, C.shell);
    ctx.fillStyle = g; ctx.fill();
  } else {                              // 其余：上亮下暗线性渐变
    const g = ctx.createLinearGradient(0, -s * shellRy, 0, s * shellRy);
    g.addColorStop(0, C.shellHi); g.addColorStop(1, C.shell);
    ctx.fillStyle = g; ctx.fill();
  }
  sideStroke(ctx, s, P, 0.016);

  // 壳面纹路（壳心坐标系，裁剪在壳内）
  ctx.save();
  shellPath();
  ctx.clip();
  const pat = P.pat ?? 'scutes';
  if (pat === 'scutes' || pat === 'rim') {         // 盾缝 + 缘盾刻痕（平滑壳种跳过）
    ctx.strokeStyle = P.rimBand ? (C.seam ?? 'rgba(255,255,255,0.38)') : 'rgba(70,56,32,0.24)';
    ctx.lineWidth = Math.max(0.8, s * 0.010);
    ctx.lineCap = 'round';
    [-0.30, -0.02, 0.26].forEach((fx) => {          // 盾片纵向接缝（柔和弧线，不触底）
      ctx.beginPath();
      ctx.moveTo(s * fx * 0.70, -s * shellRy * 0.88);
      ctx.quadraticCurveTo(s * fx * 1.12, -s * shellRy * 0.18, s * fx * 0.96, s * shellRy * 0.30);
      ctx.stroke();
    });
    for (let i = -3; i <= 3; i++) {                  // 缘盾刻痕（沿下缘内收弧排列，弓形）
      const f = i / 3.6;
      const x = s * 0.50 * f;
      const yb = s * shellRy * (0.78 + 0.15 * Math.cos(Math.PI * f * 0.92));
      ctx.beginPath();
      ctx.moveTo(x * 0.92, yb - s * 0.068);
      ctx.quadraticCurveTo(x * 1.06, yb - s * 0.022, x * 0.98, yb - s * 0.006);
      ctx.stroke();
    }
  }
  if (pat === 'rings') {                           // 同心钻纹（钻纹龟 / 缅甸陆龟）
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = darken(C.shell, 0.58);
    ctx.lineWidth = Math.max(0.8, s * 0.010);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const k = 0.92 - i * 0.21;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.545 * k, s * shellRy * 0.95 * k, 0, Math.PI * 1.04, Math.PI * 1.96);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (pat === 'lines') {                           // 密纵细纹（金线草龟甲面 / 地图龟细纹）
    ctx.save();
    ctx.globalAlpha = 0.60;
    ctx.strokeStyle = darken(C.shell, 0.55);
    ctx.lineWidth = Math.max(0.6, s * 0.008);
    ctx.lineCap = 'round';
    for (let i = -3; i <= 3; i++) {
      const fx = i / 3.4;
      ctx.beginPath();
      ctx.moveTo(s * fx * 0.86, -s * shellRy * 0.80);
      ctx.quadraticCurveTo(s * fx * 1.26, -s * shellRy * 0.04, s * fx * 1.00, s * shellRy * 0.68);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (pat === 'rim') {                             // 黄缘闭壳龟：壳缘一圈黄带
    ctx.save();
    ctx.globalAlpha = 0.60;
    ctx.strokeStyle = C.yellow;
    ctx.lineWidth = s * 0.072;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.545, s * (shellRy - 0.010), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // ── 背甲盾片细节（P.scutes：0 = 关闭）────────────────────────
  // ① 盾缝旁极淡亮边 → 盾片微微翘起的体积感
  // ② 缘盾分片：下缘每两刻痕之间一块柔和明暗片（真龟侧面最明显特征）
  // ③ 壳缘内侧柔和暗带 → 甲壳厚度
  // ④ 盾面中央微鼓高光 → 每块盾片独立鼓起
  const sc = P.scutes ?? 0;
  if (sc > 0.05) {
    ctx.strokeStyle = 'rgba(255,250,232,' + (0.20 * sc).toFixed(3) + ')';
    ctx.lineWidth = Math.max(0.7, s * 0.008);
    [-0.30, -0.02, 0.26].forEach((fx) => {
      ctx.beginPath();
      ctx.moveTo(s * fx * 0.70 + s * 0.020, -s * shellRy * 0.30);
      ctx.quadraticCurveTo(s * (fx * 1.12) + s * 0.020, -s * shellRy * 0.18, s * (fx * 0.96) + s * 0.016, s * shellRy * 0.28);
      ctx.stroke();
    });
    for (let i = -3; i < 3; i++) {
      const fm = (i + 0.5) / 3.6;
      const xm = s * 0.50 * fm;
      const ym = s * shellRy * (0.80 + 0.15 * Math.cos(Math.PI * fm * 0.92));
      ctx.beginPath();
      ctx.ellipse(xm, ym - s * 0.030, s * 0.038, s * 0.028, 0, 0, Math.PI * 2);
      ctx.fillStyle = i % 2
        ? 'rgba(255,252,238,' + (0.24 * sc).toFixed(3) + ')'
        : 'rgba(64,50,28,' + (0.13 * sc).toFixed(3) + ')';
      ctx.fill();
    }
    ctx.save();
    ctx.strokeStyle = 'rgba(70,56,32,' + (0.13 * sc).toFixed(3) + ')';
    ctx.lineWidth = s * 0.055;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.545, s * (shellRy - 0.012), 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,250,232,' + (0.10 * sc).toFixed(3) + ')';
    ctx.lineWidth = Math.max(1.2, s * 0.034);
    ctx.lineCap = 'round';
    [-0.16, 0.12].forEach((fx) => {
      ctx.beginPath();
      ctx.moveTo(s * fx * 0.86, -s * shellRy * 0.38);
      ctx.quadraticCurveTo(s * fx * 1.16, -s * shellRy * 0.14, s * fx * 1.00, s * shellRy * 0.26);
      ctx.stroke();
    });
  }
  if (detail > 0.8) {                              // 放射细纹 + 缘盾深斑（绘本档）
    ctx.strokeStyle = 'rgba(62,50,32,0.28)';
    ctx.lineWidth = Math.max(0.6, s * 0.007);
    for (let i = 0; i < 16; i++) {
      const t = Math.PI * (0.10 + 0.80 * (i / 15));
      ctx.beginPath();
      ctx.moveTo(Math.cos(t) * s * 0.30, -Math.sin(t) * s * shellRy * 0.60);
      ctx.lineTo(Math.cos(t) * s * 0.52, -Math.sin(t) * s * shellRy * 0.97);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(70,56,32,0.26)';
    for (let i = -3; i <= 3; i++) {
      const f = i / 3.6;
      const x = s * 0.50 * f;
      const yb = s * shellRy * (0.78 + 0.15 * Math.cos(Math.PI * f * 0.92));
      ctx.beginPath();
      ctx.ellipse(x * 0.97, yb - s * 0.038, s * 0.028, s * 0.020, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (P.grad > 0.6) {                              // 壳面高光弧（3D 感来源）
    ctx.strokeStyle = 'rgba(255,252,238,0.60)';
    ctx.lineWidth = s * 0.042;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.36, s * shellRy * 0.72, 0, Math.PI * 1.06, Math.PI * 1.32);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,252,238,0.32)';
    ctx.lineWidth = s * 0.020;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.36, s * shellRy * 0.72, 0, Math.PI * 1.36, Math.PI * 1.48);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

// ══════════════════════════════════════════════════════════
//  侧 视 鱼（H 档，支持品种特有：长尾 / 竖纹 / 腹色 / 独立鳍色）
// ══════════════════════════════════════════════════════════

/**
 * P = { C:{ body, bodyHi, fin, belly, line }, grad, stroke, detail, kawaii,
 *       stripes, fancyTail, so }
 * 原点 = 身体中心；头朝右。水平范围约 [-0.90s, +0.53s]。
 */
export function drawSideFish(ctx, s, ph, P) {
  const C = P.C;
  const wig = Math.sin(ph * 1.7) * 0.45;
  const so = P.so ?? 0;
  const strokeW = (w) => sideStroke(ctx, s, P, w);

  // 尾鳍（摆动；fancyTail = 金鱼/锦鲤的飘长大尾）
  const tl = P.fancyTail ? 1.30 : 1.0;
  const th = P.fancyTail ? 0.34 : 0.26;
  ctx.beginPath();
  ctx.moveTo(-s * 0.46, 0);
  ctx.quadraticCurveTo(-s * 0.74, -s * th + wig * s * 0.20 * tl, -s * 0.90 * tl, -s * 0.08 * tl + wig * s * 0.30 * tl);
  ctx.quadraticCurveTo(-s * 0.66, wig * s * 0.26, -s * 0.90 * tl, s * 0.08 * tl + wig * s * 0.30 * tl);
  ctx.quadraticCurveTo(-s * 0.74, s * th + wig * s * 0.20 * tl, -s * 0.46, 0);
  ctx.closePath();
  ctx.fillStyle = C.fin;
  ctx.fill();
  strokeW(0.009);

  // 背鳍
  ctx.beginPath();
  ctx.moveTo(-s * 0.10, -s * 0.20);
  ctx.quadraticCurveTo(s * 0.02, -s * 0.46 * (P.fancyTail ? 1.1 : 1), s * 0.24, -s * 0.16);
  ctx.closePath();
  ctx.fillStyle = darken(C.fin, 0.92);
  ctx.fill();
  strokeW(0.009);

  // 身体（有机轮廓，肚弧略鼓）
  organicPath(ctx, s * 0.50, s * 0.24, 61 + so, {
    low: 0.026, high: 0.009,
    bumps: [[0, 0.05, 0.6], [Math.PI, 0.035, 0.7]],   // 吻端 + 腹部微鼓
  });
  if (P.grad > 0.4) {
    const g = ctx.createLinearGradient(0, -s * 0.26, 0, s * 0.26);
    g.addColorStop(0, C.bodyHi); g.addColorStop(0.62, C.body); g.addColorStop(1, C.belly ?? C.body);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = C.body;
  }
  ctx.fill();
  strokeW(0.010);

  // 腹部浅色（无渐变档的兜底）
  if (P.grad <= 0.4 && C.belly) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = C.belly;
    ctx.beginPath();
    ctx.ellipse(s * 0.04, s * 0.11, s * 0.34, s * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 竖纹（鲫鱼幼体 / 锦鲤 / 白鲦侧线纹；品种 stripes 条数）
  if ((P.stripes ?? 0) > 0) {
    ctx.save();
    ctx.globalAlpha = 0.38;
    ctx.strokeStyle = C.line;
    ctx.lineWidth = Math.max(0.9, s * 0.018);
    ctx.lineCap = 'round';
    for (let i = 0; i < P.stripes; i++) {
      const px = -s * 0.26 + (i / Math.max(1, P.stripes - 1 || 1)) * s * 0.52;
      ctx.beginPath();
      ctx.moveTo(px, -s * 0.20);
      ctx.quadraticCurveTo(px - s * 0.04, 0, px - s * 0.02, s * 0.20);
      ctx.stroke();
    }
    ctx.restore();
  }

  if ((P.detail ?? 0.5) > 0.8) {                   // 侧线
    ctx.strokeStyle = 'rgba(62,50,32,0.26)';
    ctx.lineWidth = Math.max(0.6, s * 0.006);
    ctx.beginPath();
    ctx.moveTo(-s * 0.30, 0);
    ctx.quadraticCurveTo(0, -s * 0.03, s * 0.30, 0);
    ctx.stroke();
  }

  // 胸鳍
  ctx.beginPath();
  ctx.ellipse(s * 0.12, s * 0.14 + wig * s * 0.03, s * 0.13, s * 0.07, 0.4, 0, Math.PI * 2);
  ctx.fillStyle = darken(C.fin, 0.94);
  ctx.fill();

  // 眼（白圈 + 瞳 + 高光）
  const er = s * (0.070 + 0.014 * (P.kawaii ?? 0.5));
  ctx.beginPath(); ctx.arc(s * 0.30, -s * 0.055, er, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.31, -s * 0.055, er * 0.60, 0, Math.PI * 2);
  ctx.fillStyle = '#2a2018'; ctx.fill();
  ctx.beginPath(); ctx.arc(s * 0.325, -s * 0.078, er * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();

  // 嘴
  ctx.beginPath();
  ctx.arc(s * 0.50, s * 0.02, s * 0.03, Math.PI * 0.2, Math.PI * 0.9);
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(0.8, s * 0.009);
  ctx.stroke();
}

// ══════════════════════════════════════════════════════════
//  俯 视（面板图鉴用：背甲纹样从上方看最清楚）
// ══════════════════════════════════════════════════════════

/** 俯视龟：头朝右。原点 = 壳心。 */
export function drawTopTurtle(ctx, s, ph, P) {
  const C = P.C;
  const so = (P.so ?? 0) * 3;
  const hs = P.headScale ?? 1.0;
  const bob = Math.sin(ph * 0.62) * s * 0.01;

  // 四肢（前后各一对，前肢轻划）
  const swing = Math.sin(ph) * 0.10;
  const leg = (x, y, sw) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(sw);
    organicPath(ctx, s * 0.15, s * 0.09, 33 + so + (x > 0 ? 5 : 0) + (y < 0 ? 11 : 0), { low: 0.03, high: 0.012 });
    ctx.fillStyle = C.limb; ctx.fill();
    sideStroke(ctx, s, P, 0.010);
    ctx.restore();
  };
  leg(s * 0.34, -s * 0.40, swing);
  leg(s * 0.34, s * 0.40, -swing);
  leg(-s * 0.32, -s * 0.40, -swing);
  leg(-s * 0.32, s * 0.40, swing);

  // 尾（左）
  ctx.save();
  ctx.translate(-s * 0.56, 0);
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.05);
  ctx.quadraticCurveTo(-s * 0.10, 0, 0, s * 0.05);
  ctx.closePath();
  ctx.fillStyle = C.limb; ctx.fill();
  sideStroke(ctx, s, P, 0.010);
  ctx.restore();

  // 头（右，俯视更宽）
  ctx.save();
  ctx.translate(s * (0.50 + 0.16 * hs), bob);
  organicPath(ctx, s * 0.17 * hs, s * 0.145 * hs, 17 + so, {
    low: 0.024, high: 0.008, bumps: [[0, 0.04 + (P.snout ?? 0) * 0.5, 0.55]],
  });
  const g = ctx.createRadialGradient(-s * 0.05, -s * 0.05, s * 0.01, 0, 0, s * 0.2 * hs);
  g.addColorStop(0, C.headHi); g.addColorStop(1, C.head);
  ctx.fillStyle = g; ctx.fill();
  sideStroke(ctx, s, P, 0.012);
  // 头侧品种标志（俯视 = 两侧对称短线）
  if (P.mark === 'throat' || P.mark === 'line') {
    ctx.strokeStyle = lighten(C.yellow, 0.12);
    ctx.lineWidth = Math.max(1, s * 0.018);
    ctx.lineCap = 'round';
    [-1, 1].forEach((sd) => {
      ctx.beginPath();
      ctx.moveTo(-s * 0.02, sd * s * 0.10 * hs);
      ctx.quadraticCurveTo(-s * 0.10, sd * s * 0.13 * hs, -s * 0.17, sd * s * 0.11 * hs);
      ctx.stroke();
    });
  } else if (P.mark === 'ear') {
    ctx.fillStyle = lighten(C.yellow, 0.12);
    [-1, 1].forEach((sd) => {
      ctx.beginPath();
      ctx.ellipse(-s * 0.09, sd * s * 0.105 * hs, s * 0.045, s * 0.030, 0, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  // 双眼
  [-1, 1].forEach((sd) => {
    ctx.beginPath(); ctx.arc(s * 0.07, sd * s * 0.085 * hs, Math.max(1.2, s * 0.028), 0, Math.PI * 2);
    ctx.fillStyle = '#2a2018'; ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.078, sd * s * 0.095 * hs - s * 0.006, Math.max(0.6, s * 0.010), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fill();
  });
  ctx.restore();

  // 背甲（有机椭圆 + 品种纹样）
  ctx.save();
  organicPath(ctx, s * 0.56, s * 0.44, 91 + so * 3, { low: 0.030, high: 0.010 });
  const g2 = ctx.createRadialGradient(-s * 0.10, -s * 0.12, s * 0.05, 0, 0, s * 0.66);
  g2.addColorStop(0, C.shellHi); g2.addColorStop(1, C.shell);
  ctx.fillStyle = g2; ctx.fill();
  sideStroke(ctx, s, P, 0.015);

  ctx.save();
  organicPath(ctx, s * 0.56, s * 0.44, 91 + so * 3, { low: 0.030, high: 0.010 });
  ctx.clip();
  const pat = P.pat ?? 'scutes';
  if (pat === 'scutes' || pat === 'rim') {
    ctx.strokeStyle = 'rgba(70,56,32,0.30)';
    ctx.lineWidth = Math.max(0.8, s * 0.010);
    ctx.lineCap = 'round';
    [-0.22, 0.22].forEach((fx) => {                 // 椎盾两侧纵缝
      ctx.beginPath();
      ctx.moveTo(s * fx, -s * 0.40);
      ctx.quadraticCurveTo(s * fx * 1.25, 0, s * fx, s * 0.40);
      ctx.stroke();
    });
    [-0.26, 0.05, 0.36].forEach((fy) => {           // 横缝
      ctx.beginPath();
      ctx.moveTo(-s * 0.52, s * fy);
      ctx.quadraticCurveTo(0, s * fy * 1.25, s * 0.52, s * fy);
      ctx.stroke();
    });
  }
  if (pat === 'rings') {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = darken(C.shell, 0.58);
    ctx.lineWidth = Math.max(0.8, s * 0.010);
    for (let i = 0; i < 3; i++) {
      const k = 0.90 - i * 0.22;
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.50 * k, s * 0.39 * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (pat === 'lines') {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = darken(C.shell, 0.55);
    ctx.lineWidth = Math.max(0.6, s * 0.008);
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(s * 0.5 * (i / 3.4) * 0.9, -s * 0.42);
      ctx.quadraticCurveTo(s * 0.62 * (i / 3.4), 0, s * 0.5 * (i / 3.4) * 0.9, s * 0.42);
      ctx.stroke();
    }
    ctx.restore();
  }
  if (pat === 'rim') {                              // 黄缘带
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = C.yellow;
    ctx.lineWidth = s * 0.06;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.51, s * 0.395, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // 中央高光弧（3D 感）
  ctx.strokeStyle = 'rgba(255,252,238,0.5)';
  ctx.lineWidth = s * 0.05;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.36, s * 0.26, 0, Math.PI * 1.15, Math.PI * 1.55);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/** 俯视鱼：细长身形 + 叉尾 + 两侧胸鳍。原点 = 身体中心，头朝右。 */
export function drawTopFish(ctx, s, ph, P) {
  const C = P.C;
  const wig = Math.sin(ph * 1.7) * 0.10;
  const tl = P.fancyTail ? 1.25 : 1.0;
  // 尾（叉形）
  ctx.beginPath();
  ctx.moveTo(-s * 0.46, 0);
  ctx.quadraticCurveTo(-s * 0.72, -s * 0.20 * tl + wig * s * 6, -s * 0.88 * tl, -s * 0.26 * tl);
  ctx.quadraticCurveTo(-s * 0.60, wig * s * 8, -s * 0.88 * tl, s * 0.26 * tl);
  ctx.quadraticCurveTo(-s * 0.72, s * 0.20 * tl + wig * s * 6, -s * 0.46, 0);
  ctx.closePath();
  ctx.fillStyle = C.fin; ctx.fill();
  sideStroke(ctx, s, P, 0.009);
  // 身体（细长）
  organicPath(ctx, s * 0.50, s * 0.15, 71 + (P.so ?? 0), { low: 0.03, high: 0.010, bumps: [[0, 0.04, 0.6]] });
  const g = ctx.createLinearGradient(0, -s * 0.16, 0, s * 0.16);
  g.addColorStop(0, C.bodyHi); g.addColorStop(1, C.body);
  ctx.fillStyle = g; ctx.fill();
  sideStroke(ctx, s, P, 0.010);
  // 两侧胸鳍
  [-1, 1].forEach((sd) => {
    ctx.save();
    ctx.translate(s * 0.14, sd * s * 0.11);
    ctx.rotate(sd * 0.6);
    ctx.beginPath();
    ctx.ellipse(0, sd * s * 0.05, s * 0.12, s * 0.05, 0, 0, Math.PI * 2);
    ctx.fillStyle = darken(C.fin, 0.94); ctx.fill();
    ctx.restore();
  });
  // 双眼
  [-1, 1].forEach((sd) => {
    ctx.beginPath(); ctx.arc(s * 0.32, sd * s * 0.075, s * 0.038, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fill();
    ctx.beginPath(); ctx.arc(s * 0.33, sd * s * 0.075, s * 0.022, 0, Math.PI * 2);
    ctx.fillStyle = '#2a2018'; ctx.fill();
  });
}

// ══════════════════════════════════════════════════════════
//  皮 肤 派 生（品种字段 → 绘制参数；含个体差异）
// ══════════════════════════════════════════════════════════

/** 品种旧 pattern 字段 → 侧视纹样的默认映射（species.js 未写 artPattern 时兜底） */
const PATTERN_FALLBACK = { rings: 'rings', stripes: 'scutes', lines: 'lines', smooth: 'smooth' };

/**
 * 龟品种 → H 档绘制参数。
 * @param {object} sp species.js 的品种对象（shell/limb/head/markColor + artMark/artPattern）
 * @param {number} [seed] 个体种子（0 = 不做个体差异，图鉴固定形象用）
 */
export function turtleArt(sp, seed = 0) {
  const r = sRand(seed || 1);
  // 个体差异：色相 ±7° / 饱和 ±0.06 / 明度 ±0.05；品种标志色（mark）只轻偏，保辨认
  const dh = seed ? (r() - 0.5) * 14 : 0;
  const ds = seed ? (r() - 0.5) * 0.12 : 0;
  const dl = seed ? (r() - 0.5) * 0.10 : 0;
  const mdh = seed ? (r() - 0.5) * 6 : 0;
  const T = (c, f = 1) => tint(c, dh * f, ds * f, dl * f);

  const mark = sp.artMark ?? (sp.markColor ? 'line' : 'none');
  const pat = sp.artPattern ?? PATTERN_FALLBACK[sp.pattern] ?? 'scutes';
  const flat = !!sp.flat;
  return {
    C: {
      shell: T(sp.shell), shellHi: T(lighten(sp.shell, 0.42)),
      rim: T(lighten(sp.shell, 0.05)),
      limb: T(sp.limb ?? sp.shell), limbHi: T(lighten(sp.limb ?? sp.shell, 0.5)),
      head: T(sp.head ?? sp.shell), headHi: T(lighten(sp.head ?? sp.shell, 0.48)),
      yellow: tint(sp.markColor ?? sp.shell, mdh, 0, 0),
      line: darken(sp.head ?? sp.shell, 0.46),
      blush: 'rgba(240,150,120,0.34)',
    },
    headScale: flat ? 1.26 : 1.42,
    round: 0.82, grad: 1.0, stroke: 'ink', detail: 0.45,
    scutes: pat === 'smooth' ? 0 : 1.0,
    kawaii: 1.0, blush: true, shadow: true, smile: true,
    mark, pat, flat, snout: sp.snout ?? 0,
    so: seed ? Math.floor(r() * 4096) : 0,
  };
}

/** 鱼品种 → H 档绘制参数 */
export function fishArt(sp, seed = 0) {
  const r = sRand(seed || 1);
  const dh = seed ? (r() - 0.5) * 12 : 0;
  const ds = seed ? (r() - 0.5) * 0.14 : 0;
  const dl = seed ? (r() - 0.5) * 0.10 : 0;
  const T = (c) => tint(c, dh, ds, dl);
  return {
    C: {
      body: T(sp.body), bodyHi: T(lighten(sp.body, 0.38)),
      fin: T(sp.fin ?? sp.body),
      belly: sp.belly ? T(sp.belly) : null,
      line: darken(sp.body, 0.5),
    },
    grad: 1.0, stroke: 'ink', detail: 0.5, kawaii: 0.85,
    stripes: sp.stripes ?? 0,
    fancyTail: !!sp.fancyTail,
    so: seed ? Math.floor(r() * 4096) : 0,
  };
}
