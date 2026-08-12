import { formatMargin, marginColor, theme } from './theme';

/**
 * The two readouts that encode a decision rather than a format.
 *
 * `money` and `moneyShort` are plain formatting and are left to the eye. These
 * two are not: one of them decides what a week with no revenue looks like, and
 * the other decides that a thin week and a fat one are the same colour.
 */
describe('a margin on screen', () => {
  it('shows a dash where there is no denominator, never a zero', () => {
    // A week that sold nothing has no percentage. "0%" would claim the business
    // broke even on money it never took, and "-100%" would claim worse.
    expect(formatMargin(null)).toBe('—');
    expect(formatMargin(0)).toBe('0.0%');
  });

  it('keeps a decimal where a point is the whole business', () => {
    // A Valmont store runs on six points; rounding it away loses the signal.
    expect(formatMargin(0.064)).toBe('6.4%');
    expect(formatMargin(-0.021)).toBe('-2.1%');
    // A curbstone runs on twenty-odd; the decimal there is noise.
    expect(formatMargin(0.216)).toBe('22%');
    expect(formatMargin(-0.293)).toBe('-29%');
  });

  it('colours on the sign and nothing else', () => {
    // No "thin but positive" band: six percent is a bad week at a curbstone and
    // an ordinary one at a premium franchise, so any threshold is wrong at one
    // end of the ladder.
    expect(marginColor(0.06)).toBe(theme.colors.money);
    expect(marginColor(0.4)).toBe(theme.colors.money);
    expect(marginColor(-0.01)).toBe(theme.colors.danger);
    expect(marginColor(null)).toBe(theme.colors.textDim);
  });
});
