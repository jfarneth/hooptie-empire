import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lastWeek, weekMargin } from '../../sim/books';
import { portfolioValue } from '../../sim/economy';
import { activeNotes } from '../../sim/notes';
import { getStage } from '../../sim/stages';
import { carCapacity, collectionsCapacity } from '../../sim/upgrades';
import type { GameState } from '../../sim/types';
import { formatMargin, marginColor, money, moneyShort, theme } from '../theme';
import { BooksSheet } from './BooksSheet';

/**
 * Height the HUD reserves. Exported because the HUD floats over the screens
 * rather than sitting above them — every scroll view pads its content by this
 * so the lot slides underneath the glass instead of starting below a solid bar.
 */
export const HUD_HEIGHT = 62;

/** Always-visible top bar. Cash and the book, because those are the two scores. */
export function Hud({ state }: { state: GameState }) {
  const held = state.cars.filter((c) => c.status !== 'sold').length;
  const capacity = carCapacity(state);
  const active = activeNotes(state.notes);
  const portfolio = portfolioValue(state.notes);
  const stage = getStage(state.stage);
  const deskCapacity = collectionsCapacity(state);
  const overCapacity = active.length > deskCapacity;
  const [booksOpen, setBooksOpen] = useState(false);

  // Last week that actually closed, never the one in progress: "this week so
  // far" over four sales is noise, and a headline that jumped about every time
  // a car sold would be read as the game being erratic rather than the sample
  // being small. The part-week is in the sheet, drawn as a part-week.
  const margin = weekMargin(lastWeek(state));

  return (
    <View style={styles.hud}>
      <View style={styles.left}>
        <View style={styles.cashRow}>
          <Text style={[styles.cash, state.cash < 0 && { color: theme.colors.danger }]}>
            {money(state.cash)}
          </Text>

          {/* Cash is a level; this is the rate that moves it. Beside the number
              rather than in the right-hand stats because the two only mean
              anything read together — a falling balance is a crisis or a full
              lot depending entirely on this percentage. */}
          <Pressable
            onPress={() => setBooksOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={
              margin === null
                ? 'Net operating profit, no closed week yet. Open the books.'
                : `Net operating profit last week, ${formatMargin(margin)}. Open the books.`
            }
            style={({ pressed }) => [styles.net, pressed && { opacity: 0.6 }]}
          >
            <Text style={[styles.netValue, { color: marginColor(margin) }]}>
              {formatMargin(margin)}
            </Text>
            <Text style={styles.netLabel}>NET</Text>
          </Pressable>
        </View>
        <Text style={styles.stage}>{stage.shortName}</Text>
      </View>

      <View style={styles.right}>
        {stage.financing ? (
          <View style={styles.stat}>
            <Text style={styles.statLabel}>BOOK</Text>
            <Text style={[styles.statValue, { color: theme.colors.accent }]}>
              {moneyShort(portfolio)}
            </Text>
            <Text style={[styles.statSub, overCapacity && { color: theme.colors.danger }]}>
              {active.length}/{deskCapacity} notes
            </Text>
          </View>
        ) : null}

        <View style={styles.stat}>
          <Text style={styles.statLabel}>LOT</Text>
          <Text style={styles.statValue}>
            {held}/{capacity}
          </Text>
          <Text style={styles.statSub}>{state.stats.carsSold} sold</Text>
        </View>
      </View>

      <BooksSheet visible={booksOpen} state={state} onClose={() => setBooksOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  hud: {
    height: HUD_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    // Nearly opaque rather than solid: the lot showing faintly through is what
    // stops this reading as a toolbar bolted above a picture.
    backgroundColor: 'rgba(16,18,25,0.93)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(80,92,115,0.35)',
  },
  left: { gap: 1 },
  cashRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cash: {
    color: theme.colors.money,
    fontSize: 24,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  net: {
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceAlt,
  },
  netValue: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  netLabel: { color: theme.colors.textFaint, fontSize: 7, fontWeight: '700', letterSpacing: 1 },
  stage: {
    color: theme.colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  right: { flexDirection: 'row', gap: 16 },
  stat: { alignItems: 'flex-end', gap: 1 },
  statLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  statValue: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statSub: { color: theme.colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
});
