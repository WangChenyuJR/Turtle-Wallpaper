#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make_species.py —— 调色板 JSON → turtle-pond 物种条目 + 图集预览页

输入：extract_palette.py 产出的 palette.json
输出：
  1. 注入片段（可直接粘进 src/species.js 的 FISH_SPECIES / TURTLE_SPECIES）
  2. 图集预览 HTML —— 用项目真实的绘制代码渲染，一眼验收"像不像"

为什么要把"生成配置"和"导出图片"分成两步：
  简图是 **矢量绘制**（Canvas 路径），不是位图。
  所以"渲染成简图"的正式产物其实是 **species.js 里的一条配置**，
  壁纸运行时按这条配置实时画出来 —— 分辨率无关、颜色可调、体量最小。
  只有确实需要位图时（做贴图/精灵表/给美术参考）才走 atlas 导出。

用法：
    python tools/make_species.py data/palette.json --out data/generated.js
    python tools/make_species.py data/palette.json --atlas out/atlas.html
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# 栖息类型预设（与 species.js 的 HABITAT_PRESETS 对应）
HABITAT_FALLBACK = {
    'aquatic':     'semi',
    'semi':        'semi',
    'terrestrial': 'semi',
    'marsh':       'semi',
}

# 中文名 → 英文 id 兜底映射（文件名是中文时用得上）
ZH_HINTS = {
    '巴西': 'redear', '草龟': 'chinese', '甲鱼': 'softshell', '地图': 'mapTurtle',
    '枯叶': 'mata', '缅甸': 'burmese', '黄缘': 'yellowpond',
    '锦鲤': 'koi', '鲫鱼': 'crucian', '金鱼': 'goldfish', '青鱼': 'grasscarp',
}


def guess_id(rec: dict) -> str:
    """给物种挑一个 id：优先用已有的，其次从中文名映射，最后用文件名。"""
    if rec.get('id'):
        return rec['id']
    label = rec.get('label', '')
    for zh, sid in ZH_HINTS.items():
        if zh in label:
            return sid
    stem = Path(rec.get('source', 'species')).stem
    parts = [p for p in ''.join(c if c.isalnum() else '_' for c in stem).split('_') if p]
    if not parts:
        return 'species'
    return parts[0].lower() + ''.join(w.capitalize() for w in parts[1:])


def turtle_entry(rec: dict) -> dict:
    """把调色板转成 species.js 的乌龟条目。

    注意 pattern 的取值必须落在 species.js 支持的集合内：
      rings / stripes / lines / smooth
    """
    sid = guess_id(rec)
    pattern = rec.get('pattern', 'smooth')
    if pattern not in ('rings', 'stripes', 'lines', 'smooth'):
        pattern = 'smooth'

    habitat = rec.get('autoHabitat') or 'semi'
    if habitat not in ('aquatic', 'semi', 'terrestrial', 'marsh'):
        habitat = 'semi'

    entry = {
        'id': sid,
        'label': rec.get('label') or sid,
        'habitat': habitat,
        'shell': rec['shell'],
        'limb': rec['limb'],
        'head': rec['head'],
        'pattern': pattern,
        'markColor': rec['markColor'],
        'shellLight': rec.get('shellLight'),   # 简图高光色（可选，供定制渲染用）
        'sizeScale': rec.get('sizeScale', 1.0),
        'speedScale': rec.get('speedScale', 1.0),
        'weight': rec.get('weight', 1),
        '_photo': rec.get('source', ''),        # 溯源：这张配置来自哪张照片
    }
    if 'flat' in (rec.get('tags') or []):
        entry['flat'] = True
    return entry


def fish_entry(rec: dict) -> dict:
    """把调色板转成 species.js 的鱼条目。"""
    sid = guess_id(rec)
    try:
        stripes = int(rec.get('stripes', 0))
    except (TypeError, ValueError):
        stripes = 0
    stripes = max(0, min(5, stripes))

    entry = {
        'id': sid,
        'label': rec.get('label') or sid,
        'body': rec['body'],
        'fin': rec['fin'],
        'stripes': stripes,
        'belly': rec.get('belly', rec['body']),
        'sizeScale': rec.get('sizeScale', 1.0),
        'speedScale': rec.get('speedScale', 1.0),
        'weight': rec.get('weight', 1),
        '_photo': rec.get('source', ''),
    }
    if 'bright' in (rec.get('tags') or []) and stripes >= 3:
        entry['fancyTail'] = True
    return entry


# ──────────────────────────────────────────────────────────────
#  代码生成
# ──────────────────────────────────────────────────────────────
def _js_obj(d: dict, indent: int = 2) -> str:
    """把 dict 渲染成整洁的 JS 对象字面量（键不加引号，字符串用单引号）。"""
    pad = ' ' * indent
    inner = ' ' * (indent + 2)
    lines = ['{']
    for k, v in d.items():
        if v is None:
            continue
        if isinstance(v, bool):
            sv = 'true' if v else 'false'
        elif isinstance(v, (int, float)):
            sv = str(v)
        else:
            sv = "'" + str(v).replace('\\', '\\\\').replace("'", "\\'") + "'"
        lines.append(f'{inner}{k}: {sv},')
    lines.append(f'{pad}}}')
    return '\n'.join(lines)


def render_species_snippet(records: list[dict]) -> str:
    turtles = [turtle_entry(r) for r in records if r.get('kind') == 'turtle']
    fishes = [fish_entry(r) for r in records if r.get('kind') == 'fish']

    out = []
    out.append('// ══════════════════════════════════════════════════════════')
    out.append('//  由 tools/make_species.py 从照片自动生成')
    out.append('//  用法：把下面的条目粘贴进 src/species.js 对应字典，')
    out.append('//        或在运行时调用 registerFishSpecies()/registerTurtleSpecies()')
    out.append('// ══════════════════════════════════════════════════════════')
    out.append('')

    if fishes:
        out.append('// ── 由照片生成的鱼品种 ──────────────────────────────')
        out.append('export const PHOTO_FISH_SPECIES = {')
        for e in fishes:
            out.append(f'  {e["id"]}: {_js_obj(e, 2)},')
        out.append('};')
        out.append('')

    if turtles:
        out.append('// ── 由照片生成的龟品种 ──────────────────────────────')
        out.append('export const PHOTO_TURTLE_SPECIES = {')
        for e in turtles:
            out.append(f'  {e["id"]}: {_js_obj(e, 2)},')
        out.append('};')
        out.append('')

    # 附一个"一键注册"入口，方便在浏览器控制台/自定义品种里直接用
    out.append('// ── 一键注册（配合 registerFishSpecies / registerTurtleSpecies）──')
    out.append('export function registerPhotoSpecies(reg) {')
    if fishes:
        out.append('  Object.values(PHOTO_FISH_SPECIES).forEach(reg.registerFishSpecies);')
    if turtles:
        out.append('  Object.values(PHOTO_TURTLE_SPECIES).forEach(reg.registerTurtleSpecies);')
    out.append('}')
    out.append('')
    return '\n'.join(out)


# ──────────────────────────────────────────────────────────────
#  图集预览页：用项目真实绘制代码渲染
# ──────────────────────────────────────────────────────────────
ATLAS_TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>照片简图图集 · turtle-pond</title>
<style>
  :root { --bg:#f6f3ea; --ink:#2c2a24; --line:#d8d2c2; }
  * { box-sizing:border-box; }
  body { margin:0; padding:28px 32px 60px; background:var(--bg); color:var(--ink);
         font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
  h1 { font-size:20px; margin:0 0 4px; font-weight:600; }
  .sub { font-size:13px; color:#7a7466; margin-bottom:22px; }
  h2 { font-size:15px; margin:30px 0 12px; padding-bottom:6px;
       border-bottom:1px solid var(--line); font-weight:600; }
  .grid { display:flex; flex-wrap:wrap; gap:16px; }
  .card { background:#fff; border:1px solid var(--line); border-radius:10px;
          padding:12px; width:270px; }
  .card canvas { display:block; background:linear-gradient(#8fb8c9,#6f9cb0);
                 border-radius:6px; width:246px; height:150px; }
  .name { font-size:13px; font-weight:600; margin-top:8px; }
  .meta { font-size:11px; color:#8a8478; margin-top:2px; }
  .chips { display:flex; gap:5px; margin-top:8px; flex-wrap:wrap; }
  .chip { display:flex; align-items:center; gap:4px; font-size:10px; color:#6b6659;
          background:#f2efe6; border-radius:4px; padding:2px 5px; }
  .dot { width:11px; height:11px; border-radius:3px; border:1px solid rgba(0,0,0,.15); }
  .frames { display:flex; gap:8px; margin-top:8px; overflow-x:auto; }
  .frames canvas { width:76px; height:76px; flex:0 0 auto; }
  .empty { color:#8a8478; font-size:13px; }
</style>
</head>
<body>
<h1>照片 → 简图 图集预览</h1>
<div class="sub">用项目真实的绘制代码渲染（species.js 配置驱动）。下方色卡即提取出的调色板。</div>
<div id="root"></div>

<script type="module">
import { Fish } from './src/fish.js';
import { Turtle } from './src/turtle.js';
import { CONFIG } from './src/config.js';
import { registerFishSpecies, registerTurtleSpecies }
  from './src/species.js';
import { PHOTO_FISH_SPECIES, PHOTO_TURTLE_SPECIES } from './data/generated.js';

// 1) 把照片生成的品种注册进运行时字典
Object.values(PHOTO_FISH_SPECIES || {}).forEach(registerFishSpecies);
Object.values(PHOTO_TURTLE_SPECIES || {}).forEach(registerTurtleSpecies);

const SWIM = 'swim';   // 与 turtle.js STATE.SWIM 一致

/** 最小假 world：只提供绘制路径会读到的字段 */
function fakeWorld() {
  return {
    w: 246, h: 150,
    waterTop: 12, waterBottom: 140,
    bankLineAt: () => 118,
  };
}

/** 在离屏画布上把一只生物画出来。
 *  构造签名：Fish(world, species, opts) / Turtle(world, index, species, opts) */
function drawCreature(kind, speciesId, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = 246 * 2; cv.height = 150 * 2;             // 2x 便于看清细节
  const ctx = cv.getContext('2d');
  ctx.scale(2, 2);
  const world = fakeWorld();
  const size = opts.size || (kind === 'fish' ? 26 : 30);

  let obj;
  if (kind === 'fish') {
    obj = new Fish(world, PHOTO_FISH_SPECIES[speciesId]);
    obj.tailPhase = opts.phase ?? 1.4;
  } else {
    obj = new Turtle(world, 0, PHOTO_TURTLE_SPECIES[speciesId]);
    obj.state = SWIM;
    obj.flipperPhase = opts.phase ?? 1.1;
    obj.headBob = 0.6;
  }
  obj.size = size;
  obj.angle = opts.angle ?? 0;
  obj.x = 123; obj.y = 78;

  obj.draw(ctx);
  return cv;
}

function chip(label, hex) {
  const d = document.createElement('span');
  d.className = 'chip';
  d.innerHTML = `<i class="dot" style="background:${hex}"></i>${label} ${hex}`;
  return d;
}

function card(kind, sp, sourceLabel) {
  const wrap = document.createElement('div');
  wrap.className = 'card';
  const cv = drawCreature(kind, sp.id);
  wrap.appendChild(cv);

  const nm = document.createElement('div');
  nm.className = 'name';
  nm.textContent = sp.label;
  wrap.appendChild(nm);

  const mt = document.createElement('div');
  mt.className = 'meta';
  mt.textContent = `${kind === 'fish' ? '鱼' : '龟'} · ${sp.id} · 来源 ${sourceLabel}`;
  wrap.appendChild(mt);

  const chips = document.createElement('div');
  chips.className = 'chips';
  const keys = kind === 'fish'
    ? ['body', 'belly', 'fin']
    : ['shell', 'shellLight', 'head', 'limb', 'markColor'];
  keys.forEach((k) => { if (sp[k]) chips.appendChild(chip(k, sp[k])); });
  wrap.appendChild(chips);

  // 乌龟额外给出几张不同动画相位，确认逐帧可用
  if (kind === 'turtle') {
    const fr = document.createElement('div');
    fr.className = 'frames';
    [0, 0.8, 1.6, 2.4, 3.2].forEach((ph) => {
      const c = document.createElement('canvas');
      c.width = 76 * 2; c.height = 76 * 2;
      const cx = c.getContext('2d');
      cx.scale(2, 2);
      const world = fakeWorld();
      const t = new Turtle(world, 0, PHOTO_TURTLE_SPECIES[sp.id]);
      t.size = 22; t.angle = 0; t.state = SWIM;
      t.x = 38; t.y = 38;
      t.flipperPhase = ph; t.headBob = ph;
      t.draw(cx);
      fr.appendChild(c);
    });
    wrap.appendChild(fr);
  }
  return wrap;
}

const root = document.getElementById('root');
const fishList = Object.values(PHOTO_FISH_SPECIES || {});
const turtleList = Object.values(PHOTO_TURTLE_SPECIES || {});

function section(title, list, kind, srcMap) {
  const h = document.createElement('h2');
  h.textContent = title;
  root.appendChild(h);
  if (!list.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = '（无）';
    root.appendChild(e);
    return;
  }
  const g = document.createElement('div');
  g.className = 'grid';
  list.forEach((sp) => g.appendChild(card(kind, sp, srcMap[sp.id] || '-')));
  root.appendChild(g);
}

const fishSrc = {}, turtleSrc = {};
Object.values(PHOTO_FISH_SPECIES || {}).forEach((s) => { fishSrc[s.id] = s._photo || '-'; });
Object.values(PHOTO_TURTLE_SPECIES || {}).forEach((s) => { turtleSrc[s.id] = s._photo || '-'; });

section('乌龟（水龟 / 半水龟 / 陆龟 / 沼泽龟）', turtleList, 'turtle', turtleSrc);
section('鱼', fishList, 'fish', fishSrc);

// 供自动化截图脚本读取
window.__atlasReady = true;
window.__atlasCount = { fish: fishList.length, turtle: turtleList.length };
</script>
</body>
</html>
"""


def write_atlas(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(ATLAS_TEMPLATE, encoding='utf-8')


def main(argv=None):
    ap = argparse.ArgumentParser(description='调色板 JSON → 物种配置 + 图集预览页')
    ap.add_argument('palette', help='extract_palette.py 产出的 JSON')
    ap.add_argument('--out', help='输出 JS 片段路径（默认打印到终端）')
    ap.add_argument('--atlas', help='输出图集预览 HTML 路径')
    args = ap.parse_args(argv)

    p = Path(args.palette)
    if not p.exists():
        print(f'找不到调色板文件：{p}', file=sys.stderr)
        return 1

    data = json.loads(p.read_text(encoding='utf-8'))
    records = data.get('species') if isinstance(data, dict) else data
    if not records:
        print('调色板里没有 species 记录。', file=sys.stderr)
        return 1

    # 生成 JS 时需要 data/generated.js 已存在（图集页会 import 它）
    js = render_species_snippet(records)
    out_js = Path(args.out) if args.out else Path('turtle-pond/data/generated.js')
    out_js.parent.mkdir(parents=True, exist_ok=True)
    out_js.write_text(js, encoding='utf-8')
    print(f'已写出物种配置：{out_js}')

    if args.atlas:
        write_atlas(Path(args.atlas))
        print(f'已写出图集预览页：{args.atlas}（用浏览器打开即可预览）')

    n_t = sum(1 for r in records if r.get('kind') == 'turtle')
    n_f = sum(1 for r in records if r.get('kind') == 'fish')
    print(f'合计：{n_t} 个龟品种、{n_f} 个鱼品种')
    return 0


if __name__ == '__main__':
    sys.exit(main())
