#!/usr/bin/env python3
"""
アイコンの元画像（1024×1024 の正方形。透明なし・角は丸くしない）から、アプリが使うすべての大きさを作る。

  python3 -I .claude/skills/app-icon/make_icons.py <元画像.png> [--root <リポジトリ>] [--android-scale 0.9]
                                                   [--site] [--preview <プレビュー.png>] [--dry-run]

作るもの（--root からの相対パス）
  iOS      ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png   1024×1024・透明なし
  Android  android/app/src/main/res/mipmap-{m,h,xh,xxh,xxxh}dpi/
             ic_launcher_foreground.png  適応型アイコンの前景（108dp。透明なし）。元画像を縮めて中央に置き、
                                         足りない外側は、元画像の鏡写しで埋める（木目などが、つながる）
             ic_launcher.png             旧い端末向け（角丸の四角）
             ic_launcher_round.png       旧い端末向け（円）
  PWA      public/pwa-64x64.png・pwa-192x192.png・pwa-512x512.png・apple-touch-icon-180x180.png・favicon.ico
  サイト   worker/site/icon.png・favicon.ico   ← --site を付けたときだけ

--site は、Google の審査（ブランディングのロゴ）が終わるまで、付けない（CLAUDE.md の5章）。
"""
import argparse
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def load_master(path: Path) -> Image.Image:
    im = Image.open(path)
    if im.width != im.height:
        sys.exit(f'元画像が正方形ではありません: {im.size}')
    if im.width < 1024:
        print(f'注意: 元画像が {im.width}px です（1024px 以上が望ましい）', file=sys.stderr)
    if im.mode in ('RGBA', 'LA', 'P'):
        rgba = im.convert('RGBA')
        if rgba.getchannel('A').getextrema()[0] < 255:
            print('注意: 元画像に透明があります。白に重ねて、透明なしにします', file=sys.stderr)
        flat = Image.new('RGB', rgba.size, (255, 255, 255))
        flat.paste(rgba, mask=rgba.getchannel('A'))
        return flat
    return im.convert('RGB')


def resize(im: Image.Image, size: int) -> Image.Image:
    return im.resize((size, size), Image.LANCZOS)


def adaptive_foreground(master: Image.Image, canvas: int, scale: float) -> Image.Image:
    """108dp の正方形に、元画像を scale 倍で中央に置く。外側は、鏡写しで埋める（透明なし）"""
    inner = round(canvas * scale)
    inner += (canvas - inner) % 2  # 左右・上下の余白を、同じにする
    art = np.asarray(resize(master, inner))
    pad = (canvas - inner) // 2
    padded = np.pad(art, ((pad, pad), (pad, pad), (0, 0)), mode='reflect')
    return Image.fromarray(padded)


def rounded_square(im: Image.Image, radius_ratio: float = 0.16) -> Image.Image:
    size = im.width
    scale = 4  # 縁をなめらかにするため、大きく描いて縮める
    mask = Image.new('L', (size * scale, size * scale), 0)
    r = round(size * scale * radius_ratio)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size * scale - 1, size * scale - 1), radius=r, fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


def circle(im: Image.Image) -> Image.Image:
    size = im.width
    scale = 4
    mask = Image.new('L', (size * scale, size * scale), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * scale - 1, size * scale - 1), fill=255)
    mask = mask.resize((size, size), Image.LANCZOS)
    out = im.convert('RGBA')
    out.putalpha(mask)
    return out


class Writer:
    def __init__(self, root: Path, dry: bool):
        self.root, self.dry, self.written = root, dry, []

    def save(self, rel: str, im: Image.Image, **kw):
        path = self.root / rel
        self.written.append((rel, im.size, im.mode))
        if self.dry:
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        im.save(path, **kw)


def preview(master: Image.Image, android_fg: Image.Image, out: Path):
    """目視で確かめる一枚：小さい大きさ（60px）・円・角丸・Android の切り抜きの内側（中央 72/108）"""
    tile = 256
    sheet = Image.new('RGB', (tile * 4 + 60, tile + 20), (240, 240, 240))
    x = 10
    sheet.paste(resize(master, tile), (x, 10))  # 元画像
    x += tile + 10
    sheet.paste(rounded_square(resize(master, tile), 0.2).convert('RGB'), (x, 10), rounded_square(resize(master, tile), 0.2).getchannel('A'))  # iOS 風
    x += tile + 10
    fg = resize(android_fg, tile)
    c = circle(fg.crop((round(tile * 18 / 108), round(tile * 18 / 108), round(tile * 90 / 108), round(tile * 90 / 108))).resize((tile, tile), Image.LANCZOS))
    sheet.paste(c.convert('RGB'), (x, 10), c.getchannel('A'))  # Android の円（中央 72/108）
    x += tile + 10
    for i, s in enumerate((120, 60, 29)):  # 小さい大きさ
        small = resize(master, s)
        sheet.paste(small, (x + i * 70, 10))
    sheet.save(out)
    print(f'プレビュー: {out}')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('master', type=Path)
    ap.add_argument('--root', type=Path, default=Path.cwd())
    ap.add_argument('--android-scale', type=float, default=0.9, help='適応型アイコンの前景で、元画像を何倍に縮めて置くか（0.9 = 周りの5%%ずつを鏡写し）')
    ap.add_argument('--site', action='store_true', help='紹介サイトのアイコンも作る（Google の審査が終わってから）')
    ap.add_argument('--preview', type=Path)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    master = load_master(a.master)
    w = Writer(a.root, a.dry_run)

    # iOS（1024・透明なし）
    w.save('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', resize(master, 1024) if master.width != 1024 else master, optimize=True)

    # Android
    fg108 = None
    for d, k in DENSITIES.items():
        legacy = round(48 * k)
        canvas = round(108 * k)
        res = f'android/app/src/main/res/mipmap-{d}'
        fg = adaptive_foreground(master, canvas, a.android_scale)
        if d == 'xxxhdpi':
            fg108 = fg
        w.save(f'{res}/ic_launcher_foreground.png', fg, optimize=True)
        w.save(f'{res}/ic_launcher.png', rounded_square(resize(master, legacy)), optimize=True)
        w.save(f'{res}/ic_launcher_round.png', circle(resize(master, legacy)), optimize=True)

    # PWA・Apple のホーム画面・ファビコン
    for size in (64, 192, 512):
        w.save(f'public/pwa-{size}x{size}.png', resize(master, size), optimize=True)
    w.save('public/apple-touch-icon-180x180.png', resize(master, 180), optimize=True)
    ico = resize(master, 256)
    w.save('public/favicon.ico', ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])

    if a.site:
        w.save('worker/site/icon.png', resize(master, 192), optimize=True)
        w.save('worker/site/favicon.ico', ico, format='ICO', sizes=[(16, 16), (32, 32), (48, 48)])
    else:
        print('紹介サイトのアイコン（worker/site/）は作りません（--site を付けたときだけ）。')

    for rel, size, mode in w.written:
        print(('（作らない） ' if a.dry_run else '作成 ') + f'{rel}  {size[0]}×{size[1]}  {mode}')
    if a.preview and fg108 is not None:
        preview(master, fg108, a.preview)


if __name__ == '__main__':
    main()
