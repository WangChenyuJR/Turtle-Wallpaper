# -*- coding: utf-8 -*-
"""
批量处理生成的品种图片：
1. 裁掉底部水印区（底部 9%——"AI生成"平台水印位置）
2. 自动裁剪到主体包围盒（去多余留白，保留 3% 边距）
3. 统一 resize 到 768x768 画布（等比缩放居中，透明填充→白纸色）
4. 输出优化后的 PNG（同目录覆盖，原图不动）
结果写 UTF-8 文件避免控制台编码问题。
"""
import os, sys, io
from PIL import Image

SRC = r"D:/User/Spike/Personal Program/Turtle Wallpaper/turtle-pond/assets/creatures/turtle"
OUT_LOG = os.path.join(SRC, "_process_log.txt")
TARGET = 768
BOTTOM_CUT = 0.09          # 裁掉底部 9%（水印）
PAPER = (247, 244, 238)    # 纸色填充

def autocrop(im, margin_ratio=0.03):
    """按非纸色像素裁剪主体包围盒"""
    w, h = im.size
    im_small = im.convert("RGB").resize((192, 192))
    px = im_small.load()
    minx, miny, maxx, maxy = w, h, 0, 0
    for y in range(192):
        for x in range(192):
            r, g, b = px[x, y]
            # 纸色背景偏亮；与纸色差值大的算主体
            if abs(r-PAPER[0]) + abs(g-PAPER[1]) + abs(b-PAPER[2]) > 60:
                minx = min(minx, x); miny = min(miny, y)
                maxx = max(maxx, x); maxy = max(maxy, y)
    if maxx <= minx or maxy <= miny:
        return im
    # 映射回原尺寸 + 边距
    sx = max(0, int(minx / 192 * w) - int(w * margin_ratio))
    sy = max(0, int(miny / 192 * h) - int(h * margin_ratio))
    ex = min(w, int((maxx + 1) / 192 * w) + int(w * margin_ratio))
    ey = min(h, int((maxy + 1) / 192 * h) + int(h * margin_ratio))
    return im.crop((sx, sy, ex, ey))

def main():
    log = []
    for name in sorted(os.listdir(SRC)):
        if not name.endswith(".png") or name.startswith("_"):
            continue
        path = os.path.join(SRC, name)
        im = Image.open(path).convert("RGB")
        w, h = im.size
        # 1) 裁水印
        im = im.crop((0, 0, w, int(h * (1 - BOTTOM_CUT))))
        # 2) 自动裁主体
        im = autocrop(im)
        # 3) 等比缩放居中到 TARGET 画布
        im.thumbnail((TARGET, TARGET), Image.LANCZOS)
        canvas = Image.new("RGB", (TARGET, TARGET), PAPER)
        ox = (TARGET - im.width) // 2
        oy = (TARGET - im.height) // 2
        canvas.paste(im, (ox, oy))
        canvas.save(path, "PNG", optimize=True)
        kb = os.path.getsize(path) // 1024
        log.append(f"{name}: {kb} KB ({TARGET}x{TARGET})")
    with io.open(OUT_LOG, "w", encoding="utf-8") as f:
        f.write("\n".join(log))
    print("done", len(log))

if __name__ == "__main__":
    main()
