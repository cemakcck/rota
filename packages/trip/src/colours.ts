/** The 8 member colours (spec §3). Each has at least 3:1 contrast on white, so it works as an outline, icon or text accent. */
export const MEMBER_COLOURS = [
  "#dc2626", // red
  "#ea580c", // orange
  "#a16207", // amber
  "#16a34a", // green
  "#0d9488", // teal
  "#2563eb", // blue
  "#7c3aed", // violet
  "#db2777", // pink
] as const;

export type MemberColour = (typeof MEMBER_COLOURS)[number];

export function isMemberColour(value: unknown): value is MemberColour {
  return typeof value === "string" && (MEMBER_COLOURS as readonly string[]).includes(value);
}
