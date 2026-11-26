#!/usr/bin/env python3
"""
把生圖 AI 產生的 PNG 縮成遊戲實際需要的大小，轉成 WebP 放進 public/assets/。

用法：
  python scripts/optimize_images.py                 # 轉換 public/assets/ 底下所有 .png，轉完刪掉 .png
  python scripts/optimize_images.py 圖.png chars/saviel   # 把一張圖轉成 public/assets/chars/saviel.webp

需要 Pillow：pip install pillow
"""
import sys
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent / 'public' / 'assets'

# 每種圖的最大尺寸（寬, 高）：畫面上實際最大顯示尺寸的約兩倍（高解析度螢幕也清楚）
MAX_SIZE = {
    'cards': (768, 512),    # 卡圖，橫式
    'chars': (640, 960),    # 角色立繪，直式
    'frames': (512, 768),   # 卡面底框
    'backs': (512, 768),    # 卡背
    'ui': (512, 768),       # 通用卡背等
    'bg': (1920, 1280),     # 背景
}
QUALITY = 82


def convert(src: Path, dest_rel: str) -> Path:
    cat = dest_rel.split('/')[0]
    if cat not in MAX_SIZE:
        raise SystemExit(f'不認得的分類「{cat}」，可以用：{", ".join(MAX_SIZE)}')
    dest = ROOT / f'{dest_rel}.webp'
    dest.parent.mkdir(parents=True, exist_ok=True)
    im = Image.open(src).convert('RGB')
    im.thumbnail(MAX_SIZE[cat], Image.LANCZOS)  # 只縮小、不放大，維持比例
    im.save(dest, 'WEBP', quality=QUALITY, method=6)
    print(f'{src} → {dest.relative_to(ROOT.parent.parent)}  {im.size[0]}×{im.size[1]}  {dest.stat().st_size // 1024} KB')
    return dest


def main():
    args = sys.argv[1:]
    if len(args) == 2:
        convert(Path(args[0]), args[1])
        return
    if args:
        raise SystemExit(__doc__)
    pngs = sorted(ROOT.glob('*/*.png'))
    if not pngs:
        print('public/assets/ 底下沒有要轉換的 .png')
    for p in pngs:
        convert(p, f'{p.parent.name}/{p.stem}')
        p.unlink()


if __name__ == '__main__':
    main()
