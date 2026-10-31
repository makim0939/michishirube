#!/usr/bin/env python3
"""
BGM（m4a）の、繰り返しの継ぎ目を数字で確かめる（docs/bgm.md）。

  python3 scripts/check-bgm-seam.py public/bgm/*.m4a

継ぎ目（終わりから頭へ戻る所）の前後 1.5 秒で、100 ms ごとの大きさの最小を、曲の中ほどの大きさ（中央値）と比べる。
曲の中にも、拍の間でこのくらい小さくなる所があるので、「曲の中の同じ長さの窓」の下位 10 % の値と並べて出す。
継ぎ目の値が、曲の中の値と同じくらいなら、継ぎ目で間があいていない。クリックは、継ぎ目の前後の隣り合う音の差を、曲の中の差（99.9 %）と比べる。
macOS（afinfo）・ffmpeg・numpy が要る。
"""
import re, subprocess, sys
import numpy as np

SR = 44100


def valid_frames(path):
    out = subprocess.run(["afinfo", path], capture_output=True, text=True).stdout
    return int(re.search(r"(\d+) valid frames", out).group(1))


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True).stdout
    # ffmpeg は終わりの余白（最大 1024 サンプル）を削らないので、afinfo の有効な長さで切る（AVFoundation と同じ）
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)[: valid_frames(path)]


def rms(a):
    return float(np.sqrt((a**2).mean()))


w, hop = int(0.1 * SR), int(0.1 * SR) // 4


def min_level(y, a, b):
    seg = y[a:b]
    return min(rms(seg[i : i + w]) for i in range(0, len(seg) - w, hop))


for path in sys.argv[1:]:
    x = decode(path).mean(1)
    n = len(x)
    y = np.concatenate([x, x, x])
    median = float(np.median([rms(x[i : i + w]) for i in range(0, n - w, w)]))
    win = int(3 * SR)
    inside = [min_level(y, a, a + win) / median for a in range(n // 5, n - win, SR // 2)]
    seam = min_level(y, n - int(1.5 * SR), n + int(1.5 * SR)) / median
    step = float(np.abs(np.diff(y[n - 3 : n + 3])).max())
    step_p = float(np.percentile(np.abs(np.diff(x)), 99.9))
    print(f"{path.split('/')[-1]:26s} {n / SR:6.2f}s  継ぎ目の最小/中央値={seam:.2f}（曲の中の下位10%={np.percentile(inside, 10):.2f}）  継ぎ目の段差={step:.3f}（曲の中の99.9%={step_p:.3f}）")
