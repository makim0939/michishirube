#!/usr/bin/env python3
"""
BGM（m4a）の、繰り返しの継ぎ目を数字で確かめる（docs/bgm.md）。

  python3 scripts/check-bgm-seam.py public/bgm/*.m4a
  python3 scripts/check-bgm-seam.py --out <フォルダ> public/bgm/*.m4a   # 2 周分の wav・onset の間隔の列・波形とスペクトログラムの画像も出す

大きさ・段差のほかに、「音楽として」つながっているかを見る。継ぎ目の値は、必ず「曲の中の同じ測り方の値」と並べる
（曲の中にも、拍の揺れや音色の変化はあるので、継ぎ目がそれと同じ範囲なら、つながっている）。

- 拍の位相：曲の中ほどの onset で拍の格子（TRACKS の BPM。16 分音符の刻み）を決め、継ぎ目の前後 4 秒の onset が、その格子から何 ms ずれるか。
  曲の中の同じ長さの窓と比べる。小節の途中で切っていれば、継ぎ目のあと（または前）が大きくずれる
- リズムの似かた：k 小節（1・2・4 のうち、曲の中で最も似る長さ）の前後で、onset の強さの形の相関。拍は合っていても、1 拍・2 拍ずれて小節の頭が変わる場合を拾う
- onset の間隔：継ぎ目の前後 2.5 秒の onset の間隔（ms）の列。継ぎ目をまたぐ間隔が、前後の間隔と同じ拍の割りに乗っているか
- スペクトルの連続：継ぎ目の前後 0.5 秒の、帯域ごとの音の大きさ（dB）の違いを、曲の中の隣り合う 0.5 秒どうしの違いと比べる（音色が途切れていないか）
- 和声の連続：継ぎ目の前後 1 小節のクロマ（音名ごとの強さ）の似かたを、曲の中の隣り合う 1 小節どうしの似かたと比べる
- 大きさ：継ぎ目の前後 1.5 秒の最小を、曲の中の下位 10 % と比べる（間があいていないか）。段差（クリック）も

macOS（afinfo）・ffmpeg・numpy が要る。画像は matplotlib があれば出す。
"""
import importlib.util, os, re, subprocess, sys, wave
import numpy as np

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))


def load_tracks():
    """make-bgm.py の TRACKS（id → BPM）。同じ表を使うので、曲を足すとここも効く"""
    spec = importlib.util.spec_from_file_location("make_bgm", os.path.join(HERE, "make-bgm.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return {t["id"]: t for t in mod.TRACKS}


def valid_frames(path):
    out = subprocess.run(["afinfo", path], capture_output=True, text=True).stdout
    return int(re.search(r"(\d+) valid frames", out).group(1))


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], capture_output=True).stdout
    # ffmpeg は終わりの余白（最大 1024 サンプル）を削らないので、afinfo の有効な長さで切る（AVFoundation と同じ）
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)[: valid_frames(path)]


def rms(a):
    return float(np.sqrt((a**2).mean()))


# ---- 特徴量 ----
NFFT, HOP = 2048, 256
FRAME_SEC = HOP / SR


def stft_mag(x):
    win = np.hanning(NFFT).astype(np.float32)
    x = np.concatenate([np.zeros(NFFT // 2, np.float32), x.astype(np.float32), np.zeros(NFFT // 2, np.float32)])
    n = 1 + (len(x) - NFFT) // HOP
    frames = np.lib.stride_tricks.sliding_window_view(x, NFFT)[::HOP][:n] * win
    return np.abs(np.fft.rfft(frames, axis=1)).astype(np.float32)  # (時間, 周波数)


def band_matrix(n_bands=48, lo=50.0, hi=12000.0):
    """周波数の対数で等間隔の帯域（スペクトルの大きさ・onset 用）"""
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    edges = np.geomspace(lo, hi, n_bands + 1)
    m = np.zeros((n_bands, len(freqs)), np.float32)
    for i in range(n_bands):
        sel = (freqs >= edges[i]) & (freqs < edges[i + 1])
        if sel.any():
            m[i, sel] = 1 / sel.sum()
    return m


BANDS = band_matrix()


def band_db(mag):
    return 20 * np.log10(mag @ BANDS.T + 1e-5)


def onset_envelope(db):
    """帯域ごとの dB の増え方（正の分だけ）の合計。拍・音の立ち上がりの強さ"""
    d = np.diff(db, axis=0, prepend=db[:1])
    return np.maximum(d, 0).sum(axis=1)


def pick_onsets(env, min_gap=0.06):
    """立ち上がりの山。前後 0.5 秒の中央値＋ばらつきを超えるものだけ。時間（秒）と強さ"""
    w = int(0.5 / FRAME_SEC)
    peaks = []
    for i in range(2, len(env) - 2):
        if env[i] < env[i - 1] or env[i] <= env[i + 1]:
            continue
        seg = env[max(0, i - w) : i + w]
        if env[i] < np.median(seg) + 1.5 * seg.std():
            continue
        # 山の頂点を 3 点の放物線で細かく（フレーム未満）
        a, b, c = env[i - 1], env[i], env[i + 1]
        den = a - 2 * b + c
        off = 0.5 * (a - c) / den if den != 0 else 0.0
        t = (i + off) * FRAME_SEC
        if peaks and t - peaks[-1][0] < min_gap:
            if env[i] > peaks[-1][1]:
                peaks[-1] = (t, float(env[i]))
            continue
        peaks.append((t, float(env[i])))
    return np.array(peaks) if peaks else np.zeros((0, 2))


def circ_phase(times, weights, period):
    """時刻を period で巻いたときの、重み付きの平均の位相（秒。-period/2〜period/2）と、まとまり具合（0〜1）"""
    if len(times) == 0:
        return 0.0, 0.0
    ang = 2 * np.pi * (times % period) / period
    z = (weights * np.exp(1j * ang)).sum() / weights.sum()
    return float(np.angle(z) / (2 * np.pi) * period), float(abs(z))


def wrap(v, period):
    return (v + period / 2) % period - period / 2


def phase_jump(onsets, t0, span, period):
    """時刻 t0 の前後 span 秒の onset で、位相の差（後 − 前。秒）。まとまりが弱い（拍が読めない）ときは None"""
    t, w = onsets[:, 0], onsets[:, 1]
    L = (t >= t0 - span) & (t < t0)
    R = (t >= t0) & (t < t0 + span)
    pl, cl = circ_phase(t[L], w[L], period)
    pr, cr = circ_phase(t[R], w[R], period)
    if min(cl, cr) < 0.35:
        return None
    return wrap(pr - pl, period)


def chroma(mag):
    freqs = np.fft.rfftfreq(NFFT, 1 / SR)
    sel = (freqs >= 55) & (freqs < 2000)
    pc = (np.round(12 * np.log2(freqs[sel] / 440.0)) + 69).astype(int) % 12
    out = np.zeros((mag.shape[0], 12), np.float32)
    for k in range(12):
        out[:, k] = (mag[:, sel][:, pc == k] ** 2).sum(axis=1)
    return out


def unit(v):
    return v / (np.linalg.norm(v) + 1e-9)


def check(path, tracks, out=None):
    name = os.path.splitext(os.path.basename(path))[0]
    stereo = decode(path)
    x = stereo.mean(1)
    n = len(x)
    y = np.concatenate([x, x, x])
    meta = tracks.get(name) or ({"bpm": float(os.environ["BGM_BPM"]), "bars": 0} if os.environ.get("BGM_BPM") else None)

    # ---- 大きさ・段差（これまでの確認）----
    w, hop = int(0.1 * SR), int(0.1 * SR) // 4
    min_level = lambda a, b: min(rms(y[a:b][i : i + w]) for i in range(0, b - a - w, hop))
    median = float(np.median([rms(x[i : i + w]) for i in range(0, n - w, w)]))
    win = int(3 * SR)
    inside = [min_level(a, a + win) / median for a in range(n // 5, n - win, SR // 2)]
    seam_level = min_level(n - int(1.5 * SR), n + int(1.5 * SR)) / median
    step = float(np.abs(np.diff(y[n - 3 : n + 3])).max())
    step_p = float(np.percentile(np.abs(np.diff(x)), 99.9))
    print(f"\n{name}  {n / SR:.3f} 秒" + (f"  BPM {meta['bpm']}（{meta['bars']} 小節）" if meta else "  （TRACKS に無い：拍の格子は見ない）"))
    print(f"  大きさ：継ぎ目の最小/中央値={seam_level:.2f}（曲の中の下位10%={np.percentile(inside, 10):.2f}）  段差={step:.3f}（曲の中の99.9%={step_p:.3f}）")

    # ---- スペクトル・onset ----
    mag = stft_mag(y)
    db = band_db(mag)
    onsets = pick_onsets(onset_envelope(db))
    seam_t = n / SR
    beat = bar = None
    env = onset_envelope(db)
    k = 1
    if meta:
        beat = 60.0 / meta["bpm"]
        bar = beat * meta.get("beats_per_bar", 4)
        # 1 周の長さが、小節の整数倍か（半端なら、継ぎ目で拍・小節がずれる。最も基本の確認）
        nb = n / SR / bar
        print(f"  1 周の長さ：{nb:.3f} 小節（最も近い整数の {round(nb)} 小節から {abs(nb - round(nb)) * bar * 1000:.0f} ms）")
        # 拍の位相：曲の中ほど（継ぎ目から離れた所）の onset で、拍の格子の位相を決め、継ぎ目の前後の onset が、その格子（16 分音符の刻み）から何 ms ずれるか。
        # 拍が合っていれば、前後とも、曲の中と同じくらい（数 ms〜十数 ms）。小節の途中で切っていれば、後ろ（または前）が大きくずれる
        sub = beat / 4
        mid = onsets[(onsets[:, 0] >= seam_t + (n / SR) * 0.3) & (onsets[:, 0] < seam_t + (n / SR) * 0.7)]
        strong = lambda o: o[o[:, 1] >= np.median(mid[:, 1])]
        grid_phase, conc = circ_phase(strong(mid)[:, 0], strong(mid)[:, 1], sub)
        resid = lambda lo, hi: np.abs(wrap(strong(onsets[(onsets[:, 0] >= lo) & (onsets[:, 0] < hi)])[:, 0] - grid_phase, sub)) * 1000
        span = 4.0
        rb, ra = resid(seam_t - span, seam_t), resid(seam_t, seam_t + span)
        inner_means = [resid(t0, t0 + span).mean() for t0 in np.arange(seam_t + 1, seam_t + n / SR - span - 1, 2.0)]
        print(f"  拍の位相（16 分の格子からの onset のずれ。ms）：継ぎ目の前 平均{rb.mean():.1f}・後 平均{ra.mean():.1f}（曲の中の {span:.0f} 秒の窓 中央値={np.median(inner_means):.1f}・最大={max(inner_means):.1f}）")
        # リズムの似かた：k 小節の前後で、onset の強さの形がどれだけ似ているか（相関）。k は、曲の中で最も似る長さ（1・2・4 小節）
        fb = int(bar / FRAME_SEC)
        corr = lambda a, kk: float(np.corrcoef(env[a - kk * fb : a], env[a : a + kk * fb])[0, 1])
        first = int(seam_t / FRAME_SEC) + 4 * fb
        inner_of = lambda kk: range(first, first + n // HOP - (kk + 5) * fb, fb)
        ks = [kk for kk in (1, 2, 4) if len(inner_of(kk)) >= 3] or [1]
        k = max(ks, key=lambda kk: np.median([corr(a, kk) for a in inner_of(kk)]))
        inner_t = inner_of(k)
        c_seam = corr(int(seam_t / FRAME_SEC), k)
        c_inner = [corr(a, k) for a in inner_t]
        print(f"  リズムの似かた（{k} 小節の前後の onset の相関）：継ぎ目={c_seam:.2f}（曲の中 中央値={np.median(c_inner):.2f}・最小={min(c_inner):.2f}）")
    near = onsets[(onsets[:, 0] >= seam_t - 2.5) & (onsets[:, 0] < seam_t + 2.5)]
    ioi = np.diff(near[:, 0]) * 1000
    cross = int(np.searchsorted(near[:, 0], seam_t))  # 継ぎ目をまたぐ間隔の番号
    marks = " ".join(f"[{v:.0f}]" if i == cross - 1 else f"{v:.0f}" for i, v in enumerate(ioi))
    print(f"  onset の間隔（ms。[ ]が継ぎ目をまたぐ）：{marks}")

    # ---- スペクトルの連続（0.5 秒どうし）----
    fr = int(0.5 / FRAME_SEC)
    s0 = int(seam_t / FRAME_SEC)
    mean_db = lambda a: db[a : a + fr].mean(axis=0)
    seam_d = float(np.linalg.norm(mean_db(s0 - fr) - mean_db(s0)) / np.sqrt(db.shape[1]))
    inner = [float(np.linalg.norm(mean_db(a - fr) - mean_db(a)) / np.sqrt(db.shape[1])) for a in range(s0 + fr, s0 + n // HOP - fr, fr // 2)]
    rank = 100 * np.mean([v <= seam_d for v in inner])
    print(f"  スペクトルの違い（0.5 秒の前後。dB）：継ぎ目={seam_d:.2f}（曲の中 中央値={np.median(inner):.2f}・90%={np.percentile(inner, 90):.2f}・最大={max(inner):.2f}）  曲の中の {100 - rank:.0f}% より大きい")
    # 継ぎ目の瞬間（50 ms の前後）も
    f50 = int(0.05 / FRAME_SEC)
    mean50 = lambda a: db[a : a + f50].mean(axis=0)
    seam50 = float(np.linalg.norm(mean50(s0 - f50) - mean50(s0)) / np.sqrt(db.shape[1]))
    inner50 = [float(np.linalg.norm(mean50(a - f50) - mean50(a)) / np.sqrt(db.shape[1])) for a in range(s0 + f50, s0 + n // HOP - f50, f50)]
    print(f"  スペクトルの違い（50 ms の前後）：継ぎ目={seam50:.2f}（曲の中 90%={np.percentile(inner50, 90):.2f}・99%={np.percentile(inner50, 99):.2f}・最大={max(inner50):.2f}）")

    # ---- 和声の連続（1 小節どうし）----
    if bar:
        ch = chroma(mag)
        fb = int(bar * k / FRAME_SEC)
        bar_chroma = lambda a: unit(ch[a : a + fb].sum(axis=0))
        seam_c = float(bar_chroma(s0 - fb) @ bar_chroma(s0))
        inner_c = [float(bar_chroma(a - fb) @ bar_chroma(a)) for a in range(s0 + fb, s0 + n // HOP - fb, fb)]
        print(f"  和声の似かた（{k} 小節の前後。1 に近いほど同じ）：継ぎ目={seam_c:.2f}（曲の中 中央値={np.median(inner_c):.2f}・最小={min(inner_c):.2f}）")

    if out:
        os.makedirs(out, exist_ok=True)
        write_outputs(out, name, stereo, y, db, onsets, seam_t, near, ioi, beat)


def write_outputs(out, name, stereo, y, db, onsets, seam_t, near, ioi, beat):
    # 2 周分をつなげた wav（耳で聴く用。継ぎ目は 2 周の間）
    two = np.concatenate([stereo, stereo])
    with wave.open(os.path.join(out, f"{name}-loop2.wav"), "wb") as f:
        f.setnchannels(2); f.setsampwidth(2); f.setframerate(SR)
        f.writeframes((np.clip(two, -1, 1) * 32767).astype("<i2").tobytes())
    with open(os.path.join(out, f"{name}-onsets.txt"), "w") as f:
        f.write(f"継ぎ目 {seam_t:.3f} 秒（2 周目の頭）。onset の時刻と、前の onset との間隔（ms）\n")
        prev = None
        for t, s in near:
            f.write(f"{t - seam_t:+8.3f} s  強さ {s:7.1f}  間隔 {'' if prev is None else f'{(t - prev) * 1000:6.0f} ms'}\n")
            prev = t
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        return
    a, b = seam_t - 5, seam_t + 5
    fig, ax = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
    t = np.arange(int(a * SR), int(b * SR)) / SR - seam_t
    ax[0].plot(t, y[int(a * SR) : int(b * SR)], lw=0.3)
    ax[0].set_ylabel("waveform")
    f0, f1 = int(a / FRAME_SEC), int(b / FRAME_SEC)
    ax[1].imshow(db[f0:f1].T, origin="lower", aspect="auto", extent=[-5, 5, 0, db.shape[1]], cmap="magma", vmin=np.percentile(db, 5), vmax=np.percentile(db, 99.8))
    ax[1].set_ylabel("band (log freq)")
    for a_ in ax:
        a_.axvline(0, color="cyan", lw=1)
    sel = (onsets[:, 0] >= a) & (onsets[:, 0] < b)
    ax[0].vlines(onsets[sel, 0] - seam_t, -1, 1, color="red", lw=0.6, alpha=0.6)
    ax[1].set_xlabel("seconds from loop seam (cyan)")
    fig.suptitle(name + "  seam ±5 s (red = onsets)")
    fig.tight_layout()
    fig.savefig(os.path.join(out, f"{name}-seam.png"), dpi=110)
    plt.close(fig)


if __name__ == "__main__":
    args = sys.argv[1:]
    out = None
    if args and args[0] == "--out":
        out, args = args[1], args[2:]
    tracks = load_tracks()
    for p in args:
        check(p, tracks, out)
