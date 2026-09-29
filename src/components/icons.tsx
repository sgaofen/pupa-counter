import React from "react";

const c = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icons = {
  // A pupa on a strip: the app mark.
  mark: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="6.5" y="1.5" width="11" height="21" rx="1.5" stroke="currentColor" strokeWidth="1.4" opacity=".55" />
      <ellipse cx="12" cy="10" rx="2.6" ry="4.6" fill="currentColor" />
      <ellipse cx="10.6" cy="17.4" rx="1.6" ry="2.6" fill="currentColor" opacity=".6" transform="rotate(-18 10.6 17.4)" />
    </svg>
  ),
  scan: (<svg {...c}><rect x="3" y="12" width="18" height="7" rx="1.5" /><path d="M6 12V5h12v7M3 15.5h18" /></svg>),
  folder: (<svg {...c}><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5z" /></svg>),
  image: (<svg {...c}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M21 16l-5-5-8 8" /></svg>),
  zoomIn: (<svg {...c}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3M11 8v6M8 11h6" /></svg>),
  zoomOut: (<svg {...c}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3M8 11h6" /></svg>),
  fit: (<svg {...c}><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /></svg>),
  undo: (<svg {...c}><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>),
  redo: (<svg {...c}><path d="M15 14l5-5-5-5" /><path d="M20 9H10a6 6 0 0 0 0 12h3" /></svg>),
  revert: (<svg {...c}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></svg>),
  trash: (<svg {...c}><path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3" /></svg>),
  plus: (<svg {...c}><path d="M12 5v14M5 12h14" /></svg>),
  check: (<svg {...c} strokeWidth={2}><path d="M5 12l4.5 4.5L19 7" /></svg>),
  x: (<svg {...c} strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>),
  download: (<svg {...c}><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></svg>),
  table: (<svg {...c}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16" /></svg>),
  search: (<svg {...c}><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3" /></svg>),
  sun: (<svg {...c}><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>),
  moon: (<svg {...c}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>),
  monitor: (<svg {...c}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>),
  sheet: (<svg {...c}><path d="M8 3l9 1.5-2 17-9-1.5z" /></svg>),
  bands: (<svg {...c}><path d="M3 6h18M3 12h18M3 18h18" strokeDasharray="3 2" /></svg>),
  target: (<svg {...c}><circle cx="12" cy="12" r="7" strokeDasharray="3 2" /><circle cx="12" cy="12" r="1.5" fill="currentColor" /></svg>),
  star: (<svg {...c}><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2.5" fill="currentColor" /></svg>),
  keyboard: (<svg {...c}><rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>),
  external: (<svg {...c}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>),
  chevDown: (<svg {...c}><path d="M6 9l6 6 6-6" /></svg>),
  sidebar: (<svg {...c}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></svg>),
  warn: (<svg {...c}><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18h.01" /></svg>),
};

/** Outline of a sheet with a few pupae, for the empty state. */
export function SheetGlyph() {
  return (
    <svg className="sheet-glyph" viewBox="0 0 76 130" fill="none">
      <rect x="10" y="4" width="56" height="122" rx="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="4 3" transform="rotate(3 38 65)" />
      {[[30, 30], [44, 42], [36, 58], [48, 70], [28, 84], [40, 96], [34, 108], [50, 52]].map(([x, y], i) => (
        <ellipse key={i} cx={x} cy={y} rx="3" ry="5.5" fill="currentColor" opacity={0.35 + (i % 3) * 0.2} transform={`rotate(${(i * 37) % 60 - 30} ${x} ${y})`} />
      ))}
    </svg>
  );
}
