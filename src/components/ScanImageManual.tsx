import React, { useMemo } from "react";

/** Manual-edit canvas placeholder with CNN/added/removed dot kinds. */
export function ScanImageManual() {
  const W = 900, H = 560;
  const rand = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
  const dots = useMemo(() => {
    const arr: { x: number; y: number; r: number; rot: number; kind: "cnn" | "added" | "removed" }[] = [];
    for (let i = 0; i < 64; i++) {
      arr.push({
        x: 20 + rand(i * 2.1 + 3) * (W - 40),
        y: 20 + rand(i * 3.3 + 11) * (H - 40),
        r: 5 + rand(i * 5.7 + 5) * 2,
        rot: rand(i * 1.4) * 180,
        kind: i >= 61 ? "added" : i === 17 ? "removed" : "cnn",
      });
    }
    return arr;
  }, []);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <pattern id="paper2" width="160" height="160" patternUnits="userSpaceOnUse">
          <rect width="160" height="160" fill="#F8F5ED" />
          <circle cx="40" cy="60" r="0.5" fill="#D7CFB8" opacity=".5" />
          <circle cx="110" cy="30" r="0.4" fill="#D7CFB8" opacity=".5" />
          <circle cx="140" cy="130" r="0.6" fill="#D7CFB8" opacity=".4" />
        </pattern>
        <radialGradient id="pupa2" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#C9A57C" />
          <stop offset="55%" stopColor="#8F6A3F" />
          <stop offset="100%" stopColor="#4D3418" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#paper2)" />
      {dots.map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${d.y}) rotate(${d.rot})`}>
          <ellipse cx="0" cy="0" rx={d.r * 1.8} ry={d.r * 0.9} fill="url(#pupa2)" />
          <ellipse cx={-d.r * 0.4} cy={-d.r * 0.2} rx={d.r * 0.5} ry={d.r * 0.2} fill="#E6C99A" opacity=".35" />
        </g>
      ))}
      {dots.map((d, i) => {
        if (d.kind === "cnn") {
          return (
            <g key={"c" + i}>
              <circle cx={d.x} cy={d.y} r="5.5" fill="none" stroke="#2BA557" strokeWidth="1.6" />
              <circle cx={d.x} cy={d.y} r="2" fill="#2BA557" />
            </g>
          );
        }
        if (d.kind === "added") {
          return (
            <g key={"a" + i}>
              <circle cx={d.x} cy={d.y} r="7.5" fill="none" stroke="#1F5F6B" strokeWidth="1.8" strokeDasharray="2 2" />
              <circle cx={d.x} cy={d.y} r="2.5" fill="#1F5F6B" />
            </g>
          );
        }
        return (
          <g key={"r" + i}>
            <circle cx={d.x} cy={d.y} r="7" fill="none" stroke="#B4362E" strokeWidth="1.6" />
            <line x1={d.x - 4} y1={d.y - 4} x2={d.x + 4} y2={d.y + 4} stroke="#B4362E" strokeWidth="1.6" strokeLinecap="round" />
            <line x1={d.x - 4} y1={d.y + 4} x2={d.x + 4} y2={d.y - 4} stroke="#B4362E" strokeWidth="1.6" strokeLinecap="round" />
          </g>
        );
      })}
      <g transform={`translate(${W * 0.62} ${H * 0.38})`} opacity=".9">
        <circle r="14" fill="none" stroke="#1F5F6B" strokeWidth="1" strokeDasharray="3 2" />
      </g>
    </svg>
  );
}
