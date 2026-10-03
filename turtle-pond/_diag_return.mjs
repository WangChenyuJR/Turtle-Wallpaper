/**
 * 诊断 / 回归测试：乌龟水陆往返行为
 * 运行：node _diag_return.mjs
 *
 * 覆盖：
 *  A. 上岸晒背 → 是否回到水里（本次修复的 bug）
 *  B. 水里 → 能否爬上岸（不能因为修复 A 而反过来卡住）
 *  C. 长时间跑：统计"上岸-回水"完整循环次数（各栖息类型）
 *  D. 破壳幼龟（出生在岸上、state=return）能否下水
 *  E. 阶段 8-⑫：默认地形左岸沉入水下（无陆地）→ 龟全程待在水里、状态机不休眠不卡死
 *
 * ⚠️ 阶段 8-⑫ 起默认地形没有陆地（左岸整体沉入水下，龟鱼从墙上游过去），
 *    A~D 用**临时打开晒台**造一块合法陆地来继续覆盖水陆往返状态机。
 */
import { World } from './src/world.js';
import { Turtle } from './src/turtle.js';
import { TURTLE_SPECIES } from './src/species.js';
import { seededRandom } from './src/utils.js';
import { CONFIG } from './src/config.js';

// 固定随机源：诊断脚本必须可复现（同一种子结果完全一致），
// 否则"低晒背率品种 15 分钟内是否抽中上岸"会随运行次数忽 PASS 忽 FAIL。
// 依赖 Math.random 的模块（turtle/species/utils）统一走这里。
const SEED = Number(process.argv[2] ?? 20261002);
const rng = seededRandom(SEED);
Math.random = rng;

const W = 1280, H = 720, DT = 1 / 60;
const CUR = { active: false, x: 0, y: 0 };

// A~D 需要"有岸"的世界：临时打开晒台（默认地形无陆地）
CONFIG.layout.platform.enabled = true;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);
  ok ? pass++ : fail++;
};

function makeTurtle(world, speciesId, opts = {}) {
  const t = new Turtle(world, 0, TURTLE_SPECIES[speciesId], { artSeed: 12345, ...opts });
  return t;
}

/** 把龟放在岸上并立刻结束晒背 → 进入 RETURN */
function putOnBank(world, t) {
  const x = world.w * 0.5;
  t.x = x;
  t.y = world.bankLineAt(x) - 20;
  t.state = 'bask';
  t.stateTime = 999;
  t._baskGoal = 1;
  t.angle = Math.PI / 2;      // 朝下（朝水）
}

// ── A: 上岸 → 回水 ────────────────────────────────────────
console.log('\n=== A. 上岸晒背 → 重新下水 ===');
for (const [id, name] of [['redear', '巴西红耳龟(半水)'], ['chinese', '中华草龟(半水)'],
                          ['yellowthroat', '黄喉拟水龟(半水)'], ['softshell', '甲鱼(水龟)'],
                          ['mata', '枯叶龟(沼泽)']]) {
  const world = new World(W, H);
  const t = makeTurtle(world, id);
  putOnBank(world, t);
  let backT = -1;
  for (let i = 0; i < 60 * 40; i++) {          // 最多 40 秒
    t.update(DT, [], CUR, [], { light: 1, isNight: false });
    if (t.state === 'swim') { backT = i * DT; break; }
  }
  check(`${name} 40s 内回到水里`, backT >= 0, backT >= 0 ? `用时 ${backT.toFixed(1)}s` : `卡在 ${t.state} y=${t.y.toFixed(1)}`);
}

// ── B: 水里 → 上岸 ────────────────────────────────────────
console.log('\n=== B. 水里 → 爬上岸晒背 ===');
for (const [id, name] of [['redear', '巴西红耳龟'], ['yellowthroat', '黄喉拟水龟'], ['softshell', '甲鱼']]) {
  const world = new World(W, H);
  const t = makeTurtle(world, id);
  t.x = world.w * 0.5;
  t.y = (world.bankLineAt(t.x) + world.marshLineAt(t.x)) / 2;
  t.state = 'climb_out';
  t._pickBaskTarget();
  let ashoreT = -1;
  for (let i = 0; i < 60 * 60; i++) {
    t.update(DT, [], CUR, [], { light: 1, isNight: false });
    if (t.state === 'bask') { ashoreT = i * DT; break; }
  }
  check(`${name} 60s 内上岸晒背`, ashoreT >= 0, ashoreT >= 0 ? `用时 ${ashoreT.toFixed(1)}s` : `卡在 ${t.state}`);
}

// ── C: 长跑，统计完整循环 ─────────────────────────────────
console.log('\n=== C. 连续跑 15 分钟（无食物/无水草干扰），统计 上岸→回水 循环 ===');
for (const [id, name] of [['redear', '巴西红耳龟(半水)'], ['chinese', '中华草龟(半水)'],
                          ['softshell', '甲鱼(水龟)'], ['mata', '枯叶龟(沼泽)'],
                          ['yellowpond', '黄缘闭壳龟(陆龟)']]) {
  const world = new World(W, H);
  const t = makeTurtle(world, id);
  const frames = {};
  const dwell = {};             // 各状态最长连续停留
  const WATER = ['swim', 'seek_food'];
  let ashore = false, cycles = 0, cur = null, curT = 0;
  const MINUTES = 15;
  const N = 60 * 60 * MINUTES;
  for (let i = 0; i < N; i++) {
    t.update(DT, [], CUR, [], { light: 1, isNight: i % (60 * 360) > 60 * 180 });
    // 本用例只考察水陆往返节奏，不与饥饿耦合：
    // 不喂食时饱食度约 250s 就满了（starveTimer 240s → 死亡），
    // 死了以后不再做上岸决策，低晒背率品种（甲鱼 0.06 / 枯叶龟 0.12）
    // 会在"死前那次也没抽中"时误报 FAIL。这里每帧把饥饿压回 0。
    t.hunger = 0;
    t.starveTimer = 0;
    frames[t.state] = (frames[t.state] ?? 0) + 1;
    if (t.state === cur) curT += DT;
    else { dwell[cur] = Math.max(dwell[cur] ?? 0, curT); cur = t.state; curT = DT; }
    if (t.state === 'bask') ashore = true;
    else if (WATER.includes(t.state) && ashore) { ashore = false; cycles++; }
  }
  dwell[cur] = Math.max(dwell[cur] ?? 0, curT);
  const pct = (k) => (((frames[k] ?? 0) / N) * 100).toFixed(0) + '%';
  const d = (k) => (dwell[k] ?? 0).toFixed(1) + 's';
  console.log(`  ${name}: 循环 ${cycles} 次 | 占比 水${pct('swim')} 晒背${pct('bask')} 回水${pct('return')} 上岸${pct('climb_out')}`);
  console.log(`            最长连续停留：水${d('swim')} 晒背${d('bask')} 回水${d('return')} 上岸${d('climb_out')}`);
  check(`${name} 回水状态不滞留（最长 <30s）`, (dwell.return ?? 0) < 30);
  check(`${name} 上岸状态不滞留（最长 <60s）`, (dwell.climb_out ?? 0) < 60);
  if (id === 'yellowpond') {
    console.log(`            （陆龟只在不占多数的"真下水"里进水域，循环 ${cycles} 次属正常）`);
  } else {
    check(`${name} 15 分钟内至少完成 1 次 上岸→回水 循环`, cycles > 0);
  }
}

// ── D: 破壳幼龟下水 ──────────────────────────────────────
console.log('\n=== D. 破壳幼龟（出生在岸上，state=return） ===');
for (const [id, name] of [['redear', '巴西红耳龟'], ['yellowthroat', '黄喉拟水龟']]) {
  const world = new World(W, H);
  const baby = new Turtle(world, 0, TURTLE_SPECIES[id], { baby: true, artSeed: 7 });
  // 出生点放晒台上（阶段 8-⑫ 起这是唯一的合法陆地）
  const x = world.platform.cx;
  baby.x = x;
  baby.y = Math.max(world.bankLineAt(x) - 10, world.bankLineAt(x) + 14);
  baby.state = 'return';
  let ok = -1;
  for (let i = 0; i < 60 * 60; i++) {
    baby.update(DT, [], CUR, [], { light: 1, isNight: false });
    if (baby.state === 'swim' && world.isWater(baby.x, baby.y)) { ok = i * DT; break; }
  }
  check(`${name}幼龟 60s 内下水`, ok >= 0, ok >= 0 ? `用时 ${ok.toFixed(1)}s` : `卡在 ${baby.state} y=${baby.y.toFixed(1)} size=${baby.size.toFixed(1)}`);
}

// ── E: 默认沉底地形（无陆地）→ 龟全程待水里，状态机不误判不卡死 ──
console.log('\n=== E. 沉底地形（无陆地）：龟全程在水里、不误判不越界 ===');
CONFIG.layout.platform.enabled = false;   // 恢复默认（左岸沉入水下）
{
  const world = new World(W, H);
  if (world.landZones.length !== 0) {
    check('前置：默认地形无陆地', false, `landZones=${world.landZones.length}`);
  } else {
    check('前置：默认地形无陆地（左岸已沉底）', true);
    const names = { redear: '巴西红耳龟(半水)', softshell: '甲鱼(水龟)', mata: '枯叶龟(沼泽)', yellowpond: '黄缘闭壳龟(陆龟)' };
    for (const [id, name] of Object.entries(names)) {
      const t = makeTurtle(world, id);
      const frames = {};
      let oob = 0, firstOob = '';
      const N = 60 * 120;              // 2 分钟
      for (let i = 0; i < N; i++) {
        t.update(DT, [], CUR, [], { light: 1, isNight: false });
        t.hunger = 0; t.starveTimer = 0;
        frames[t.state] = (frames[t.state] ?? 0) + 1;
        // 身体中心必须始终"在水里"（无岸可上，任何"既不在水也不在岸"都是空档 bug）
        if (!world.isWater(t.x, t.y)) {
          oob++;
          if (!firstOob) firstOob = `首帧#${i} (${t.x.toFixed(0)},${t.y.toFixed(0)})`;
        }
      }
      const landStates = (frames.bask ?? 0) + (frames.climb_out ?? 0) + (frames.return ?? 0);
      check(`${name} 2 分钟从不进入上岸状态`, landStates === 0,
        `上岸类帧 ${landStates} / 占比 swim ${((frames.swim ?? 0) / N * 100).toFixed(0)}%`);
      check(`${name} 2 分钟身体始终在水里（无空档）`, oob === 0, oob ? `${oob} 帧越界 · ${firstOob}` : '');
      check(`${name} 一直活着且在决策`, (t.dying ? 0 : 1) && (frames.swim ?? 0) > N * 0.8);
    }
  }
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
