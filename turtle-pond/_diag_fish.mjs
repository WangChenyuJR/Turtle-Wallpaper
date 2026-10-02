/**
 * 诊断：鱼群 + 存档在新侧视地形下的行为回归
 * 运行：node _diag_fish.mjs
 */
import { World } from './src/world.js';
import { Fish } from './src/fish.js';
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

// ── D. shorePointNear 一定落在陆地上 ──
console.log('\n=== D. shorePointNear 落点可达陆地 ===');
for (const [W, H] of [[1920, 1080], [1280, 720], [800, 500]]) {
  const world = new World(W, H);
  let bad = 0;
  for (let x = 10; x < W - 10; x += 17) {
    const sp = world.shorePointNear(x);
    if (!world.isLandColumn(sp.x)) bad++;
  }
  check(`${W}x${H} shorePointNear 全部落在陆列`, bad === 0, `不达标 ${bad}`);
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
