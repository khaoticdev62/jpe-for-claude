/** Colour maths shared by the design tokens, the painter and the accessibility tests. No dependencies. */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: string): boolean => HEX_COLOR.test(value);

/** `#RRGGBB` to channels. Throws on anything else, so a typo in a theme fails loudly in tests. */
export function parseHex(hex: string): Rgb {
  if (!isHexColor(hex)) throw new RangeError(`Not a #RRGGBB colour: ${hex}`);
  return { r: Number.parseInt(hex.slice(1, 3), 16), g: Number.parseInt(hex.slice(3, 5), 16), b: Number.parseInt(hex.slice(5, 7), 16) };
}

const linear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [light, dark] = a >= b ? [a, b] : [b, a];
  return (light + 0.05) / (dark + 0.05);
}

/** Nearest xterm 256-colour index: the 6x6x6 cube, or the 24-step grey ramp for neutral colours. */
export function toAnsi256(hex: string): number {
  const { r, g, b } = parseHex(hex);
  if (Math.abs(r - g) < 8 && Math.abs(g - b) < 8) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return 232 + Math.round(((r - 8) / 247) * 23);
  }
  const level = (channel: number): number => Math.round((channel / 255) * 5);
  return 16 + 36 * level(r) + 6 * level(g) + level(b);
}
