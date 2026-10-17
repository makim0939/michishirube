#!/usr/bin/env python3
"""
ChatGPT で作ってもらった画像（1024px 前後の PNG）を、アプリで使う大きさにして、public/world/ に入れる。

  python3 -I integrate_images.py patterns <フォルダ> [--crop 0.62] [--center 0.495,0.465] [--size 640] [--root <リポジトリ>] [--preview <画像.png>] [--dry-run]
  python3 -I integrate_images.py light    <フォルダ> [--root <リポジトリ>] [--preview <画像.png>] [--dry-run]

patterns：型の見本。フォルダの中に、次の名前の画像がある分だけ処理する（無いものは飛ばす）。
    rosetta heart tulip2 layerheart wing swan   （拡張子は .png .webp .jpg）
  カップ＋ソーサーの周りを、**すべての画像で同じ範囲**（--crop：一辺の割合、--center：中心の位置の割合）で
  正方形に切り出し、--size px の WebP にして public/world/patterns/<名前>.webp に入れる。
  既定の --crop 0.62 --center 0.495,0.465 は、合意した基準画像（ロゼッタ。1254px）で測った、ソーサーの位置と大きさ。
  別の画角の画像のときは、プレビューを見て調整する。
light：記録がないときのホーム背景。morning noon evening night。中央を 780:860 の縦長に切り出して、
  public/world/light/<名前>.webp（780×860）にする。

--preview：切り出した結果を一覧にした画像を作る。型の見本は、実際の表示（56px の丸、104px の角丸）でも並べる。
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

PATTERNS = ['rosetta', 'heart', 'tulip2', 'layerheart', 'wing', 'swan']
LIGHTS = ['morning', 'noon', 'evening', 'night']
EXTS = ['.png', '.webp', '.jpg', '.jpeg']


def find(folder: Path, name: str):
    for ext in EXTS:
        p = folder / f'{name}{ext}'
        if p.exists():
            return p
    return None


def crop_square(im: Image.Image, crop: float, cx: float, cy: float) -> Image.Image:
    side = round(im.width * crop)
    left = round(im.width * cx - side / 2)
    top = round(im.height * cy - side / 2)
    left = max(0, min(left, im.width - side))
    top = max(0, min(top, im.height - side))
    return im.crop((left, top, left + side, top + side))


def circle(im: Image.Image, size: int) -> Image.Image:
    s = 4
    big = im.resize((size * s, size * s), Image.LANCZOS)
    mask = Image.new('L', big.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big.width - 1, big.height - 1), fill=255)
    out = big.convert('RGBA')
    out.putalpha(mask)
    return out.resize((size, size), Image.LANCZOS)


def patterns(a):
    out_dir = a.root / 'public/world/patterns'
    cx, cy = (float(v) for v in a.center.split(','))
    done = []
    for name in PATTERNS:
        src = find(a.folder, name)
        if not src:
            print(f'飛ばす（画像なし）: {name}')
            continue
        im = Image.open(src).convert('RGB')
        if im.width != im.height:
            sys.exit(f'{src.name} が正方形ではありません: {im.size}')
        tile = crop_square(im, a.crop, cx, cy).resize((a.size, a.size), Image.LANCZOS)
        done.append((name, tile))
        print(('（作らない） ' if a.dry_run else '作成 ') + f'public/world/patterns/{name}.webp  {a.size}×{a.size}')
        if not a.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            tile.save(out_dir / f'{name}.webp', 'WEBP', quality=86, method=6)
    if a.preview and done:
        sheet = Image.new('RGB', (len(done) * 280 + 20, 400), (250, 247, 242))
        for i, (name, tile) in enumerate(done):
            x = 10 + i * 280
            sheet.paste(tile.resize((260, 260), Image.LANCZOS), (x, 10))
            c = circle(tile, 56)  # ホームの型のカード（丸）
            sheet.paste(c, (x, 290), c)
            sq = tile.resize((104, 104), Image.LANCZOS)  # 型の一覧（角丸の正方形）
            sheet.paste(sq, (x + 80, 290))
        sheet.save(a.preview)
        print(f'プレビュー: {a.preview}（上：切り出し結果／下：56px の丸・104px の正方形）')


def light(a):
    out_dir = a.root / 'public/world/light'
    done = []
    for name in LIGHTS:
        src = find(a.folder, name)
        if not src:
            print(f'飛ばす（画像なし）: {name}')
            continue
        im = Image.open(src).convert('RGB')
        w, h = 780, 860
        # 元の高さいっぱいで、780:860 の幅を、中央から取る
        crop_w = round(im.height * w / h)
        if crop_w > im.width:  # 横が足りないときは、幅いっぱいで、高さを取る
            crop_h = round(im.width * h / w)
            box = (0, (im.height - crop_h) // 2, im.width, (im.height - crop_h) // 2 + crop_h)
        else:
            box = ((im.width - crop_w) // 2, 0, (im.width - crop_w) // 2 + crop_w, im.height)
        tile = im.crop(box).resize((w, h), Image.LANCZOS)
        done.append((name, tile))
        print(('（作らない） ' if a.dry_run else '作成 ') + f'public/world/light/{name}.webp  {w}×{h}')
        if not a.dry_run:
            out_dir.mkdir(parents=True, exist_ok=True)
            tile.save(out_dir / f'{name}.webp', 'WEBP', quality=86, method=6)
    if a.preview and done:
        sheet = Image.new('RGB', (len(done) * 400 + 20, 460), (250, 247, 242))
        for i, (name, tile) in enumerate(done):
            sheet.paste(tile.resize((390, 430), Image.LANCZOS), (10 + i * 400, 10))
        sheet.save(a.preview)
        print(f'プレビュー: {a.preview}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('kind', choices=['patterns', 'light'])
    ap.add_argument('folder', type=Path)
    ap.add_argument('--root', type=Path, default=Path.cwd())
    ap.add_argument('--crop', type=float, default=0.62)
    ap.add_argument('--center', default='0.495,0.465')
    ap.add_argument('--size', type=int, default=640)
    ap.add_argument('--preview', type=Path)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()
    (patterns if a.kind == 'patterns' else light)(a)


if __name__ == '__main__':
    main()
