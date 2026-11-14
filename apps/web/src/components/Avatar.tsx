/** A member's initial on their colour, with the name (or `label`) as its accessible label. */
export function Avatar({ name, colour, size = 28, label = name }: { name: string; colour: string; size?: number; label?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-[0_0_0_2px_#fff]"
      style={{ width: size, height: size, background: colour, fontSize: Math.round(size * 0.43) }}
    >
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?"}
    </span>
  );
}
