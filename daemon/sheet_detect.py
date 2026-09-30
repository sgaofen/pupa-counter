"""纸片（透明塑料条）边界检测 + 纸片相对高度。

只依赖 numpy + opencv，纯 CPU，1240×1753 单张约 0.28 s（M5 Max）。

接口（软件按此契约集成）:
  detect_sheet(img_bgr, pupae_xy=None) -> dict
  sheet_relative_pct(corners, x, y) -> float      # 0 = 下端, 100 = 上端

方法（详见 REPORT.md）:
  1. 灰度 -> 半分辨率；自动屏蔽扫描仪四周暗边（左侧 6-8px）。
  2. 在 [-10°, +10°] 内以 1° 粗扫、最佳角附近 0.2° 细扫。每个角度把图像旋正，算
     - 取向边缘支持度（竖直边 |gx|、水平边 |gy|，软阈值，±1px 容差）；端边取左/中/右三段的中位数，
       只覆盖部分宽度的胶带、折角被压下去；
     - 拉普拉斯纹理（纸片内有折痕/污渍/蛹，背景光滑；对阴影这种平缓梯度不敏感）；
     用积分图一次性得到任意行区间的列剖面、任意列区间的行剖面。
  3. 交替搜索 (左,右) 与 (上,下) 边对。单边得分 = 边缘支持 + 内外纹理对比；
     边对得分再加：蛹云包含度（边外的蛹扣分）、标准尺寸先验、贯穿线扣分（纸片外侧背景里也有
     同一条横线 = 扫描仪/台面上的线，不是纸边）。
  4. 标准尺寸先验：纸片是统一裁的 1280×~545 px（8.5 英寸长）。候选假设
       A 两端都看得见且间距≈1280；A* 间距不标准（扣分，置信度打折）；
       B/C 一端看得见、另一端按 1280 外推到图外（要求外推端确实落在图外）= 截断。
  5. 上端阴影修正（CIS 扫描时翘起的上端在外侧投下一条 8-10px 暗带）。
  6. 置信度 = 边缘强度 × 备选假设造成的 pct 不确定度 × 尺寸是否标准 × 外推边数 × 纹理 × 蛹包含度。
     < 0.6 建议让用户手动拖角点。
"""
from __future__ import annotations

import math
import numpy as np
import cv2

# ---------------------------------------------------------------- 常量（150 DPI 全分辨率像素）
SCALE = 0.5                 # 内部工作分辨率
# 标准纸片尺寸：金标里 25 张可见两端的纸片长度 1275–1290 px（= 8.5 英寸 @150DPI），宽度 490–560 px。
STD_LENGTH = 1280.0
LENGTH_TOL = 45.0
STD_WIDTH = 545.0
WIDTH_TOL = 65.0
WIDTH_RANGE = (380.0, 760.0)     # 非标准宽度也允许，但扣分
LENGTH_RANGE = (400.0, 1700.0)   # 非标准长度也允许，但扣分
EDGE_SLACK = 12                  # 工作分辨率 px：外推端离可见边界这么近也算“在图外”

# 打分权重
W_TEX = 0.9
W_BRI = 0.0
W_PUP = 2.5
W_LEN_PEN = 1.2
W_LEN_PEN_STRONG = 0.3        # 两端都是强边缘时的非标准尺寸扣分
STRONG_EDGE = 1.1
W_XLINE = 1.5                 # 贯穿线（纸片外侧背景里也有同一条边）的扣分
XL_RAD = 4
XL_NEAR, XL_FAR = 8, 60       # 工作分辨率 px：检查纸片外侧的这段背景
TEX_CLIP = 8.0
ALT_WINDOW = 0.35            # 与最优假设分差小于它的备选假设视为“也说得通”
ALT_SEP = 15                # 工作分辨率 px：两个假设的端点相差超过它才算“不同假设”
BG_MIN = 110.0              # 背景中位灰度低于它 -> 不是正常扫描（空扫描、黑盖板）
TRUNC_SCORE = 0.75           # 截断端（外推）的得分，相当于“较弱的真实边缘”


# ---------------------------------------------------------------- 工具
def _box_mean_1d(prof: np.ndarray, a: int, b: int) -> np.ndarray:
    """对每个位置 c，返回 prof[c+a : c+b] 的均值（a<b，可为负）；越界部分取 nan-safe 截断。"""
    n = len(prof)
    cs = np.concatenate([[0.0], np.cumsum(np.nan_to_num(prof))])
    cnt = np.concatenate([[0.0], np.cumsum(~np.isnan(prof))])
    idx = np.arange(n)
    lo = np.clip(idx + a, 0, n)
    hi = np.clip(idx + b, 0, n)
    s = cs[hi] - cs[lo]
    k = cnt[hi] - cnt[lo]
    out = np.full(n, np.nan)
    ok = k > 0.5 * (b - a)
    out[ok] = s[ok] / k[ok]
    return out


def _valid_mask(g: np.ndarray) -> np.ndarray:
    """屏蔽图像四周扫描仪的暗边（左侧通常 6-8px 全分辨率）。"""
    h, w = g.shape
    valid = np.ones((h, w), np.uint8)
    med = float(np.median(g))
    colmed = np.median(g, axis=0)
    rowmed = np.median(g, axis=1)
    lim = max(8, int(0.04 * w))
    thr = med - 18
    i = 0
    while i < lim and colmed[i] < thr:
        i += 1
    valid[:, :i + 2] = 0
    i = 0
    while i < lim and colmed[w - 1 - i] < thr:
        i += 1
    valid[:, w - 1 - i - 1:] = 0
    lim = max(8, int(0.04 * h))
    i = 0
    while i < lim and rowmed[i] < thr:
        i += 1
    valid[:i + 1, :] = 0
    i = 0
    while i < lim and rowmed[h - 1 - i] < thr:
        i += 1
    valid[h - 1 - i:, :] = 0
    return valid


class _Rot:
    """某一角度下旋正后的特征与积分图。"""

    def __init__(self, G, valid, theta, gthr):
        h, w = G.shape
        c = (w / 2.0, h / 2.0)
        M = cv2.getRotationMatrix2D(c, theta, 1.0)
        cos, sin = abs(M[0, 0]), abs(M[0, 1])
        W2 = int(math.ceil(h * sin + w * cos)) + 2
        H2 = int(math.ceil(h * cos + w * sin)) + 2
        M[0, 2] += W2 / 2.0 - c[0]
        M[1, 2] += H2 / 2.0 - c[1]
        self.M = M
        self.Minv = cv2.invertAffineTransform(M)
        self.W2, self.H2 = W2, H2
        R = cv2.warpAffine(G, M, (W2, H2), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        V = cv2.warpAffine(valid * 255, M, (W2, H2), flags=cv2.INTER_NEAREST, borderValue=0) > 0
        Ve = cv2.erode(V.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
        gx = cv2.Sobel(R, cv2.CV_32F, 1, 0, ksize=3) / 8.0
        gy = cv2.Sobel(R, cv2.CV_32F, 0, 1, ksize=3) / 8.0
        ax, ay = np.abs(gx), np.abs(gy)
        t0, t1 = gthr
        ex = np.clip((ax - t0) / (t1 - t0), 0, 1) * (ax > 0.7 * ay)
        ey = np.clip((ay - t0) / (t1 - t0), 0, 1) * (ay > 0.7 * ax)
        ex = cv2.dilate(ex, np.ones((1, 3), np.uint8))
        ey = cv2.dilate(ey, np.ones((3, 1), np.uint8))
        # 纹理用拉普拉斯（对阴影这种平缓亮度梯度不敏感）
        lap = np.abs(cv2.Laplacian(R, cv2.CV_32F, ksize=3))
        tex = cv2.blur(np.minimum(lap, TEX_CLIP), (5, 5))
        vf = Ve.astype(np.float32)
        ex *= vf
        ey *= vf
        tex *= vf
        Rv = R * vf
        self.V = Ve
        # 2D 积分图（cv2.integral 比 numpy cumsum 快很多）；列剖面/行剖面都由它差分得到
        self.S_ex = cv2.integral(ex, sdepth=cv2.CV_64F)
        self.S_ey = cv2.integral(ey, sdepth=cv2.CV_64F)
        self.S_t = cv2.integral(tex, sdepth=cv2.CV_64F)
        self.S_i = cv2.integral(Rv, sdepth=cv2.CV_64F)
        self.S_v = cv2.integral(vf, sdepth=cv2.CV_64F)

    def col_profiles(self, t, b):
        t = int(np.clip(t, 0, self.H2)); b = int(np.clip(b, t + 1, self.H2))
        d = lambda S: np.diff(S[b] - S[t])
        n = d(self.S_v)
        ok = n > 0.3 * (b - t)
        with np.errstate(invalid='ignore', divide='ignore'):
            E = np.where(ok, d(self.S_ex) / n, np.nan)
            T = np.where(ok, d(self.S_t) / n, np.nan)
            I = np.where(ok, d(self.S_i) / n, np.nan)
        return E, T, I

    def row_profiles(self, l, r, split=True):
        l = int(np.clip(l, 0, self.W2)); r = int(np.clip(r, l + 1, self.W2))
        d = lambda S: np.diff(S[:, r] - S[:, l])
        n = d(self.S_v)
        ok = n > 0.3 * (r - l)
        with np.errstate(invalid='ignore', divide='ignore'):
            E = np.where(ok, d(self.S_ey) / n, np.nan)
            if split and r - l >= 30:
                # 端边必须横贯整个宽度：分左/中/右三段，取三段支持度的中位数
                # （胶带、折角只覆盖一部分宽度，会被压下去）
                cuts = np.linspace(l, r, 4).round().astype(int)
                parts = []
                for a, b in zip(cuts[:-1], cuts[1:]):
                    nn = np.diff(self.S_v[:, b] - self.S_v[:, a])
                    parts.append(np.where(nn > 0.3 * (b - a), np.diff(self.S_ey[:, b] - self.S_ey[:, a]) / nn, 0.0))
                E = np.where(ok, np.median(np.vstack(parts), axis=0), np.nan)
            T = np.where(ok, d(self.S_t) / n, np.nan)
            I = np.where(ok, d(self.S_i) / n, np.nan)
        return E, T, I


def _side_scores(E, T, I, d_in=(3, 14), d_bri=(2, 8)):
    """对剖面上每个位置 c 计算“作为起始边(内侧在 +方向)”和“作为终止边(内侧在 -方向)”的得分。
    返回 (S_start, S_end, outside_invalid_start, outside_invalid_end)。"""
    a, b = d_in
    Tin_s = _box_mean_1d(T, a, b)          # 起始边：内侧在后面
    Tout_s = _box_mean_1d(T, -b, -a + 1)
    Tin_e = Tout_s
    Tout_e = Tin_s
    a2, b2 = d_bri
    Iin_s = _box_mean_1d(I, a2, b2)
    Iout_s = _box_mean_1d(I, -b2, -a2 + 1)
    E0 = np.nan_to_num(E)
    # 取 ±1 容差
    E0 = np.maximum(E0, np.maximum(np.roll(E0, 1), np.roll(E0, -1)) * 0.85)

    def one(Tin, Tout, Iin, Iout):
        with np.errstate(invalid='ignore', divide='ignore'):
            ts = np.clip(1.0 - Tout / (Tin + 0.15), -1, 1)
            bs = np.clip((Iout - Iin) / 5.0, -1, 1)
        out_invalid = np.isnan(Tout) & ~np.isnan(Tin)
        ts = np.where(out_invalid, 0.0, np.nan_to_num(ts, nan=-1.0))
        bs = np.where(out_invalid, 0.0, np.nan_to_num(bs, nan=0.0))
        s = E0 + W_TEX * ts + W_BRI * bs
        return s, out_invalid

    Ss, inv_s = one(Tin_s, Tout_s, Iin_s, Iout_s)
    Se, inv_e = one(Tout_s, Tin_s, Iout_s, Iin_s)
    return Ss, Se, inv_s, inv_e


def _best_pair(Ss, Se, inv_s, inv_e, ext, std_len, tol, free_range, pts=None):
    """一维上找最佳 (start, end) 边对，带“标准尺寸”先验。
    候选:
      A 两端都是真实边缘，间距 ∈ [std-tol, std+tol]；
      A' 两端真实但间距不标准（free_range 内）—— 扣 W_LEN_PEN；
      B start 真实、end 截断：end 由 start+std 外推，要求外推位置确实在可见范围之外；
      C end 真实、start 截断：同理。
    ext = (first_valid, last_valid)。pts = 该轴上的蛹坐标。
    返回 dict(start, end, score, sv, ev, s_start, s_end)，sv/ev = 该端是截断（外推）的。"""
    n = len(Ss)
    f, l = ext
    Ss = Ss.copy(); Se = Se.copy()
    Ss[:f] = -9; Se[l + 1:] = -9
    Ss[l + 1:] = -9; Se[:f] = -9
    idx = np.arange(n)
    if pts is not None and len(pts) >= 3:
        p = np.sort(np.asarray(pts))
        before = np.searchsorted(p, idx - 2, side='left') / len(p)
        after = 1.0 - np.searchsorted(p, idx + 2, side='right') / len(p)
    else:
        before = np.zeros(n); after = np.zeros(n)
    A = Ss - W_PUP * before
    B = Se - W_PUP * after
    std = int(round(std_len)); tol = int(round(tol))
    cands = []   # (score, start, end, sv, ev, s_start, s_end, kind)

    def topk(arr, k=4, sep=8):
        arr = arr.copy(); out = []
        for _ in range(k):
            j = int(np.argmax(arr))
            if arr[j] < -1e8:
                break
            out.append(j)
            arr[max(0, j - sep):j + sep + 1] = -1e9
        return out

    def pair_search(lo, hi, pen, kind):
        lo = max(1, int(lo)); hi = min(int(hi), n - 1)
        if hi < lo:
            return
        K = hi - lo + 1
        AA, BB = A, B
        if pen > 0:
            # 非标准尺寸：两端都是强边缘时只小扣分（可能真是别的尺寸的纸片），弱边缘大扣分
            AA = A - np.where(Ss >= STRONG_EDGE, W_LEN_PEN_STRONG, pen) / 2
            BB = B - np.where(Se >= STRONG_EDGE, W_LEN_PEN_STRONG, pen) / 2
        Ap = np.concatenate([np.full(hi, -1e9), AA])
        win = np.lib.stride_tricks.sliding_window_view(Ap, K)[:n]
        am = np.argmax(win, axis=1)
        tot = win[np.arange(n), am] + BB
        for j in topk(tot):
            i = j - hi + int(am[j])
            cands.append((float(tot[j]), i, j, bool(inv_s[i]), bool(inv_e[j]), float(Ss[i]), float(Se[j]), kind))

    pair_search(std - tol, std + tol, 0.0, 'A')
    pair_search(free_range[0], std - tol - 1, W_LEN_PEN, 'A*')
    pair_search(std + tol + 1, free_range[1], W_LEN_PEN, 'A*')
    # B: start 真实，end 外推到 start+std，要求外推端在可见范围外（允许 EDGE_SLACK 的贴边）
    okB = (idx + std + tol >= l - EDGE_SLACK) & (idx >= f)
    if np.any(okB):
        sc = np.where(okB, A + TRUNC_SCORE, -1e9)
        for i in topk(sc):
            cands.append((float(sc[i]), i, max(i + std, l), bool(inv_s[i]), True, float(Ss[i]), TRUNC_SCORE, 'B'))
    okC = (idx - std - tol <= f + EDGE_SLACK) & (idx <= l)
    if np.any(okC):
        sc = np.where(okC, B + TRUNC_SCORE, -1e9)
        for j in topk(sc):
            cands.append((float(sc[j]), min(j - std, f), j, True, bool(inv_e[j]), TRUNC_SCORE, float(Se[j]), 'C'))
    if not cands:
        return dict(score=-9.0, start=f, end=l, sv=True, ev=True, s_start=0.0, s_end=0.0, kind='none', margin=0.0,
                    altShift=0.0, unc=0.0, alt=None)
    cands.sort(key=lambda c: -c[0])
    c0 = cands[0]
    # 次优的“不同假设”（任一端位置相差 > ALT_SEP）的分差 —— 用于置信度
    alt = [c for c in cands[1:] if abs(c[1] - c0[1]) > ALT_SEP or abs(c[2] - c0[2]) > ALT_SEP]
    margin = c0[0] - (alt[0][0] if alt else c0[0] - 2.0)
    # 分差 < ALT_WINDOW 的备选假设里，端点最大位移（工作分辨率 px）—— 用于估计 pct 的不确定度
    close = [c for c in alt if c0[0] - c[0] < ALT_WINDOW]
    shift = max([max(abs(c[1] - c0[1]), abs(c[2] - c0[2])) for c in close], default=0.0)
    # 不确定度 = 备选假设的端点位移 × 它“有多说得通”（分差越小权重越大）
    unc = max([max(abs(c[1] - c0[1]), abs(c[2] - c0[2])) * (1 - (c0[0] - c[0]) / ALT_WINDOW) for c in close],
              default=0.0)
    return dict(score=c0[0], start=c0[1], end=c0[2], sv=c0[3], ev=c0[4], s_start=c0[5], s_end=c0[6],
                kind=c0[7], margin=float(margin), altShift=float(shift), unc=float(unc),
                alt=(alt[0][1], alt[0][2], alt[0][0], alt[0][7]) if alt else None)


def _nz(a, rad=XL_RAD):
    """nan->0，再取 ±rad 的滑动最大（贯穿线相对纸片可能倾斜，外侧同一条线会错开几行）。"""
    a = np.nan_to_num(a, nan=0.0).astype(np.float32)
    return cv2.dilate(a.reshape(1, -1), np.ones((1, 2 * rad + 1), np.uint8)).ravel()


def _extent(valid_prof):
    ok = np.where(valid_prof)[0]
    if len(ok) == 0:
        return 0, len(valid_prof) - 1
    return int(ok[0]), int(ok[-1])


def _fit_at_angle(rot, pts_r, s, n_iter=3):
    """在某个旋正角度下交替搜索 (l,r) 与 (t,b)。pts_r: 旋转后的蛹坐标 (N,2)，工作分辨率。"""
    if pts_r is not None and len(pts_r) >= 5:
        t = np.percentile(pts_r[:, 1], 10); b = np.percentile(pts_r[:, 1], 90)
        if b - t < 80 * s:
            m = (t + b) / 2; t, b = m - 40 * s, m + 40 * s
    else:
        rows = np.where(rot.V.any(1))[0]
        t = rows[0] + 0.3 * (rows[-1] - rows[0]); b = rows[0] + 0.7 * (rows[-1] - rows[0])
    px = None if pts_r is None else pts_r[:, 0]
    py = None if pts_r is None else pts_r[:, 1]
    res = None
    for it in range(n_iter):
        E, T, I = rot.col_profiles(t, b)
        Ss, Se, inv_s, inv_e = _side_scores(E, T, I)
        LR = _best_pair(Ss, Se, inv_s, inv_e, _extent(~np.isnan(E)), STD_WIDTH * s, WIDTH_TOL * s,
                        (WIDTH_RANGE[0] * s, WIDTH_RANGE[1] * s), px)
        l, r = LR['start'], LR['end']
        # 行剖面只用可见的列
        lv, rv = max(l, 0), min(r, rot.W2 - 1)
        m = max(3, int(0.06 * (rv - lv)))
        E, T, I = rot.row_profiles(lv + m, rv - m)
        Ss, Se, inv_s, inv_e = _side_scores(E, T, I)
        # 贯穿整幅图宽的横线（扫描仪盖板边、台面划痕）在纸片左右两侧背景里也有边缘 —— 纸片端边不会
        xo = np.minimum(_nz(rot.row_profiles(l - XL_FAR, l - XL_NEAR, split=False)[0]),
                        _nz(rot.row_profiles(r + XL_NEAR, r + XL_FAR, split=False)[0]))
        xo = W_XLINE * np.clip((xo - 0.3) / 0.4, 0, 1)   # 两侧都要有连续的线（>30% 支持）才算贯穿线
        Ss = Ss - xo; Se = Se - xo
        TB = _best_pair(Ss, Se, inv_s, inv_e, _extent(~np.isnan(E)), STD_LENGTH * s, LENGTH_TOL * s,
                        (LENGTH_RANGE[0] * s, LENGTH_RANGE[1] * s), py)
        t, b = TB['start'], TB['end']
        res = dict(l=l, r=r, t=t, b=b, score=LR['score'] + TB['score'], lv=LR['sv'], rv=LR['ev'],
                   tv=TB['sv'], bv=TB['ev'], sl=LR['s_start'], sr=LR['s_end'], st=TB['s_start'],
                   sb=TB['s_end'], kindLR=LR['kind'], kindTB=TB['kind'],
                   marginLR=LR['margin'], marginTB=TB['margin'],
                   altShiftTB=TB['altShift'], altShiftLR=LR['altShift'], altTB=TB['alt'],
                   uncTB=TB['unc'], uncLR=LR['unc'])
        # 下一轮列剖面用纸片内部、且在图内的行
        f, la = _extent(rot.V.any(1))
        tt, bb = max(t, f), min(b, la)
        mm = 0.05 * (bb - tt)
        t, b = tt + mm, bb - mm
    return res


def _to_orig(rot, x, y, s):
    p = rot.Minv @ np.array([x, y, 1.0])
    return p[0] / s, p[1] / s


def detect_sheet(img_bgr: np.ndarray, pupae_xy=None) -> dict:
    h0, w0 = img_bgr.shape[:2]
    g = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY) if img_bgr.ndim == 3 else img_bgr
    # 常量都按 150 DPI 定义。整页扫描按宽度推算 DPI 并换算（1240 宽 -> 150，2480/2550 宽 -> 300），
    # 这样以后真 300 DPI 也能直接用；其他尺寸按 150 DPI 处理。
    dpi_f = 1.0
    if 1.30 <= h0 / w0 <= 1.50:    # A4 / Letter 整页：宽约 8.3–8.5 英寸，就近取常见 DPI
        dpi_est = w0 / 8.4
        dpi = min((75, 100, 150, 200, 300, 400, 600, 1200), key=lambda d: abs(d - dpi_est))
        dpi_f = dpi / 150.0
    s = SCALE / dpi_f
    G = cv2.resize(g, (int(round(w0 * s)), int(round(h0 * s))), interpolation=cv2.INTER_AREA).astype(np.float32)
    G = cv2.GaussianBlur(G, (0, 0), 0.8)
    valid = _valid_mask(G)
    # 自适应梯度阈值：以有效区域梯度幅值中位数为噪声尺度
    gx = cv2.Sobel(G, cv2.CV_32F, 1, 0, ksize=3) / 8.0
    gy = cv2.Sobel(G, cv2.CV_32F, 0, 1, ksize=3) / 8.0
    mag = np.hypot(gx, gy)[valid > 0]
    nz = float(np.median(mag))
    gthr = (max(0.6, 2.0 * nz), max(1.6, 5.0 * nz))
    pts = None
    if pupae_xy is not None and len(pupae_xy) > 0:
        pts = np.asarray(pupae_xy, np.float64).reshape(-1, 2) * s

    def run(theta):
        rot = _Rot(G, valid, theta, gthr)
        pr = None
        if pts is not None:
            pr = (rot.M[:, :2] @ pts.T).T + rot.M[:, 2]
        return rot, _fit_at_angle(rot, pr, SCALE)   # 常量按 150 DPI -> 工作分辨率换算

    cands = {}
    for th in np.arange(-10, 10.01, 1.0):
        cands[round(float(th), 2)] = run(th)
    ranked = sorted(cands.items(), key=lambda kv: -kv[1][1]['score'])
    th0 = ranked[0][0]
    for th in np.arange(th0 - 0.8, th0 + 0.81, 0.2):
        k = round(float(th), 2)
        if k not in cands and -10.5 <= k <= 10.5:
            cands[k] = run(k)
    ranked = sorted(cands.items(), key=lambda kv: -kv[1][1]['score'])
    theta, (rot, res) = ranked[0]
    l, r, t, b = res['l'], res['r'], res['t'], res['b']
    # 上端阴影修正：CIS 扫描时翘起的上端会在纸片外侧投下一条暗带（约 8-10px），
    # 边缘检测常落在暗带的外沿；真实纸边在暗带最暗处附近。检测到暗带就把上端移到暗带最暗处 +1。
    if not res['tv']:
        lv, rv = max(l, 0), min(r, rot.W2 - 1)
        m = max(3, int(0.1 * (rv - lv)))
        _, _, I = rot.row_profiles(lv + m, rv - m)
        ti = int(round(t))
        if ti - 4 >= 0 and ti + 15 < len(I) and not np.any(np.isnan(I[ti - 4:ti + 15])):
            seg = I[ti:ti + 8]
            k = int(np.argmin(seg))
            out_lvl = float(np.mean(I[ti - 4:ti - 1]))
            in_lvl = float(np.mean(I[ti + 10:ti + 15]))
            if out_lvl - seg[k] >= 4 and in_lvl - seg[k] >= 2 and k >= 1:
                t = ti + k + 1
                res['t'] = t
                res['shadowShift'] = (k + 1) / s

    # 区域纹理对比：纸片内部（有折痕、污渍、蛹）比外面的扫描床背景“花”得多
    T = rot.S_t; V = rot.S_v
    def rect_mean(S, x0, y0, x1, y1):
        x0 = int(np.clip(x0, 0, rot.W2)); x1 = int(np.clip(x1, 0, rot.W2))
        y0 = int(np.clip(y0, 0, rot.H2)); y1 = int(np.clip(y1, 0, rot.H2))
        if x1 <= x0 or y1 <= y0:
            return 0.0
        return float(S[y1, x1] - S[y0, x1] - S[y1, x0] + S[y0, x0])
    mg = int(0.08 * (r - l))
    ti, bi = t + mg, b - mg
    li, ri = l + mg, r - mg
    tin = rect_mean(T, li, ti, ri, bi); vin = rect_mean(V, li, ti, ri, bi)
    rg = int(40 * SCALE)
    tall = rect_mean(T, l - rg, t - rg, r + rg, b + rg); vall = rect_mean(V, l - rg, t - rg, r + rg, b + rg)
    tsh = rect_mean(T, l, t, r, b); vsh = rect_mean(V, l, t, r, b)
    t_out = (tall - tsh) / max(vall - vsh, 1.0)
    t_in = tin / max(vin, 1.0)
    res['texIn'] = t_in; res['texOut'] = t_out
    res['texRatio'] = t_in / (t_out + 0.05)

    # 回到原图坐标
    TL = _to_orig(rot, l, t, s); TR = _to_orig(rot, r, t, s)
    BR = _to_orig(rot, r, b, s); BL = _to_orig(rot, l, b, s)
    width = (r - l) / s
    length = (b - t) / s
    trunc_top, trunc_bot = res['tv'], res['bv']
    trunc_left, trunc_right = res['lv'], res['rv']

    corners = [list(map(float, TL)), list(map(float, TR)), list(map(float, BR)), list(map(float, BL))]
    top_mid = ((TL[0] + TR[0]) / 2, (TL[1] + TR[1]) / 2)
    bot_mid = ((BL[0] + BR[0]) / 2, (BL[1] + BR[1]) / 2)
    angle = math.degrees(math.atan2(top_mid[0] - bot_mid[0], bot_mid[1] - top_mid[1]))
    L = math.hypot(top_mid[0] - bot_mid[0], top_mid[1] - bot_mid[1])
    Wd = math.hypot(TR[0] - TL[0], TR[1] - TL[1])

    # ---- 置信度（0-1）。低于 ~0.5 时软件应提示用户手动拖角点。
    def q(v, lo, hi):
        return float(np.clip((v - lo) / (hi - lo), 0, 1))
    V_END = 0.8   # 截断端（按标准长度外推）本身的可信度
    ends = [V_END if trunc_top else q(res['st'], 0.4, 1.2), V_END if trunc_bot else q(res['sb'], 0.4, 1.2)]
    sides = [V_END if trunc_left else q(res['sl'], 0.4, 1.2), V_END if trunc_right else q(res['sr'], 0.4, 1.2)]
    c_edge = 0.6 * float(np.mean(ends)) + 0.4 * float(np.mean(sides))
    # 备选假设带来的 pct 不确定度（百分点）：换成次优但也说得通的端点，pct 会变多少
    unc_pp = res['uncTB'] / SCALE / STD_LENGTH * 100.0
    c_alt = 1.0 - q(unc_pp, 1.0, 6.0)
    # 非标准尺寸（没有落在标准长度/宽度窗口里）
    c_std = (0.55 if res['kindTB'] == 'A*' else 1.0) * (0.8 if res['kindLR'] == 'A*' else 1.0)
    # 截断端（按标准长度外推）越多证据越少；左右边在图外对 pct 几乎没影响，只轻扣
    n_virt_end = int(trunc_top) + int(trunc_bot)
    n_virt_side = int(trunc_left) + int(trunc_right)
    c_virt = (1.0, 0.9, 0.2)[n_virt_end] * (1.0, 0.95, 0.4)[n_virt_side]
    # 区域纹理：纸片内部应至少和外圈一样“花”（背景是光滑的扫描床）
    c_tex = 0.2 + 0.8 * q(res['texRatio'], 0.25, 0.6)
    conf = c_edge * c_alt * c_std * c_virt * c_tex
    if pts is not None and len(pts) >= 5:
        inside = float(np.mean([0 <= sheet_relative_pct([TL, TR, BR, BL], x / s, y / s) <= 100 and
                                -30 * dpi_f <= _lat_pos([TL, TR, BR, BL], x / s, y / s) <= Wd + 30 * dpi_f for x, y in pts]))
        conf *= 0.3 + 0.7 * q(inside, 0.8, 0.97)
        res['pupaeInside'] = inside
    # 空扫描/盖板没盖好：正常扫描床背景很亮（中位灰度 ~200+），纸片也只比背景暗 5-15 级。
    # 整张图偏暗（中位 < BG_MIN）说明根本不是“扫描床+纸片”的图 -> 判没找到。
    bg_med = float(np.median(G[valid > 0])) if np.any(valid) else 0.0
    c_bg = q(bg_med, BG_MIN, BG_MIN + 40)
    conf *= c_bg
    # 明确传入“0 个蛹”：没有蛹云佐证（也没有需要算高度的蛹），置信度打折
    if pupae_xy is not None and len(pupae_xy) == 0:
        conf *= 0.6
    res.update(bgMedian=bg_med, c_bg=c_bg)
    res.update(c_edge=c_edge, c_alt=c_alt, c_std=c_std, c_virt=c_virt, c_tex=c_tex, unc_pp=unc_pp)
    found = conf > 0.2 and c_bg > 0
    return {"found": bool(found), "corners": corners, "angleDeg": float(angle),
            "lengthPx": float(L), "widthPx": float(Wd),
            "truncatedTop": bool(trunc_top), "truncatedBottom": bool(trunc_bot),
            "confidence": float(np.clip(conf, 0, 1)), "method": "rotproj-v2",
            "_debug": _jsonable({"theta": theta, **res,
                                 "truncLeft": bool(trunc_left), "truncRight": bool(trunc_right),
                                 "visLength": float(length), "visWidth": float(width)})}


def _jsonable(o):
    """把调试信息里的 numpy 标量/元组转成可 JSON 序列化的纯 Python 类型。"""
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    if isinstance(o, (bool, np.bool_)):
        return bool(o)
    if isinstance(o, (int, np.integer)):
        return int(o)
    if isinstance(o, (float, np.floating)):
        return float(o)
    return o


def _lat_pos(corners, x, y):
    """点沿纸片短轴的位置（px，0 = 左边 TL-BL）。仅用于置信度里的“蛹是否在纸片内”。"""
    TL, TR, BR, BL = [np.asarray(c, float) for c in corners]
    u = (TR + BR) / 2 - (TL + BL) / 2
    u /= (np.linalg.norm(u) + 1e-9)
    return float(np.dot(np.array([x, y]) - (TL + BL) / 2, u))


def sheet_relative_pct(corners, x: float, y: float) -> float:
    """点在纸片长轴上的相对位置：0 = 下端(BL-BR 边)，100 = 上端(TL-TR 边)。
    对任意四边形：pct = d_bottom / (d_bottom + d_top) * 100，
    d_bottom = 点到 BL-BR 直线的有符号距离（朝上端为正），d_top = 点到 TL-TR 直线的有符号距离（朝下端为正）。
    矩形时等价于投影到长轴。点在纸片外时可以 <0 或 >100。"""
    (tlx, tly), (trx, try_), (brx, bry), (blx, bly) = [tuple(map(float, c)) for c in corners]

    def sdist(ax, ay, bx, by, px, py, refx, refy):
        # 点 p 到直线 ab 的有符号距离，ref 所在一侧为正
        nx, ny = -(by - ay), (bx - ax)
        nn = math.hypot(nx, ny) or 1e-12
        d = ((px - ax) * nx + (py - ay) * ny) / nn
        dr = (refx - ax) * nx + (refy - ay) * ny
        return d if dr >= 0 else -d

    cx_t, cy_t = (tlx + trx) / 2, (tly + try_) / 2
    cx_b, cy_b = (blx + brx) / 2, (bly + bry) / 2
    db = sdist(blx, bly, brx, bry, x, y, cx_t, cy_t)
    dt = sdist(tlx, tly, trx, try_, x, y, cx_b, cy_b)
    den = db + dt
    if abs(den) < 1e-9:
        return 50.0
    return 100.0 * db / den
