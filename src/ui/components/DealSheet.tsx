import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BALANCE } from '../../sim/balance';
import { carLabel } from '../../sim/cars';
import { TIER_BLURB } from '../../sim/customers';
import { expectedCollections } from '../../sim/engine';
import {
  countersRemaining,
  readCounter,
  roundingIncrement,
  tellFor,
} from '../../sim/haggle';
import { repoThreshold } from '../../sim/business';
import { activeNotes, canWriteNote, overCapacityFactor } from '../../sim/notes';
import { haggleSkillFor } from '../../sim/skills';
import { collectionsCapacity } from '../../sim/upgrades';
import type { GameState, Prospect } from '../../sim/types';
import { TIER_COLOR, money, theme } from '../theme';
import { PriceSlider } from './PriceSlider';
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
  onCounter,
  onFinance,
  onDecline,
  onClose,
}: {
  state: GameState;
  prospect: Prospect | null;
  onCash: () => void;
  onCounter: (price: number) => void;
  onFinance: () => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  // Hooks must run unconditionally, so the counter lives above the early return.
  const neg = prospect?.negotiation ?? null;
  const step = neg ? roundingIncrement(neg.anchor) : 100;
  // The slider bottoms out at their actual number so the "their offer" label is
  // telling the truth; the button below is what refuses a pointless counter.
  const sliderMin = neg ? neg.currentOffer : 0;
  const openingCounter = neg ? Math.min(neg.currentOffer + step, neg.anchor) : 0;

  const [counter, setCounter] = useState(openingCounter);

  // Reset the slider whenever a new buyer appears or they move their number.
  const negKey = neg ? `${prospect!.id}:${neg.currentOffer}:${neg.countersMade}` : null;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (negKey && negKey !== lastKey.current) {
      lastKey.current = negKey;
      setCounter(openingCounter);
    }
  }, [negKey, openingCounter]);

  if (!prospect || !neg) {
    return <Sheet visible={false} title="" onClose={onClose} children={null} />;
  }

  const car = state.cars.find((c) => c.id === prospect.carId);
  const costBasis = car?.costBasis ?? 0;
  const financeAvailable = state.stage === 'bhph';

  const countersLeft = countersRemaining(neg, haggleSkillFor(state));
  const agreed = neg.status === 'accepted';
  // Once they have said yes there is nothing left to argue about; without the
  // status check the sheet would render a counter control that silently no-ops,
  // because the action layer rejects counters on a closed negotiation.
  const canCounter = neg.status === 'open' && countersLeft > 0 && neg.currentOffer < neg.anchor;

  const bookSize = activeNotes(state.notes).length;
  const bookLimit = collectionsCapacity(state);
  const bookOpen = canWriteNote(state);

  const capFactor = overCapacityFactor(bookSize, bookLimit);
  const missChance = BALANCE.creditTiers[prospect.tier].missChance * capFactor;
  // Quoted against the player's own repo trigger, not the house default: this
  // number is presented as exact, so it has to be the rule they actually set.
  const { expectedCollected, defaultProbability } = expectedCollections(
    prospect.financeTerms.weeks,
    prospect.financeTerms.weeklyPayment,
    missChance,
    repoThreshold(state),
  );

  const financeEv = prospect.downPayment + expectedCollected;
  const cashProfit = neg.currentOffer - costBasis;
  const financeEvProfit = financeEv - costBasis;
  const financeBeatsC = financeEv > neg.currentOffer;

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
          <Text style={styles.optionTitle}>
            {agreed ? 'They agreed' : neg.countersMade > 0 ? 'Their new offer' : 'Cash'}
          </Text>
          <Text style={styles.optionHeadline}>{money(neg.currentOffer)}</Text>
        </Row>
        <Text style={styles.optionNote}>
          {agreed
            ? 'They took your number. Shake on it.'
            : neg.currentOffer >= neg.anchor
              ? 'Full asking price. No argument.'
              : `${money(neg.anchor - neg.currentOffer)} under your ask of ${money(neg.anchor)}.`}
        </Text>

        <Text style={styles.tell}>{tellFor(neg)}</Text>

        <Row style={{ justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={styles.profitLabel}>Profit</Text>
          <Text
            style={[
              styles.profitValue,
              { color: cashProfit >= 0 ? theme.colors.money : theme.colors.danger },
            ]}
          >
            {money(cashProfit)}
          </Text>
        </Row>
        <Button
          label={agreed ? `Close at ${money(neg.currentOffer)}` : 'Take the cash'}
          tone="money"
          onPress={onCash}
          style={{ marginTop: 10 }}
        />

        {canCounter ? (
          <View style={styles.counterBlock}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.counterTitle}>Counter</Text>
              <Text style={styles.counterValue}>{money(counter)}</Text>
            </Row>

            <PriceSlider
              min={sliderMin}
              max={neg.anchor}
              step={step}
              value={counter}
              onChange={setCounter}
              minLabel="their offer"
              maxLabel="your ask"
            />

            <Text style={styles.read}>{readCounter(neg, counter)}</Text>

            <Button
              label={
                counter <= neg.currentOffer ? 'Slide up to counter' : `Ask for ${money(counter)}`
              }
              sublabel={
                counter <= neg.currentOffer
                  ? undefined
                  : countersLeft === 1
                    ? 'last word — they take it or leave'
                    : `+${money(counter - neg.currentOffer)}`
              }
              tone="default"
              disabled={counter <= neg.currentOffer}
              onPress={() => onCounter(counter)}
              style={{ marginTop: 8 }}
            />
          </View>
        ) : agreed ? null : neg.countersMade > 0 ? (
          <Text style={styles.exhausted}>
            They are done negotiating. Take it or let them go.
          </Text>
        ) : null}
      </View>

      {/* ------------------------------------------------------- finance */}
      {financeAvailable ? (
        <View style={[styles.option, financeBeatsC && bookOpen && styles.optionHighlight]}>
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

          {bookOpen ? (
            <Button
              label="Write the note"
              sublabel={
                financeBeatsC ? `+${money(financeEv - neg.currentOffer)} over cash` : undefined
              }
              tone={financeBeatsC ? 'primary' : 'default'}
              onPress={onFinance}
              style={{ marginTop: 10 }}
            />
          ) : (
            // A disabled button rather than a hidden one: the deal that is not
            // available is still information, and the player needs to see what
            // the full book is costing them on this specific customer.
            <>
              <Button
                label="Book is full"
                sublabel={`${bookSize}/${bookLimit} contracts`}
                tone="ghost"
                disabled
                onPress={onFinance}
                style={{ marginTop: 10 }}
              />
              <Text style={styles.bookFull}>
                The collections desk will not carry another contract. Take the cash, or staff the
                desk and come back to the next one.
              </Text>
            </>
          )}
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
  tell: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontStyle: 'italic',
    lineHeight: 15,
    marginTop: 6,
  },
  counterBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 2,
  },
  counterTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  counterValue: {
    color: theme.colors.accent,
    fontSize: 17,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  read: { color: theme.colors.textDim, fontSize: 12, lineHeight: 16, marginTop: 2 },
  exhausted: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },
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
  bookFull: {
    color: theme.colors.warn,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 8,
    textAlign: 'center',
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
