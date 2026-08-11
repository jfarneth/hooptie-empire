import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getModel } from '../../sim/models';
import { RARITIES } from '../../sim/rarity';
import type { AwaySummary, SpecialFind } from '../../state/store';
import { CarArt } from '../art/CarArt';
import { RARITY_COLOR, money, theme } from '../theme';
import { Sheet } from './Sheet';
import { Button, Row } from './ui';

/**
 * What happened while the app was closed.
 *
 * These numbers are not an estimate or a reward table — the engine actually ran
 * those hours on load. Saying so plainly is worth more than a bigger number.
 */
export function AwaySummaryModal({
  summary,
  onDismiss,
}: {
  summary: AwaySummary | null;
  onDismiss: () => void;
}) {
  if (!summary) return <Sheet visible={false} title="" onClose={onDismiss} children={null} />;

  const away = describeSpan(summary.elapsedMs);
  const ran = describeSpan(summary.simulatedMs);

  return (
    <Sheet
      visible
      title="While you were gone"
      subtitle={summary.capped ? `Away ${away} — the lot ran for ${ran}` : `The lot ran for ${ran}`}
      onClose={onDismiss}
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Cash collected</Text>
        <Text
          style={[
            styles.heroValue,
            { color: summary.cashDelta >= 0 ? theme.colors.money : theme.colors.danger },
          ]}
        >
          {summary.cashDelta >= 0 ? '+' : ''}
          {money(summary.cashDelta)}
        </Text>
      </View>

      {summary.specialFinds.length > 0 ? <SpecialFinds finds={summary.specialFinds} /> : null}

      <View style={styles.grid}>
        <Tile label="Cars sold" value={String(summary.carsSold)} />
        <Tile label="Payments in" value={money(summary.collected)} tone={theme.colors.money} />
        <Tile label="Notes paid off" value={String(summary.notesPaid)} />
        <Tile
          label="Repossessions"
          value={String(summary.repos)}
          tone={summary.repos > 0 ? theme.colors.danger : undefined}
        />
        {summary.commissionPaid > 0 ? (
          // The other half of every overnight sale: who closed them, and what
          // that cost. Deals you close yourself never pay this — which is the
          // whole reason to show it.
          <Tile
            label={`${summary.deskTitle}'s cut`}
            value={money(summary.commissionPaid)}
            tone={theme.colors.warn}
          />
        ) : null}
      </View>

      {summary.skillUps.length > 0 ? (
        <View style={styles.skills}>
          {summary.skillUps.map((line, i) => (
            <Text key={`${line}-${i}`} style={styles.skillLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {summary.capped ? (
        <Text style={styles.capNote}>
          Your night manager only covers so much. Hire more coverage to keep the lot running longer
          while you are away.
        </Text>
      ) : null}

      <Button label="Back to work" tone="primary" onPress={onDismiss} />
    </Sheet>
  );
}

/**
 * The good stuff the buyer found while nobody was watching.
 *
 * This is the answer to the one genuinely awkward thing about trim grades: the
 * feed churns whether or not the app is open, so at one car in a thousand a
 * unicorn is something a player would essentially never be present for. The
 * retainer buyer already values and buys them correctly with no changes at all —
 * what was missing was anybody saying so.
 *
 * The spread is the headline rather than the price, because the ask was drawn
 * against stock trim: that number IS the premium, landing on the player's side
 * of a deal they did not have to be awake for.
 *
 * Horizontal, because there is usually one card and occasionally three, and a
 * grid that reflows between those two cases reads as a layout bug.
 */
function SpecialFinds({ finds }: { finds: SpecialFind[] }) {
  return (
    <View style={styles.finds}>
      <Text style={styles.findsLabel}>The buyer found these</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.findsRow}
      >
        {finds.map(({ car, paid, worth }) => {
          const color = RARITY_COLOR[car.rarity];
          return (
            <View key={car.id} style={[styles.find, { borderLeftColor: color }]}>
              <Text style={[styles.findGrade, { color }]}>
                {RARITIES[car.rarity].badge.toUpperCase()}
              </Text>
              <View style={styles.findArt}>
                <CarArt
                  modelId={car.modelId}
                  colorIndex={car.colorIndex}
                  condition={car.condition}
                  rarity={car.rarity}
                  width={186}
                />
              </View>
              <Text style={styles.findName} numberOfLines={1}>
                {getModel(car.modelId).name}
              </Text>
              <Text style={styles.findMeta} numberOfLines={1}>
                {car.mileage.toLocaleString('en-US')} mi · {Math.round(car.condition * 100)}%
              </Text>
              <View style={styles.findDeal}>
                <Figure label="Paid" value={money(paid)} />
                <Figure label="Worth" value={money(worth)} />
                <Figure label="Spread" value={`+${money(worth - paid)}`} tone={theme.colors.money} />
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.findFigure}>
      <Text style={styles.findFigureLabel}>{label}</Text>
      <Text style={[styles.findFigureValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function describeSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  finds: { gap: 8 },
  findsLabel: {
    color: theme.colors.textDim,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  findsRow: { gap: 10, paddingRight: 4 },
  find: {
    width: 216,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderLeftWidth: 3,
    padding: 12,
    gap: 5,
  },
  findGrade: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  findArt: { alignItems: 'center', paddingVertical: 2 },
  findName: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  findMeta: { color: theme.colors.textFaint, fontSize: 11, marginTop: -3 },
  findDeal: {
    flexDirection: 'row',
    gap: 4,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: 8,
    marginTop: 3,
  },
  findFigure: { flex: 1, gap: 1 },
  findFigureLabel: { color: theme.colors.textFaint, fontSize: 9, letterSpacing: 0.6 },
  findFigureValue: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  skills: {
    gap: 3,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.accent,
    paddingLeft: 10,
    marginTop: 4,
  },
  skillLine: { color: theme.colors.accent, fontSize: 12 },
  hero: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    gap: 2,
  },
  heroLabel: { color: theme.colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  heroValue: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 10,
    gap: 2,
  },
  tileLabel: { color: theme.colors.textDim, fontSize: 11 },
  tileValue: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  capNote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
