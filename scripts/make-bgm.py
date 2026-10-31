#!/usr/bin/env python3
"""
同梱の BGM を、つなぎ目なく繰り返せる m4a に作る（docs/bgm.md）。

  python3 scripts/make-bgm.py <元の曲のフォルダ> <出力のフォルダ（public/bgm）> [曲の id ...]

元の曲（MP3）は、git に入れない（references/ に置く）。macOS（afconvert）・ffmpeg・numpy が要る。
手順：頭と終わりの無音を詰める → 終わりの X 秒を、頭の X 秒に重ねる（等パワーのクロスフェード）
→ 音量をそろえる（-16 LUFS・ピーク -1 dB）→ AAC 128 kbps（afconvert）に変換。
できた曲は、終わりから頭へ戻るところが、元の曲の中と同じように続く（終わりが小さくなって、頭が大きくなる）。
最初から繰り返せるように作られた曲（loopable）は、継ぎ目が合っているので、ごく短い（30 ms）重ねだけにする。
"""
import json, os, subprocess, sys, tempfile
import numpy as np

SR = 44100

# id・元のファイル（元のフォルダの中の相対パス）・重ねる秒数
TRACKS = [
    ("dreams-of-tomorrow", "⭐️3/oma-dreams-of-tomorrow-lofi-hCsVNxfshixaX84jmBnKtX.mp3", 2.5),
    ("playful-toy", "⭐️3/oma-playful-toy-lo-fi-SF5KFpjai4FHNZirie2roW.mp3", 2.0),
    ("cosy-feeling", "⭐️2/oma-cosy-kind-of-feeling-jazztrio-loopable-pzf1UaMD5YF7B533r9dEJK.mp3", 0.03),
    ("quiet-days", "⭐️2/oma-quiet-days-lo-fi-sfM1hM2rD5HtjzxPSECLGw.mp3", 2.5),
    ("8bit-bossa", "⭐️2/oga-8bit Bossa.mp3", 2.0),
    ("april-groove", "⭐️1/oma-april-groove-jazz-xTiXSQBg4ZsmeWBvQiJo6D.mp3", 2.0),
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
    for tid, rel, fade in TRACKS:
        if only and tid not in only:
            continue
        x = trim_silence(decode(os.path.join(src, rel)))
        cut, corr = (None, 1.0) if fade < 0.1 else find_cut(x, fade)
        y = loop_ready(x, fade, cut)
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
        report[tid] = {"beat_match": round(corr, 2), "seconds": round(len(y) / SR, 2), "bytes": os.path.getsize(dst), "gain_db": round(20 * np.log10(gain), 1)}
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
