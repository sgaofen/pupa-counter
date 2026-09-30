/**
 * 纸片相对高度（与 sheet_detect.py 里的 sheet_relative_pct 完全同一公式）。
 *
 * corners 顺序: TL, TR, BR, BL（"top" = 靠近图像上方那一端），图像像素坐标，可在图外。
 * 返回: 0 = 下端 (BL-BR 边)，100 = 上端 (TL-TR 边)；点在纸片外时可 <0 或 >100。
 *
 * 公式: pct = d_bottom / (d_bottom + d_top) * 100
 *   d_bottom = 点到直线 BL-BR 的有符号距离（朝上端为正）
 *   d_top    = 点到直线 TL-TR 的有符号距离（朝下端为正）
 * 矩形时等价于“投影到长轴”；用户把角点拖成一般四边形时，点落在上/下边上仍然严格是 100 / 0。
 * 纯函数、O(1)，拖角点时可以每帧对所有蛹重算。
 */
export function sheetRelativePct(corners: [number, number][], x: number, y: number): number {
  if (corners.length !== 4) throw new Error("corners must be [TL, TR, BR, BL]");
  const [[tlx, tly], [trx, try_], [brx, bry], [blx, bly]] = corners;

  // 点 p 到直线 ab 的有符号距离，ref 所在一侧为正
  const sdist = (ax: number, ay: number, bx: number, by: number,
                 px: number, py: number, refx: number, refy: number): number => {
    const nx = -(by - ay), ny = bx - ax;
    const nn = Math.hypot(nx, ny) || 1e-12;
    const d = ((px - ax) * nx + (py - ay) * ny) / nn;
    const dr = (refx - ax) * nx + (refy - ay) * ny;
    return dr >= 0 ? d : -d;
  };

  const cxT = (tlx + trx) / 2, cyT = (tly + try_) / 2;
  const cxB = (blx + brx) / 2, cyB = (bly + bry) / 2;
  const db = sdist(blx, bly, brx, bry, x, y, cxT, cyT);
  const dt = sdist(tlx, tly, trx, try_, x, y, cxB, cyB);
  const den = db + dt;
  if (Math.abs(den) < 1e-9) return 50.0;
  return (100.0 * db) / den;
}
