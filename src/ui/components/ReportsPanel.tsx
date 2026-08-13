import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { lastWeek, weekMargin } from '../../sim/books';
import { STALE_DAYS, inventoryReport, inventoryTotals } from '../../sim/inventory';
import type { GameState } from '../../sim/types';
import { formatMargin, marginColor, money, theme } from '../theme';
import { BooksSheet } from './BooksSheet';
import { CarSheetHost } from './CarSheetHost';
import { DealSheetHost, useOpenDeal } from './DealSheetHost';
import { InventoryAgeSheet } from './InventoryAgeSheet';
import { Label } from './ui';

type ReportId = 'ageing' | 'books';

/**
 * Reporting: what the business has been doing.
 *
 * A deliberate split from the Business tab rather than another block on it.
 * Business is the five house rules — LEVERS, things you set and the business
 * then runs under while you are away. This is READOUTS: things that already
 * happened, which you look at and then go and change a lever about. Putting a
 * table of sixty cars on the same screen as five sliders would bury both, and
 * the panel was already the longest in the game.
 *
 * The index is the point of the shape. Each report is one card here and one
 * sheet behind it, so the next one — the ledger, plan performance, a skills
 * history — lands as a card and a component and touches nothing else.
 */
export function ReportsPanel({ state }: { state: GameState }) {
  const [open, setOpen] = useState<ReportId | null>(null);
  const [carId, setCarId] = useState<string | null>(null);
  const [prospectId, setProspectId] = useState<string | null>(null);
  const openDeal = useOpenDeal(setProspectId);

  const lines = inventoryReport(state);
  const totals = inventoryTotals(lines);
  const last = lastWeek(state);
  const margin = weekMargin(last);

  return (
    <View style={{ gap: 10 }}>
      <Label>What the business has been doing</Label>
      <Text style={styles.intro}>
        The rules live on the Business tab. This is what they have produced.
      </Text>

      <ReportCard
        title="Inventory ageing"
        blurb="Every car on the lot, how long it has been there, and what it has cost you to keep — sortable by whichever of those is hurting."
        onPress={() => setOpen('ageing')}
      >
        {totals.units === 0 ? (
          <Stat label="On the lot" value="nothing" />
        ) : (
          <>
            <Stat label="On the lot" value={`${totals.units}`} />
            <Stat label="Your money in it" value={money(totals.allIn)} />
            <Stat
              label={`Sitting over ${STALE_DAYS}d`}
              value={`${totals.staleUnits}`}
              tone={totals.staleUnits > 0 ? theme.colors.warn : undefined}
            />
          </>
        )}
      </ReportCard>

      <ReportCard
        title="Weekly books"
        blurb="Net operating margin, week by week. Cash is a level and this is the rate — a week that bought six cars and sold none reads as a disaster on the till and is just inventory."
        onPress={() => setOpen('books')}
      >
        {last === null ? (
          <Stat label="Weeks filed" value="none yet" />
        ) : (
          <>
            <Stat label="Last week" value={formatMargin(margin)} tone={marginColor(margin)} />
            <Stat label="Taken" value={money(last.revenue)} />
            <Stat label="Kept" value={money(last.profit)} />
          </>
        )}
      </ReportCard>

      <InventoryAgeSheet
        visible={open === 'ageing'}
        state={state}
        onSelectCar={setCarId}
        onSelectProspect={openDeal}
        onClose={() => setOpen(null)}
      />
      <BooksSheet visible={open === 'books'} state={state} onClose={() => setOpen(null)} />
      {/*
        Siblings of the report rather than children of it, so the inventory
        sheet stays open underneath: tapping a six-week-old car, repricing it and
        coming straight back to the next one is the whole workflow this report
        exists to make possible. Same for a walk-up — close the deal and the
        list you were working is still there, with the next buyer on it.
      */}
      <CarSheetHost state={state} carId={carId} onClose={() => setCarId(null)} />
      <DealSheetHost
        state={state}
        prospectId={prospectId}
        onClose={() => setProspectId(null)}
      />
    </View>
  );
}

function ReportCard({
  title,
  blurb,
  children,
  onPress,
}: {
  title: string;
  blurb: string;
  children: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.72 }]}
    >
      <View style={styles.cardHead}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
      <Text style={styles.blurb}>{blurb}</Text>
      <View style={styles.stats}>{children}</View>
    </Pressable>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  intro: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 16 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 6,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  chevron: { color: theme.colors.textFaint, fontSize: 20, fontWeight: '700', lineHeight: 20 },
  blurb: { color: theme.colors.textDim, fontSize: 12, lineHeight: 16 },
  stats: { flexDirection: 'row', gap: 8, marginTop: 2 },
  stat: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 8,
    gap: 2,
  },
  statLabel: { color: theme.colors.textDim, fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  statValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
