// _sprite_cut.mjs — AI 标准姿势图拆件脚本（untracked 诊断脚本，不入库）
// 用法：node _sprite_cut.mjs <posePng> <view:top|side> [--cut]
// 报告模式（默认）：去背景 + 连通域统计，打印各组件 bbox/质心/面积，不写文件。
// --cut：按分类切件，输出到 assets/creatures/turtle/sprites/<species>/<view>/ 并写 manifest.json
//
// 原理：
//  1) 背景是均匀浅灰 → 从图像四边泛洪，颜色距离 < TOL 的像素归背景（软 alpha 用颜色距离映射）
//  2) X 姿势保证头/壳/爪/尾互不接触 → 前景连通域天然就是部件
//  3) 分类规则按视角：
//     top : 壳=最大组件；头=y质心最大（图里朝下）；尾=y质心最小；其余按象限分四爪
//     side: 先按组件分（前爪/后爪/尾），头颈若与壳连成一体则用颈部多边形切一刀
//  4) 水印（右下角小组件）按位置+面积丢弃
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { PNG } = require('pngjs'); // NODE_PATH 指向托管工作区（CJS 解析器认 NODE_PATH）

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const [pngPath, view] = process.argv.slice(2);
const doCut = process.argv.includes('--cut');
const TOL_HARD = 42;   // 与背景色的 RGB 距离阈值（判定前景/背景）
const SOFT_LO = 14, SOFT_HI = 46; // 软 alpha 映射区间
const MIN_AREA = 600;  // 组件最小面积（去水印/碎屑）

if (!pngPath || !view) { console.error('用法: node _sprite_cut.mjs <posePng> <top|side> [--cut]'); process.exit(1); }

const png = PNG.sync.read(fs.readFileSync(pngPath));
const { width: W, height: H } = png;
const data = png.data;

// 1) 背景色：四边各取一条 6px 带，取中位 RGB
const samples = [];
const band = 6;
for (let x = 0; x < W; x += 3) for (const y of [0, 1, 2, band, H - 1 - band, H - 2, H - 1]) samples.push(idx(x, y));
for (let y = 0; y < H; y += 3) for (const x of [0, 1, 2, band, W - 1 - band, W - 2, W - 1]) samples.push(idx(x, y));
const med = ch => { const a = samples.map(s => data[s + ch]).sort((p, q) => p - q); return a[a.length >> 1]; }; // samples 存的是字节偏移
const BG = [med(0), med(1), med(2)];
const dist2 = (i) => { const dr = data[i] - BG[0], dg = data[i + 1] - BG[1], db = data[i + 2] - BG[2]; return dr * dr + dg * dg + db * db; };

// 2) 软 alpha + 硬掩码
const alpha = new Float32Array(W * H);
const mask = new Uint8Array(W * H);
for (let p = 0; p < W * H; p++) {
  const d = Math.sqrt(dist2(p * 4));
  alpha[p] = Math.max(0, Math.min(1, (d - SOFT_LO) / (SOFT_HI - SOFT_LO)));
  mask[p] = d > TOL_HARD ? 1 : 0;
}

// 3) 连通域（4邻接，BFS）
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
let cid = 0;
for (let sy = 0; sy < H; sy++) for (let sx = 0; sx < W; sx++) {
  const sp = sy * W + sx;
  if (!mask[sp] || label[sp] >= 0) continue;
  let head = 0, tail = 0;
  qx[tail] = sx; qy[tail] = sy; tail++;
  label[sp] = cid;
  let area = 0, x0 = W, x1 = 0, y0 = H, y1 = 0, sxm = 0, sym = 0;
  while (head < tail) {
    const x = qx[head], y = qy[head]; head++;
    const p = y * W + x; area++;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    sxm += x; sym += y;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const np = ny * W + nx;
      if (mask[np] && label[np] < 0) { label[np] = cid; qx[tail] = nx; qy[tail] = ny; tail++; }
    }
  }
  comps.push({ id: cid, area, bbox: [x0, y0, x1, y1], cx: sxm / area, cy: sym / area });
  cid++;
}

// 4) 过滤：小面积碎屑 + 右下角水印
const isWatermark = c => c.bbox[0] > W * 0.6 && c.bbox[3] > H * 0.9 && c.area < W * H * 0.01;
const keep = comps.filter(c => c.area >= MIN_AREA && !isWatermark(c));
const dropped = comps.filter(c => !keep.includes(c));
for (const c of dropped) console.log(`  [丢弃] 面积=${c.area} bbox=[${c.bbox}] ${isWatermark(c) ? '(水印位)' : '(碎屑)'}`);

function idx(x, y) { return (y * W + x) * 4; }

// ── 报告 ──
console.log(`图: ${path.basename(pngPath)}  ${W}x${H}  背景RGB=${BG}`);
console.log(`组件总数=${comps.length}，保留=${keep.length}，丢弃=${dropped.length}（碎屑/水印）`);
for (const c of keep) {
  const [x0, y0, x1, y1] = c.bbox;
  console.log(`  #${c.id} 面积=${c.area} bbox=[${x0},${y0} → ${x1},${y1}] 质心=(${c.cx.toFixed(0)},${c.cy.toFixed(0)}) 质心比例=(${(c.cx / W).toFixed(2)},${(c.cy / H).toFixed(2)})`);
}

// ── 分类（仅 --cut 时执行）──
// 切件输出已移到 --regions 块末尾（依赖 owner 图）

// ── 形态学/连通域工具 ──
const erode1 = m => {
  const a = new Uint8Array(W * H), b = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 1; x < W - 1; x++) { const p = y * W + x; a[p] = m[p] && m[p - 1] && m[p + 1] ? 1 : 0; }
  for (let y = 1; y < H - 1; y++) for (let x = 0; x < W; x++) { const p = y * W + x; b[p] = a[p] && a[p - W] && a[p + W] ? 1 : 0; }
  return b;
};
function components(m) {
  const lab = new Int32Array(W * H).fill(-1);
  const out = [];
  const stack = new Int32Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || lab[s] >= 0) continue;
    const id = out.length;
    let top = 0; stack[top++] = s; lab[s] = id;
    let area = 0, sxm = 0, sym = 0;
    while (top > 0) {
      const p = stack[--top]; area++;
      const x = p % W, y = (p / W) | 0; sxm += x; sym += y;
      if (x > 0 && m[p - 1] && lab[p - 1] < 0) { lab[p - 1] = id; stack[top++] = p - 1; }
      if (x < W - 1 && m[p + 1] && lab[p + 1] < 0) { lab[p + 1] = id; stack[top++] = p + 1; }
      if (y > 0 && m[p - W] && lab[p - W] < 0) { lab[p - W] = id; stack[top++] = p - W; }
      if (y < H - 1 && m[p + W] && lab[p + W] < 0) { lab[p + W] = id; stack[top++] = p + W; }
    }
    out.push({ area, cx: sxm / area, cy: sym / area });
  }
  return { lab, comps: out };
}

// ── 区域切件 v2：深度图 + 多级腐蚀核 + 几何种子 + 多源洪泛 ──
if (process.argv.includes('--regions')) {
  console.log('\n── 区域切件 v2 ──');
  // 1) 深度图（腐蚀深度 ≈ 到背景距离）
  const depth = new Uint16Array(W * H);
  { let mD = mask, d = 0;
    while (true) { d++; mD = erode1(mD); let any = false;
      for (let p = 0; p < W * H; p++) if (mD[p]) { depth[p] = d; any = true; }
      if (!any || d > 220) break; } }

  // 2) 壳核：深度 ≥ 120 的最大连通域（全身只有壳能这么"厚"）
  const shellCoreMask = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (depth[p] >= 120) shellCoreMask[p] = 1;
  const shellC = components(shellCoreMask);
  const shellComp = shellC.comps.reduce((a, b) => (b.area > a.area ? b : a), { area: 0, cx: W / 2, cy: H / 2 });
  const shellIdx = shellC.comps.indexOf(shellComp);
  let shellTop = H, shellBot = 0, shellL = W, shellR = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (shellCoreMask[y * W + x] && shellC.lab[y * W + x] === shellIdx) { if (y < shellTop) shellTop = y; if (y > shellBot) shellBot = y; if (x < shellL) shellL = x; if (x > shellR) shellR = x; }
  }
  const cx0 = shellComp.cx;
  // 可视壳框（深度≥60，排除爪：爪厚度不够 60；侧视头也 <60）——侧视尾带/回收框用它
  let visL = W, visR = 0, visT = H, visB = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (depth[p] >= 60 && Math.abs(x - cx0) < W * 0.4) { if (y < visT) visT = y; if (y > visB) visB = y; if (x < visL) visL = x; if (x > visR) visR = x; }
  }
  console.log(`壳核: 质心=(${cx0.toFixed(0)},${shellComp.cy.toFixed(0)}) 深色区 y[${shellTop}→${shellBot}] x[${shellL}→${shellR}] 可视壳 y[${visT}→${visB}] x[${visL}→${visR}]`);

  // 3) 爪核：多级腐蚀收集，跳过落在壳核内的
  const legSeeds = [];
  for (const LEVEL of [30, 40, 50]) {
    let m = mask; for (let i = 0; i < LEVEL; i++) m = erode1(m);
    const cc = components(m);
    cc.comps.forEach((c, i) => {
      if (c.area < 400) return;
      const p0 = Math.round(c.cy) * W + Math.round(c.cx);
      if (depth[p0] >= 120) return; // 壳内部，跳过
      if (legSeeds.some(s => Math.hypot(s.cx - c.cx, s.cy - c.cy) < 80)) return; // 已有
      legSeeds.push({ cx: c.cx, cy: c.cy, area: c.area });
    });
  }
  // 缺爪补镜像种子（俯视姿势近对称）
  const need = [];
  for (const s of legSeeds) {
    const mx = 2 * cx0 - s.cx;
    if (!legSeeds.some(o => Math.abs(o.cx - mx) < 80 && Math.abs(o.cy - s.cy) < 80)) need.push({ cx: mx, cy: s.cy, area: 0, synth: true });
  }
  for (const s of need) {
    // 验证镜像点附近确有前景
    let cnt = 0;
    for (let dy = -90; dy <= 90; dy += 6) for (let dx = -90; dx <= 90; dx += 6) {
      const x = Math.round(s.cx + dx), y = Math.round(s.cy + dy);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      if (mask[y * W + x] && depth[y * W + x] < 120) cnt++;
    }
    if (cnt > 60) legSeeds.push(s);
  }
  console.log(`爪核 ${legSeeds.length} 个:`, legSeeds.map(s => `(${s.cx.toFixed(0)},${s.cy.toFixed(0)}${s.synth ? ',合成' : ''})`).join(' '));

  // 4) 头/尾种子（top: 头在 y 小端、尾在 y 大端；side: 头在 x 大端、尾在 x 小端）
  const seeds = [{ name: 'shell', px: [] }, { name: 'head', px: [] }, { name: 'tail', px: [] }];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (shellCoreMask[y * W + x] && shellC.lab[y * W + x] === shellIdx) seeds[0].px.push(y * W + x);
  }
  if (view === 'top') {
    // 颈切线：从壳顶往上找 rowMax 首次降到 <110 的平台区（颈），头种子 = 顶部中带窄条（别贪到爪）
    const rowMax = new Float32Array(H);
    for (let y = 0; y < H; y++) { let mx = 0; for (let x = 0; x < W; x++) { const p = y * W + x; if (mask[p] && depth[p] > mx) mx = depth[p]; } rowMax[y] = mx; }
    let yCut = shellTop;
    while (yCut > 60 && rowMax[yCut] >= 110) yCut--;
    console.log(`颈切线 y=${yCut}（rowMax 从壳 ${rowMax[shellTop].toFixed(0)} 降到颈 ${rowMax[yCut].toFixed(0)}）`);
    // 头中轴：取最顶部 40 行（必属头）的 x 均值
    let topRows = 0, sumX = 0;
    for (let y = 40; y < Math.min(H, yCut); y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (mask[p]) { sumX += x; topRows++; } }
    const headCx = topRows ? sumX / topRows : cx0;
    console.log(`头中轴 x=${headCx.toFixed(0)}（顶部 ${topRows}px 采样）`);
    // 头种子 = 圆盘(头顶部) ∪ 颈走廊（切线附近收窄到脖子宽度）
    let headTop = H;
    for (let y = 40; y < yCut; y++) { let any = false; for (let x = 0; x < W; x++) if (mask[y * W + x]) { any = true; break; } if (any) { headTop = y; break; } }
    const headCy = (headTop + yCut) / 2, headR = Math.min(240, (yCut - headTop) * 0.62);
    for (let y = headTop; y < yCut; y++) for (let x = Math.round(headCx - W * 0.18); x < headCx + W * 0.18; x++) {
      if (x < 0 || x >= W) continue;
      const p = y * W + x;
      if (!mask[p] || depth[p] >= 120) continue;
      const inDisc = Math.hypot(x - headCx, y - headCy) <= headR;
      const inCorridor = y > headCy && Math.abs(x - headCx) < W * 0.105; // 颈走廊只在下半段
      if (inDisc || inCorridor) seeds[1].px.push(p);
    }
    // 尾种子：壳底以下更远处中带（只取尾巴本体，不占壳后缘）
    const tailY0 = shellBot + 70;
    for (let y = tailY0; y < H; y++) for (let x = Math.round(cx0 - W * 0.13); x < cx0 + W * 0.13; x++) {
      const p = y * W + x;
      if (x >= 0 && x < W && mask[p] && depth[p] < 120) seeds[2].px.push(p);
    }
  } else {
    const colMax = new Float32Array(W);
    for (let x = 0; x < W; x++) { let mx = 0; for (let y = 0; y < H; y++) { const p = y * W + x; if (mask[p] && depth[p] > mx) mx = depth[p]; } colMax[x] = mx; }
    let xCut = shellR;
    while (xCut < W - 60 && colMax[xCut] >= 110) xCut++;
    console.log(`颈切线 x=${xCut}`);
    for (let x = xCut; x < W - 40; x++) for (let y = 0; y < H; y++) {
      const p = y * W + x;
      if (mask[p] && depth[p] < 120) seeds[1].px.push(p);
    }
    for (let x = 40; x < Math.max(60, visL - 15); x++) for (let y = 0; y < H; y++) {
      const p = y * W + x;
      if (mask[p] && depth[p] < 120) seeds[2].px.push(p);
    }
    // 侧视爪种子：壳可视底缘下方两侧合成圆盘（腐蚀分不开——爪根与壳宽桥连接）
    // 可视壳底 = 深度 ≥60 的像素的最大 y（深核太瘦，60 档贴壳腹）
    let bellyY = 0;
    for (let p = 0; p < W * H; p++) if (depth[p] >= 60) { const y = (p / W) | 0; if (y > bellyY) bellyY = y; }
    console.log(`可视壳底 y=${bellyY}`);
    // 头带/尾带先收紧：头带限制在爪区上方；尾带保到腹线+15（尾尖在腹线下方，别滤掉）
    seeds[1].px = seeds[1].px.filter(p => ((p / W) | 0) < bellyY - 40);
    seeds[2].px = seeds[2].px.filter(p => ((p / W) | 0) < bellyY + 15);
    for (const sx of [cx0 - W * 0.21, cx0 + W * 0.21]) {
      const cxx = Math.round(sx), cyy = bellyY + 45;
      const s = { name: 'leg', px: [] };
      for (let dy = -125; dy <= 125; dy++) for (let dx = -125; dx <= 125; dx++) {
        const x = cxx + dx, y = cyy + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const p = y * W + x;
        if (mask[p] && depth[p] < 120) s.px.push(p);
      }
      if (s.px.length > 300) seeds.push(s);
      console.log(`侧视爪种子 (${cxx},${cyy}) → ${s.px.length}px`);
    }
  }
  // 爪种子归入 seeds
  legSeeds.forEach((s, i) => seeds.push({ name: `leg${i}`, px: [], cx: s.cx, cy: s.cy }));
  for (const s of seeds.slice(3)) {
    const { cx, cy } = s;
    for (let dy = -160; dy <= 160; dy++) for (let dx = -160; dx <= 160; dx++) {
      const x = Math.round(cx + dx), y = Math.round(cy + dy);
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const p = y * W + x;
      if (mask[p] && depth[p] < 120) s.px.push(p);
    }
  }

  // 5) 多源洪泛
  const owner = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let qt = 0;
  seeds.forEach((s, i) => { for (const p of s.px) if (owner[p] < 0) { owner[p] = i; q[qt++] = p; } });
  let qh = 0;
  while (qh < qt) {
    const p = q[qh++]; const x = p % W, y = (p / W) | 0;
    for (const np of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
      if (np < 0 || !mask[np] || owner[np] >= 0) continue;
      owner[np] = owner[p]; q[qt++] = np;
    }
  }

  // 6) 命名：四爪按相对壳心象限 + 前后（top: y 大=前近头？头在 y 小端 → 前爪 y 小）
  const legObjs = seeds.slice(3).map((s, i) => ({ i, cx: s.cx ?? avg(s.px, p => p % W), cy: s.cy ?? avg(s.px, p => (p / W) | 0) }));
  function avg(px, f) { let a = 0; for (const p of px) a += f(p); return a / px.length; }
  const legNames = {};
  for (const L of legObjs) {
    const front = view === 'top' ? L.cy < shellComp.cy : L.cx > shellComp.cx;
    const leftSide = L.cx < cx0;
    // top 视图头朝上：龟背朝观众，龟左 = 图左；side 视图头朝右：图左 = 龟左侧也成立（龟面朝右时其左侧在观众侧为背面？——俯视龟头朝右时，龟左 = 图下方。此处按图左/图右直接映射，集成时如发现镜像再翻）
    legNames[L.i] = `leg${front ? 'F' : 'H'}${leftSide ? 'L' : 'R'}`;
  }
  console.log('爪命名:', Object.entries(legNames).map(([i, n]) => `#${i}→${n}`).join(' '));

  // 7) 调试图
  const COLORS = { shell: [150, 150, 150], head: [66, 133, 244], tail: [52, 168, 83], legFL: [251, 188, 5], legFR: [255, 99, 132], legHL: [153, 102, 255], legHR: [0, 191, 165], unassigned: [0, 0, 0] };
  const dbg = new PNG({ width: W, height: H });
  dbg.data.fill(255);
  const stats = {};
  for (let p = 0; p < W * H; p++) {
    if (!mask[p]) continue;
    const o = owner[p];
    const nm = o < 0 ? 'unassigned' : (o < 3 ? seeds[o].name : legNames[o - 3] || `leg?${o}`);
    (stats[nm] = stats[nm] || []).push(p);
    const c = COLORS[nm] || [0, 0, 0];
    dbg.data[p * 4] = c[0]; dbg.data[p * 4 + 1] = c[1]; dbg.data[p * 4 + 2] = c[2]; dbg.data[p * 4 + 3] = 255;
  }
  for (const [nm, px] of Object.entries(stats)) {
    let x0 = W, x1 = 0, y0 = H, y1 = 0;
    for (const p of px) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    console.log(`  ${nm}: ${px.length}px bbox=[${x0},${y0}→${x1},${y1}]`);
  }
  fs.writeFileSync(path.join(__dirname, '_cut_debug.png'), PNG.sync.write(dbg));
  console.log('调试图 → _cut_debug.png');

  // 7.5) 壳缘回收：壳轮廓椭圆内的头/爪/尾像素归还壳（分界落在肢根/颈中段，避免部件旋转时带走壳缘）
  // top：深核（深度≥120）外扩 1.55；side：可视壳（深度≥60，头深度在侧视 <60 不入框）外扩 1.12
  {
    let vT, vB, vL, vR, F;
    if (view === 'top') {
      vT = shellTop; vB = shellBot; vL = shellL; vR = shellR; F = 1.55;
    } else {
      vT = visT; vB = visB; vL = visL; vR = visR;       F = 1.25;
    }
    const exCx = (vL + vR) / 2, exCy = (vT + vB) / 2;
    const exRx = ((vR - vL) / 2) * F, exRy = ((vB - vT) / 2) * F;
    const shellOwner = seeds.findIndex(s => s.name === 'shell');
    const headOwner = seeds.findIndex(s => s.name === 'head');   // Q版下巴厚重（深度≥45），补条/椭圆会误收下巴 → 头部件不参与回收
    let reclaimed = 0;
    for (let p = 0; p < W * H; p++) {
      if (!mask[p] || owner[p] < 0 || owner[p] === shellOwner || owner[p] === headOwner) continue;
      const x = p % W, y = (p / W) | 0;
      const u = (x - exCx) / exRx, v = (y - exCy) / exRy;
      let hit = u * u + v * v <= 1;
      if (!hit && view === 'side') {
        // 侧视补条：壳顶窄处的厚像素（≥45，爪 <40 不会误收；head 已跳过）
        hit = depth[p] >= 45 && x >= vL - 30 && x <= vR + 30 && y >= vT - 40 && y <= vB + 20;
      }
      if (hit) { owner[p] = shellOwner; reclaimed++; }
    }
    console.log(`回收框 y[${vT}→${vB}] x[${vL}→${vR}] F=${F}，壳缘回收 ${reclaimed}px`);
  }

  // 8) 切件输出：每种部件裁剪成独立 PNG（软 alpha）+ manifest（bbox/锚点）
  if (doCut) {
    const mSp = pngPath.replace(/\\/g, '/').match(/sprites\/([^/]+)\//);
    const species = mSp ? mSp[1] : 'unknown';
    const outDir = path.join(__dirname, 'assets', 'creatures', 'turtle', 'sprites', species, view);
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = { view, source: path.basename(pngPath), size: [W, H], bg: BG, parts: {} };
    // 收集每个命名部件的像素与 bbox
    const buckets = {};
    for (let p = 0; p < W * H; p++) {
      if (!mask[p]) continue;
      const o = owner[p];
      if (o < 0) continue;
      const nm = o < 3 ? seeds[o].name : (legNames[o - 3] || null);
      if (!nm) continue;
      (buckets[nm] = buckets[nm] || []).push(p);
    }
    const shellBucket = buckets.shell;
    const shellCxs = shellBucket ? shellBucket.reduce((a, p) => a + p % W, 0) / shellBucket.length : cx0;
    const shellCys = shellBucket ? shellBucket.reduce((a, p) => a + ((p / W) | 0), 0) / shellBucket.length : shellComp.cy;
    for (const [nm, px] of Object.entries(buckets)) {
      let x0 = W, x1 = 0, y0 = H, y1 = 0;
      for (const p of px) { const x = p % W, y = (p / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const out = new PNG({ width: w, height: h });
      for (const p of px) {
        const x = p % W, y = (p / W) | 0;
        const dp = (y - y0) * w + (x - x0);
        out.data[dp * 4] = data[p * 4]; out.data[dp * 4 + 1] = data[p * 4 + 1];
        out.data[dp * 4 + 2] = data[p * 4 + 2]; out.data[dp * 4 + 3] = Math.round(alpha[p] * 255);
      }
      const file = `${nm}.png`;
      fs.writeFileSync(path.join(outDir, file), PNG.sync.write(out));
      // 锚点（关节）：部件上离壳质心最近的像素（壳=自身质心）
      let anchor;
      if (nm === 'shell') anchor = [shellCxs, shellCys];
      else {
        let best = -1, bd = Infinity;
        for (const p of px) { const x = p % W, y = (p / W) | 0; const d = (x - shellCxs) ** 2 + (y - shellCys) ** 2; if (d < bd) { bd = d; best = p; } }
        anchor = [best % W, (best / W) | 0];
      }
      manifest.parts[nm] = { file, bbox: [x0, y0, x1, y1], area: px.length, anchor: [anchor[0], anchor[1]] };
      console.log(`  切件 ${nm} → ${file} (${w}x${h}) 锚点=(${anchor[0]},${anchor[1]})`);
    }
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`manifest → ${outDir}${path.sep}manifest.json`);
  }
}

// ── 爆炸图切件模式（--explode [--cut]）：AI 直接出"部件全分离"图 → 纯连通域分类，零带肉 ──
// 分类：壳=最大组件；头=次大；尾=最小；其余=腿（top 按前后/左右象限，side 按前后+近远面积）
// 输出 manifest 增加 rig:'explode' + 每部件 slot（壳上挂点）——装配器把部件关节对齐到 slot。
if (process.argv.includes('--explode')) {
  console.log('\n── 爆炸图切件 ──');
  const sorted = [...keep].sort((a, b) => b.area - a.area);
  // top 标准结构 7 件（头/壳/四爪/尾）；side 标准结构 5 件（头/壳/尾/前腿组/后腿组，近远腿投影重叠成对）
  const minParts = view === 'top' ? 6 : 5;
  if (sorted.length < minParts) throw new Error(`爆炸图期望 ≥${minParts} 个部件组件，实际 ${sorted.length} —— AI 可能漏画/粘连，先看上方报告`);
  const shellC = sorted[0], headC = sorted[1];
  const rest = sorted.slice(2);

  // 前方向 = 头质心 - 壳质心；cross>0 = 屏幕顺时针侧（top 头朝上时=图右=龟右）
  const fx = headC.cx - shellC.cx, fy = headC.cy - shellC.cy, fl = Math.hypot(fx, fy) || 1;
  const UX = fx / fl, UY = fy / fl;
  const alongOf = c => (c.cx - shellC.cx) * UX + (c.cy - shellC.cy) * UY;
  const crossOf = c => UX * (c.cy - shellC.cy) - UY * (c.cx - shellC.cx);

  // 尾 = 剩余中沿"壳→头"轴负方向最远者（几何判定，比"面积最小"鲁棒——防 AI 多画的腹甲件抢走尾名）
  const tailC = rest.reduce((a, b) => (alongOf(b) < alongOf(a) ? b : a));
  const legCs = rest.filter(c => c !== tailC);
  console.log(`壳#${shellC.id}(${shellC.area}) 头#${headC.id}(${headC.area}) 尾#${tailC.id}(${tailC.area})，腿${legCs.length}只`);
  if (headC.area < legCs[0].area * 1.15) console.log('⚠ 头与最大腿面积接近，注意人工复核');

  const nameOf = new Map([[shellC, 'shell'], [headC, 'head'], [tailC, 'tail']]);
  if (view === 'top') {
    for (const c of legCs) nameOf.set(c, `leg${alongOf(c) > 0 ? 'F' : 'H'}${crossOf(c) < 0 ? 'L' : 'R'}`);
  } else {
    // 侧视：腿组件 = 成对腿组。前腿组 = 屏幕上最靠头侧（dx 最大）者，其余为后腿组（HL/HR）
    const byDx = [...legCs].sort((a, b) => (b.cx - shellC.cx) - (a.cx - shellC.cx));
    nameOf.set(byDx[0], 'legFR');
    for (let i = 1; i < byDx.length; i++) nameOf.set(byDx[i], i === 1 ? 'legHL' : 'legHR');
  }
  {
    const names = [...nameOf.values()];
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    if (dup.length) console.log(`⚠ 命名重复 ${[...new Set(dup)].join(',')} —— 后者覆盖前者，请人工复核`);
  }
  console.log('命名:', [...nameOf].map(([c, n]) => `#${c.id}→${n}`).join(' '));

  // 关节 = 部件上离壳质心最近的像素；挂点 = 壳质心沿该方向的最后一片壳像素内缩 12%
  const scx = shellC.cx, scy = shellC.cy;
  const isShell = p => label[p] === shellC.id;
  const geoOf = (comp) => {
    let best = -1, bd = Infinity;
    for (let p = 0; p < W * H; p++) {
      if (label[p] !== comp.id) continue;
      const x = p % W, y = (p / W) | 0;
      const d = (x - scx) ** 2 + (y - scy) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    const bx = best % W, by = (best / W) | 0;
    const dx = bx - scx, dy = by - scy, dl = Math.hypot(dx, dy) || 1;
    const ux = dx / dl, uy = dy / dl;
    let last = -1;
    for (let r = 0; r < dl * 1.8; r++) {
      const x = Math.round(scx + ux * r), y = Math.round(scy + uy * r);
      if (x < 0 || y < 0 || x >= W || y >= H) break;
      if (isShell(y * W + x)) last = r;
    }
    if (last < 0) last = dl * 0.5;
    const sr = last * 0.88;   // 内缩：肢根/颈根塞进壳缘下，旋转不露缝
    return { joint: [bx, by], slot: [Math.round(scx + ux * sr), Math.round(scy + uy * sr)] };
  };

  if (doCut) {
    // 软边归属：mask 外但 alpha>0 的像素 → 3x3 邻域内出现最多的组件
    const owner = new Int32Array(W * H).fill(-1);
    for (let p = 0; p < W * H; p++) if (mask[p]) owner[p] = label[p];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (mask[p] || alpha[p] <= 0) continue;
      const tally = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const l = label[yy * W + xx];
        if (l >= 0 && keep.some(k => k.id === l)) tally.set(l, (tally.get(l) || 0) + 1);
      }
      if (tally.size) owner[p] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }

    const species = (() => { const m = pngPath.replace(/\\/g, '/').match(/sprites\/([^/]+)\//); return m ? m[1] : 'unknown'; })();
    const outDir = path.join(__dirname, 'assets', 'creatures', 'turtle', 'sprites', species, view);
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = { view, source: path.basename(pngPath), size: [W, H], bg: BG, rig: 'explode', parts: {} };
    for (const [comp, nm] of nameOf) {
      const g = nm === 'shell' ? { joint: [Math.round(comp.cx), Math.round(comp.cy)], slot: null } : geoOf(comp);
      const px = [];
      let x0 = W, y0 = H, x1 = 0, y1 = 0;
      for (let p = 0; p < W * H; p++) {
        if (owner[p] !== comp.id) continue;
        px.push(p);
        const x = p % W, y = (p / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (!px.length) continue;
      const w = x1 - x0 + 1, h = y1 - y0 + 1;
      const out = new PNG({ width: w, height: h });
      for (const p of px) {
        const x = p % W, y = (p / W) | 0, i = idx(x, y), o = ((y - y0) * w + (x - x0)) * 4;
        out.data[o] = data[i]; out.data[o + 1] = data[i + 1]; out.data[o + 2] = data[i + 2];
        out.data[o + 3] = Math.round(Math.min(1, Math.max(0, alpha[p])) * 255);
      }
      const file = `${nm}.png`;
      fs.writeFileSync(path.join(outDir, file), PNG.sync.write(out));
      manifest.parts[nm] = { file, bbox: [x0, y0, x1, y1], area: comp.area, anchor: g.joint };
      if (g.slot) manifest.parts[nm].slot = g.slot;
      console.log(`  ${nm} → ${file} (${w}x${h}) 关节=(${g.joint})${g.slot ? ` 挂点=(${g.slot})` : ''}`);
    }
    fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`manifest → ${outDir}${path.sep}manifest.json`);
  }
}
