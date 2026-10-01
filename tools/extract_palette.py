#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
extract_palette.py —— 照片 → 扁平简图调色板提取

作用：
    把一张乌龟 / 鱼的真实照片，提取成 turtle-pond 简图风格所需的"平涂色"，
    输出可直接喂给 make_species.py 的 JSON。

为什么要这么做：
    真实照片是"连续色调"的（几千种颜色 + 丰富明暗），
    而 turtle-pond 是"扁平矢量"风格（每个物种只用 5~8 个色块）。
    所以要先把照片压缩成几个"代表色"，再交给简图渲染器。

从照片提取哪些色（与 species.js 的字段一一对应）：

  乌龟（TurtleSpecies）
    crop        主体裁剪信息
    shell       壳的主色          ← 龟壳区域的主色簇
    shellLight  壳高光色          ← 壳区域最亮的簇（简图用 radialGradient 复现）
    limb        四肢颜色          ← 主体外围偏暗的簇
    head        头部颜色          ← 头部区域主色（与壳区分开）
    markColor   斑纹/耳后斑颜色    ← 主体内"离群色"（最跳的那个簇）
    pattern     壳纹样式          ← 由壳区域对比度自动判定

  鱼（FishSpecies）
    body        体色              ← 主体主色簇
    belly       腹色              ← 主体下 1/3 的亮色簇
    fin         鳍色              ← 主体外围偏半透明的簇
    stripes     竖条纹数量        ← 由体表垂直方向的色差波动自动判定

用法：
    # 单个文件
    python tools/extract_palette.py photo.jpg --kind turtle --id myTurtle --label 我的龟

    # 整个目录（文件名作为 id）
    python tools/extract_palette.py photos/ --kind fish --out data/palette.json

    # 只想要色卡可视化检查
    python tools/extract_palette.py photo.jpg --kind turtle --swatch out/swatch.png
"""

from __future__ import annotations

import argparse
import colorsys
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

# ──────────────────────────────────────────────────────────────
#  扁平化参数：决定"简图"有多简
# ──────────────────────────────────────────────────────────────
SAT_FLOOR = 0.28        # 最低饱和度 —— 照片褪色时把颜色"提纯"，否则简图会发灰
SAT_PUSH = 1.22         # 饱和度增强系数（简图风格比照片更鲜明）
VAL_CLAMP = (58, 205)   # 明度压缩区间：简图不用纯黑纯白，压在中间调
VAL_GAMMA = 0.88        # <1 轻微提亮，避免照片逆光偏暗

# 聚类时先量化到 LAB 网格，避免 KMeans 陷入逐像素噪声
# （LAB_STEP 单位为 Lab 距离 ≈ 人眼可辨的 JND 的 2 倍）
LAB_STEP = 6.0


# ──────────────────────────────────────────────────────────────
#  颜色空间工具
# ──────────────────────────────────────────────────────────────
def srgb_to_lab(rgb: np.ndarray) -> np.ndarray:
    """sRGB(0-255) → CIE Lab。用 Lab 做聚类 = 按"人眼感知差异"分组，
    比直接对 RGB 聚类更符合直觉（RGB 里绿色和黄色距离远得离谱）。
    接受 ndarray / list / tuple。"""
    rgb = np.asarray(rgb)
    c = rgb.astype(np.float64) / 255.0
    # sRGB 反 gamma
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = c @ m.T
    xyz /= np.array([0.95047, 1.0, 1.08883])          # D65 白点
    d = 6 / 29
    f = np.where(xyz > d ** 3, np.cbrt(xyz), xyz / (3 * d ** 2) + 4 / 29)
    # L* ∈ [0,100]，a*/b* 为 ±(100 量级)；两者都要放大，否则距离尺度失真
    return np.stack([
        116.0 * f[..., 1] - 16.0,
        500.0 * (f[..., 0] - f[..., 1]),
        200.0 * (f[..., 1] - f[..., 2]),
    ], axis=-1)


def lab_to_rgb(lab: np.ndarray) -> np.ndarray:
    """CIE Lab → sRGB(0-255)，结果裁剪到合法范围。"""
    fy = (lab[..., 0] + 16.0) / 116.0
    fx = fy + lab[..., 1] / 500.0
    fz = fy - lab[..., 2] / 200.0
    d = 6 / 29
    f = np.stack([fx, fy, fz], axis=-1)
    xyz = np.where(f > d, f ** 3, 3 * d ** 2 * (f - 4 / 29))
    xyz *= np.array([0.95047, 1.0, 1.08883])
    m = np.array([
        [3.2404542, -1.5371385, -0.4985314],
        [-0.9692660, 1.8760108, 0.0415560],
        [0.0556434, -0.2040259, 1.0572252],
    ])
    lin = xyz @ m.T
    lin = np.clip(lin, 0, None)
    srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
    return np.clip(srgb * 255.0, 0, 255)


def rgb_to_hex(rgb) -> str:
    """接受 0-1 或 0-255 两种量纲的颜色，统一输出 #rrggbb。"""
    vals = [float(v) for v in rgb[:3]]
    if max(abs(v) for v in vals) <= 1.0:      # 判定为 0-1 归一化
        vals = [v * 255.0 for v in vals]
    r, g, b = (int(round(max(0, min(255, v)))) for v in vals)
    return f'#{r:02x}{g:02x}{b:02x}'


def flatten_color(rgb, sat_push=SAT_PUSH, val_range=VAL_CLAMP, gamma=VAL_GAMMA) -> str:
    """把一个色往"扁平简图"方向推。

    简图的色彩特征：**高饱和、中明度、明暗层次少**。
    照片直接取色会得到一堆灰扑扑的中间色，转绘出来像褪色的贴纸。
    这里做三件事：提饱和 / 把明度压进中间调 / 轻微提亮。
    """
    vals = [max(0.0, float(x)) for x in rgb[:3]]
    # 量纲自适应：>1 视为 0-255，否则视为已归一化的 0-1。
    # （早期版本无条件除以 255，导致传入 0-1 颜色时被二次缩放，全部压成近黑）
    if max(vals) > 1.0:
        vals = [x / 255.0 for x in vals]
    r, g, b = [min(1.0, x) for x in vals]
    h, s, v = colorsys.rgb_to_hsv(r, g, b)

    # 1) 提饱和：低饱和色优先大幅提升（它最需要"被救"）
    s = s * sat_push + (SAT_FLOOR - s) * 0.55 if s < SAT_FLOOR else s * sat_push
    s = max(0.0, min(1.0, s))

    # 2) 明度压进中间调 + gamma 提亮
    v = max(0.0, min(1.0, v)) ** gamma
    lo, hi = val_range[0] / 255.0, val_range[1] / 255.0
    v = lo + v * (hi - lo)

    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return rgb_to_hex((r * 255, g * 255, b * 255))


def hex_to_rgb01(h: str):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


# ──────────────────────────────────────────────────────────────
#  主体检测：把照片里的龟/鱼从背景（水、桌面、手）里抠出来
# ──────────────────────────────────────────────────────────────
def _fg_mask(img: Image.Image, trim: float = 0.06) -> np.ndarray:
    """估计"主体像素"掩码。

    策略（不依赖 AI 抠图，纯统计，够用且零依赖）：
      1. 取照片四边的窄框作为"背景样本"
      2. 算每个像素与背景均值的 Lab 距离
      3. 距离超过阈值的即为主体
      4. 按包围盒裁掉边缘 trim 比例（去掉水面反光/桌面）

    如果背景和主体太像（比如龟漂在浑水里），退化为"取画面中心 70%"，
    这样至少不会把整张图当主体 —— 宁粗勿错。
    """
    a = np.asarray(img.convert('RGB'))
    h, w = a.shape[:2]
    b = max(2, int(min(h, w) * 0.04))
    border = np.concatenate([
        a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3),
        a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3),
    ])
    bg_lab = srgb_to_lab(border)
    bg_mean = bg_lab.mean(axis=0)

    lab = srgb_to_lab(a.reshape(-1, 3))
    dist = np.linalg.norm(lab - bg_mean, axis=-1)
    # 背景样本自身有波动，用其距离分布定阈值，避免把水面噪点当主体
    border_dist = np.linalg.norm(srgb_to_lab(border) - bg_mean, axis=-1)
    thr = max(float(np.percentile(border_dist, 97)) * 1.6, 12.0)
    mask = dist > thr

    frac = mask.mean()
    # 主体在整幅照片里可能只占几个百分点（远景/带环境的照片很常见），
    # 所以下限放得很低；只有"几乎什么都没抠到"或"几乎抠了整张"才算失败。
    if frac < 0.012 or frac > 0.80:          # 抠失败 → 退化为中心区域
        m = np.zeros((h, w), bool)
        m[int(h * 0.15):int(h * 0.85), int(w * 0.15):int(w * 0.85)] = True
        mask = m.reshape(-1)

    mask = mask.reshape(h, w)
    mask = _largest_blob(mask)
    ys, xs = np.where(mask)
    if len(ys) < 50:
        ys = np.array([0, h - 1]); xs = np.array([0, w - 1])

    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    px = int((y1 - y0) * trim); py = int((x1 - x0) * trim)
    y0, y1 = min(y0 + px, h - 1), max(y1 - px, y0 + 1)
    x0, x1 = min(x0 + py, w - 1), max(x1 - py, x0 + 1)

    # 关键：把裁剪区之外的像素从掩码里抹掉，但 **保持整幅图尺寸**。
    # 下游的 _boxes / dominant_colors 都按整图尺寸做矩阵运算，
    # 返回裁剪后的小矩阵会让形状对不上（元素数 ≠ h*w）。
    keep = np.zeros((h, w), bool)
    keep[y0:y1 + 1, x0:x1 + 1] = True
    return (mask & keep), (x0, y0, x1 + 1, y1 + 1)


def _largest_blob(mask: np.ndarray) -> np.ndarray:
    """只保留最大连通域（即主角本身），丢掉水面反光等零散噪点。

    用 4-邻域泛洪填充实现（纯 numpy，无需 scipy）。
    为控制耗时，先把掩码降采样到最长边 ≤256 做连通性判断，再上采样回原尺寸。
    """
    h, w = mask.shape
    if mask.sum() < 64:
        return mask
    scale = max(1, int(math.ceil(max(h, w) / 256)))
    if scale > 1:
        small = mask[::scale, ::scale]
    else:
        small = mask

    sh, sw = small.shape
    lbl = np.zeros((sh, sw), np.int32)
    best_id, best_size = 0, 0
    cur = 0
    # 用显式栈做 4-邻域扫描，避免递归爆栈
    for sy in range(sh):
        for sx in range(sw):
            if not small[sy, sx] or lbl[sy, sx]:
                continue
            cur += 1
            stack = [(sy, sx)]
            lbl[sy, sx] = cur
            size = 0
            while stack:
                y, x = stack.pop()
                size += 1
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < sh and 0 <= nx < sw and small[ny, nx] and not lbl[ny, nx]:
                        lbl[ny, nx] = cur
                        stack.append((ny, nx))
            if size > best_size:
                best_id, best_size = cur, size

    if best_id == 0:
        return mask
    small_keep = lbl == best_id
    if scale == 1:
        return small_keep
    keep = np.zeros((h, w), bool)
    up = np.repeat(np.repeat(small_keep, scale, axis=0), scale, axis=1)[:h, :w]
    keep[:up.shape[0], :up.shape[1]] = up
    return mask & keep


def _boxes(mask: np.ndarray) -> dict[str, np.ndarray]:
    """在 **主体包围盒** 内切出「壳/头/腹/外围」子区域。

    为什么要用包围盒而不是前景掩码来切区域：
      紧致的前景掩码只覆盖"最实"的主体核心（例如鱼身椭圆），
      而腹鳍、尾鳍这类半透明部分常被漏掉，四肢也可能被判为背景。
      若基于掩码像素划区，belly/limb 区域会得到空集，导致鳍色、腹色退化。
      改用包围盒后，这些区域一定能取到像素。

    乌龟 —— 壳(中央大块)、头(前侧)、四肢(外围)
    鱼   —— 身体(中央)、腹(下侧)、鳍(外围)

    返回 {区域名: 全图尺寸的布尔矩阵}。
    """
    h, w = mask.shape
    ys, xs = np.where(mask)
    if len(ys) < 20:
        return {}

    # 主体包围盒（略放宽，纳入紧贴主体的鳍/边沿）
    y0, y1 = int(ys.min()), int(ys.max())
    x0, x1 = int(xs.min()), int(xs.max())
    bh, bw = max(1, y1 - y0), max(1, x1 - x0)
    pad_y, pad_x = int(bh * 0.10), int(bw * 0.08)
    y0, y1 = max(0, y0 - pad_y), min(h - 1, y1 + pad_y)
    x0, x1 = max(0, x0 - pad_x), min(w - 1, x1 + pad_x)
    bh, bw = max(1, y1 - y0), max(1, x1 - x0)

    yy, xx = np.mgrid[0:h, 0:w]
    # 归一化到包围盒坐标系（0~1）
    ux = (xx - x0) / bw
    uy = (yy - y0) / bh
    inside = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)

    boxes = {}
    # 中央椭圆 —— 壳 / 躯干
    boxes['center'] = inside & (((ux - 0.5) / 0.30) ** 2 + ((uy - 0.5) / 0.40) ** 2 <= 1.0)
    # 前侧（右侧）—— 头
    boxes['front'] = inside & (ux > 0.68)
    # 下侧 —— 腹部
    boxes['belly'] = inside & (uy > 0.62)
    # 外围环 —— 四肢 / 鳍（排除中心椭圆）
    boxes['limb'] = inside & (((ux - 0.5) / 0.28) ** 2 + ((uy - 0.5) / 0.36) ** 2 > 1.0)
    return boxes


# ──────────────────────────────────────────────────────────────
#  主色提取：Lab 空间网格量化 + KMeans
# ──────────────────────────────────────────────────────────────
def _kmeans(lab: np.ndarray, k: int, iters: int = 32, seed: int = 7):
    """极简 KMeans++。数据已量化到网格，几百个点跑一次是毫秒级。
    返回 (聚类中心 C[k,3], 每个点的簇标签 lbl[n] 整数, 每簇权重 counts[k])。
    """
    rng = np.random.default_rng(seed)
    n = len(lab)
    if n == 0:
        return np.zeros((1, 3)), np.zeros(0, dtype=int), np.ones(1)
    if n <= k:
        # 点数比簇还少：每个点自成一簇，权重各为 1
        return lab.copy(), np.arange(n, dtype=int), np.ones(n, dtype=float)

    # KMeans++ 初始化
    centers = [lab[rng.integers(n)]]
    for _ in range(k - 1):
        d = np.min(((lab[:, None, :] - np.array(centers)[None, :, :]) ** 2).sum(-1), axis=1)
        p = d / (d.sum() or 1)
        centers.append(lab[rng.choice(n, p=p)])
    C = np.array(centers)

    for _ in range(iters):
        d2 = ((lab[:, None, :] - C[None, :, :]) ** 2).sum(-1)
        lbl = d2.argmin(1)
        moved = False
        for j in range(k):
            sel = lbl == j
            if sel.sum() == 0:
                continue
            nc = lab[sel].mean(0)
            if np.abs(nc - C[j]).max() > 0.4:
                moved = True
            C[j] = nc
        if not moved:
            break

    counts = np.array([(lbl == j).sum() for j in range(k)], dtype=float)
    return C, lbl, counts


def dominant_colors(img: Image.Image, mask: np.ndarray | None = None,
                    k: int = 6, box: np.ndarray | None = None):
    """返回 [(lab_color, weight, rgb01), ...]，按权重降序。

    mask / box 都是 **整幅图尺寸** 的布尔矩阵。
    只传 mask  → 全部主体像素（紧致前景）
    再传 box   → 在子区域内取色

    注意：子区域取色时用的是 **bbox 范围内的宽松区域**，而不是紧致前景掩码。
    原因：鱼的腹鳍/尾鳍是半透明的、腹色与体色对比弱，
    这些像素常被前景检测判为背景，若强制与前景掩码求交会得到空集
    （实测 belly/limb 区域像素数为 0，导致鳍色退化成体色）。
    """
    a = np.asarray(img.convert('RGB')).reshape(-1, 3)
    strong = mask.reshape(-1) if mask is not None else np.ones(len(a), bool)

    if box is not None:
        bsel = box.reshape(-1)
        # 优先用"子区域 ∩ 前景"；空集或过少时，放宽为"子区域内全部像素"
        sel = strong & bsel
        if sel.sum() < max(40, 0.004 * bsel.sum()):
            sel = bsel
        if sel.sum() >= 40:
            strong = sel

    px = a[strong]
    if len(px) < 30:
        px = a

    lab = srgb_to_lab(px)
    q = np.round(lab / LAB_STEP).astype(np.int32)
    _, inv, cnt = np.unique(q, axis=0, return_inverse=True, return_counts=True)
    grid = np.zeros((len(cnt), 3))
    for i in range(len(cnt)):
        grid[i] = lab[inv == i].mean(0)

    C, lbl, counts = _kmeans(grid, min(k, len(grid)))
    # 把"网格点的像素数"按所属簇累加，得到每个簇的真实权重
    lbl = np.asarray(lbl).astype(int)
    w = np.zeros(len(C), dtype=float)
    for gi in range(len(grid)):
        w[lbl[gi]] += float(cnt[gi])

    order = np.argsort(-w)
    out = []
    for ci in order:
        if w[ci] <= 0:
            continue
        out.append((C[ci], float(w[ci]), tuple(lab_to_rgb(C[ci]) / 255.0)))
    return out


def _salient(cols, base_lab, min_frac: float = 0.0015):
    """挑"离群色" = 与主体平均色差异最大、且不是噪声的簇。

    用来找斑纹：巴西龟的耳后红斑、地图龟的黄线这类，
    在照片里往往只占不到 1% 的像素，但正是品种辨识度最高的部分。

    评分 = Lab 色差 × 饱和度权重 × sqrt(占比)
      · 色差   —— 越不像主体底色越可能是斑纹
      · 饱和度 —— 斑纹通常是醒目色（红/黄），比暗部阴影更值得当斑纹
      · 占比   —— 用平方根压制，让 1% 的小色块也能和 89% 的大色块竞争

    min_frac 只用来剔除"像素尘埃"级噪点，不要设太高——
    设成百分之几会把真正的斑点（如红耳斑，实测仅占 0.6%）误滤掉。

    评分 = 归一化色差 × 饱和度权重 × 频率微调

    关键：**色差必须占主导**。早期版本用 sqrt(占比) 直接相乘，
    结果"占比 89% 的底色"总能压过"占比 0.6% 但色差极大的红斑"，
    导致斑纹永远选不出来。现在改为：
      · 色差归一化到 0~1（除以 60，约等于人眼能明显分辨的 Lab 距离上限）
      · 频率只用 (0.5 + 0.5*sqrt(frac)) 轻微调节，范围 0.5~1.0，不再喧宾夺主
    """
    total = sum(w for _, w, _ in cols) or 1.0
    best, score_best = None, 0.0
    for lab, wt, rgb in cols:
        frac = wt / total
        if frac < min_frac:
            continue
        mx, mn = max(rgb), min(rgb)
        sat = 0.0 if mx <= 1e-6 else (mx - mn) / mx
        color_dist = float(np.linalg.norm(lab - base_lab)) / 60.0     # 归一化
        color_dist = min(1.0, color_dist)
        freq = 0.5 + 0.5 * math.sqrt(frac)                            # 0.5 ~ 1.0
        score = color_dist * (0.45 + 0.85 * sat) * freq
        if score > score_best:
            best, score_best = (lab, wt, rgb), score
    return best


# ──────────────────────────────────────────────────────────────
#  龟 / 鱼：照片 → species 条目
# ──────────────────────────────────────────────────────────────
def extract_turtle(path: Path, sid: str, label: str, k: int = 6) -> dict:
    img = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    mask, crop = _fg_mask(img)
    boxes = _boxes(mask)

    flat = {}
    for name, box in boxes.items():
        flat[name] = dominant_colors(img, mask, k=k, box=box)
    allc = dominant_colors(img, mask, k=k)

    # 壳 = 中央区域（避开外围四肢与头部）
    shell_c = flat.get('center') or allc
    # 头 = 前侧；照片里若与壳区分不明显，则用壳色微调
    head_c = flat.get('front') or allc
    # 四肢 = 外围偏暗的簇（按 Lab 明度 L 升序，取最暗两簇）
    limb_c = sorted(flat.get('limb') or allc, key=lambda t: t[0][0])[:2] or allc

    shell_lab, _, shell_rgb = shell_c[0]
    head_lab, _, head_rgb = head_c[0]
    limb_lab, _, limb_rgb = limb_c[0]

    # 壳高光：壳区域里最亮的一簇（简图用 radialGradient 复现立体感）
    shell_light = max(shell_c, key=lambda t: t[0][0])[2]
    if abs(shell_light[0] - shell_rgb[0]) < 0.04:
        shell_light = tuple(min(1.0, c + 0.16) for c in shell_rgb)

    # 斑纹色：以"壳+头"的加权均值为基准找离群色
    base = (shell_lab * 0.65 + head_lab * 0.35)
    sal = _salient(allc, base)          # min_frac 用默认值，勿设高（会滤掉小面积斑纹）
    mark_rgb = sal[2] if sal else head_rgb

    # 壳纹样式：按壳区域内的明度对比度判定
    # 阈值偏保守 —— 单纯的光照渐变也会带来 0.10 左右的对比度，
    # 只有明显更强的明暗交替才认定为真实纹路（避免把光斑误判成条纹）。
    contrast = _shell_contrast(mask, img)
    pattern = 'rings' if contrast > 0.26 else ('stripes' if contrast > 0.17 else 'smooth')

    tags = _turtle_tags(shell_rgb, limb_rgb, img)

    return {
        'id': sid,
        'label': label,
        'kind': 'turtle',
        'source': path.name,
        'crop': crop,
        'shell': flatten_color(shell_rgb),
        'shellLight': flatten_color(shell_light),
        'limb': flatten_color(limb_rgb),
        'head': flatten_color(head_rgb),
        'markColor': flatten_color(mark_rgb),
        'pattern': pattern,
        'contrast': round(contrast, 3),
        'autoHabitat': _guess_habitat(tags),
        'tags': tags,
        '_palette': {
            'shell': [c[2] for c in shell_c],
            'head': [c[2] for c in head_c],
            'limb': [c[2] for c in limb_c],
            'all': [c[2] for c in allc],
        },
    }


def _shell_contrast(mask, img) -> float:
    """壳区域明度标准差 / 均值 —— 纹路越花，值越大。"""
    a = np.asarray(img.convert('RGB'))
    h, w = a.shape[:2]
    cy, cx = h // 2, w // 2
    r = int(min(h, w) * 0.24)
    sub = a[max(0, cy - r):cy + r, max(0, cx - r):cx + r].reshape(-1, 3).astype(float)
    if len(sub) < 30:
        return 0.0
    lum = sub @ np.array([0.299, 0.587, 0.114])
    return float(lum.std() / (lum.mean() + 1e-6))


def _turtle_tags(shell_rgb, limb_rgb, img) -> list[str]:
    """给龟打上算法可直接读的视觉标签（决定简图怎么画）。"""
    r, g, b = shell_rgb
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    tags = []
    if v < 0.30:
        tags.append('dark')
    if s > 0.42 and 0.06 < h < 0.18:
        tags.append('golden' if h > 0.10 else 'brown')
    if (r > g > b) and (r - b) > 0.18:
        tags.append('reddish')
    if b >= r and b >= g:
        tags.append('cool')
    if g > r and g > b:
        tags.append('olive')
    if s < 0.16:
        tags.append('neutral')
    # 扁平体态：主体宽高比 > 1.45 视作扁平（甲鱼/枯叶龟）
    a = np.asarray(img.convert('RGB'))
    if a.shape[0] / max(1, a.shape[1]) > 1.45:
        tags.append('flat')
    return tags


def _guess_habitat(tags) -> str:
    """从视觉标签推测栖息类型，仅作为生成配置的初始建议（人工可改）。"""
    if 'flat' in tags and 'dark' in tags:
        return 'marsh'
    if 'olive' in tags or 'brown' in tags:
        return 'terrestrial'
    if 'dark' in tags:
        return 'aquatic'
    return 'semi'


def extract_fish(path: Path, sid: str, label: str, k: int = 6) -> dict:
    img = ImageOps.exif_transpose(Image.open(path)).convert('RGB')
    mask, crop = _fg_mask(img)
    boxes = _boxes(mask)
    allc = dominant_colors(img, mask, k=k)
    body_c = dominant_colors(img, mask, k=k, box=boxes.get('center'))
    belly_c = dominant_colors(img, mask, k=k, box=boxes.get('belly'))
    fin_c = dominant_colors(img, mask, k=k, box=boxes.get('limb'))

    body_rgb = body_c[0][2]
    # 腹色：主体下侧最亮簇，且必须比体色亮，否则手动提亮
    belly_rgb = max(belly_c, key=lambda t: t[0][0])[2]
    if belly_rgb[0] + belly_rgb[1] + belly_rgb[2] <= sum(body_rgb) * 1.03:
        belly_rgb = tuple(min(1.0, c * 1.18 + 0.10) for c in body_rgb)

    # 鳍色：外围簇里最接近体色色相、但更亮/更淡的一个
    fin_rgb = _pick_fin(fin_c, body_rgb)

    stripes = _count_stripes(img, mask)
    h, s, v = colorsys.rgb_to_hsv(*body_rgb)
    tags = []
    if s > 0.55 and v > 0.55:
        tags.append('bright')
    if v < 0.26:
        tags.append('dark')
    if s < 0.18:
        tags.append('pale')
    if h > 0.92 or h < 0.05:
        tags.append('red')
    elif 0.05 <= h < 0.16:
        tags.append('orange')

    return {
        'id': sid,
        'label': label,
        'kind': 'fish',
        'source': path.name,
        'crop': crop,
        'body': flatten_color(body_rgb),
        'belly': flatten_color(belly_rgb),
        'fin': flatten_color(fin_rgb),
        'stripes': stripes,
        'tags': tags,
        '_palette': {
            'body': [c[2] for c in body_c],
            'belly': [c[2] for c in belly_c],
            'fin': [c[2] for c in fin_c],
            'all': [c[2] for c in allc],
        },
    }


def _pick_fin(cols, body_rgb):
    bh, bs, bv = colorsys.rgb_to_hsv(*body_rgb)
    best, best_score = None, -1e9
    for lab, wt, rgb in cols:
        h, s, v = colorsys.rgb_to_hsv(*rgb)
        dh = min(abs(h - bh), 1 - abs(h - bh))
        # 奖励：色相近、更亮、有一定占比
        score = -dh * 2.0 + v * 1.4 + wt * 3.0
        if score > best_score:
            best, best_score = rgb, score
    if best is None:
        return tuple(min(1.0, c * 1.18 + 0.08) for c in body_rgb)
    return best


def _count_stripes(img, mask, max_stripes: int = 5) -> int:
    """数体表竖条纹。

    做法：主体沿 X 方向分成若干竖列，算每列的平均明度，
    对明度曲线做一次平滑后数"波峰"个数。
    锦鲤/白鲦这类有条纹的鱼会得到 1~4，纯色鱼得到 0。
    """
    a = np.asarray(img.convert('RGB')).astype(float)
    lum = a @ np.array([0.299, 0.587, 0.114])
    m = mask if mask.shape == lum.shape else np.ones_like(lum, bool)
    ys, xs = np.where(m)
    if len(xs) < 100:
        return 0
    x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    if x1 - x0 < 24 or y1 - y0 < 12:
        return 0
    ncol = 18
    prof = []
    for i in range(ncol):
        xa = x0 + (x1 - x0) * i // ncol
        xb = x0 + (x1 - x0) * (i + 1) // ncol
        sel = m[:, xa:max(xa + 1, xb)]
        if sel.sum() < 6:
            prof.append(None)
        else:
            prof.append(float(lum[:, xa:max(xa + 1, xb)][sel].mean()))
    prof = [p for p in prof if p is not None]
    if len(prof) < 10:
        return 0
    p = np.array(prof)
    p = np.convolve(p, np.ones(3) / 3, mode='same')          # 平滑
    lo, hi = p.min(), p.max()
    if hi - lo < 9.0:
        return 0                                             # 起伏太小 → 无条纹
    thr = (lo + hi) / 2
    above = p > thr
    edges = int(np.sum(above[1:] & ~above[:-1]))
    return max(0, min(max_stripes, edges))


# ──────────────────────────────────────────────────────────────
#  CLI
# ──────────────────────────────────────────────────────────────
IMG_EXT = {'.jpg', '.jpeg', '.png', '.webp', '.bmp', '.tif', '.tiff'}


def _iter_inputs(src: Path):
    if src.is_dir():
        for p in sorted(src.iterdir()):
            if p.suffix.lower() in IMG_EXT and not p.name.startswith(('swatch', 'palette')):
                yield p
    else:
        yield src


# 素材照片的视角后缀（assets/creatures/ 约定：<id>_<view>.png）——
# 提取 id 时要剥掉，否则 caramelSlider_top 会变成 caramelSliderTop
VIEW_SUFFIXES = {'top', 'side', 'front', 'back', 'left', 'right'}


def _slug(name: str) -> str:
    """文件名 → 物种 id。

    遵循 assets/creatures/ 的照片命名约定：`<id>_<view>.png`，
    末段若是视角名（top/side/front…）则剥掉，如 `caramelSlider_top` → `caramelSlider`。
    其余下划线转驼峰：`red_ear_slider` → `redEarSlider`。
    """
    s = ''.join(ch if ch.isalnum() else '_' for ch in name)
    parts = [x for x in s.split('_') if x]
    if len(parts) > 1 and parts[-1].lower() in VIEW_SUFFIXES:
        parts = parts[:-1]
    if not parts:
        return 'species'
    first = parts[0]
    # 已含大写的首段视为有意命名的 id（如 caramelSlider），保留原样；
    # 全小写的才做规范小写。后续段统一转驼峰。
    head = first if any(c.isupper() for c in first) else first.lower()
    return head + ''.join(w.capitalize() for w in parts[1:]) or 'species'


def main(argv=None):
    ap = argparse.ArgumentParser(
        description='照片 → 扁平简图调色板提取',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument('input', help='照片文件或目录')
    ap.add_argument('--kind', choices=['turtle', 'fish', 'auto'], default='auto',
                    help='物种类型（auto=按文件名猜，默认自动）')
    ap.add_argument('--id', help='指定物种 id（仅单文件时有效）')
    ap.add_argument('--label', help='中文显示名（仅单文件时有效）')
    ap.add_argument('--colors', type=int, default=6, help='聚类色数 K（默认 6）')
    ap.add_argument('--out', help='输出 JSON 路径（默认打印到终端）')
    ap.add_argument('--swatch', help='额外输出色卡 PNG，便于肉眼检查')
    args = ap.parse_args(argv)

    src = Path(args.input)
    if not src.exists():
        print(f'找不到输入：{src}', file=sys.stderr)
        return 1

    results = []
    for p in _iter_inputs(src):
        kind = args.kind
        if kind == 'auto':
            low = p.stem.lower()
            kind = 'turtle' if any(w in low for w in
                                   ('turtle', 'tortoise', '乌龟', '龟', '甲鱼')) else 'fish'
        sid = args.id if (args.id and src.is_file()) else _slug(args.id or p.stem)
        label = args.label if (args.label and src.is_file()) else (args.label or p.stem)
        try:
            if kind == 'turtle':
                results.append(extract_turtle(p, sid, label, k=args.colors))
            else:
                results.append(extract_fish(p, sid, label, k=args.colors))
            print(f'  ✔ {p.name} → {sid} ({kind})')
        except Exception as e:                                    # noqa: BLE001
            print(f'  ✘ {p.name} 提取失败：{e}', file=sys.stderr)

    if not results:
        print('没有提取到任何结果。', file=sys.stderr)
        return 1

    payload = {'version': 1, 'generatedFrom': str(src), 'species': results}
    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'\n已写出：{out}')
    else:
        print('\n' + json.dumps(payload, ensure_ascii=False, indent=2))

    if args.swatch:
        _write_swatch(results, Path(args.swatch))
        print(f'已写出色卡：{args.swatch}')
    return 0


def _write_swatch(results, out: Path, cell: int = 64):
    """生成色卡图：一眼看出"简图化"之后颜色长什么样。"""
    keys = {'turtle': ['shell', 'shellLight', 'head', 'limb', 'markColor'],
            'fish': ['body', 'belly', 'fin']}
    rows = len(results)
    maxc = max(len(keys[r['kind']]) for r in results)
    W = 220 + maxc * cell
    H = 34 + rows * cell
    canvas = Image.new('RGB', (W, H), (248, 246, 240))

    from PIL import ImageDraw
    d = ImageDraw.Draw(canvas)
    y = 6
    for r in results:
        d.text((10, y + cell // 2 - 6), f"{r['label']}", fill=(40, 40, 40))
        x = 220
        for key in keys[r['kind']]:
            hexv = r.get(key)
            if not hexv:
                x += cell; continue
            rgb = tuple(int(hexv.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))
            d.rectangle([x, y, x + cell - 6, y + cell - 6], fill=rgb,
                        outline=(200, 200, 200))
            bri = sum(rgb) / 3
            d.text((x + 3, y + cell - 20), hexv, fill=(20, 20, 20) if bri > 130 else (240, 240, 240))
            x += cell
        y += cell
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)


if __name__ == '__main__':
    sys.exit(main())
