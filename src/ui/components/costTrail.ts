import type { InventoryLine } from '../../sim/inventory';
import { money, moneyShort } from '../theme';

/**
 * Where one car's money went, in one line.
 *
 * Shared by the ageing report and the car sheet so the two cannot describe the
 * same car differently — the report is where a player notices a unit and the
 * sheet is where they act on it, and a figure that changed between the two
 * screens would read as the game losing track of their money.
 *
 * Zero components are dropped rather than printed as "$0". A curbstone lot buys
 * locally and never repossesses anything, so four of the six would be a column
 * of zeroes on every row for the first two hours of the game. Carrying is
 * dropped below a dollar for the same reason and not because it is unimportant:
 * a car bought this morning has genuinely not been billed for yet.
 *
 * `compact` rounds to the nearest tidy figure, which is what a table of sixty
 * rows needs and what a sheet showing ONE car emphatically does not: at a
 * premium franchise `moneyShort` reports an $86,400 purchase as "$86k", and a
 * cost report that rounds away four hundred dollars on the screen the player
 * opened to find out where four hundred dollars went is no use at all.
 */
export function costTrail(line: InventoryLine, compact = false): string {
  const fmt = compact ? moneyShort : money;
  const parts = [`paid ${fmt(line.purchase)}`];
  if (line.freight > 0) parts.push(`freight ${fmt(line.freight)}`);
  if (line.recon > 0) parts.push(`repairs ${fmt(line.recon)}`);
  if (line.carrying >= 1) parts.push(`carrying ${fmt(line.carrying)}`);
  if (line.recovery > 0) parts.push(`recovery ${fmt(line.recovery)}`);
  if (line.returned > 0) parts.push(`paid back ${fmt(line.returned)}`);
  return parts.join(' · ');
}
