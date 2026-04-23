// SVG icons ported from the Claude Design HTML.
import React from "react";

const common = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const Icons = {
  logo: (
    <svg viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="5" ry="8" fill="currentColor" opacity=".95" />
      <path d="M9 9c.5-1 1.8-1.6 3-1.6M9.5 12.5h5M9.8 15.8h4.4" stroke="white"
        strokeWidth="0.8" strokeLinecap="round" opacity=".7" />
    </svg>
  ),
  moon: (<svg {...common} strokeWidth="1.6"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>),
  sun: (<svg {...common} strokeWidth="1.6"><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" /></svg>),
  zoomIn: (<svg {...common} strokeWidth="1.6"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3M11 8v6M8 11h6" /></svg>),
  zoomOut: (<svg {...common} strokeWidth="1.6"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3M8 11h6" /></svg>),
  fit: (<svg {...common} strokeWidth="1.6"><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /></svg>),
  undo: (<svg {...common} strokeWidth="1.6"><path d="M9 14l-5-4 5-4M4 10h9a6 6 0 0 1 0 12h-3" /></svg>),
  folder: (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18V7.5z" /></svg>),
  chev: (<svg {...common} strokeWidth="1.6"><path d="M9 6l6 6-6 6" /></svg>),
  search: (<svg {...common} strokeWidth="1.8"><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.3-4.3" /></svg>),
  x: (<svg {...common} strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>),
  excel: (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" fill="currentColor" opacity=".15" />
      <path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  download: (<svg {...common} strokeWidth="1.6"><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></svg>),
  plus: (<svg {...common} strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>),
  check: (<svg {...common} strokeWidth="2"><path d="M5 12l4.5 4.5L19 7" /></svg>),
  arrowRight: (<svg {...common} strokeWidth="1.6"><path d="M5 12h14M13 6l6 6-6 6" /></svg>),
  upArrow: (<svg {...common} strokeWidth="2"><path d="M12 19V5M6 11l6-6 6 6" /></svg>),
  upload: (<svg {...common} strokeWidth="1.3"><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></svg>),
};
