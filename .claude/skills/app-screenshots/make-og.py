# シェア用の画像（worker/site/og.png、1200×630）を、紹介サイトの画像から作る。
# 使い方：python3 -I .claude/skills/app-screenshots/make-og.py worker/site
# 「今日」の画面（img/today.webp）を使うので、画面写真を撮り直したら、これも作り直す。
# macOS のヒラギノを使う。文言は、紹介サイトのキャッチ（index.html の .catch と .sub）と同じにする。変えたら、og:image:alt も直す。
import sys
from PIL import Image, ImageDraw, ImageFont
site = sys.argv[1]
W, H = 1200, 630
ACCENT = (168, 98, 47)
BG, INK, SUB, LINE = (250, 247, 242), (37, 37, 40), (117, 117, 120), (227, 217, 204)
CATCH = 46
bold = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', CATCH)
small = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', round(CATCH * 0.75))
name = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', 40)
sub = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', 26)
img = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(img)

# 右：「今日」の画面。下にはみ出させて、画面の続きがあることを見せる
shot = Image.open(f'{site}/img/today.webp').convert('RGB')
sw = 380
sh = round(shot.height * sw / shot.width)
shot = shot.resize((sw, sh), Image.LANCZOS)
x0, y0 = 810, 52
mask = Image.new('L', (sw, sh), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius=36, fill=255)
img.paste(shot, (x0, y0), mask)
d.rounded_rectangle((x0, y0, x0 + sw - 1, y0 + sh - 1), radius=36, outline=LINE, width=2)

# 左：アイコン・名前・キャッチ
icon = Image.open(f'{site}/icon.png').convert('RGB').resize((88, 88), Image.LANCZOS)
im = Image.new('L', (88, 88), 0)
ImageDraw.Draw(im).rounded_rectangle((0, 0, 87, 87), radius=20, fill=255)
img.paste(icon, (80, 96), im)
d.text((190, 118), 'ラテ帳', font=name, fill=INK)

TEXT_RIGHT = 790  # 右の画面（x=810〜）に重ならない右端（画面との間に 20px）

def line(x, baseline, parts):
    # 同じ行に、大きさ・色の違う字を並べる（ベースラインをそろえる）
    for text, font, fill in parts:
        d.text((x, baseline), text, font=font, fill=fill, anchor='ls')
        x += d.textlength(text, font=font)
    assert x <= TEXT_RIGHT, f'文字が右の画面に重なる（右端 {x:.0f}px）：{parts[0][0]}…'

# キャッチ：「と」「で、」は、名詞（動画・写真）より小さく。「ラテアート」は茶色
line(80, 330, [('動画', bold, INK), ('と', small, INK), ('写真', bold, INK), ('で、', small, INK)])
line(80, 396, [('毎日の', bold, INK), ('ラテアート', bold, ACCENT), ('を記録しよう。', bold, INK)])
line(80, 480, [('成功／失敗と、次の一手をメモ。', sub, SUB)])
line(80, 520, [('かんたんなステップで記録でき、次の一杯で改善できます。', sub, SUB)])

img.save(f'{site}/og.png', optimize=True)
print(img.size)
