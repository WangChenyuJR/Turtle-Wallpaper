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

  // 1) 关键高度顺序：岸顶 < 水线 < 池底（阶段 8-⑬：岸恢复露出水面的高度）
  if (!(w.bankTopY < w.waterY && w.waterY < w.bedY)) bad.push('高度顺序');
  // 2) 地表处处有限
  for (let x = 0; x <= W; x += 7) {
    const g = w.groundYAt(x);
    if (!Number.isFinite(g)) { bad.push(`groundY@${x}=${g}`); break; }
  }
  // 3) 视觉水列占比（水线从岸线铺到右缘；岸坡列的水下部分不算"视觉水"）
  let waterCols = 0, total = 0;
  for (let x = 0; x <= W; x += 4) { total++; if (w.isWaterColumn(x)) waterCols++; }
  const frac = waterCols / total;
  if (frac < 0.3 || frac > 0.85) bad.push(`水面占比 ${(frac * 100).toFixed(0)}%`);

  ok(bad.length === 0, `${tag} 基本几何`, bad.join(' '));

  // 4) 阶段 8-⑬：左侧是**露出水面的岸**（恢复 8-⑫ 之前的高度），右侧水面铺到右缘
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

  // 7) 阶段 8-⑬ 剖面水体：岸坡列画着土的地方实际是**水**（土只是剖面背景），
  //    物理地板一路沉到池底；但干地/空气不越界
  const bankX = Math.round(w.bankSpan * 0.2);
  const bs = w.surfaceAt(bankX), bf = w.swimFloorY(bankX);
  ok(w.isWater(bankX, Math.max(bs + 6, (bs + bf) / 2)),
    `${tag} 岸坡土前是水（x=${bankX}，水线 ${bs.toFixed(0)} → 地板 ${bf.toFixed(0)}）`);
  ok(bf >= w.bedY - 4, `${tag} 剖面地板处处到池底（x=${bankX} 地板 ${bf.toFixed(0)} / 池底 ${w.bedY}）`);
  // 开阔水面不再是"地面"（修 8-⑫ 以来的"龟在水上走路/留水面脚印"）
  const midX2 = Math.round(W * 0.6);
  ok(!w.isLand(midX2, w.surfaceAt(midX2) + 1) && !w.isLand(midX2, w.surfaceAt(midX2) + 3),
    `${tag} 开阔水面不是地面（龟不再在水上走）`);

  // 8) constrainToWater 把任意点都收回水里
  let leaked = 0;
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * W, y = Math.random() * H;
    const c = w.constrainToWater(x, y, 10);
    if (!w.isWater(c.x, c.y)) leaked++;
  }
  ok(leaked === 0, `${tag} constrainToWater 400 次随机点全部落在水里`, leaked ? `${leaked} 次漏出` : '');

  // 9) pickLandSpot 给出可站的干地（阶段 8-⑬：左岸已恢复，龟有地方晒背）
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

    // 天空留白（岸顶以上；8-⑬ 岸恢复原高，岸顶就是天空的下沿）
    ok(w.bankTopY / H <= 0.23,
      `${tag} 天空留白 ${((w.bankTopY / H) * 100).toFixed(1)}%（≤23%，不多留空气）`);

    // 底部泥层厚度（阶段 8-⑧ 用户："水底泥土的占比降低"）
    // ⚠️ bedY 是**池底在画面里的高度比例**：数值越大 = 池底越靠下 = 泥层越薄。
    const mudPct = (H - w.bedY) / H;
    ok(mudPct <= 0.15, `${tag} 池底泥层只占 ${(mudPct * 100).toFixed(1)}%（≤15%）`);

    // ── 岸坡坡度（恢复 8-⑫ 之前的岸，缓坡指标照旧守住）──
    // 岸坡整体角：画面左缘（岸顶）→ 岸线，整体要缓
    const edge = w.waterLeftX;
    const dropAll = Math.max(0, w.surfaceAt(edge) - w.groundYAt(1));
    const angAll = (Math.atan2(dropAll, Math.max(1, edge)) * 180) / Math.PI;
    ok(angAll <= 30, `${tag} 岸坡整体 ${angAll.toFixed(1)}°（≤30° 才算缓）`);

    // 水线附近最陡角 —— 龟攀爬的就是这一段（滑动窗口 ±12px 量坡，防噪声假峰）
    let maxNear = 0;
    for (let x = Math.max(14, edge - 44); x <= edge - 12; x += 2) {
      const dy = w.groundYAt(x + 12) - w.groundYAt(x - 12);
      maxNear = Math.max(maxNear, (Math.abs(Math.atan2(dy, 24)) * 180) / Math.PI);
    }
    ok(maxNear <= 45, `${tag} 水线附近最陡 ${maxNear.toFixed(0)}°（≤45° 龟爬得上）`);

    // 水下：刚入水 14px 处要还是浅滩（画出来的剖面），不能垂直扎下去
    const shoal = w.groundYAt(Math.min(W - 1, edge + 14)) - w.surfaceAt(edge);
    ok(shoal >= -4 && shoal <= (w.bedY - w.waterY) * 0.3,
      `${tag} 入水 14px 才下沉 ${shoal.toFixed(0)}px（近岸是缓浅滩）`);

    // ── 阶段 8-⑬ 剖面水体量化 ──
    // ① 物理地板处处沉到池底（水下土体不挡路）
    let minFloor = Infinity;
    for (let x = 0; x <= W; x += 6) minFloor = Math.min(minFloor, w.swimFloorY(x));
    ok(minFloor >= w.bedY - 4,
      `${tag} 剖面地板最浅 ${minFloor.toFixed(0)}px（≥池底 ${w.bedY.toFixed(0)}-4，龟鱼游得进"土"里）`);
    // ② 岸坡列的水头：水线到剖面地板的深度要够龟鱼下潜
    const headBank = w.swimFloorY(4) - w.surfaceAt(4);
    ok(headBank >= (w.bedY - w.waterY) * 0.8,
      `${tag} 岸坡列可游水深 ${headBank.toFixed(0)}px（≥总水深的 80%）`);

    // 水体：视觉水面积（水线→画出的地表）+ 可游面积（水线→剖面地板，才是"水多不多"的正解）
    let wArea = 0, sArea = 0;
    for (let x = 0; x <= W; x += 2) {
      const s = w.surfaceAt(x), g = w.groundYAt(x), f = w.swimFloorY(x);
      wArea += Math.max(0, Math.min(g, H) - Math.max(s, 0)) * 2;
      sArea += Math.max(0, Math.min(f, H) - Math.max(s, 0)) * 2;
    }
    const areaFrac = wArea / (W * H);
    const swimFrac = sArea / (W * H);
    ok(areaFrac >= 0.40,
      `${tag} 视觉水体面积占画面 ${(areaFrac * 100).toFixed(1)}%（≥40%）`);
    ok(swimFrac >= 0.60,
      `${tag} 可游水体面积占画面 ${(swimFrac * 100).toFixed(1)}%（≥60%，剖面把水下土体让给了水）`);
  }

  // 11) landZones / waterSpans 结构（阶段 8-⑬：陆地 = 左岸 [+ 晒台]）
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
    ok(w.landZones.length === 1, `默认只有左岸一块陆（实际 ${w.landZones.length}）`);
    const cx = 640;
    ok(w.isWater(cx, (w.surfaceAt(cx) + w.swimFloorY(cx)) / 2), '池中央是水');
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
  // 阶段 8-⑬：岸顶在水线上 —— resize 后仍要满足"岸顶 < 水线 < 池底"且随尺寸重算
  ok(Number.isFinite(b) && b < w.surfaceAt(20), `resize 后地表重算（${a.toFixed(0)} → ${b.toFixed(0)}）`);
  ok(w.bankTopY < w.waterY && w.waterY < w.bedY, 'resize 后高度顺序保持 岸顶<水线<池底');
  // 剖面地板在 resize 后仍处处到池底
  let minFloor = Infinity;
  for (let x = 0; x <= 800; x += 6) minFloor = Math.min(minFloor, w.swimFloorY(x));
  ok(minFloor >= w.bedY - 4, `resize 后剖面地板仍到池底（${minFloor.toFixed(0)} / ${w.bedY}）`);
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
  // 阶段 8-⑬：左岸已恢复 —— 脚印系统在真岸上照常工作
  const bankZone = w.landZones.find((z) => z.kind === 'bank');
  const bankX = bankZone ? bankZone.mid : w.waterLeftX * 0.45;
  let made = 0;
  for (let i = 0; i < 6; i++) {
    const x = bankX + (i - 2.5) * 9;
    const before = w.footprints.length;
    w.addFootprint(x, w.groundYAt(x) - 2, Math.PI, 34, i % 2 ? 1 : -1);
    if (w.footprints.length > before) made++;
  }
  ok(made >= 4, `岸上留下一串脚印（${made} / 6）`);
  // 但开阔水面的"假地面"不留脚印（8-⑫ 期间用户实测 bug：龟在水上走出脚印）
  let madeWater = 0;
  for (let i = 0; i < 6; i++) {
    const x = Math.round(w.w * 0.6) + i * 9;
    const before = w.footprints.length;
    w.addFootprint(x, w.surfaceAt(x) + 1, Math.PI, 34, i % 2 ? 1 : -1);
    if (w.footprints.length > before) madeWater++;
  }
  ok(madeWater === 0, '水面上不留脚印（isLand 闸门拒收）');

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

console.log('\n=== E. 水陆之间没有"死带"（点判定，阶段 8-⑬）===');
// 不变量（8-⑬ 剖面水体版）：
//   ① 水线以下到**剖面地板**之间逐点必须都是水（土体只是剖面，龟鱼一路游到池底）；
//   ② 干地列贴着地表要算陆（龟站得住）；近岸浅水列的水线过渡带要算陆（过界必经）。
for (const [W, H] of [[1920, 1080], [1280, 720], [800, 500], [1000, 1400]]) {
  const w = new World(W, H);
  let gap = 0, tested = 0, firstGap = '';
  for (let x = 1; x < w.w; x += 7) {
    const s = w.surfaceAt(x), f = w.swimFloorY(x);
    for (let y = Math.floor(s) + 1; y <= f; y += 2) {
      tested++;
      if (!w.isWater(x, y)) {
        if (!gap) firstGap = `首个 (${x},${y.toFixed(0)}) 水线 ${s.toFixed(0)} 地板 ${f.toFixed(0)}`;
        gap++;
      }
    }
    // 干地表面的可站性
    const g = w.groundYAt(x);
    if (g <= s + 2 && !w.isLand(x, g)) {
      if (!gap) firstGap = `干地不可站 (${x},${g.toFixed(0)})`;
      gap++;
    }
  }
  ok(gap === 0, `${W}×${H} 水线→剖面地板全是水 + 干地可站`, gap ? `${gap}/${tested} 个点悬空 · ${firstGap}` : `${tested} 个点全部有归属`);
}

console.log(`\n=== 合计：通过 ${pass} / 失败 ${fail} ===`);
process.exit(fail ? 1 : 0);
