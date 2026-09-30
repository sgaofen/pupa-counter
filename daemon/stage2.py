"""Stage 2 for the v5 model: blob counting + false-positive / white-larva filter.

Takes the TinyUNet heatmap, proposes every 3x3 local maximum above cand_thr,
computes 62 features per candidate and lets a HistGradientBoosting classifier
predict whether the candidate holds 0 / 1 / 2 / 3+ pupae. Candidates with
P(>=1) >= t_keep are kept; P(>=2) >= t2 splits the blob into two points along
its long axis (overlapping pupae). box/features/decode are copied verbatim from
pupa-lab/bench/stage2.py (via export/v5_stage2/stage2_infer.py).
"""
from __future__ import annotations

import numpy as np
import cv2
from skimage.feature import peak_local_max

FEAT_NAMES = []


def box(a, x, y, r):
    H, W = a.shape[:2]
    return a[max(0, y - r):min(H, y + r + 1), max(0, x - r):min(W, x + r + 1)]


def features(hm, rgb, cands):
    """每个候选 ~40 维：原 11 维 + 热图形状/质量 + 更大窗口颜色/面积 + 邻居。"""
    global FEAT_NAMES
    n = len(cands)
    if n == 0:
        return np.zeros((0, len(FEAT_NAMES) or 1), np.float32), np.zeros((0, 2), np.float32)
    rgbf = rgb.astype(np.float32)
    r, g, b = rgbf[..., 0], rgbf[..., 1], rgbf[..., 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    yellow = np.clip((np.minimum(r, g) - b - 15) / 60, 0, 1)
    sat = (np.max(rgbf, 2) - np.min(rgbf, 2))
    bg = float(np.median(lum[::7, ::7]))
    dark = (lum < bg - 35).astype(np.float32)
    xy = cands[:, :2]; sc = cands[:, 2]
    D = np.linalg.norm(xy[:, None] - xy[None], axis=2); np.fill_diagonal(D, 1e9)
    Ds = np.sort(D, 1)
    feats, axes = [], []
    H, W = hm.shape
    for i in range(n):
        x, y = int(round(xy[i, 0])), int(round(xy[i, 1]))
        f = {}
        f['score'] = sc[i]
        for rr in (2, 4, 6):
            hb = box(hm, x, y, rr)
            f[f'heat_mean{2*rr+1}'] = hb.mean(); f[f'heat_sum{2*rr+1}'] = hb.sum()
        hb = box(hm, x, y, 7)
        f['heat_std5'] = box(hm, x, y, 2).std()
        for t in (0.3, 0.5):
            f[f'heat_area>{t}'] = float((hb > t).sum()); f[f'heat_area>{t}rel'] = float((hb > t * sc[i]).sum())
        # 热图团块二阶矩（>0.3*峰值）→ 长短轴
        yy, xx = np.nonzero(hb > 0.3 * sc[i])
        w = hb[yy, xx]
        if len(w) > 2:
            cx, cy = (xx * w).sum() / w.sum(), (yy * w).sum() / w.sum()
            cov = np.cov(np.stack([xx - cx, yy - cy]), aweights=w) + 1e-6 * np.eye(2)
            ev, evec = np.linalg.eigh(cov)
            f['blob_major'] = np.sqrt(ev[1]); f['blob_minor'] = np.sqrt(ev[0]); f['blob_elong'] = np.sqrt(ev[1] / ev[0])
            f['blob_offc'] = np.hypot(cx - min(x, 7), cy - min(y, 7))
            axes.append(evec[:, 1])
        else:
            f['blob_major'] = f['blob_minor'] = f['blob_elong'] = f['blob_offc'] = 0.0
            axes.append(np.array([1.0, 0.0]))
        # 二阶导（峰的尖锐度）
        if 1 <= x < W - 1 and 1 <= y < H - 1:
            f['hess_xx'] = hm[y, x - 1] + hm[y, x + 1] - 2 * hm[y, x]; f['hess_yy'] = hm[y - 1, x] + hm[y + 1, x] - 2 * hm[y, x]
        else:
            f['hess_xx'] = f['hess_yy'] = 0.0
        # 颜色
        for rr in (3, 7, 10):
            c = box(rgbf, x, y, rr).reshape(-1, 3).mean(0)
            f[f'R{2*rr+1}'], f[f'G{2*rr+1}'], f[f'B{2*rr+1}'] = c
            f[f'lum{2*rr+1}'] = box(lum, x, y, rr).mean()
            f[f'yellow{2*rr+1}'] = box(yellow, x, y, rr).mean()
            f[f'dark_area{2*rr+1}'] = box(dark, x, y, rr).sum()
        f['lum_min7'] = box(lum, x, y, 3).min(); f['contrast'] = bg - f['lum7']; f['sat9'] = box(sat, x, y, 4).mean()
        f['bg'] = bg
        hsv = cv2.cvtColor(np.ascontiguousarray(box(rgb, x, y, 8)), cv2.COLOR_RGB2HSV).astype(np.float32)
        for rr in (2, 4, 8):   # 白色幼虫：低饱和、高亮度、min(R,G)-B 小
            c = 8 if min(x, y) >= 8 else min(x, y)
            hb2 = hsv[max(0, c - rr):c + rr + 1, max(0, c - rr):c + rr + 1]
            f[f'S{2*rr+1}'] = hb2[..., 1].mean(); f[f'V{2*rr+1}'] = hb2[..., 2].mean()
            f[f'minRG_B{2*rr+1}'] = float((np.minimum(box(r, x, y, rr), box(g, x, y, rr)) - box(b, x, y, rr)).mean())
            f[f'white{2*rr+1}'] = float(((hb2[..., 1] < 40) & (hb2[..., 2] > bg * 0.95)).mean())
        f['yellow_max17'] = box(yellow, x, y, 8).max(); f['blue17'] = float(np.clip((box(b, x, y, 8) - np.maximum(box(r, x, y, 8), box(g, x, y, 8)) - 15) / 60, 0, 1).mean())
        # 邻居
        f['nn1'] = Ds[i, 0] if n > 1 else 99; f['nn2'] = Ds[i, 1] if n > 2 else 99
        f['nn1_score'] = sc[np.argmin(D[i])] if n > 1 else 0
        for rr in (4, 6, 10, 16):
            f[f'n_within{rr}'] = float((D[i] < rr).sum())
        f['edge'] = float(min(x, y, W - 1 - x, H - 1 - y))
        feats.append(list(f.values()))
        if not FEAT_NAMES:
            FEAT_NAMES = list(f.keys())
    return np.asarray(feats, np.float32), np.asarray(axes, np.float32)


def decode(cands, axes, proba, t_keep, t2, t3=None, dist=2.5):
    """proba: (N,4) 对应 0/1/2/3+。返回 (M,3) 点。"""
    out = []
    pk = 1 - proba[:, 0]; p2 = proba[:, 2:].sum(1); p3 = proba[:, 3]
    for i in np.where(pk >= t_keep)[0]:
        x, y, s = cands[i]
        nn = 1 + int(p2[i] >= t2) + int(t3 is not None and p3[i] >= t3)
        ax = axes[i]
        if nn == 1:
            out.append((x, y, pk[i]))
        elif nn == 2:
            out += [(x - dist * ax[0], y - dist * ax[1], pk[i]), (x + dist * ax[0], y + dist * ax[1], pk[i])]
        else:
            out += [(x - 2 * dist * ax[0], y - 2 * dist * ax[1], pk[i]), (x, y, pk[i]), (x + 2 * dist * ax[0], y + 2 * dist * ax[1], pk[i])]
    return np.asarray(out, np.float32).reshape(-1, 3)

def run(hm: np.ndarray, img_rgb: np.ndarray, bundle: dict):
    """Returns (points, suspects): points = [(x, y, p_keep)], suspects = [(x, y, p_keep)]."""
    c = peak_local_max(hm, min_distance=1, threshold_abs=bundle["cand_thr"], exclude_border=False)
    if len(c) == 0:
        return [], []
    cands = np.stack([c[:, 1], c[:, 0], hm[c[:, 0], c[:, 1]]], 1).astype(np.float32)
    X, axes = features(hm, np.ascontiguousarray(img_rgb), cands)
    clf = bundle["clf"]
    p = clf.predict_proba(X)
    P = np.zeros((len(X), 4))
    P[:, clf.classes_] = p
    pts = decode(cands, axes, P, bundle["t_keep"], bundle["t2"], None, bundle["dist"])
    pk = 1 - P[:, 0]
    sus = [(float(cands[i, 0]), float(cands[i, 1]), float(pk[i]))
           for i in np.where((pk >= 0.12) & (pk < bundle["t_keep"]))[0]]
    return [tuple(map(float, q)) for q in pts], sus
