# 撮った画面（実機のスクリーンショット）を、App Store のプロダクトページ用の画像にする。
# 使い方：python3 -I .claude/skills/app-screenshots/appstore-shot.py <撮った画像のフォルダ> <出力フォルダ>
#   <出力>/clean/ … 状態バーを 9:41・電波・電池満タンに差し替えて、1179×2556 にしたもの（文字なし）
#   <出力>/store/ … clean に、説明の文字・背景・枠を足したもの（App Store に出すのは、こちら）
# 文言・順番・どの画像を使うかは、同じ場所の appstore-captions.json で決める（file は、撮った画像の拡張子なしの名前）。
# macOS のヒラギノ・SF を使う。透明なしの PNG を書き出す。
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

src, out = Path(sys.argv[1]), Path(sys.argv[2])
here = Path(__file__).parent
captions = json.loads((here / 'appstore-captions.json').read_text())

W, H = 1179, 2556  # iPhone 6.3 インチ（Dynamic Island の機種）の大きさ
ACCENT = (168, 98, 47)
INK, SUB = (37, 37, 40), (117, 117, 120)
BG_TOP, BG_BOTTOM = (252, 249, 244), (240, 228, 212)

HEAD = '/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc'
BODY = '/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc'


def find(stem):
    for p in sorted(src.iterdir()):
        if p.stem == stem and p.suffix.lower() in ('.png', '.jpg', '.jpeg'):
            return p
    raise SystemExit(f'撮った画像が見つからない：{stem}（{src}）')


def sf(size, weight):
    f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    try:
        f.set_variation_by_axes([weight])
    except Exception:
        pass
    return f


def fix_status_bar(im):
    """状態バー（時刻・電波・電池）を、9:41・電波4・電池満タンに差し替える。

    もとの文字は、まわりの色で塗りつぶす。背景が一色なら行ごとの色、写真なら、すぐ下の帯を鏡のように写して隠す。
    大きさは、幅 1170 の画面（iPhone 12 など）を基準にして、幅に合わせて拡大する。
    """
    im = im.convert('RGB')
    k = im.width / 1170
    a = np.asarray(im).copy()
    bar = round(135 * k)  # 状態バーの高さ（アプリが重ねる「同時に再生」の帯も、この中）
    edge = a[:bar, 3].astype(float)
    if edge.std(axis=0).max() < 6:  # 背景が一色
        a[:bar] = a[:bar, 3:4]
    else:  # 写真：文字のある左右だけ、下の帯を鏡写しにして埋める
        for x0, x1 in ((70, 260), (880, 1135)):
            x0, x1 = round(x0 * k), round(x1 * k)
            y0, y1 = round(35 * k), round(115 * k)
            a[y0:y1, x0:x1] = a[y1 + 5:y1 + 5 + (y1 - y0), x0:x1][::-1]
        patch = Image.fromarray(a).crop((0, 0, im.width, bar)).filter(ImageFilter.GaussianBlur(2 * k))
        a[:bar] = np.asarray(patch)
    im = Image.fromarray(a)

    lum = np.asarray(im.crop((60, round(40 * k), 260, round(110 * k)))).mean()
    fg = (255, 255, 255) if lum < 120 else (20, 20, 22)

    s = 4  # 4倍で描いて縮める（ふちをなめらかに）
    layer = Image.new('RGBA', (im.width * s, bar * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = k * s
    d.text((156 * u, 75 * u), '9:41', font=sf(round(50 * u), 600), fill=fg, anchor='mm')
    for i in range(4):  # 電波
        h = (14 + i * 7) * u
        x = (907 + i * 14) * u
        d.rounded_rectangle((x, 92 * u - h, x + 9 * u, 92 * u), radius=2.5 * u, fill=fg)
    cx, cy = 999 * u, 90 * u  # Wi-Fi：外から、扇を塗る・内側を抜く、をくり返す
    for r, fill in ((36, fg), (28, (0, 0, 0, 0)), (24, fg), (16, (0, 0, 0, 0)), (12, fg)):
        d.pieslice((cx - r * u, cy - r * u, cx + r * u, cy + r * u), 225, 315, fill=fill)
    d.rounded_rectangle((1040 * u, 55 * u, 1105 * u, 92 * u), radius=11 * u, outline=fg + (110,), width=int(2.5 * u))
    d.rounded_rectangle((1044 * u, 59 * u, 1101 * u, 88 * u), radius=8 * u, fill=fg)
    d.rounded_rectangle((1109 * u, 68 * u, 1114 * u, 80 * u), radius=2 * u, fill=fg + (110,))
    layer = layer.resize((im.width, bar), Image.LANCZOS)
    im.paste(layer, (0, 0), layer)
    return im


def fit(im, target=(W, H)):
    """画面全体が収まる倍率で拡大し、足りない分を端の色で伸ばす（スキル app-screenshots の C）。"""
    tw, th = target
    s = min(tw / im.width, th / im.height)
    im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    px, py = tw - im.width, th - im.height
    a = np.pad(np.asarray(im), ((py // 2, py - py // 2), (px // 2, px - px // 2), (0, 0)), mode='edge')
    return Image.fromarray(a)


def background():
    g = np.linspace(0, 1, H)[:, None, None]
    a = (np.array(BG_TOP) * (1 - g) + np.array(BG_BOTTOM) * g) * np.ones((1, W, 1))
    im = Image.fromarray(a.astype('uint8'))
    # 窓辺の光のような、ぼやけた丸（飾りは、これだけ）
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((W - 560, -300, W + 260, 520), fill=(255, 230, 190, 90))
    gd.ellipse((-340, 1500, 420, 2260), fill=(214, 160, 110, 40))
    glow = glow.filter(ImageFilter.GaussianBlur(120))
    im.paste(glow, (0, 0), glow)
    return im


def draw_caption(im, title, sub):
    """見出し（{} でかこんだ字は茶色）を、中央ぞろえで 2 行まで。"""
    d = ImageDraw.Draw(im)
    big = ImageFont.truetype(HEAD, 92)
    small = ImageFont.truetype(BODY, 40)
    y = 150
    for ln in title.split('\n'):
        parts, acc = [], False
        for chunk in ln.replace('}', '{').split('{'):
            parts.append((chunk, ACCENT if acc else INK))
            acc = not acc
        total = sum(d.textlength(t, font=big) for t, _ in parts)
        assert total <= W - 120, f'見出しが長すぎる（{total:.0f}px）：{ln}'
        x = (W - total) / 2
        for t, c in parts:
            d.text((x, y), t, font=big, fill=c, anchor='ls')
            x += d.textlength(t, font=big)
        y += 124
    if sub:
        d.text((W / 2, y + 22), sub, font=small, fill=SUB, anchor='ms')


def compose(clean, title, sub):
    im = background()
    draw_caption(im, title, sub)
    sw = 920
    sh = round(clean.height * sw / clean.width)
    x0, y0, bez, rad = (W - sw) // 2, 560, 16, 120
    shot = clean.resize((sw, sh), Image.LANCZOS)
    # 影 → 黒い枠 → 画面（下は、はみ出させる。画面の続きがあることを見せる）
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0 - bez, y0 - bez + 24, x0 + sw + bez, y0 + sh + bez + 24), radius=rad + bez, fill=(60, 40, 20, 110))
    shadow = shadow.filter(ImageFilter.GaussianBlur(36))
    im.paste(shadow, (0, 0), shadow)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((x0 - bez, y0 - bez, x0 + sw + bez, y0 + sh + bez), radius=rad + bez, fill=(28, 28, 30))
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=rad, fill=255)
    im.paste(shot, (x0, y0), mask)
    return im


(out / 'clean').mkdir(parents=True, exist_ok=True)
(out / 'store').mkdir(parents=True, exist_ok=True)
for i, c in enumerate(captions, 1):
    raw = Image.open(find(c['file']))
    clean = fit(fix_status_bar(raw))
    clean.save(out / 'clean' / f'{i}-{c["name"]}.png')
    store = compose(clean, c['title'], c.get('sub', ''))
    assert store.size == (W, H) and store.mode == 'RGB'
    store.save(out / 'store' / f'{i}-{c["name"]}.png', optimize=True)
    print(i, c['name'])
