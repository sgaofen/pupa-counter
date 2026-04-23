import React, { useMemo } from "react";

/**
 * SVG placeholder rendering of a pupa scan. Matches the Claude Design
 * mockup; swap for a real PNG <img /> once the scanner adapter lands.
 */
export function ScanImage({ variant }: { variant: "empty" | "processing" | "detected" }) {
  const W = 600, H = 380;
  const rand = (seed: number) => { const x = Math.sin(seed) * 10000; return x - Math.floor(x); };
  const dots = useMemo(() => {
    const arr: { x: number; y: number; r: number; rot: number }[] = [];
    for (let i = 0; i < 62; i++) {
      arr.push({
        x: 20 + rand(i * 2.3 + 1) * (W - 40),
        y: 20 + rand(i * 3.7 + 9) * (H - 40),
        r: 4 + rand(i * 5.1 + 17) * 2,
        rot: rand(i * 1.9) * 180,
      });
    }
    return arr;
  }, []);
  const bandY5 = H * 0.05, bandY25 = H * 0.25, bandY75 = H * 0.75;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "100%", display: "block" }}>
      <defs>
        <pattern id="paper" width="140" height="140" patternUnits="userSpaceOnUse">
          <rect width="140" height="140" fill="#F5F1E6" />
          <circle cx="30" cy="42" r="0.5" fill="#D7CFB8" opacity=".5" />
          <circle cx="80" cy="18" r="0.4" fill="#D7CFB8" opacity=".5" />
          <circle cx="110" cy="100" r="0.6" fill="#D7CFB8" opacity=".4" />
          <circle cx="50" cy="120" r="0.4" fill="#D7CFB8" opacity=".5" />
        </pattern>
        <radialGradient id="pupa" cx="40%" cy="35%" r="70%">
          <stop offset="0%" stopColor="#C9A57C" />
          <stop offset="55%" stopColor="#8F6A3F" />
          <stop offset="100%" stopColor="#4D3418" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#paper)" />
      {dots.map((d, i) => (
        <g key={i} transform={`translate(${d.x} ${d.y}) rotate(${d.rot})`}>
          <ellipse cx="0" cy="0" rx={d.r * 1.7} ry={d.r * 0.85} fill="url(#pupa)" />
          <ellipse cx={-d.r * 0.4} cy={-d.r * 0.2} rx={d.r * 0.5} ry={d.r * 0.2} fill="#E6C99A" opacity=".35" />
        </g>
      ))}
      {variant !== "empty" && (
        <g>
          <line x1="0" x2={W} y1={bandY5} y2={bandY5} stroke="#B4362E" strokeWidth="1" strokeDasharray="4 3" opacity=".75" />
          <text x="8" y={bandY5 - 4} fontSize="9" fill="#B4362E" fontFamily="ui-monospace, monospace" fontWeight="600">RANK 5%</text>
          <line x1="0" x2={W} y1={bandY25} y2={bandY25} stroke="#C77A1D" strokeWidth="1" strokeDasharray="4 3" opacity=".75" />
          <text x="8" y={bandY25 - 4} fontSize="9" fill="#C77A1D" fontFamily="ui-monospace, monospace" fontWeight="600">RANK 25%</text>
          <line x1="0" x2={W} y1={bandY75} y2={bandY75} stroke="#C77A1D" strokeWidth="1" strokeDasharray="4 3" opacity=".75" />
          <text x="8" y={bandY75 - 4} fontSize="9" fill="#C77A1D" fontFamily="ui-monospace, monospace" fontWeight="600">RANK 75%</text>
        </g>
      )}
      {variant === "detected" && dots.map((d, i) => (
        <g key={"g" + i}>
          <circle cx={d.x} cy={d.y} r="4.5" fill="none" stroke="#2BA557" strokeWidth="1.5" />
          <circle cx={d.x} cy={d.y} r="1.8" fill="#2BA557" />
        </g>
      ))}
    </svg>
  );
}
