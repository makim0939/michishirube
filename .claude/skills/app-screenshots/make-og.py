# シェア用の画像（worker/site/og.png、1200×630）を、紹介サイトの画像から作る。
# 使い方：python3 -I .claude/skills/app-screenshots/make-og.py worker/site
# 「今日」の画面（img/today.webp）を使うので、画面写真を撮り直したら、これも作り直す。
# macOS のヒラギノを使う。✕ は、ヒラギノにも Apple Symbols にも字が無いので、線で描く。
import sys
from PIL import Image, ImageDraw, ImageFont
site = sys.argv[1]
W, H = 1200, 630
BG, INK, SUB, LINE = (250, 247, 242), (42, 31, 25), (95, 80, 70), (227, 217, 204)
bold = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', 52)
name = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W6.ttc', 40)
sub = ImageFont.truetype('/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc', 29)
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
d.text((80, 270), 'ラテアートの練習を、', font=bold, fill=INK)
d.text((80, 340), '動画と写真で記録するアプリ', font=bold, fill=INK)
x = 80
for part in ('1杯ずつ撮って、◎△',):
    d.text((x, 470), part, font=sub, fill=SUB)
    x += d.textlength(part, font=sub)
# ✕ は、使うフォントに字が無いので、線で描く
d.line((x + 5, 479, x + 23, 497), fill=SUB, width=3)
d.line((x + 23, 479, x + 5, 497), fill=SUB, width=3)
x += 29
d.text((x, 470), 'と次の一手をメモ。', font=sub, fill=SUB)
d.text((80, 516), '最初の1杯と並べれば、上達が目で見えます。', font=sub, fill=SUB)

img.save(f'{site}/og.png', optimize=True)
print(img.size)
