/** A member's initial on their colour, with the name as its accessible label. */
export function Avatar({ name, colour, size = 28 }: { name: string; colour: string; size?: number }) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold text-white shadow-[0_0_0_2px_#fff]"
      style={{ width: size, height: size, background: colour, fontSize: Math.round(size * 0.43) }}
    >
      {Array.from(name.trim())[0]?.toLocaleUpperCase() ?? "?"}
    </span>
  );
}
