"use client";

/**
 * Generated marks and photos for the fictional airlines and hotels.
 *
 * These are inline SVG derived from the name, so there are no image files to
 * host, nothing to load over the network, and no chance of borrowing a real
 * brand by accident. A fictional carrier gets a fictional mark by construction.
 *
 * Hotel photos are still gated on `imageUrl`. When `safeUrls` strips a URL from
 * an unapproved host the photo disappears, which is the behaviour the demo is
 * there to show, so the placeholder must not paper over it.
 */

/** Stable hue from a name, so a given airline always looks the same. */
function hue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

export function AirlineMark({ name, size = 32 }: { name: string; size?: number }) {
  const h = hue(name);
  const id = `am-${h}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={`${name} logo`}
      className="shrink-0"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={`hsl(${h} 62% 46%)`} />
          <stop offset="100%" stopColor={`hsl(${(h + 38) % 360} 58% 34%)`} />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${id})`} />
      <text
        x="16"
        y="16"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="13"
        fontWeight="600"
        fill="white"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        {initials(name)}
      </text>
    </svg>
  );
}

/**
 * A generated stand-in for a hotel photograph. Deterministic from the name, so
 * the four cards look distinct from each other and stable across reloads.
 */
export function HotelPhoto({ name, alt }: { name: string; alt: string }) {
  const h = hue(name);
  const id = `hp-${h}`;
  const roofs = [0, 1, 2].map((i) => ({
    x: 6 + i * 36,
    w: 28,
    y: 46 + ((hue(name + i) % 18) - 9),
  }));

  return (
    <svg
      viewBox="0 0 112 80"
      role="img"
      aria-label={alt || name}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={`hsl(${h} 54% 74%)`} />
          <stop offset="100%" stopColor={`hsl(${(h + 24) % 360} 46% 52%)`} />
        </linearGradient>
      </defs>
      <rect width="112" height="80" fill={`url(#${id})`} />
      <circle cx="88" cy="18" r="9" fill="white" opacity="0.35" />
      {roofs.map((r, i) => (
        <g key={i}>
          <rect x={r.x} y={r.y} width={r.w} height={80 - r.y} fill="white" opacity="0.22" />
          <rect
            x={r.x + 7}
            y={r.y + 9}
            width="6"
            height="7"
            fill={`hsl(${h} 40% 30%)`}
            opacity="0.5"
          />
          <rect
            x={r.x + 16}
            y={r.y + 9}
            width="6"
            height="7"
            fill={`hsl(${h} 40% 30%)`}
            opacity="0.5"
          />
        </g>
      ))}
      <rect y="70" width="112" height="10" fill={`hsl(${h} 38% 32%)`} opacity="0.35" />
    </svg>
  );
}

/** Shown where a photo would be, when the guard removed its URL. */
export function PhotoRemoved({ reason }: { reason: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-0.5 bg-slate-100 px-1 text-center">
      <span className="text-[13px] leading-none text-slate-400">⃠</span>
      <span className="text-[9px] leading-tight text-slate-500">{reason}</span>
    </div>
  );
}
