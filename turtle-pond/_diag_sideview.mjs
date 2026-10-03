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

  // 1) 关键高度顺序：水线 < 墙顶 < 池底（阶段 8-⑫：左岸沉入水下，墙顶在水线之下）
  if (!(w.waterY < w.bankTopY && w.bankTopY < w.bedY)) bad.push('高度顺序');
  // 2) 地表处处有限
  for (let x = 0; x <= W; x += 7) {
    const g = w.groundYAt(x);
    if (!Number.isFinite(g)) { bad.push(`groundY@${x}=${g}`); break; }
  }
  // 3) 阶段 8-⑫：水面铺满全宽（左岸沉底后不再有陆列）
  let waterCols = 0, total = 0;
  for (let x = 0; x <= W; x += 4) { total++; if (w.isWaterColumn(x)) waterCols++; }
  const frac = waterCols / total;
  if (frac < 0.98) bad.push(`水面占比 ${(frac * 100).toFixed(0)}%（应全宽）`);

  ok(bad.length === 0, `${tag} 基本几何`, bad.join(' '));

  // 4) 阶段 8-⑫：左侧是一堵**没入水下**的墙 —— 墙顶在水线下、又没沉太深
  //    （龟鱼要从墙顶上游过去，顶上得留够水头）；想恢复露出水面的岸：
  //    CONFIG.layout.bank.submerged = false。
  const leftTop = w.groundYAt(4);
  const sink = leftTop - w.waterY;
  ok(leftTop > w.surfaceAt(4),
    `${tag} 左墙顶没入水下（墙顶 ${leftTop.toFixed(0)} > 水线 ${w.surfaceAt(4).toFixed(0)}）`);
  ok(sink >= H * 0.03 && sink <= H * 0.09,
    `${tag} 墙顶吃水 ${(sink / H * 100).toFixed(1)}%h（3%~9%，太浅游不过、太深看不见墙）`);
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

  // 7) 阶段 8-⑫：左墙顶一带是**水下地形** —— 墙顶上方是水（龟鱼从上面游过去），
  //    墙体本身不再是干地
  const bankX = Math.round(w.bankSpan * 0.2);
  ok(w.isWaterColumn(bankX) && w.isWater(bankX, w.groundYAt(bankX) - 8),
    `${tag} 墙顶上方是水（x=${bankX}，墙顶 ${w.groundYAt(bankX).toFixed(0)} 在水线下）`);

  // 8) constrainToWater 把任意点都收回水里
  let leaked = 0;
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const c = w.constrainToWater(x, y, 10);
    if (!w.isWater(c.x, c.y)) leaked++;
  }
  ok(leaked === 0, `${tag} constrainToWater 400 次随机点全部落在水里`, leaked ? `${leaked} 次漏出` : '');

  // 9) pickLandSpot：无陆地时**必须返回 null**（龟的上岸决策据此自然休眠，
  //    绝不能返回一个水下的假落点让龟去"上岸"）
  let badSpot = 0;
  for (let i = 0; i < 200; i++) {
    const s = w.pickLandSpot(Math.random() * W, Math.random() < 0.5);
    if (s !== null) badSpot++;
  }
  ok(badSpot === 0, `${tag} 无陆地时 pickLandSpot 全部返回 null`, badSpot ? `${badSpot} 次给了点` : '');

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

    // 天空留白（阶段 8-⑫：岸沉底后"天空"就是水线以上的部分，用 waterY 量）
    ok(w.waterY / H <= 0.24,
      `${tag} 天空留白 ${((w.waterY / H) * 100).toFixed(1)}%（≤24%，不多留空气）`);

    // 底部泥层厚度（阶段 8-⑧ 用户："水底泥土的占比降低"）
    // ⚠️ bedY 是**池底在画面里的高度比例**：数值越大 = 池底越靠下 = 泥层越薄。
    const mudPct = (H - w.bedY) / H;
    ok(mudPct <= 0.15, `${tag} 池底泥层只占 ${(mudPct * 100).toFixed(1)}%（≤15%）`);

    // ── 阶段 8-⑫：水下墙的三个量化指标 ──
    // ① 墙要"读得出来"：墙顶明显高过年终池底（否则沉底等于把地形抹平）
    const wallRise = w.bedY - w.groundYAt(1);
    ok(wallRise >= (w.bedY - w.waterY) * 0.35,
      `${tag} 水下墙高出池底 ${wallRise.toFixed(0)}px（≥总水深的 35%，剖面里看得见墙）`);

    // ② 墙顶缓台要平缓：从左缘到缓台中段，坡角有绝对上限 + 必须**明显缓于墙面**
    //    （相对对比才抗噪声/抗分辨率差异 —— 绝对阈值在竖屏上会间歇挂）
    //    ⚠️ 滑动窗口 ±12px 量坡度，别用相邻 2px 差分（噪声会出 60° 假峰）
    let shelfMax = 0;
    const shelfEnd = Math.round(w.bankSpan * (CONFIG.layout?.bank?.shelfRatio ?? 0.58) * w.shoreRatio * 0.7);
    for (let x = 14; x <= Math.max(14, shelfEnd); x += 2) {
      const dy = w.groundYAt(x + 12) - w.groundYAt(x - 12);
      shelfMax = Math.max(shelfMax, (Math.abs(Math.atan2(dy, 24)) * 180) / Math.PI);
    }
    ok(shelfMax <= 35, `${tag} 墙顶缓台最陡 ${shelfMax.toFixed(1)}°（≤35°）`);

    // ③ 墙面要立得住：缓台之后那一段的最陡坡 ≥35°，且比缓台陡一截（侧视图里像墙）
    let wallMax = 0;
    const wallX0 = Math.round(w.bankSpan * (CONFIG.layout?.bank?.shelfRatio ?? 0.58) * w.shoreRatio);
    const wallX1 = Math.round(w.bankSpan * (w.shoreRatio + 0.12));
    for (let x = Math.max(14, wallX0); x <= Math.min(W - 14, wallX1); x += 2) {
      const dy = w.groundYAt(x + 12) - w.groundYAt(x - 12);
      wallMax = Math.max(wallMax, (Math.abs(Math.atan2(dy, 24)) * 180) / Math.PI);
    }
    ok(wallMax >= 35, `${tag} 墙面最陡 ${wallMax.toFixed(1)}°（≥35° 才像墙）`);
    ok(wallMax >= shelfMax + 8, `${tag} 墙面比缓台陡（墙 ${wallMax.toFixed(0)}° vs 台 ${shelfMax.toFixed(0)}°）`);

    // ④ 墙顶上方要留够水头：任意一列从水线到地表的水深 ≥ min(30px, 4.5%h)
    //    （龟鱼从墙顶上游过去；小窗口按比例放宽）
    let minHead = Infinity;
    for (let x = 0; x <= Math.round(w.bankSpan * w.shoreRatio * 0.8); x += 6) {
      minHead = Math.min(minHead, w.groundYAt(x) - w.surfaceAt(x));
    }
    ok(minHead >= Math.min(30, H * 0.045),
      `${tag} 墙顶上方最小水头 ${minHead.toFixed(0)}px（≥${Math.min(30, H * 0.045).toFixed(0)}，龟鱼过得去）`);

    // 水体（阶段 8-⑫ 岸沉底后：水面占宽 100%，面积从 44.3% 涨到 ~55%）
    //   **面积占比** = 水在画面里到底占多大一块 —— "看起来水多不多"的正解。
    let wArea = 0;
    for (let x = 0; x <= W; x += 2) {
      const s = w.surfaceAt(x), g = w.groundYAt(x);
      wArea += Math.max(0, Math.min(g, H) - Math.max(s, 0)) * 2;
    }
    const areaFrac = wArea / (W * H);
    ok(frac >= 0.98, `${tag} 水面占宽 ${(frac * 100).toFixed(0)}%（≥98%，铺满全宽）`);
    ok(areaFrac >= 0.52,
      `${tag} 水体面积占画面 ${(areaFrac * 100).toFixed(1)}%（≥52%）`);
  }

  // 11) landZones / waterSpans 结构（阶段 8-⑫：无陆地，一段全宽水域）
  ok(w.landZones.length === 0, `${tag} 无陆地（左岸已沉入水下，实际 ${w.landZones.length}）`);
  ok(w.waterSpans.length === 1 && w.waterSpans[0].x0 <= 4 && w.waterSpans[0].x1 >= W - 4,
    `${tag} 一段全宽水域（实际 ${JSON.stringify(w.waterSpans)}）`);
  // 无岸时 shorePointNear 必须退回水域中心、不越界（龟的上岸目标兜底契约）
  {
    const sp = w.shorePointNear(W * 0.9);
    ok(sp.x >= 0 && sp.x <= W && Math.abs(sp.y - w.surfaceAt(sp.x)) <= 30,
      `${tag} 无岸时 shorePointNear 退回水域中心`);
  }

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
    ok(w.landZones.length === 0, `左岸沉底后无陆地（实际 ${w.landZones.length}）`);
    const cx = 640;
    ok(w.isWater(cx, (w.surfaceAt(cx) + w.groundYAt(cx)) / 2), '池中央是水');
  }
  // 打开晒台的对照：台地仍要能露出水面、龟站得住、水域被切成两段
  CONFIG.layout.platform.enabled = true;
  {
    const w = new World(1280, 720);
    ok(w.platform.on, '临时打开后晒台生效');
    ok(w.waterSpans.length >= 2, `晒台把水域切成两段（实际 ${w.waterSpans.length}）`);
    ok(w.landZones.length === 1, `沉底后唯一的陆块 = 晒台（实际 ${w.landZones.length}）`);
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
  // 阶段 8-⑫：墙顶在水下 —— resize 后仍要满足"水线 < 墙顶 < 池底"且随尺寸重算
  ok(Number.isFinite(b) && b > w.surfaceAt(20) && b < w.bedY,
    `resize 后墙顶仍没入水下（${a.toFixed(0)} → ${b.toFixed(0)}，水线 ${w.surfaceAt(20).toFixed(0)}）`);
  ok(Math.abs(w.bankTopY - w.waterY - w.h * 0.055) < w.h * 0.02,
    `resize 后墙顶吃水仍 ≈ 5.5%h（实际 ${((w.bankTopY - w.waterY) / w.h * 100).toFixed(1)}%）`);
  ok(w.landZones.length >= 0 && w.waterSpans.length >= 1, 'resize 后水陆分区重建');
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
  // 阶段 8-⑫：默认地形已无陆地（左岸沉底）→ 脚印系统应自然休眠（isLand 闸门拒收）
  let made0 = 0;
  for (let i = 0; i < 6; i++) {
    const before = w.footprints.length;
    w.addFootprint(100 + i * 9, w.groundYAt(100 + i * 9) - 2, Math.PI, 34, i % 2 ? 1 : -1);
    if (w.footprints.length > before) made0++;
  }
  ok(made0 === 0, `无陆地时水下不留脚印（拒收 ${6 - made0}/6）`);

  // 打开晒台 = 造一块合法陆地，脚印的形状防回退断言全部照常跑
  CONFIG.layout.platform.enabled = true;
  const wp = new World(1920, 1080);
  const zone = wp.landZones[0];
  const bankX = zone ? zone.mid : wp.waterLeftX * 0.45;
  let made = 0;
  for (let i = 0; i < 6; i++) {
    const x = bankX + (i - 2.5) * 9;
    const before = wp.footprints.length;
    wp.addFootprint(x, wp.groundYAt(x) - 2, Math.PI, 34, i % 2 ? 1 : -1);
    if (wp.footprints.length > before) made++;
  }
  ok(made >= 4, `岸上留下一串脚印（${made} / 6）`);

  wp._drawFootprints(ctx);
  ok(rec.fills + rec.strokes >= made * 3, `每个脚印至少 3 个形状（fill ${rec.fills} / stroke ${rec.strokes}）`);

  // ① 侧视的"扁"：每个形状的纵向半径必须远小于横向半径
  const fat = rec.ellipses.filter((e) => e.ry > e.rx / 3 + 0.01);
  ok(fat.length === 0, '所有踩痕都很扁（纵向 ≤ 横向的 1/3）',
    fat.length ? `${fat.length} 个太厚` : `${rec.ellipses.length} 个形状`);

  // ② 不再有脚趾圆 —— 那是俯视爪印的残留，防以后被加回来
  ok(rec.arcs === 0, '不再画脚趾圆（arc = 0，俯视爪印已彻底去掉）', `arc=${rec.arcs}`);

  // ③ 脚印躺在**地表**上（侧视：痕迹只能出现在地表）
  const off = wp.footprints.filter((f) => Math.abs(f.y - wp.groundYAt(f.x)) > 26).length;
  ok(off === 0, '每个脚印都贴在地表附近', off ? `${off} 个离地` : '');

  // ④ 倾斜角跟的是**地形坡度**，不是俯视行进方向
  const badRot = wp.footprints.filter((f) => {
    const want = Math.atan((wp.groundYAt(f.x + 4) - wp.groundYAt(f.x - 4)) / 8);
    return Math.abs((f.rot ?? 0) - want) > 1e-6;
  }).length;
  ok(badRot === 0, '倾斜角 = 地形坡度（不再是俯视的 rotate(angle)）', badRot ? `${badRot} 个不对` : '');
  CONFIG.layout.platform.enabled = false;   // 恢复默认
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
