/**
 * Colours of highlights (`==…==`) and coloured words (`!!…!!`) in the stored
 * document text. Four are theme colours, written as a sign after the opening
 * marks and drawn from the page's own palette in light and dark: none is
 * yellow, `+` green, `~` blue, `-` pink. Any other colour is written as its
 * code in braces, `=={#ff8800}words==`, and drawn as it is.
 */
export const PRESET_COLORS = ["yellow", "green", "blue", "pink"] as const;
export type PresetColor = (typeof PRESET_COLORS)[number];

const BY_SIGN: Record<string, PresetColor> = { "": "yellow", "+": "green", "~": "blue", "-": "pink" };
const SIGN: Record<PresetColor, string> = { yellow: "", green: "+", blue: "~", pink: "-" };

/** The tone part of the marks, as a regular-expression source: a sign, or a code in braces. */
export const TONE_PATTERN = String.raw`[+~-]|\{#[0-9a-fA-F]{6}\}`;

export const isHexColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);

/** `#ff8800`, `ff8800`, `#f80` or `f80` as `#ff8800`; anything else as null. */
export function parseHexColor(input: string): string | null {
  const value = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(value)) return `#${[...value].map((digit) => digit + digit).join("")}`.toLowerCase();
  return /^[0-9a-f]{6}$/i.test(value) ? `#${value}`.toLowerCase() : null;
}

/** The colour a tone stands for: a preset's name, or a code. */
export function colorOfTone(tone = ""): string {
  const code = tone.match(/^\{(#[0-9a-fA-F]{6})\}$/)?.[1];
  return code ? code.toLowerCase() : BY_SIGN[tone] ?? "yellow";
}

/** The tone written for a colour: a preset's sign, or the code in braces. */
export function toneOfColor(color = "yellow"): string {
  if (color in SIGN) return SIGN[color as PresetColor];
  return isHexColor(color) ? `{${color.toLowerCase()}}` : "";
}

/** A highlight's background for a colour code: the colour itself, see-through, so text stays readable in both themes. */
export const highlightBackground = (hex: string) => `${hex}59`;
