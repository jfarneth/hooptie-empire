import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  INVENTORY_SORTS,
  STALE_DAYS,
  inventoryReport,
  inventoryTotals,
  sortLabel,
  type InventoryLine,
  type InventorySort,
} from '../../sim/inventory';
import { carCapacity } from '../../sim/upgrades';
import type { GameState } from '../../sim/types';
import { formatMargin, marginColor, money, moneyShort, theme } from '../theme';
import { costTrail } from './costTrail';
import { Sheet } from './Sheet';
import { Chip, EmptyState, Label } from './ui';

/**
 * Inventory ageing: what is on the lot, how long it has been there, and what
 * every unit has cost.
 *
 * The lot screen answers "what do I own" and the car sheet answers "what should
 * I do with this one". Neither answers the question a real dealer runs their
 * week off, which is "what is my old stock and what is it costing me" — that is
 * a property of the whole lot at once, and it is invisible when the inventory
 * is sixty cars on a tarmac you have to pan sideways to see.
 *
 * Every figure comes out of `inventory.ts`, which is a pure read over the cost
 * ledger the engine writes per car. Nothing is computed here — same rule the
 * books sheet follows, and for the same reason: a report that did its own
 * arithmetic could quietly disagree with the ledger it claims to summarise.
 *
 * A row is a car and tapping one opens it, because a report you cannot act on
 * is a report that sends you hunting across the lot for the car it just told
 * you about.
 */
export function InventoryAgeSheet({
  visible,
  state,
  onSelectCar,
  onClose,
}: {
  visible: boolean;
  state: GameState;
  onSelectCar: (carId: string) => void;
  onClose: () => void;
}) {
  const [sort, setSort] = useState<InventorySort>('age');

  // The lot is a 4Hz surface and this sorts every car on it. Memoised against
  // the tick rather than recomputed per render.
  const lines = useMemo(() => inventoryReport(state, sort), [state, sort]);
  const totals = useMemo(() => inventoryTotals(lines), [lines]);
  const capacity = carCapacity(state);

  return (
    <Sheet
      visible={visible}
      title="Inventory ageing"
      subtitle="What is sitting, how long it has sat, and what it has cost"
      onClose={onClose}
    >
      {lines.length === 0 ? (
        <EmptyState
          title="Nothing on the lot"
          hint="Buy something on the Buy tab and this is where you will find out what it is costing you to keep."
        />
      ) : (
        <>
          <View style={styles.headline}>
            <View style={{ flex: 1 }}>
              <Label>On the lot</Label>
              <Text style={styles.big}>
                {totals.units}
                <Text style={styles.bigDim}> / {capacity}</Text>
              </Text>
              <Text style={styles.headlineSub}>{money(totals.allIn)} of it is your money</Text>
            </View>
            <View style={styles.ageBox}>
              <Label>Typical age</Label>
              <Text style={styles.ageValue}>{days(totals.medianDays)}</Text>
              <Text style={styles.headlineSub}>oldest is {days(totals.oldestDays)}</Text>
            </View>
          </View>

          {/*
            WHERE THE MONEY WENT. The three figures the report exists to
            separate — `costBasis` folds the first two together and never saw
            the third at all, because floorplan interest is charged weekly
            against the whole lot and never against a car.
          */}
          <View style={styles.split}>
            <SplitFigure label="Bought for" value={totals.purchase + totals.freight} />
            <SplitFigure label="Repairs" value={totals.recon} />
            <SplitFigure label="Carrying" value={totals.carrying + totals.recovery} />
          </View>

          <Text style={styles.diagnosis}>{diagnose(totals, capacity)}</Text>

          <View style={styles.sorts}>
            {INVENTORY_SORTS.map((id) => (
              <Pressable
                key={id}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === id }}
                onPress={() => setSort(id)}
                style={({ pressed }) => [
                  styles.sortChip,
                  sort === id && styles.sortChipOn,
                  pressed && { opacity: 0.72 },
                ]}
              >
                <Text style={[styles.sortText, sort === id && styles.sortTextOn]}>
                  {sortLabel(id)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={{ gap: 6 }}>
            {lines.map((line) => (
              <CarRow key={line.car.id} line={line} onPress={() => onSelectCar(line.car.id)} />
            ))}
          </View>

          {/*
            The one line that stops "in it" being read as the number the books
            will charge. They are deliberately different, and the difference is
            money the business has already paid out.
          */}
          <Text style={styles.footnote}>
            "In it" is every dollar this car has taken out of the till — what you paid, the truck
            that brought it, the shop work, the weekly floorplan interest on the money it is tying
            up, and any recovery fee — less anything a customer has already handed back. Profit in
            the books is measured against a smaller number, because floorplan is charged the week it
            accrues rather than at the sale. Margin here is against the sticker on cars that are up,
            and against cash retail on the ones that are not. Age counts from the day you bought the
            car, so it includes any time it spent in the shop — the car's own sheet counts from the
            day it went up for sale.
          </Text>
        </>
      )}
    </Sheet>
  );
}

/** One car. Two lines of numbers and a tap target that opens it. */
function CarRow({ line, onPress }: { line: InventoryLine; onPress: () => void }) {
  const stale = line.daysHeld >= STALE_DAYS;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${line.label}, ${days(line.daysHeld)} on the lot`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, stale && styles.rowStale, pressed && { opacity: 0.72 }]}
    >
      <View style={styles.rowHead}>
        <Text style={styles.rowName} numberOfLines={1}>
          {line.label}
        </Text>
        <Text style={[styles.rowAge, stale && { color: theme.colors.warn }]}>
          {days(line.daysHeld)}
        </Text>
        <Text style={[styles.rowMargin, { color: marginColor(line.margin) }]}>
          {formatMargin(line.margin)}
        </Text>
      </View>

      <Text style={styles.rowCosts} numberOfLines={1}>
        {costTrail(line, true)}
      </Text>

      <View style={styles.rowFoot}>
        <Text style={styles.rowIn}>
          In it <Text style={styles.rowInValue}>{money(line.allIn)}</Text>
        </Text>
        <View style={{ flex: 1 }} />
        {line.car.repoCount > 0 ? <Chip text="BACK" color={theme.colors.warn} /> : null}
        <Text style={styles.rowExit}>{exitLabel(line)}</Text>
      </View>
    </Pressable>
  );
}

function exitLabel(line: InventoryLine): string {
  if (line.car.status === 'recon') return `in the shop · worth ${moneyShort(line.retail)}`;
  if (line.listed) return `asking ${moneyShort(line.exit)}`;
  return `unlisted · worth ${moneyShort(line.retail)}`;
}

/**
 * One sentence naming the problem, if there is one.
 *
 * The same argument the shop panel's diagnosis line makes: a table of numbers
 * cannot tell a lot that is merely full from one that is full of cars nobody
 * wants, and those want opposite things done about them. Ordered worst first,
 * and it says the good news out loud rather than rendering nothing — a panel
 * that goes blank when everything is fine looks broken.
 */
function diagnose(
  totals: ReturnType<typeof inventoryTotals>,
  capacity: number,
): string {
  const weekly = money(Math.round(totals.weeklyCarry));

  if (totals.underWaterUnits > 0) {
    return `${count(totals.underWaterUnits, 'car')} would lose money at the price ${
      totals.underWaterUnits === 1 ? 'it is' : 'they are'
    } asking. Holding the whole lot another week costs ${weekly} in floorplan interest.`;
  }
  if (totals.staleUnits > 0) {
    return `${count(totals.staleUnits, 'car')} ${
      totals.staleUnits === 1 ? 'has' : 'have'
    } been here over ${STALE_DAYS} days. Cut the price or take the wholesaler's — the lot costs ${weekly} a week to sit still.`;
  }
  if (totals.units >= capacity) {
    return `Every stall is full, so the next car you want has to wait for one of these to go. Floorplan on the lot runs ${weekly} a week.`;
  }
  return `Nothing here is stuck. Floorplan on the lot runs ${weekly} a week.`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

function days(value: number): string {
  if (value < 1) return 'today';
  const whole = Math.floor(value);
  return `${whole}d`;
}

function SplitFigure({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.splitCell}>
      <Text style={styles.splitLabel}>{label}</Text>
      <Text style={styles.splitValue}>{money(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  big: { color: theme.colors.text, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bigDim: { color: theme.colors.textFaint, fontSize: 20, fontWeight: '700' },
  headlineSub: { color: theme.colors.textFaint, fontSize: 11, marginTop: 1 },
  ageBox: { alignItems: 'flex-end' },
  ageValue: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },

  split: { flexDirection: 'row', gap: 8 },
  splitCell: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 9,
    gap: 2,
  },
  splitLabel: { color: theme.colors.textDim, fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  splitValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  diagnosis: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },

  sorts: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  sortChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  sortChipOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentDim },
  sortText: { color: theme.colors.textDim, fontSize: 11, fontWeight: '700' },
  sortTextOn: { color: theme.colors.text },

  row: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
    gap: 3,
  },
  // Old stock reads differently, the same way the car sheet's day count does.
  rowStale: { borderColor: theme.colors.accentDim },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  rowName: { flex: 1, color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  rowAge: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  rowMargin: {
    width: 52,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  rowCosts: { color: theme.colors.textFaint, fontSize: 11 },
  rowFoot: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 },
  rowIn: { color: theme.colors.textDim, fontSize: 11 },
  rowInValue: {
    color: theme.colors.text,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  rowExit: { color: theme.colors.textDim, fontSize: 11, fontVariant: ['tabular-nums'] },

  footnote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16 },
});
