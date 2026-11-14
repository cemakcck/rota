import type { Category } from "@rota/trip";

// Line icons from the design reference (24×24, 1.75 stroke). Decorative unless given a label.

const PATHS = {
  food: <path d="M7 3v18M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1.2-3 3.6-3 6.5 0 2.4.9 3.5 3 3.5" />,
  drinks: <path d="M5 4h14l-7 8zM12 12v8M8 20h8M7.6 7h8.8" />,
  cafe: <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10.5h1.5a2.5 2.5 0 0 1 0 5H16M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5" />,
  museum: <path d="M3 9.5 12 4l9 5.5zM5.5 9.5V18M10 9.5V18M14 9.5V18M18.5 9.5V18M3 20.5h18" />,
  sight: (
    <>
      <path d="M3 9a2 2 0 0 1 2-2h2l1.6-2.4h6.8L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  nightlife: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10zM17 3.5v3M15.5 5h3" />,
  shopping: <path d="M5 8h14l-1.2 12.2H6.2zM9 10V6.5a3 3 0 0 1 6 0V10" />,
  nature: <path d="M12 3 6.5 10.5h3L5 16.5h14l-4.5-6h3zM12 16.5V21" />,
  gym: <path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11" />,
  stay: (
    <>
      <path d="M3 5v14M3 15h18v4M21 15v-3a3 3 0 0 0-3-3h-7v6" />
      <circle cx="7" cy="11.5" r="1.8" />
    </>
  ),
  other: (
    <>
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m9 20 2.5-6.5L14 16v5M8 11.5l2.5-3.5 3.5 1 2 3.5 2.5 1M11.5 13.5 12.6 9" />
    </>
  ),
  car: (
    <>
      <path d="M5 16.5V12l2-5h10l2 5v4.5M3.5 12h17M5 16.5h14M6.5 16.5v2M17.5 16.5v2" />
      <circle cx="8" cy="13.8" r=".6" />
      <circle cx="16" cy="13.8" r=".6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  cloudOff: <path d="M3 3l18 18M8.5 6.2A6 6 0 0 1 17.6 10 4 4 0 0 1 20 17M16 19H7a4.5 4.5 0 0 1-1.5-8.75" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  ext: <path d="M14 4h6v6M20 4l-8.5 8.5M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />,
  pencil: <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />,
  up: <path d="M12 19V5M6 11l6-6 6 6" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  grip: (
    <>
      <circle cx="9" cy="6" r="1" />
      <circle cx="15" cy="6" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="18" r="1" />
      <circle cx="15" cy="18" r="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  trash: <path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />,
  move: <path d="M5 12h14M13 6l6 6-6 6" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.3-4.3" />
    </>
  ),
  warn: <path d="M10.3 4.2 2.8 17.5A2 2 0 0 0 4.5 20.5h15a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 9.5v4.5M12 17.2v.1" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  partly: <path d="M8 4.5v1.2M3.8 8.5H5M5 5.3l.9.9M11.6 6.4a4 4 0 0 0-6.7 3.7M8.5 19.5h9a3.5 3.5 0 0 0 .4-7 5 5 0 0 0-9.6 1.2A3 3 0 0 0 8.5 19.5z" />,
  cloud: <path d="M7 18.5h10.5a4 4 0 0 0 .4-8 6 6 0 0 0-11.5 1.6A3.3 3.3 0 0 0 7 18.5z" />,
  fog: <path d="M4 9h16M6 13h12M4 17h16" />,
  rain: <path d="M7 15.5a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.5 1.5 3.5 3.5 0 0 1-.6 6.5M8.5 18l-1 2.5M12.5 17l-1 2.5M16.5 18l-1 2.5" />,
  snow: <path d="M7 14.5a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.5 1.5 3.5 3.5 0 0 1-.6 6.5M8 18.5h.01M12 17.5h.01M16 18.5h.01M10 21h.01M14 21h.01" />,
  storm: <path d="M7 14.5a4 4 0 0 1 .6-8 5.5 5.5 0 0 1 10.5 1.5 3.5 3.5 0 0 1-.6 6.5M13 13l-2.5 4h3L11 21" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 fill-none stroke-current ${className}`}
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The red Google Maps pin used on "Open in Google Maps" buttons. */
export function GoogleMapsPin() {
  return (
    <svg viewBox="0 0 24 24" width={14} height={14} aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M12 21.5s-6.5-6-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15.5 12 21.5 12 21.5z" fill="#ea4335" />
      <circle cx="12" cy="10.3" r="2.4" fill="#fff" />
    </svg>
  );
}

/** A category's icon in its tile; labelled with the category's name when `label` is given. */
export function CategoryIcon({ category, label, small = false }: { category: Category; label?: string; small?: boolean }) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={`grid shrink-0 place-items-center rounded-[9px] bg-line-2 text-ink-2 ${small ? "size-6" : "size-8"}`}
    >
      <Icon name={category} size={small ? 14 : 17} />
    </span>
  );
}
