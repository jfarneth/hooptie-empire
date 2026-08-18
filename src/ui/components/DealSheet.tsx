import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BALANCE } from '../../sim/balance';
import { carLabel } from '../../sim/cars';
import { TIER_BLURB } from '../../sim/customers';
import { expectedCollections } from '../../sim/engine';
import {
  countersRemaining,
  paymentAcceptance,
  readCounter,
  readOffer,
  roundingIncrement,
  tellFor,
} from '../../sim/haggle';
import { pushedTerms } from '../../sim/actions';
import { repoThreshold } from '../../sim/business';
import { getStage } from '../../sim/stages';
import { level } from '../../sim/upgrades';
import { activeNotes, canWriteNote, overCapacityFactor } from '../../sim/notes';
import { haggleSkillFor } from '../../sim/skills';
import { collectionsCapacity } from '../../sim/upgrades';
import type { GameState, Prospect } from '../../sim/types';
import { OFFER_COLOR, TIER_COLOR, money, theme } from '../theme';
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
  onFinance: (push: number) => void;
  onDecline: () => void;
  onClose: () => void;
}) {
  // The sheet being open IS the claim — the staff stand back the moment you sit
  // down (see claimDeal in LotScreen), so what the subtitle owes the player is
  // the fact that this deal is now theirs to keep the whole margin on.
  const deskWaiting =
    level(state, 'salesDesk') > 0 && state.dealPolicy !== 'manual' && prospect != null;
  const deskTitle = getStage(state.stage).desk.title;

  // Hooks must run unconditionally, so the counter lives above the early return.
  const neg = prospect?.negotiation ?? null;
  const step = neg ? roundingIncrement(neg.anchor) : 100;
  // The slider bottoms out at their actual number so the "their offer" label is
  // telling the truth; the button below is what refuses a pointless counter.
  const sliderMin = neg ? neg.currentOffer : 0;
  const openingCounter = neg ? Math.min(neg.currentOffer + step, neg.anchor) : 0;

  const [counter, setCounter] = useState(openingCounter);
  // How far past their own payment we are asking. 1 is their number, which
  // always signs — the slider opens where the old take-it-or-leave-it button
  // used to be, so doing nothing behaves exactly as financing always did.
  const [push, setPush] = useState(1);

  // Reset the slider whenever a new buyer appears or they move their number.
  const negKey = neg ? `${prospect!.id}:${neg.currentOffer}:${neg.countersMade}` : null;
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (negKey && negKey !== lastKey.current) {
      lastKey.current = negKey;
      setCounter(openingCounter);
      setPush(1);
    }
  }, [negKey, openingCounter]);

  if (!prospect || !neg) {
    return <Sheet visible={false} title="" onClose={onClose} children={null} />;
  }

  const car = state.cars.find((c) => c.id === prospect.carId);
  const costBasis = car?.costBasis ?? 0;
  const financeAvailable = getStage(state.stage).financing;

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

  // Everything on the finance card is quoted at the payment currently on the
  // slider, through the same function the button writes the contract with — a
  // readout computed separately from the action is a readout that will
  // eventually lie about what the button does.
  const asked = pushedTerms(prospect, push);
  const pushedCollections = expectedCollections(
    asked.terms.weeks,
    asked.payment,
    missChance,
    repoThreshold(state),
  );
  const financeEv = prospect.downPayment + pushedCollections.expectedCollected;
  const signOdds = paymentAcceptance(
    asked.payment,
    prospect.financeTerms.weeklyPayment,
    prospect.paymentCeiling,
  );
  const cashProfit = neg.currentOffer - costBasis;
  // Follows the CURRENT offer, not the opening one: counter them up and the
  // headline goes amber and then green as they climb toward the sticker.
  const offerRead = readOffer(neg.currentOffer, neg.anchor);
  const financeEvProfit = financeEv - costBasis;
  const financeBeatsC = financeEv > neg.currentOffer;

  const scheduled = Math.round(asked.payment * asked.terms.weeks);
  // The top of the slider is deliberately past what most buyers can carry: the
  // rule is "you can price them out", and a track that stopped at a safe number
  // would make that unsayable. Rounded to a payment a person would quote.
  const maxPush = BALANCE.business.paymentPushes[BALANCE.business.paymentPushes.length - 1];

  return (
    <Sheet
      visible
      title={prospect.name}
      subtitle={
        car
          ? deskWaiting
            ? `wants the ${carLabel(car)} — yours to close, ${deskTitle.toLowerCase()} waived off`
            : `wants the ${carLabel(car)}`
          : undefined
      }
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
          {/* The same red/amber/green the lot painted this buyer, so the colour
              that made you walk over means one thing on both screens. */}
          <Text style={[styles.optionHeadline, { color: OFFER_COLOR[offerRead] }]}>
            {money(neg.currentOffer)}
          </Text>
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
            {/*
              The number that tracks the drag is PROFIT AT THIS PRICE, not the
              distance from their offer. Distance-from-offer was the machine's
              view of the slider — how hard you are pushing — and it answered a
              question nobody at a car deal is asking. What you want to know
              mid-drag is what the deal is worth at this number, and whether it
              is worth anything at all: green over your cost, red under it, the
              same convention the cash card's Profit line already uses. This is
              the player's own arithmetic (their cost, their counter), not a
              read of the buyer — the offer colours stay ask-relative for the
              reason readOffer documents.
            */}
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.counterTitle}>Counter</Text>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.counterValue}>{money(counter)}</Text>
                <Text
                  style={[
                    styles.counterProfit,
                    {
                      color:
                        counter - costBasis >= 0 ? theme.colors.money : theme.colors.danger,
                    },
                  ]}
                >
                  {counter - costBasis >= 0
                    ? `${money(counter - costBasis)} profit`
                    : `${money(costBasis - counter)} loss`}
                </Text>
              </View>
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
                // The profit readout lives beside the counter value above the
                // slider; repeating it here said the same number twice on one
                // card. The last-word warning is the only sublabel that earns
                // the space.
                counter > neg.currentOffer && countersLeft === 1
                  ? 'last word — they take it or leave'
                  : undefined
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
            down today, then {money(asked.payment)}/wk × {asked.terms.weeks} at{' '}
            {(asked.terms.apr * 100).toFixed(1)}%
            {push > 1 ? ` — they asked for ${money(prospect.financeTerms.weeklyPayment)}` : ''}
          </Text>

          {/* ------------------------------------------------ the payment push */}
          <View style={styles.counterBlock}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.counterTitle}>Weekly payment</Text>
              <Text style={[styles.counterValue, { color: OFFER_COLOR[readPush(signOdds)] }]}>
                {money(asked.payment)}
              </Text>
            </Row>

            <PriceSlider
              min={prospect.financeTerms.weeklyPayment}
              max={Math.round(prospect.financeTerms.weeklyPayment * maxPush)}
              step={paymentStep(prospect.financeTerms.weeklyPayment)}
              value={asked.payment}
              onChange={(next) => setPush(next / prospect.financeTerms.weeklyPayment)}
              minLabel="what they offered"
              maxLabel="all they could carry"
            />

            <Text style={styles.read}>{readPayment(signOdds, push)}</Text>
          </View>

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
              <Text style={styles.evLabel}>Chance they sign</Text>
              <Text
                style={[
                  styles.evStrong,
                  { color: signOdds >= 0.95 ? theme.colors.money : theme.colors.warn },
                ]}
              >
                {(signOdds * 100).toFixed(0)}%
              </Text>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.evLabel}>Chance you take it back</Text>
              <Text style={[styles.evStrong, { color: theme.colors.warn }]}>
                {(pushedCollections.defaultProbability * 100).toFixed(0)}%
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
              label={push > 1 ? `Write it at ${money(asked.payment)}/wk` : 'Write the note'}
              sublabel={
                financeBeatsC ? `+${money(financeEv - neg.currentOffer)} over cash` : undefined
              }
              tone={financeBeatsC ? 'primary' : 'default'}
              onPress={() => onFinance(push)}
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
                onPress={() => onFinance(1)}
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
  counterProfit: {
    fontSize: 12,
    fontWeight: '700',
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

/**
 * The same three-colour read the lot and the cash headline use, applied to how
 * likely this payment is to be signed. One scale across the whole sheet.
 */
function readPush(odds: number): 'strong' | 'fair' | 'weak' {
  if (odds >= 0.95) return 'strong';
  if (odds >= 0.6) return 'fair';
  return 'weak';
}

/** Plain English for where the payment sits against what they can carry. */
function readPayment(odds: number, push: number): string {
  if (push <= 1) return 'Their own number. They will sign this without blinking.';
  if (odds >= 0.95) return 'Comfortably inside what they can carry.';
  if (odds >= 0.75) return 'A stretch, but they can probably find it.';
  if (odds >= 0.5) return 'Tight. About even money they balk at this.';
  if (odds >= 0.25) return 'They are close to priced out — and some of them walk rather than haggle.';
  return 'This is more than they earn. Expect to lose them.';
}

/** Payments are quoted in dollars, so the slider should move in them. */
function paymentStep(base: number): number {
  return base >= 400 ? 10 : base >= 100 ? 5 : 1;
}
