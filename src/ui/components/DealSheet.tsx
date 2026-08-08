import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BALANCE } from '../../sim/balance';
import { carLabel } from '../../sim/cars';
import { TIER_BLURB } from '../../sim/customers';
import { expectedCollections } from '../../sim/engine';
import { activeNotes, overCapacityFactor } from '../../sim/notes';
import { collectionsCapacity } from '../../sim/upgrades';
import type { GameState, Prospect } from '../../sim/types';
import { TIER_COLOR, money, theme } from '../theme';
import { Sheet } from './Sheet';
import { Button, Chip, Row } from './ui';

/**
 * The decision the entire game is built around: take their money, or take their
 * paper.
 *
 * The expected value shown here is not a vibe — it is the same exact Markov
 * calculation the engine uses to resolve the contract, so a player who learns to
 * read this screen is learning the real economics rather than a UI fiction.
 */
export function DealSheet({
  state,
  prospect,
  onCash,
  onFinance,
  onDecline,
  onClose,
}: {
  state: GameState;
  prospect: Prospect | null;
  onCash: () => void;
  onFinance: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  if (!prospect) return <Sheet visible={false} title="" onClose={onClose} children={null} />;

  const car = state.cars.find((c) => c.id === prospect.carId);
  const costBasis = car?.costBasis ?? 0;
  const financeAvailable = state.stage === 'bhph';

  const capFactor = overCapacityFactor(activeNotes(state.notes).length, collectionsCapacity(state));
  const missChance = BALANCE.creditTiers[prospect.tier].missChance * capFactor;
  const { expectedCollected, defaultProbability } = expectedCollections(
    prospect.financeTerms.weeks,
    prospect.financeTerms.weeklyPayment,
    missChance,
  );

  const financeEv = prospect.downPayment + expectedCollected;
  const cashProfit = prospect.cashOffer - costBasis;
  const financeEvProfit = financeEv - costBasis;
  const financeBeatsC = financeEv > prospect.cashOffer;

  const scheduled = Math.round(prospect.financeTerms.weeklyPayment * prospect.financeTerms.weeks);

  return (
    <Sheet
      visible
      title={prospect.name}
      subtitle={car ? `wants the ${carLabel(car)}` : undefined}
      onClose={onClose}
    >
      <Row gap={8}>
        <Chip text={`TIER ${prospect.tier}`} color={TIER_COLOR[prospect.tier]} filled />
        <Text style={styles.blurb}>{TIER_BLURB[prospect.tier]}</Text>
      </Row>

      <View style={styles.costRow}>
        <Text style={styles.costLabel}>Your cost in this car</Text>
        <Text style={styles.costValue}>{money(costBasis)}</Text>
      </View>

      {/* ---------------------------------------------------------- cash */}
      <View style={[styles.option, !financeAvailable && styles.optionHighlight]}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.optionTitle}>Cash</Text>
          <Text style={styles.optionHeadline}>{money(prospect.cashOffer)}</Text>
        </Row>
        <Text style={styles.optionNote}>
          Paid in full today. Done with it.
        </Text>
        <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={styles.profitLabel}>Profit</Text>
          <Text style={[styles.profitValue, { color: cashProfit >= 0 ? theme.colors.money : theme.colors.danger }]}>
            {money(cashProfit)}
          </Text>
        </Row>
        <Button label="Take the cash" tone="money" onPress={onCash} style={{ marginTop: 10 }} />
      </View>

      {/* ------------------------------------------------------- finance */}
      {financeAvailable ? (
        <View style={[styles.option, financeBeatsC && styles.optionHighlight]}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.optionTitle}>Finance it</Text>
            <Text style={styles.optionHeadline}>{money(prospect.downPayment)}</Text>
          </Row>
          <Text style={styles.optionNote}>
            down today, then {money(prospect.financeTerms.weeklyPayment)}/wk ×{' '}
            {prospect.financeTerms.weeks} at {(prospect.financeTerms.apr * 100).toFixed(1)}%
          </Text>

          <View style={styles.evBlock}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.evLabel}>If they pay every week</Text>
              <Text style={styles.evStrong}>{money(prospect.downPayment + scheduled)}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.evLabel}>Expected, after defaults</Text>
              <Text style={styles.evStrong}>{money(financeEv)}</Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.evLabel}>Chance you take it back</Text>
              <Text style={[styles.evStrong, { color: theme.colors.warn }]}>
                {(defaultProbability * 100).toFixed(0)}%
              </Text>
            </Row>
          </View>

          <Text style={styles.repoNote}>
            If they stop paying you keep every dollar collected and the car comes back to the lot.
          </Text>

          <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
            <Text style={styles.profitLabel}>Expected profit</Text>
            <Text
              style={[
                styles.profitValue,
                { color: financeEvProfit >= 0 ? theme.colors.money : theme.colors.danger },
              ]}
            >
              {money(financeEvProfit)}
            </Text>
          </Row>

          <Button
            label="Write the note"
            sublabel={financeBeatsC ? `+${money(financeEv - prospect.cashOffer)} over cash` : undefined}
            tone={financeBeatsC ? 'primary' : 'default'}
            onPress={onFinance}
            style={{ marginTop: 10 }}
          />
        </View>
      ) : (
        <View style={styles.lockedBox}>
          <Text style={styles.lockedText}>
            Financing needs a lot and a desk. Buy the lot to start writing your own paper.
          </Text>
        </View>
      )}

      <Button label="Send them away" tone="ghost" onPress={onDecline} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  blurb: { color: theme.colors.textDim, fontSize: 12, flex: 1, lineHeight: 16 },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
  },
  costLabel: { color: theme.colors.textDim, fontSize: 12 },
  costValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  option: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  optionHighlight: { borderColor: theme.colors.accent },
  optionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  optionHeadline: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  optionNote: { color: theme.colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
  evBlock: {
    marginTop: 10,
    gap: 4,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  evLabel: { color: theme.colors.textDim, fontSize: 12 },
  evStrong: { color: theme.colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  repoNote: {
    color: theme.colors.textFaint,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 8,
    fontStyle: 'italic',
  },
  profitLabel: { color: theme.colors.textDim, fontSize: 12, fontWeight: '600' },
  profitValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  lockedBox: {
    padding: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.border,
  },
  lockedText: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 17, textAlign: 'center' },
});
