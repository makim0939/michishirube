# 撮った画面（実機のスクリーンショット）を、App Store のプロダクトページ用の画像にする。
# 使い方：python3 -I .claude/skills/app-screenshots/appstore-shot.py <撮った画像のフォルダ> <出力フォルダ> [--device ipad]
#   --device … iphone（標準。1179×2556）か ipad（13 インチ用。2048×2732）
#   <出力>/clean/ … 状態バーを 9:41・電池満タンなどに差し替えて、App Store の大きさにしたもの（文字なし）
#   <出力>/store/ … clean に、説明の文字・背景・枠を足したもの（App Store に出すのは、こちら）
# 文言・順番・どの画像を使うかは、同じ場所の appstore-captions.json で決める（file は、撮った画像の拡張子なしの名前）。
# 最初の1枚の subtitle は、App Store のサブタイトル（docs/app-store-submission.md の 4-1）と同じにする。
# 撮った画像ごとの手直し（明るさ・彩度、写り込みを消す）は、撮った画像のフォルダの retouch.json に書く（SKILL.md の D）。
# macOS のヒラギノ・SF を使う。透明なしの PNG を書き出す。
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ap = argparse.ArgumentParser(description='撮った画面を、App Store の画面写真にする')
ap.add_argument('src', type=Path, help='撮った画像のフォルダ')
ap.add_argument('out', type=Path, help='出力フォルダ')
ap.add_argument('--device', choices=('iphone', 'ipad'), default='iphone')
args = ap.parse_args()
src, out, device = args.src, args.out, args.device
here = Path(__file__).parent
captions = json.loads((here / 'appstore-captions.json').read_text())
retouch_file = src / 'retouch.json'
retouches = json.loads(retouch_file.read_text()).get(device, {}) if retouch_file.exists() else {}

# 機種ごとの寸法。iPhone は、もとの値のまま（この表に移しただけ）。
# iPad は、iPad Air 第4世代（1640×2360）で撮った画面を、13 インチ用の大きさにする前提。
DEVICES = {
    'iphone': dict(
        size=(1179, 2556),     # iPhone 6.3 インチ（Dynamic Island の機種）の大きさ
        aspect=1170 / 2532,    # 撮った画面の、幅÷高さ（機種の取り違えを見つけるため）
        base_w=1170,           # 状態バーの位置の基準にする、撮った画面の幅（iPhone 12 など）
        caption=(92, 150, 124),  # 見出しの字の大きさ・1 行目の位置・行の間隔
        shot=(1000, 440, 118),   # 画面の幅・上の位置・角の丸み
        hero=(1100, 360, 90, 120, 52, 70, 75),  # 写真の幅・上の位置・角の丸み、名前とサブタイトルの字の大きさ・中心からの位置
        glow=1.0,              # 背景の光の丸の大きさの倍率
    ),
    'ipad': dict(
        size=(2048, 2732),     # iPad 13 インチ用
        aspect=1640 / 2360,
        base_w=1640,           # iPad Air 第4世代（11 インチの機種も同じ幅）
        caption=(118, 190, 160),
        shot=(1700, 470, 64),  # iPad の画面は横に広いので、角の丸みは小さめ
        hero=(1300, 430, 110, 150, 64, 90, 95),
        glow=1.6,
    ),
}
D = DEVICES[device]
W, H = D['size']
# 背景は、明るい生成り色（濃い色は、アプリの雰囲気と合わない）。画面より少し深い色にして、ふちを出す
ACCENT = (168, 98, 47)
INK, LINE = (37, 37, 40), (200, 180, 155)
BG_TOP, BG_BOTTOM = (247, 240, 229), (231, 214, 192)
# 影の色。ぼかす前の地（透明）にも、この色を使う（地の色が違うと、ぼかしで縁がその色に濁る）
SHADOW = (90, 60, 30)

HEAD = '/System/Library/Fonts/ヒラギノ角ゴシック W7.ttc'
BODY = '/System/Library/Fonts/ヒラギノ角ゴシック W4.ttc'
STATUS_JA = '/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc'  # iPad の状態バーの日付（漢字があるので、SF では描けない）
# iPad の状態バーの日付。Apple の宣材と同じ日（2007 年に iPhone を発表した日）。撮った日の日付は残さない
IPAD_DATE = '1月9日(火)'


def find(stem):
    for p in sorted(src.iterdir()):
        if p.stem == stem and p.suffix.lower() in ('.png', '.jpg', '.jpeg'):
            return p
    return None


def sf(size, weight):
    f = ImageFont.truetype('/System/Library/Fonts/SFNS.ttf', size)
    try:
        f.set_variation_by_axes([100, 28, 400, weight])  # 幅・光学サイズ・GRAD・太さ
    except Exception:
        pass
    return f


def retouch(im, ops):
    """retouch.json の手直しを、撮った画像（状態バーを直す前）にかける。座標は、撮った画像のピクセル。

    tone：box の中を明るく（gamma が 1 より小さいほど明るい）・鮮やかに（saturation 倍）する。
          keep_rows があれば、box の下の端からその行数の中だけ、keep_color に近い色（シートの角など）は変えない。
    fill：box の中を、一色（color）で塗る。写り込んだ、重複した表示などを消す。
    """
    a = np.asarray(im.convert('RGB')).astype(float)
    for op in ops:
        (kind, p), = op.items()
        x0, y0, x1, y1 = p['box']
        if kind == 'tone':
            sub = a[y0:y1, x0:x1]  # box の中だけ計算する（画像全体は重い）
            b = 255 * (sub / 255) ** p.get('gamma', 1.0)
            lum = np.dot(b, [.299, .587, .114])[..., None]
            b = (lum + (b - lum) * p.get('saturation', 1.0)).clip(0, 255)
            mask = np.ones(sub.shape[:2], bool)
            if 'keep_color' in p:
                ky = sub.shape[0] - p.get('keep_rows', sub.shape[0])
                near = np.abs(sub - np.array(p['keep_color'])).sum(2) <= p.get('keep_tol', 25)
                near[:max(ky, 0)] = False
                mask &= ~near
            sub[mask] = b[mask]
        elif kind == 'fill':
            a[y0:y1, x0:x1] = p['color']
        else:
            raise SystemExit(f'retouch.json の知らない手直し：{kind}')
    return Image.fromarray(a.round().astype('uint8'))


def cover_bar(im, k, regions, y0, y1):
    """状態バーの文字のある左右だけ、すぐ隣（同じ高さ）の模様をずらして重ね、ふちをぼかして隠す。"""
    for x0, x1 in regions:
        x0, x1, t, b = round(x0 * k), round(x1 * k), round(y0 * k), round(y1 * k)
        w = x1 - x0
        src_x = x1 + round(20 * k) if x0 < im.width / 2 else x0 - w - round(20 * k)  # 左は右隣から、右は左隣から
        patch = im.crop((src_x, t, src_x + w, b))
        mask = Image.new('L', (w, b - t), 0)
        ImageDraw.Draw(mask).rectangle((round(12 * k), round(12 * k), w - round(12 * k), b - t - round(12 * k)), fill=255)
        im.paste(patch, (x0, t), mask.filter(ImageFilter.GaussianBlur(7 * k)))
    return im


def fix_status_bar_iphone(im):
    """状態バー（時刻・電波・電池）を、9:41・電波4・電池満タンに差し替える。

    もとの文字は、まわりの色で塗りつぶす。背景が一色なら行ごとの色、写真なら、すぐ隣の同じ高さの木目などを重ねて隠す。
    大きさは、幅 1170 の画面（iPhone 12 など）を基準にして、幅に合わせて拡大する。
    """
    im = im.convert('RGB')
    k = im.width / D['base_w']
    a = np.asarray(im).copy()
    bar = round(135 * k)  # 状態バーの高さ（アプリが重ねる「同時に再生」の帯も、この中）
    edge = a[:bar, 3].astype(float)
    if edge.std(axis=0).max() < 6:  # 背景が一色
        a[:bar] = a[:bar, 3:4]
        im = Image.fromarray(a)
    else:  # 写真：文字のある左右だけ、すぐ隣（同じ高さ）の木目をずらして重ね、ふちをぼかす
        im = cover_bar(Image.fromarray(a), k, ((40, 300), (860, 1150)), 15, 125)

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


def fix_status_bar_ipad(im):
    """iPad の状態バー（左に時刻と日付、右に Wi-Fi と電池）を、9:41・1月9日(火)・電池満タンに差し替える。

    位置と大きさは、iPad のシミュレーター（日本語・幅 1640）の 9:41 の表示から測った。
    iPad では、アプリが中央の列なので、状態バーの文字が、左右の余白（一色）と、列の中の写真の両方にかかることがある。
    そのため、列（縦 1 本）ごとに、状態バーのすぐ上と下が、どちらも画面の端（余白）と同じ色なら余白として、その色で塗り、
    それ以外の列を写真として、すぐ隣（同じ高さ）の写真を重ねて隠す。
    （上と下の色が同じかどうかだけで決めると、写真の中の平らな所も余白と見なし、写真の範囲が細切れになる。
    細切れの範囲ごとに隣を写すと、元の文字まで写してしまう）
    """
    im = im.convert('RGB')
    k = im.width / D['base_w']
    bar = round(48 * k)  # 状態バーの高さ（24pt）
    # 左：時刻と日付（TestFlight から開くと、前に「◀ TestFlight」が付く）。右：Wi-Fi・電池の残量の数字・電池
    regions = ((20, 470), (1430, 1625))
    a = np.asarray(im).copy()
    top, below = a[round(2 * k)].astype(int), a[bar + round(2 * k)].astype(int)
    spans = []  # 写真の列の、ひと続きの範囲
    is_plain = np.zeros(im.width, bool)  # 余白と判定した列
    for x0, x1 in regions:
        x0, x1 = round(x0 * k), round(x1 * k)
        edge = below[0] if x0 < im.width / 2 else below[-1]  # 余白の色（画面の端）
        start = None
        for x in range(x0, x1 + 1):
            plain = x < x1 and np.abs(top[x] - edge).sum() < 12 and np.abs(below[x] - edge).sum() < 12
            if x < x1 and plain:
                a[:bar, x] = below[x]
                is_plain[x] = True
            if x < x1 and not plain:
                start = x if start is None else start
            elif start is not None:
                spans.append((start, x))
                start = None
    # 写真の列は、状態バーのすぐ下の写真を、上下に折り返して埋める。
    # iPad の写真は横の変化が大きい（皿・テーブルクロス・カップ）ので、iPhone のように隣から写すと、
    # 違う物が四角く貼られて見える。すぐ下の続きなら、境目（状態バーの下の端）で、物の縁がつながる
    reflect = a[bar:2 * bar][::-1]
    fade = round(10 * k)  # 写真の続き（範囲の外も写真）の側だけ、元の写真へなめらかに戻す
    for x0, x1 in spans:
        w = x1 - x0
        wgt = np.ones(w)
        if x0 > 0 and not is_plain[x0 - 1]:
            wgt[:fade] = np.linspace(0, 1, fade + 2)[1:-1][:w]
        if x1 < im.width and not is_plain[x1]:
            wgt[-fade:] = np.minimum(wgt[-fade:], np.linspace(1, 0, fade + 2)[1:-1][-w:])
        wgt = wgt[None, :, None]
        a[:bar, x0:x1] = (reflect[:, x0:x1] * wgt + a[:bar, x0:x1] * (1 - wgt)).round().astype('uint8')
    im = Image.fromarray(a)

    lum = np.asarray(im.crop((round(30 * k), round(10 * k), round(250 * k), round(38 * k)))).mean()
    fg = (255, 255, 255) if lum < 120 else (20, 20, 22)

    s = 4
    layer = Image.new('RGBA', (im.width * s, bar * s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    u = k * s
    d.text((34 * u, 32 * u), '9:41', font=sf(round(24 * u), 600), fill=fg, anchor='ls')
    d.text((105 * u, 32 * u), IPAD_DATE, font=ImageFont.truetype(STATUS_JA, round(23 * u)), fill=fg, anchor='ls')
    cx, cy = 1534.5 * u, 34 * u  # Wi-Fi（iPhone の形を、iPad の大きさに縮めたもの）
    for r, fill in ((20, fg), (15.5, (0, 0, 0, 0)), (13.3, fg), (8.9, (0, 0, 0, 0)), (6.7, fg)):
        d.pieslice((cx - r * u, cy - r * u, cx + r * u, cy + r * u), 225, 315, fill=fill)
    d.rounded_rectangle((1557 * u, 12 * u, 1604 * u, 35 * u), radius=7 * u, outline=fg + (102,), width=int(2 * u))
    d.rounded_rectangle((1561 * u, 16 * u, 1600 * u, 31 * u), radius=4 * u, fill=fg)
    d.rounded_rectangle((1607 * u, 19 * u, 1610 * u, 27 * u), radius=1.5 * u, fill=fg + (128,))
    layer = layer.resize((im.width, bar), Image.LANCZOS)
    im.paste(layer, (0, 0), layer)
    return im


def clear_resize_grip(im):
    """iPadOS 26 の、ウインドウの大きさを変えるつまみ（右下の角の、曲がった線）を消す。

    アプリの画面ではないので、撮った画面に残さない。下のタブバーの地の色（行ごとに、すぐ左の色）で塗る。
    つまみが無い（iPadOS 26 より前・角に別の表示がある）ときは、何もしない。
    """
    k = im.width / D['base_w']
    a = np.asarray(im).copy()
    x0, y0 = round(1590 * k), im.height - round(50 * k)
    left = a[y0:, x0 - round(5 * k)].astype(int)
    if np.abs(a[y0:, x0:].astype(int) - left[:, None]).sum(2).max() < 60:
        return im
    a[y0:, x0:] = left[:, None]
    return Image.fromarray(a)


if device == 'ipad':
    def fix_status_bar(im):
        return clear_resize_grip(fix_status_bar_ipad(im))
else:
    fix_status_bar = fix_status_bar_iphone


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
    # 丸ごとに、地をその丸の色の透明にしてからぼかす（透明な黒の地だと、縁の色が黒に寄り、灰色に濁る）
    # 位置は、iPhone の大きさ（1179×2556）で決めた丸を、縦横の比で動かし、大きさは glow 倍にする
    g = D['glow']
    sx, sy = W / 1179, H / 2556
    for (cx, cy, rx, ry), color, alpha in (((1179 - 150, 110, 410, 410), (255, 230, 190), 90),
                                           ((40, 1880, 380, 380), (214, 160, 110), 45)):
        cx, cy, rx, ry = cx * sx, cy * sy, rx * g, ry * g
        glow = Image.new('RGBA', (W, H), color + (0,))
        ImageDraw.Draw(glow).ellipse((round(cx - rx), round(cy - ry), round(cx + rx), round(cy + ry)), fill=color + (alpha,))
        glow = glow.filter(ImageFilter.GaussianBlur(round(120 * g)))
        im.paste(glow, (0, 0), glow)
    return im


def draw_caption(im, title):
    """見出し（{} でかこんだ字は茶色）を、中央ぞろえで 2 行まで。"""
    size, y, step = D['caption']
    d = ImageDraw.Draw(im)
    big = ImageFont.truetype(HEAD, size)
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
        y += step


def hero(title, subtitle):
    """最初の1枚：画面は出さず、アプリ自身の背景の写真（窓辺のカップ）を大きく見せ、名前とサブタイトルを添える。

    参考にしたアプリは、最初の1枚だけ、画面の枠から出た見せ方をしていた。
    """
    root = here.parents[2]
    im = background()
    draw_caption(im, title)
    # 写真とアイコンが、ほぼ同じ絵（窓辺のロゼッタ）になるので、アイコンは出さない（ストアのページの上にも出る）。
    # 写真を大きくして、名前とサブタイトルを添える
    pw, y0, rad, name_size, sub_size, name_dy, sub_dy = D['hero']
    x0 = (W - pw) // 2
    photo = Image.open(root / 'public/world/light/morning.webp').convert('RGB')
    photo = photo.resize((pw, round(photo.height * pw / photo.width)), Image.LANCZOS)
    shadow = Image.new('RGBA', (W, H), SHADOW + (0,))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 20, x0 + pw, y0 + photo.height + 20), radius=rad, fill=SHADOW + (120,))
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    im.paste(shadow, (0, 0), shadow)
    mask = Image.new('L', photo.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, photo.width - 1, photo.height - 1), radius=rad, fill=255)
    im.paste(photo, (x0, y0), mask)
    # 名前とサブタイトル（写真の下の余白の、真ん中）
    d = ImageDraw.Draw(im)
    cy = (y0 + photo.height + H) // 2
    d.text((W / 2, cy - name_dy), 'ラテ帳', font=ImageFont.truetype(HEAD, name_size), fill=INK, anchor='mm')
    small = ImageFont.truetype(BODY, sub_size)
    assert d.textlength(subtitle, font=small) <= W - 120, f'サブタイトルが長すぎる：{subtitle}'
    d.text((W / 2, cy + sub_dy), subtitle, font=small, fill=(110, 92, 75), anchor='mm')
    return im


def compose(clean, title):
    im = background()
    draw_caption(im, title)
    sw, y0, rad = D['shot']
    sh = round(clean.height * sw / clean.width)
    x0 = (W - sw) // 2
    shot = clean.resize((sw, sh), Image.LANCZOS)
    # 影 → 画面（下は、はみ出させる。画面の続きがあることを見せる）→ 細い線
    shadow = Image.new('RGBA', (W, H), SHADOW + (0,))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 20, x0 + sw, y0 + sh + 20), radius=rad, fill=SHADOW + (120,))
    shadow = shadow.filter(ImageFilter.GaussianBlur(34))
    im.paste(shadow, (0, 0), shadow)
    mask = Image.new('L', (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=rad, fill=255)
    im.paste(shot, (x0, y0), mask)
    ImageDraw.Draw(im).rounded_rectangle((x0, y0, x0 + sw - 1, y0 + sh - 1), radius=rad, outline=LINE, width=3)
    return im


(out / 'clean').mkdir(parents=True, exist_ok=True)
(out / 'store').mkdir(parents=True, exist_ok=True)
for name in retouches:
    if not any(c.get('file') == name for c in captions):
        raise SystemExit(f'retouch.json の {name} は、appstore-captions.json で使っていない（名前の間違い？）')
# 撮っていない画面は、飛ばして番号を詰める（iPad は 1 枚から出せるので、全部そろわないことがある）
i = 0
for c in captions:
    if c.get('layout') == 'hero':
        i += 1
        hero(c['title'], c['subtitle']).save(out / 'store' / f'{i}-{c["name"]}.png', optimize=True)
        print(i, c['name'])
        continue
    path = find(c['file'])
    if path is None:
        if device == 'iphone':  # iPhone は、全部そろえて出す。名前の打ち間違いで、黙って 1 枚減らさない
            raise SystemExit(f'撮った画像が見つからない：{c["file"]}（{src}）')
        print(f'-  {c["name"]}：撮った画像がないので飛ばす（{src / c["file"]}.png）')
        continue
    i += 1
    raw = Image.open(path)
    if abs(raw.width / raw.height - D['aspect']) > 0.03:
        raise SystemExit(f'{path.name} は {raw.width}×{raw.height}。--device {device} の画面ではない（機種の指定を確かめる）')
    if c['file'] in retouches:
        raw = retouch(raw, retouches[c['file']])
    clean = fit(fix_status_bar(raw))
    clean.save(out / 'clean' / f'{i}-{c["name"]}.png')
    store = compose(clean, c['title'])
    assert store.size == (W, H) and store.mode == 'RGB'
    store.save(out / 'store' / f'{i}-{c["name"]}.png', optimize=True)
    print(i, c['name'])
