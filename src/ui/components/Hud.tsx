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
import { CarSheetHost } from './CarSheetHost';
import { DealSheetHost, useOpenDeal } from './DealSheetHost';
import { InventoryAgeSheet } from './InventoryAgeSheet';

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
  const [ageingOpen, setAgeingOpen] = useState(false);
  const [carId, setCarId] = useState<string | null>(null);
  const [prospectId, setProspectId] = useState<string | null>(null);
  const openDeal = useOpenDeal(setProspectId);

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

        {/* The lot counter opens the ageing report, exactly as the margin
            readout opens the books. Both are the same move: the HUD shows a
            level, and one tap gets you the thing behind it — how full is not
            the same question as how long it has been full, and a lot pinned at
            capacity for a week is either a healthy business or a stall nobody
            wants, which this number cannot tell you on its own. It is also
            where the report belongs for discovery; Office → Reports is where
            you go looking for it, this is where you notice it. */}
        <Pressable
          onPress={() => setAgeingOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`${held} of ${capacity} stalls filled. Open the ageing report.`}
          style={({ pressed }) => [styles.stat, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.statLabel}>LOT</Text>
          <Text style={styles.statValue}>
            {held}/{capacity}
          </Text>
          <Text style={styles.statSub}>{state.stats.carsSold} sold</Text>
        </Pressable>
      </View>

      <BooksSheet visible={booksOpen} state={state} onClose={() => setBooksOpen(false)} />
      <InventoryAgeSheet
        visible={ageingOpen}
        state={state}
        onSelectCar={setCarId}
        onSelectProspect={openDeal}
        onClose={() => setAgeingOpen(false)}
      />
      <CarSheetHost state={state} carId={carId} onClose={() => setCarId(null)} />
      <DealSheetHost
        state={state}
        prospectId={prospectId}
        onClose={() => setProspectId(null)}
      />
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
