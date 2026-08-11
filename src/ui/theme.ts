/**
 * A used car lot at night: wet asphalt, sodium lights, painted stripes.
 * Dark-first because the game is mostly numbers on small screens.
 */
export const theme = {
  colors: {
    bg: '#101219',
    surface: '#191d26',
    surfaceAlt: '#212632',
    surfaceHigh: '#2a3040',
    border: '#2e3543',
    text: '#e9ecf3',
    textDim: '#98a1b3',
    textFaint: '#6b7487',
    accent: '#f2a63b',
    accentDim: '#8a5f22',
    money: '#4ec97e',
    moneyDim: '#2c6b46',
    danger: '#e0685a',
    dangerDim: '#7a3229',
    warn: '#e3b341',
    asphalt: '#1c202a',
    stripe: '#3d4658',
    glass: '#4a5568',
  },
  space: (n: number) => n * 4,
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  font: {
    // Tabular-ish stacks so money columns do not jitter as digits change.
    mono: 'Menlo, Consolas, monospace',
  },
} as const;

export const TIER_COLOR: Record<string, string> = {
  A: '#4ec97e',
  B: '#8fc95a',
  C: '#e3b341',
  D: '#e0685a',
};

/**
 * The colour a car fades toward as it wears out, and how far.
 *
 * Exported because two renderers have to agree on it: the vector drawing blends
 * its paint toward this, and the sprite renderer lays a tinted copy of the same
 * sprite over itself at this opacity. Computed once here so a tired car looks
 * equally tired whichever one is drawing it.
 */
export const WEATHERED_GREY = '#6a6c70';

/**
 * The trim-grade ramp: silver, cyan, violet, neon magenta.
 *
 * Deliberately clear of the game's semantic colours — money green and danger red
 * mean something specific on every other surface, and a chip that borrowed one
 * would read as "this car is profitable" rather than "this car is rare".
 */
export const RARITY_COLOR: Record<string, string> = {
  common: '#7e8695',
  rare: '#4fb3d9',
  epic: '#9b74e6',
  legendary: '#ff3ea5',
};

/**
 * Underglow. One fixed colour, and it matches the legendary chip on purpose:
 * at 34px across a full lot the glow is the only trim that reads as *colour*,
 * so it has to be the same thing the badge trained the player to look for. A
 * hue that varied per car would just be a pink smudge.
 */
export const NEON = RARITY_COLOR.legendary;

/**
 * A racing stripe is painted to contrast with the car it is on, so it is
 * derived from the paint rather than fixed: white on dark, near-black on light.
 * Nine body colours get nine correct-looking cars with no hand-tuned palettes,
 * the same rule `shadeColor` already lets the rest of the lot art follow.
 */
export function stripeColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum < 0.55 ? '#eef1f6' : '#191d24';
}

export function weatherAmount(condition: number): number {
  return Math.min(0.62, (1 - Math.max(0, Math.min(1, condition))) * 0.72);
}

/** Blend a hex colour toward grey as condition drops, so tired cars look tired. */
export function weatheredColor(hex: string, condition: number): string {
  const target = { r: 0x6a, g: 0x6c, b: 0x70 };
  const amount = weatherAmount(condition);

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const mix = (c: number, t: number) => Math.round(c + (t - c) * amount);
  const to2 = (n: number) => n.toString(16).padStart(2, '0');

  return `#${to2(mix(r, target.r))}${to2(mix(g, target.g))}${to2(mix(b, target.b))}`;
}

/**
 * Push a hex colour toward white (positive) or black (negative).
 *
 * The lot is drawn from one paint colour per car, so every panel that needs to
 * read as lit or shadowed derives from it here rather than being picked by hand
 * — otherwise nine body colours would need nine hand-tuned palettes.
 */
export function shadeColor(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (c: number) =>
    Math.max(0, Math.min(255, Math.round(amount > 0 ? c + (255 - c) * amount : c * (1 + amount))));
  const to2 = (v: number) => v.toString(16).padStart(2, '0');
  return `#${to2(ch((n >> 16) & 255))}${to2(ch((n >> 8) & 255))}${to2(ch(n & 255))}`;
}

export function money(n: number): string {
  const rounded = Math.round(n);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded).toLocaleString('en-US')}`;
}

/** Compact money for tight spots: $1.2k, $340k. */
export function moneyShort(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export function duration(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
