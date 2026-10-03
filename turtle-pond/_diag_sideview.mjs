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

  // 4) 左侧必须是岸（高于水线），池中必须是水
  //    阶段 8-⑦ 起**默认取消右岸**（用户："缓坡多了水的部分就变少了，尽量让水体占更多"），
  //    所以右侧改成断言"水面一路铺到右缘"。想恢复对称岸：CONFIG.layout.rightBank.enabled = true。
  const leftTop = w.groundYAt(4);
  ok(leftTop < w.surfaceAt(4),
    `${tag} 左侧是岸（左地表 ${leftTop.toFixed(0)} < 水线 ${w.surfaceAt(4).toFixed(0)}）`);
  const rbOn = CONFIG.layout?.rightBank?.enabled === true;
  const rx = W - 4;
  ok(rbOn ? w.groundYAt(rx) < w.surfaceAt(rx) : w.isWaterColumn(rx),
    `${tag} 右侧${rbOn ? '是岸' : '无岸（水面铺到右缘）'}（右地表 ${w.groundYAt(rx).toFixed(0)} / 水线 ${w.surfaceAt(rx).toFixed(0)}）`);

  const midX = W / 2;
  const probeX = midX + w.platform.halfW + 30;
  const midWater = w.isWater(probeX, (w.surfaceAt(probeX) + w.groundYAt(probeX)) / 2);
  ok(midWater, `${tag} 池中央偏左是水`);

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

  // 11) 构图与坡度量化（阶段 6-⑨ 抬高水面 / 8-⑧ 再扩水）
  //     这些数字就是用户那几条要求的可测版本，改 layout 后靠它们守住。
  {
    // 水线高度：目标值直接读 config，改 layout 就不用改断言
    const wantWater = CONFIG.layout?.waterY ?? 0.27;
    const waterPct = w.waterY / H;
    ok(Math.abs(waterPct - wantWater) < 0.03,
      `${tag} 水线抬到 ${(waterPct * 100).toFixed(1)}%（目标 ${(wantWater * 100).toFixed(1)}%，把画面让给水）`);

    ok(w.bankTopY / H <= 0.23,
      `${tag} 天空留白 ${((w.bankTopY / H) * 100).toFixed(1)}%（≤23%，不多留空气）`);

    // 底部泥层厚度（阶段 8-⑧ 用户："水底泥土的占比降低"）
    // ⚠️ bedY 是**池底在画面里的高度比例**：数值越大 = 池底越靠下 = 泥层越薄。
    const mudPct = (H - w.bedY) / H;
    ok(mudPct <= 0.15, `${tag} 池底泥层只占 ${(mudPct * 100).toFixed(1)}%（≤15%）`);

    // 上岸缓坡的横向宽度（阶段 8-⑧ 用户："左侧的缓坡宽度加一点"）
    const bankPct = w.waterLeftX / W;
    ok(bankPct >= 0.185, `${tag} 上岸缓坡横向占 ${(bankPct * 100).toFixed(1)}%（≥18.5%，坡铺得开）`);

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

    // 水体（阶段 8-⑦⑧ 用户："尽量让水体占更多"、"目的主要还是扩大水体"）
    //   · 列占比 = 水面有多宽（会被"缓坡变宽"吃掉一点）
    //   · **面积占比** = 水在画面里到底占多大一块 —— 这才是"看起来水多不多"的正解，
    //     8-⑧ 抬高水线 + 削薄泥层换来的正是它（40.8% → 44.3%）。
    const rbOn = CONFIG.layout?.rightBank?.enabled === true;
    const minCols = rbOn ? 0.45 : 0.65;
    const minArea = rbOn ? 0.34 : 0.42;
    let wArea = 0;
    for (let x = 0; x <= W; x += 2) {
      const s = w.surfaceAt(x), g = w.groundYAt(x);
      wArea += Math.max(0, Math.min(g, H) - Math.max(s, 0)) * 2;
    }
    const areaFrac = wArea / (W * H);
    ok(frac >= minCols, `${tag} 水面占宽 ${(frac * 100).toFixed(0)}%（≥${(minCols * 100).toFixed(0)}%）`);
    ok(areaFrac >= minArea,
      `${tag} 水体面积占画面 ${(areaFrac * 100).toFixed(1)}%（≥${(minArea * 100).toFixed(0)}%）`);
  }

  // 11) landZones / waterSpans 结构
  //    现在陆地 = 左岸 [+ 晒台]（右岸默认关闭），所以 ≥1 而不是"左右两块"。
  ok(w.landZones.length >= 1, `${tag} 至少一块陆地（实际 ${w.landZones.length}）`);
  ok(w.landZones.some((z) => z.kind === 'bank'), `${tag} 至少有一块"岸"型的陆块（龟有地方爬上去）`);
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

console.log('\n=== B. 晒台（阶段 8-⑧ 起默认关闭；临时打开应仍正常工作）===');
{
  ok(CONFIG.layout?.platform?.enabled === false,
    '默认关闭晒台（中央不再有台地，水面整片连成一体）');
  {
    const w = new World(1280, 720);
    ok(w.waterSpans.length === 1, `默认只剩一段水（实际 ${w.waterSpans.length}）`);
    ok(w.landZones.length === 1, `只剩左岸一块陆（实际 ${w.landZones.length}）`);
    const cx = 640;
    ok(w.isWater(cx, (w.surfaceAt(cx) + w.groundYAt(cx)) / 2), '池中央是水');
  }
  // 打开晒台的对照：台地仍要能露出水面、龟站得住、水域被切成两段
  CONFIG.layout.platform.enabled = true;
  {
    const w = new World(1280, 720);
    ok(w.platform.on, '临时打开后晒台生效');
    ok(w.waterSpans.length >= 2, `晒台把水域切成两段（实际 ${w.waterSpans.length}）`);
    ok(w.landZones.length >= 2, `晒台 + 左岸 = 至少两块陆（实际 ${w.landZones.length}）`);
    const px = w.platform.cx;
    ok(w.isLand(px, w.groundYAt(px)), '晒台上算干地（龟能站）');
    let leaked = 0;
    for (let i = 0; i < 300; i++) {
      const c = w.constrainToWater(Math.random() * 1280, Math.random() * 720, 10);
      if (!w.isWater(c.x, c.y)) leaked++;
    }
    ok(leaked === 0, '开晒台时 constrainToWater 不漏', leaked ? `${leaked}` : '');
  }
  CONFIG.layout.platform.enabled = false;   // 恢复默认（8-⑧ 起关）
}

console.log('\n=== C. resize 后几何重建 ===');
{
  const w = new World(1920, 1080);
  const a = w.groundYAt(20);
  w.resize(800, 500);
  const b = w.groundYAt(20);
  ok(w.w === 800 && w.h === 500, 'resize 更新了宽高');
  ok(Number.isFinite(b) && b < w.surfaceAt(20), `resize 后地表重算（${a.toFixed(0)} → ${b.toFixed(0)}）`);
  ok(w.landZones.length >= 1 && w.waterSpans.length >= 1, 'resize 后水陆分区重建');
}

console.log('\n=== D. 侧视脚印（阶段 8-⑧：由俯视爪印改成侧视踩痕）===');
{
  // 只记形状参数的假 ctx —— 脚印只用 fill/stroke + ellipse，够断言了
  const rec = { ellipses: [], arcs: 0, fills: 0, strokes: 0 };
  const noop = () => {};
  const ctx = {
    save: noop, restore: noop, translate: noop, rotate: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, quadraticCurveTo: noop,
    fill: () => { rec.fills++; },
    stroke: () => { rec.strokes++; },
    arc: () => { rec.arcs++; },
    ellipse: (x, y, rx, ry, rot, a0, a1) => rec.ellipses.push({ x, y, rx, ry, rot, a0, a1 }),
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {}, set globalAlpha(v) {},
  };

  const w = new World(1920, 1080);
  const bankX = w.waterLeftX * 0.45;
  let made = 0;
  for (let i = 0; i < 6; i++) {
    const x = bankX + i * 9;
    const before = w.footprints.length;
    w.addFootprint(x, w.groundYAt(x) - 2, Math.PI, 34, i % 2 ? 1 : -1);
    if (w.footprints.length > before) made++;
  }
  ok(made >= 4, `岸上留下一串脚印（${made} / 6）`);

  w._drawFootprints(ctx);
  ok(rec.fills + rec.strokes >= made * 3, `每个脚印至少 3 个形状（fill ${rec.fills} / stroke ${rec.strokes}）`);

  // ① 侧视的"扁"：每个形状的纵向半径必须远小于横向半径
  const fat = rec.ellipses.filter((e) => e.ry > e.rx / 3 + 0.01);
  ok(fat.length === 0, '所有踩痕都很扁（纵向 ≤ 横向的 1/3）',
    fat.length ? `${fat.length} 个太厚` : `${rec.ellipses.length} 个形状`);

  // ② 不再有脚趾圆 —— 那是俯视爪印的残留，防以后被加回来
  ok(rec.arcs === 0, '不再画脚趾圆（arc = 0，俯视爪印已彻底去掉）', `arc=${rec.arcs}`);

  // ③ 脚印躺在**地表**上（侧视：痕迹只能出现在地表）
  const off = w.footprints.filter((f) => Math.abs(f.y - w.groundYAt(f.x)) > 26).length;
  ok(off === 0, '每个脚印都贴在地表附近', off ? `${off} 个离地` : '');

  // ④ 倾斜角跟的是**地形坡度**，不是俯视行进方向
  const badRot = w.footprints.filter((f) => {
    const want = Math.atan((w.groundYAt(f.x + 4) - w.groundYAt(f.x - 4)) / 8);
    return Math.abs((f.rot ?? 0) - want) > 1e-6;
  }).length;
  ok(badRot === 0, '倾斜角 = 地形坡度（不再是俯视的 rotate(angle)）', badRot ? `${badRot} 个不对` : '');
}

console.log('\n=== E. 水陆之间没有"死带"（点判定，阶段 8-⑧）===');
// 不变量：水面到池底之间的任何一个点，必须**要么在水里要么在岸上**。
// 阶段 8-⑧ 实测过两处空档（都不是断言过时，是真 bug）：
//   · 水线以上 3px：`isWater` 为了让浮面饲料算在水里而留的余量 →
//     龟在 climb_out / return 途中身体中心必经此处（跑 2 分钟 1616 帧越界）；
//   · 池底上方 4px：`isWater` 下边界留的余量 → 龟贴底游时同样掉出去。
// 现在由 isWater 的下边界（收到池底）+ isLand 的水线过渡带一起兜住。
for (const [W, H] of [[1920, 1080], [1280, 720], [800, 500], [1000, 1400]]) {
  const w = new World(W, H);
  let gap = 0, tested = 0, firstGap = '';
  for (let x = 1; x < w.w; x += 7) {
    if (!w.isWaterColumn(x)) continue;
    const s = w.surfaceAt(x), g = w.groundYAt(x);
    for (let y = s - 25; y <= g; y += 2) {
      tested++;
      if (!w.isWater(x, y) && !w.isLand(x, y)) {
        if (!gap) firstGap = `首个 (${x.toFixed(0)},${y.toFixed(0)}) 水线 ${s.toFixed(0)} 池底 ${g.toFixed(0)}`;
        gap++;
      }
    }
  }
  ok(gap === 0, `${W}×${H} 水线下到池底无死带`, gap ? `${gap}/${tested} 个点悬空 · ${firstGap}` : `${tested} 个点全部有归属`);
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
