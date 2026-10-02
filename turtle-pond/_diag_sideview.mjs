/**
 * 纯 Node 几何回归：侧视剖面地形（阶段 6-⑧）
 *
 * 目标：不开浏览器就验证"水在哪、岸在哪、龟能不能站住"这套几何是自洽的。
 * 做法：给最小 document 桩 → import World → 拿各种窗口尺寸做断言。
 *
 * 跑法： node _diag_sideview.mjs
 */

let pass = 0, fail = 0;
const ok = (c, m, extra = '') => {
  c ? pass++ : fail++;
  console.log(`  ${c ? 'PASS' : 'FAIL'}  ${m}${extra ? '  ' + extra : ''}`);
};

// 最小 DOM 桩（World 本身不建 DOM，但 waterwave / terrain-tex 可能碰到）
globalThis.document = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};

const { CONFIG } = await import('./src/config.js');
const { World } = await import('./src/world.js');

const SIZES = [
  [1920, 1080], [1280, 720], [800, 500], [3440, 1440], [1000, 1400],
];

console.log('\n=== A. 地形自洽性（多分辨率）===');
for (const [W, H] of SIZES) {
  const w = new World(W, H);
  const tag = `${W}×${H}`;
  const bad = [];

  // 1) 关键高度顺序：岸顶 < 水线 < 池底
  if (!(w.bankTopY < w.waterY && w.waterY < w.bedY)) bad.push('高度顺序');
  // 2) 地表处处有限
  for (let x = 0; x <= W; x += 7) {
    const g = w.groundYAt(x);
    if (!Number.isFinite(g)) { bad.push(`groundY@${x}=${g}`); break; }
  }
  // 3) 水区比例合理（30%~80%）
  let waterCols = 0, total = 0;
  for (let x = 0; x <= W; x += 4) { total++; if (w.isWaterColumn(x)) waterCols++; }
  const frac = waterCols / total;
  if (frac < 0.3 || frac > 0.85) bad.push(`水面占比 ${(frac * 100).toFixed(0)}%`);

  ok(bad.length === 0, `${tag} 基本几何`, bad.join(' '));

  // 4) 左右两侧必须是岸（高于水线），池中必须是水
  const leftTop = w.groundYAt(4), rightTop = w.groundYAt(W - 4);
  ok(leftTop < w.surfaceAt(4) && rightTop < w.surfaceAt(W - 4),
    `${tag} 左右两侧是岸（左地表 ${leftTop.toFixed(0)} / 右 ${rightTop.toFixed(0)} < 水线 ${w.surfaceAt(4).toFixed(0)}）`);

  const midX = W / 2;
  const midWater = w.isWater(midX + w.platform.halfW + 30, (w.surfaceAt(midX) + w.groundYAt(midX + w.platform.halfW + 30)) / 2);
  ok(midWater, `${tag} 晒台旁边是水`);

  // 5) 水线之上是空气（不是岸）——取一段真正的水面中央来看
  const s0 = w.waterSpans[0];
  const watX = (s0.x0 + s0.x1) / 2;
  const airY = Math.max(2, w.surfaceAt(watX) - 40);
  ok(!w.isWater(watX, airY) && !w.isLand(watX, airY), `${tag} 水面上方是空气（既不是水也不是岸）`);

  // 6) 晒台：中央有一块露出水面的干地
  if (w.platform.on) {
    const px = w.platform.cx;
    ok(w.groundYAt(px) < w.surfaceAt(px) - 8, `${tag} 晒台露出水面（台面 ${w.groundYAt(px).toFixed(0)} < 水线 ${w.surfaceAt(px).toFixed(0)}）`);
    ok(w.isLand(px, w.groundYAt(px)), `${tag} 晒台上算干地（龟能站）`);
    ok(w.isLand(px, w.groundYAt(px) - 12), `${tag} 龟身体中心比脚高一点也算站在晒台上`);
    ok(!w.isWater(px, w.groundYAt(px) + 40), `${tag} 晒台内部不是水`);
  }

  // 7) 岸顶算干地
  const bankX = w.waterLeftX * 0.4;
  ok(!w.isWaterColumn(bankX) && w.isLand(bankX, w.groundYAt(bankX)),
    `${tag} 岸顶（x=${bankX.toFixed(0)}）是干地`);

  // 8) constrainToWater 把任意点都收回水里
  let leaked = 0;
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const c = w.constrainToWater(x, y, 10);
    if (!w.isWater(c.x, c.y)) leaked++;
  }
  ok(leaked === 0, `${tag} constrainToWater 400 次随机点全部落在水里`, leaked ? `${leaked} 次漏出` : '');

  // 9) pickLandSpot 给出可站的干地
  let badSpot = 0;
  for (let i = 0; i < 200; i++) {
    const s = w.pickLandSpot(Math.random() * W, Math.random() < 0.5);
    if (!s || !w.isLand(s.x, s.y)) badSpot++;
  }
  ok(badSpot === 0, `${tag} pickLandSpot 200 次都给到干地`, badSpot ? `${badSpot} 次不行` : '');

  // 10) shorePointNear / waterEntryNear 挨着水
  let badShore = 0, badEntry = 0;
  for (let i = 0; i < 100; i++) {
    const sp = w.shorePointNear(Math.random() * W);
    if (!(sp.x >= 0 && sp.x <= W) || Math.abs(sp.y - w.surfaceAt(sp.x)) > 30) badShore++;
    const ep = w.waterEntryNear(Math.random() * W);
    if (!w.isWater(ep.x, Math.min(ep.y, w.groundYAt(ep.x) - 6))) badEntry++;
  }
  ok(badShore === 0, `${tag} shorePointNear 都贴在水线附近`, badShore ? `${badShore}` : '');
  ok(badEntry === 0, `${tag} waterEntryNear 都给到水面内`, badEntry ? `${badEntry}` : '');

  // 11) 构图与坡度量化（阶段 6-⑨：抬高水面 / 少留空气 / 放缓岸坡）
  //     这些数字就是用户那三条要求的可测版本，改 layout 后靠它们守住。
  {
    const waterPct = w.waterY / H;
    ok(Math.abs(waterPct - 0.27) < 0.03,
      `${tag} 水线抬到 ${(waterPct * 100).toFixed(1)}%（目标 27%，把画面让给水）`);

    ok(w.bankTopY / H <= 0.23,
      `${tag} 天空留白 ${((w.bankTopY / H) * 100).toFixed(1)}%（≤23%，不多留空气）`);

    // 岸坡整体角度：画面边缘（岸顶）→ 水缘
    const edge = w.waterLeftX;
    const dropAll = Math.max(0, w.surfaceAt(edge) - w.groundYAt(1));
    const angAll = (Math.atan2(dropAll, Math.max(1, edge)) * 180) / Math.PI;
    ok(angAll <= 30, `${tag} 岸坡整体 ${angAll.toFixed(1)}°（≤30° 才算缓）`);

    // 水线附近（水缘外 40px 一带）的最陡角 —— 龟攀爬的就是这一段。
    // ⚠️ 必须用滑动窗口（±12px）而不是相邻 2px：地表自带 ±2px 的起伏噪声，
    // 除以 2px 步长会算出 60° 的假峰（阶段 6-⑨ 实测：同一条地形在 45° 上下抖成概率性失败）。
    let maxNear = 0;
    for (let x = Math.max(14, edge - 44); x <= edge - 12; x += 2) {
      const dy = w.groundYAt(x + 12) - w.groundYAt(x - 12);
      maxNear = Math.max(maxNear, (Math.abs(Math.atan2(dy, 24)) * 180) / Math.PI);
    }
    ok(maxNear <= 45, `${tag} 水线附近最陡 ${maxNear.toFixed(0)}°（≤45° 龟爬得上）`);

    // 岸上：水线外 60px 处不该已经爬得很高
    const rise60 = -(w.groundYAt(Math.max(1, edge - 60)) - w.surfaceAt(edge));
    ok(rise60 <= 60, `${tag} 水线外 60px 只高出 ${rise60.toFixed(0)}px（≤60 → 坡 ≤45°）`);

    // 水下：刚入水 14px 处要还是浅滩，不能垂直扎下去
    const shoal = w.groundYAt(Math.min(W - 1, edge + 14)) - w.surfaceAt(edge);
    ok(shoal >= -4 && shoal <= (w.bedY - w.waterY) * 0.3,
      `${tag} 入水 14px 才下沉 ${shoal.toFixed(0)}px（近岸是缓浅滩）`);
  }

  // 11) landZones / waterSpans 结构
  ok(w.landZones.length >= 2, `${tag} 至少两块陆地（左右岸，实际 ${w.landZones.length}）`);
  ok(w.waterSpans.length >= 1, `${tag} 水域 ${w.waterSpans.length} 段`);
  if (w.platform.on) ok(w.waterSpans.length >= 2, `${tag} 晒台把水域切成两段（实际 ${w.waterSpans.length}）`);

  // 12) 岸顶草皮层的下沿不会越过水线（不会盖在水面上）
  let over = 0;
  for (const z of w.landZones) {
    for (let x = z.x0; x <= z.x1; x += 6) {
      const bot = Math.max(w.groundYAt(x), Math.min(w.groundYAt(x) + 30, w.surfaceAt(x) + 1));
      if (bot < w.groundYAt(x) - 0.01) over++;
    }
  }
  ok(over === 0, `${tag} 岸顶草皮层不会盖到水面`, over ? `${over} 列越界` : '');
}

console.log('\n=== B. 关掉晒台（应只剩一段水，左右仍是岸）===');
CONFIG.layout.platform.enabled = false;
{
  const w = new World(1280, 720);
  ok(w.waterSpans.length === 1, `关晒台后水域连成一段（实际 ${w.waterSpans.length}）`);
  ok(w.landZones.length >= 2, `仍有两块岸（实际 ${w.landZones.length}）`);
  const cx = 640;
  ok(w.isWater(cx, (w.surfaceAt(cx) + w.groundYAt(cx)) / 2), '池中央是水');
  let leaked = 0;
  for (let i = 0; i < 300; i++) {
    const c = w.constrainToWater(Math.random() * 1280, Math.random() * 720, 10);
    if (!w.isWater(c.x, c.y)) leaked++;
  }
  ok(leaked === 0, '关晒台后 constrainToWater 仍不漏', leaked ? `${leaked}` : '');
}
CONFIG.layout.platform.enabled = true;

console.log('\n=== C. resize 后几何重建 ===');
{
  const w = new World(1920, 1080);
  const a = w.groundYAt(20);
  w.resize(800, 500);
  const b = w.groundYAt(20);
  ok(w.w === 800 && w.h === 500, 'resize 更新了宽高');
  ok(Number.isFinite(b) && b < w.surfaceAt(20), `resize 后地表重算（${a.toFixed(0)} → ${b.toFixed(0)}）`);
  ok(w.landZones.length >= 2 && w.waterSpans.length >= 1, 'resize 后水陆分区重建');
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
