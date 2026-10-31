#!/usr/bin/env python3
"""
同梱の BGM を、つなぎ目なく繰り返せる m4a に作る（docs/bgm.md）。

  python3 scripts/make-bgm.py <元の曲のフォルダ> <出力のフォルダ（public/bgm）> [曲の id ...]

元の曲（MP3）は、git に入れない（references/ に置く）。macOS（afconvert）・ffmpeg・numpy が要る。

加工の方式は 2 つ（TRACKS の method）：

- bars（整数小節で切る）：元の曲は、整数小節の長さで書き出されていることが多い（16 小節など）。曲のテンポ（BPM）から
  1 小節の長さを決め、**音の始まりから、整数小節ぶん**を、そのまま 1 周分にする。終わりから頭へ戻っても、拍・小節・和声が
  そのまま続く（曲の中の、小節から次の小節への移り変わりと同じになる）。ファイルが 1 周分より長く、余韻（リバーブの残り）が
  続いているときは、その余韻を頭に重ねる（テールのオーバーラップ）。アウトロ・イントロは、skip_bars・bars で外す
- legacy（終わりを頭に重ねる）：曲の終わりの X 秒を、頭の X 秒に重ねる（等パワーのクロスフェード）。Cosy Feeling（Loopable）と
  Quiet Days は、この方式で十分つながっている（実機で確認済み）ので、音を変えないために残す

どちらも、音量をそろえて（-16 LUFS・ピーク -1 dB）、AAC 128 kbps（afconvert）に変換する。
"""
import json, os, subprocess, sys, tempfile
import numpy as np

SR = 44100

# id・元のファイル（元のフォルダの中の相対パス）・method。
# bars：bpm（テンポの分析で求めた値）・bars（1 周の小節数）・skip_bars（音の始まりから外す小節数）・tail（余韻を頭に重ねる最大の秒数）
# legacy：fade（重ねる秒数。Loopable は 0.03）
# beats_per_bar は 4（省略可）。check-bgm-seam.py も、この表の bpm を使う
TRACKS = [
    {"id": "dreams-of-tomorrow", "src": "⭐️3/oma-dreams-of-tomorrow-lofi-hCsVNxfshixaX84jmBnKtX.mp3", "method": "bars", "bpm": 70, "bars": 8, "skip_bars": 4, "tail": 5.0},
    {"id": "playful-toy", "src": "⭐️3/oma-playful-toy-lo-fi-SF5KFpjai4FHNZirie2roW.mp3", "method": "bars", "bpm": 160, "bars": 16, "skip_bars": 0, "tail": 0},
    {"id": "cosy-feeling", "src": "⭐️2/oma-cosy-kind-of-feeling-jazztrio-loopable-pzf1UaMD5YF7B533r9dEJK.mp3", "method": "legacy", "fade": 0.03, "bpm": 105, "bars": 16},
    {"id": "quiet-days", "src": "⭐️2/oma-quiet-days-lo-fi-sfM1hM2rD5HtjzxPSECLGw.mp3", "method": "legacy", "fade": 2.5, "bpm": 120, "bars": 12},
    {"id": "8bit-bossa", "src": "⭐️2/oga-8bit Bossa.mp3", "method": "bars", "bpm": 129, "bars": 32, "skip_bars": 0, "tail": 0},
    {"id": "april-groove", "src": "⭐️1/oma-april-groove-jazz-xTiXSQBg4ZsmeWBvQiJo6D.mp3", "method": "bars", "bpm": 125, "bars": 16, "skip_bars": 0, "tail": 0},
]


def decode(path):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"],
        check=True, capture_output=True,
    ).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).copy()


def trim_silence(x, db=-55):
    """頭と終わりの無音（エンコーダーの余白も）を詰める"""
    level = 10 ** (db / 20)
    loud = np.where(np.abs(x).max(axis=1) > level)[0]
    return x[loud[0] : loud[-1] + 1]


def envelope(x, hz=100):
    """音の立ち上がりの形（拍の位置を比べるため）。100 Hz の粒度で、大きさの増え方だけを見る"""
    h = SR // hz
    m = np.abs(x).mean(axis=1)
    power = (m[: len(m) // h * h].reshape(-1, h) ** 2).mean(axis=1)
    e = np.sqrt(np.convolve(power, np.ones(3) / 3, mode="same"))
    return np.maximum(0, np.diff(np.log(e + 1e-4)))


def find_cut(x, fade_sec):
    """
    曲を切る位置 N を探す。N のあとの fade_sec 秒（頭に重ねる所）が、頭の fade_sec 秒と拍の形が合い、
    しかも音がまだ鳴っている（終わりの余韻・無音でない）所を選ぶ。拍がずれた所で重ねると、音が二重に聞こえる
    """
    hz = 100
    n = int(fade_sec * SR)
    mono = np.abs(x).mean(axis=1)
    h = SR // hz
    level = np.sqrt((mono[: len(mono) // h * h].reshape(-1, h) ** 2).mean(axis=1))  # 100 Hz の大きさ
    typical = np.median(level[level > 0.01 * level.max()])
    env = envelope(x, hz)
    k = int(fade_sec * hz)
    head = env[:k] - env[:k].mean()
    best, best_n = -2.0, len(x) - n
    for cand in range(len(level) - k, len(level) // 2, -1):  # 10 ms 刻み、終わりから前へ
        tail_level = level[cand : cand + k]
        if len(tail_level) < k or tail_level.min() < 0.35 * typical:
            continue  # 余韻や無音にかかる所は避ける
        seg = env[cand : cand + k]
        if len(seg) < k:
            continue
        seg = seg - seg.mean()
        c = float((head * seg).sum() / (np.linalg.norm(head) * np.linalg.norm(seg) + 1e-9))
        if c > best:
            best, best_n = c, cand * h
    return best_n, best


def loop_ready(x, fade_sec, cut=None):
    """N（cut）のあとの fade_sec 秒を、頭に重ねる。長さは N になる"""
    n = int(fade_sec * SR)
    body = len(x) - n if cut is None else cut
    x = x[: body + n]
    t = np.linspace(0, 1, n, endpoint=False, dtype=np.float32)[:, None]
    fin, fout = np.sin(t * np.pi / 2), np.cos(t * np.pi / 2)
    y = x[:body].copy()
    y[:n] = x[:n] * fin + x[body:] * fout
    return y


def rms(a):
    return float(np.sqrt((a**2).mean()))


def first_sound(x, db=-50):
    """音の始まり（MP3 の頭の無音・デコーダーの遅れを除く）。2 ms の窓で、ピークが db を超える最初の所"""
    w = SR // 500
    peak = np.abs(x).max(axis=1)
    peak = peak[: len(peak) // w * w].reshape(-1, w).max(axis=1)
    return int(np.argmax(peak > 10 ** (db / 20))) * w


def bars_loop(x, bpm, bars, skip_bars=0, tail=0.0, beats_per_bar=4):
    """
    音の始まりから skip_bars 小節あとを頭にして、bars 小節ぶんを 1 周分に切り出す。長さは小節の整数倍（サンプルの丸めだけ）。
    1 周分のあとに、ファイルに余韻が残っているとき（tail 秒まで）は、頭に足す（終わりの余韻が、頭にかかって鳴る）
    """
    bar = beats_per_bar * 60.0 / bpm * SR
    s = first_sound(x) + int(round(skip_bars * bar))
    e = s + int(round(bars * bar))
    body = np.zeros((e - s, 2), np.float32)
    have = x[s : min(e, len(x))]
    body[: len(have)] = have
    info = {"start": round(s / SR, 4), "loop_sec": round((e - s) / SR, 4), "tail_sec": 0.0}
    rest = x[e : e + int(tail * SR)] if tail > 0 else x[:0]
    if len(rest) > SR // 5:
        head_level = rms(body[: SR // 2])
        # 余韻は、頭より十分小さいときだけ足す（続きの音楽が残っているファイルは、足さない）
        if rms(rest[: SR // 2]) < 0.5 * head_level:
            # 頭の最初の 2 ms だけ立ち上げる：終わりの音の次のサンプルは、1 周分のあとの続き（rest の頭）なので、
            # 頭の音（s の所）を入れずに始めると、終わりから頭へ、段差なくつながる
            ramp = np.linspace(0, 1, SR // 500, dtype=np.float32)[:, None]
            body[: len(ramp)] *= ramp
            body[: len(rest)] += rest
            info["tail_sec"] = round(len(rest) / SR, 2)
    return body, info


def measure_lufs(x):
    with tempfile.NamedTemporaryFile(suffix=".f32") as f:
        f.write(x.astype(np.float32).tobytes())
        f.flush()
        r = subprocess.run(
            ["ffmpeg", "-nostats", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", f.name, "-af", "ebur128=peak=true", "-f", "null", "-"],
            capture_output=True, text=True,
        ).stderr
    # 最後の Summary の I: を読む
    tail = r.split("Summary:")[-1]
    return float(tail.split("I:")[1].split("LUFS")[0])


def main():
    src, out = sys.argv[1], sys.argv[2]
    only = set(sys.argv[3:])
    os.makedirs(out, exist_ok=True)
    report = {}
    for t in TRACKS:
        tid = t["id"]
        if only and tid not in only:
            continue
        raw = decode(os.path.join(src, t["src"]))
        if t["method"] == "legacy":
            x = trim_silence(raw)
            fade = t["fade"]
            cut, corr = (None, 1.0) if fade < 0.1 else find_cut(x, fade)
            y = loop_ready(x, fade, cut)
            extra = {"beat_match": round(corr, 2)}
        else:
            y, extra = bars_loop(raw, t["bpm"], t["bars"], t["skip_bars"], t["tail"])
        gain = 10 ** ((-16 - measure_lufs(y)) / 20)
        y = y * gain
        peak = np.abs(y).max()
        if peak > 0.89:  # -1 dBFS
            y = y * (0.89 / peak)
        # ffmpeg の AAC は、終わりの余白（最大 1024 サンプル）の長さを書かないので、繰り返すたびに短い無音が入る。
        # macOS の afconvert は、余白の長さも書くので、継ぎ目が詰まる
        with tempfile.TemporaryDirectory() as d:
            wav = os.path.join(d, "in.wav")
            subprocess.run(
                ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-", "-c:a", "pcm_s16le", wav],
                input=np.clip(y, -1, 1).astype(np.float32).tobytes(), check=True,
            )
            dst = os.path.join(out, f"{tid}.m4a")
            subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "128000", "-q", "127", "-s", "0", wav, dst], check=True)
        report[tid] = {**extra, "seconds": round(len(y) / SR, 2), "bytes": os.path.getsize(dst), "gain_db": round(20 * np.log10(gain), 1)}
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
