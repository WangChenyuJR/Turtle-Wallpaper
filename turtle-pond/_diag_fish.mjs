/**
 * 诊断：鱼群 + 存档在新侧视地形下的行为回归
 * 运行：node _diag_fish.mjs
 */
import { World } from './src/world.js';
import { Fish } from './src/fish.js';
import { CONFIG } from './src/config.js';
import { seededRandom } from './src/utils.js';

Math.random = seededRandom(20261002);
let pass = 0, fail = 0;
const check = (n, ok, ex = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${ex ? '  ' + ex : ''}`); ok ? pass++ : fail++; };

const CUR = { active: false, x: 0, y: 0 };
const DT = 1 / 60;

// ── A. 各尺寸下鱼群 15 分钟都待在水里 ──
console.log('\n=== A. 鱼始终在水域内（各种窗口尺寸）===');
for (const [W, H] of [[1920, 1080], [1280, 720], [1024, 768], [800, 500]]) {
  const world = new World(W, H);
  const fishes = [];
  for (let i = 0; i < 6; i++) fishes.push(new Fish(world, world.w * (0.2 + i * 0.12), 0));
  let out = 0, outMax = 0;
  for (let i = 0; i < 60 * 60 * 15; i++) {
    for (const f of fishes) { f.update(DT, [], CUR, {}, []); if (!world.isWater(f.x, f.y)) out++; }
  }
  check(`${W}x${H} 鱼 100% 待在水里`, out === 0, `越界帧 ${out}`);
}

// ── B. 鱼不会卡死（x 有位移）──
console.log('\n=== B. 鱼有正常游动（不卡死）===');
{
  const world = new World(1280, 720);
  const f = new Fish(world, world.w * 0.5, 0);
  let minX = Infinity, maxX = -Infinity;
  for (let i = 0; i < 60 * 900; i++) { f.update(DT, [], CUR, {}, []); minX = Math.min(minX, f.x); maxX = Math.max(maxX, f.x); }
  check('15 分钟内横向活动范围 > 100px', maxX - minX > 100, `范围 ${(maxX - minX).toFixed(1)}px`);
}

// ── C. 新地形的几何 API 自洽（水/陆互补、无死带）──
console.log('\n=== C. 水/陆分类互补（无死带）===');
for (const [W, H] of [[1920, 1080], [1280, 720], [800, 500]]) {
  const world = new World(W, H);
  let both = 0, neither = 0;
  for (let x = 1; x < W; x += 2) {
    const w = world.isWaterColumn(x), l = world.isLandColumn(x);
    if (w && l) both++;
    if (!w && !l) neither++;
  }
  check(`${W}x${H} 每列恰好属于水或陆`, both === 0 && neither === 0, `both=${both} neither=${neither}`);
}

// ── D. shorePointNear 的契约（阶段 8-⑫ 更新）──
// 默认地形左岸沉入水下 → **无陆列**，shorePointNear 必须走"退回水域中心"的兜底：
// 返回点不越界、贴着水线（龟的上岸决策拿不到真岸时据此自然休眠）。
console.log('\n=== D. shorePointNear 兜底契约（无岸世界）===');
for (const [W, H] of [[1920, 1080], [1280, 720], [800, 500]]) {
  const world = new World(W, H);
  let bad = 0, tested = 0;
  for (let x = 10; x < W - 10; x += 17) {
    if (!world.isWaterColumn(x)) continue;
    tested++;
    const sp = world.shorePointNear(x);
    if (!(sp.x >= 0 && sp.x <= W) || Math.abs(sp.y - world.surfaceAt(sp.x)) > 30) bad++;
  }
  check(`${W}x${H} shorePointNear 退回水域中心且不越界（${tested} 个水列）`, bad === 0, `不达标 ${bad}`);
}
// D2. 取消右岸后水体应该明显占更多（用户："尽量让水体占更多"）
console.log('\n=== D2. 取消右岸 → 水体占比 ===');
{
  const world = new World(1920, 1080);
  let wc = 0, t = 0;
  for (let x = 0; x <= 1920; x += 4) { t++; if (world.isWaterColumn(x)) wc++; }
  const frac = wc / t;
  check('水体占比 ≥ 65%', frac >= 0.65, `${(frac * 100).toFixed(1)}%`);
}

// ── E. 运动随机性（阶段 8-⑧：用户"运动不够随机"）──
// 指标：累积转向角（度）。走直线的鱼全程不转向；随机巡游的鱼一直在转。
// ⚠️ 三条注意（前两版都栽在这里）：
//   ① 只对**一条鱼**测（没有邻居）→ 把 boids 三力排除，量的就是"随机性"本身；
//   ② 用**超大世界 + 水平初速 + 只跑 30 秒** → 保证全程撞不到墙/水面/池底。
//      否则"沿墙滑行"会贡献上百度的假转向（第一版 60 秒就撞上水面了）；
//   ③ 断言用**开关比值**，不依赖绝对角度 —— 随机行为换台机器也不会概率性失败。
console.log('\n=== E. 单鱼无邻居时的随机巡游 ===');
function turn(set, seed) {
  const rnd = Math.random;
  Math.random = seededRandom(seed);
  const saved = { ...CONFIG.fish };
  Object.assign(CONFIG.fish, set);
  const world = new World(4200, 3000);
  const f = new Fish(world);
  f.x = world.w * 0.5; f.y = world.h * 0.5;
  f.vx = f.maxSpeed * 0.5; f.vy = 0;          // 水平出发 → 不碰上下边界
  let sum = 0, prev = Math.atan2(f.vy, f.vx);
  for (let i = 0; i < 60 * 30; i++) {
    f.flock([f], CUR, [], DT, null);
    f.update(DT);
    const a = Math.atan2(f.vy, f.vx);
    let d = a - prev;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    sum += Math.abs(d);
    prev = a;
  }
  Object.assign(CONFIG.fish, saved);
  Math.random = rnd;
  return sum * 180 / Math.PI;
}
{
  const tOff = turn({ wander: false, roam: false, depthPull: 0 }, 777);
  const tOn = turn({ wander: true, roam: false, depthPull: 0 }, 777);
  check('关掉随机游走 → 全程不转向（30 秒 < 30°）', tOff < 30, `${tOff.toFixed(1)}°`);
  check('开着随机游走 → 持续转向（≥ 关掉时的 5 倍）', tOn >= tOff * 5 + 60,
    `${tOn.toFixed(0)}° vs ${tOff.toFixed(1)}°`);
}

// ── F. 鱼群不再黏成一团（阶段 8-⑧ / 8-⑪）──
// ⚠️ 这里是**第三版**指标，前两版都交过学费：
//    v1「120px 圆里挤了 60% 的鱼」→ 14 条分成两三团时**永不触发**，PASS 了但用户仍看到团。
//    v2「横向散度」→ 只能区分"有没有随机游走"，**区分不出排布力**（实测老行为 484px vs
//       有排布力 489px，几乎一样）。换指标后必须重新验证它在新机制下还有没有区分度！
//    v3（本版）「拥挤帧占比」—— 采样帧中"14 条里有 >7 条挤在同一个 120px 圆内"的比例。
//       实测：8-⑧ 老行为 83% / 只改 roamRadius 48% / 只加排布力 42% / **两者齐上 5%**。
//       这才是"看起来是不是一团"的直接量。
console.log('\n=== F. 鱼群聚集度（14 条鱼 / 10 分钟）===');
function crowd(set, seed) {
  const rnd = Math.random;
  Math.random = seededRandom(seed);
  const saved = { ...CONFIG.fish };
  Object.assign(CONFIG.fish, set);
  const world = new World(1920, 1080);
  const fishes = [];
  for (let i = 0; i < CONFIG.fish.count; i++) fishes.push(new Fish(world));
  const n = fishes.length;
  const tightTh = Math.ceil(n * 0.5);
  let frames = 0, tight = 0, nnSum = 0;
  for (let s = 0; s < 60 * 600; s++) {
    for (const f of fishes) f.lightLevel = 1;
    for (const f of fishes) f.flock(fishes, CUR, [], DT, null);
    for (const f of fishes) f.update(DT);
    if (s % 150) continue;                        // 每 2.5s 采样
    frames++;
    let nn = 0, inMax = 0;
    for (const a of fishes) {
      let best = Infinity, c = 0;
      for (const b of fishes) {
        if (a === b) continue;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < best) best = d;
        if (d < 120) c++;
      }
      nn += best;
      if (c > inMax) inMax = c;
    }
    nnSum += nn / n;
    if (inMax > tightTh) tight++;
  }
  Object.assign(CONFIG.fish, saved);
  Math.random = rnd;
  return { tight: tight / frames * 100, nn: nnSum / frames };
}
{
  // 阶段 8-⑬：默认地形恢复为"岸露出水面"（8-⑫ 的 submerged 开关已删除），
  // 水 体量回到 8-⑪ 时的水平，老-新对照直接在默认地形上跑即可。
  const old = crowd({ roamRadius: 200, spacing: 0, spacingForce: 0, roamAbsolute: 0 }, 20261003);
  const on = crowd({}, 20261003);                 // 直接读 CONFIG.fish 当前值
  // 阈值 25：渐进避墙（8-⑭）对"老行为"也生效——鱼被墙推着散开，拥挤帧
  // 比 8-⑪ 复现时（48%）低。锚的作用只是"旧参数确实更爱聚团"，不是精确复现。
  check('老行为确实老是一团（复现用户现象）', old.tight >= 25, `拥挤帧 ${old.tight.toFixed(0)}%`);
  check('现在拥挤帧 ≤ 20%（实测 5%）', on.tight <= 20, `拥挤帧 ${on.tight.toFixed(0)}%`);
  check('拥挤帧至少降 5 倍', old.tight >= on.tight * 5,
    `${old.tight.toFixed(0)}% → ${on.tight.toFixed(0)}%`);
}

// ── G. 全域巡游 + 不钉墙（8-⑭）──────────────────────────
// 用户实测："大多数鱼只在很小的水域范围活动"。两个元凶：
//   ① 避墙是恒力（1.2×maxForce），压不过群体外推合力（贴身1.0+个人空间0.9+…），
//     鱼 45 秒内被顶死在 x=10 / x=w-10 且再也出不来（吸收态）；
//   ② 漫游目标只从"当前位置±半径"挑，没有全池性的动力。
// 修法：渐进式避墙（墙面 4.4×）+ 35% 概率全池绝对取目标。
// ⚠️ 必须按 main.js 的真实调用顺序：先 flock(...) 再 update(dt) ——
//   只调 update 的探针等于关掉了全部群体力（8-⑭ 实测踩过：假象"全钉墙"）。
console.log('\n=== G. 全域巡游 + 不钉墙 + 无垂直瞬移（8-⑭） ===');
{
  const world = new World(1280, 720);
  const fs = [];
  for (let i = 0; i < 10; i++) fs.push(new Fish(world, i));
  const CUR = { active: false, x: 0, y: 0 };
  const DT = 1 / 60, N = 60 * 150;
  for (const f of fs) { f._x0 = f.x; f._x1 = f.x; f._maxdy = 0; f._py = f.y; }
  let edgeFrames = 0;
  for (let i = 0; i < N; i++) {
    for (const f of fs) if (!f.dying) f.flock(fs, CUR, [], DT, null);
    for (const f of fs) f.update(DT);
    for (const f of fs) {
      f._x0 = Math.min(f._x0, f.x); f._x1 = Math.max(f._x1, f.x);
      const dy = Math.abs(f.y - f._py); f._py = f.y;
      if (dy > f._maxdy) f._maxdy = dy;
      if (f.x < 26 || f.x > 1280 - 26) edgeFrames++;
    }
  }
  const ranges = fs.map((f) => f._x1 - f._x0);
  const meanR = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const edgeEnd = fs.filter((f) => f.x < 26 || f.x > 1280 - 26).length;
  const edgePct = edgeFrames / (N * fs.length) * 100;
  const maxJump = Math.max(...fs.map((f) => f._maxdy));
  check('鱼群平均 x 活动范围 ≥ 700px（全域巡游）', meanR >= 700, `实测 ${meanR.toFixed(0)}px`);
  check('个体最差活动范围 ≥ 300px', Math.min(...ranges) >= 300, `最差 ${Math.min(...ranges).toFixed(0)}px`);
  check('结尾贴墙（≤26px）的鱼 ≤ 1 条', edgeEnd <= 1, `${edgeEnd} 条`);
  check('贴墙帧占比 ≤ 8%', edgePct <= 8, `${edgePct.toFixed(1)}%`);
  check('鱼无垂直瞬移（单帧 |dy| ≤ 4px）', maxJump <= 4, `最大 ${maxJump.toFixed(1)}px`);
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
