import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { setBusinessPolicy, setDealPolicy } from '../../sim/actions';
import { BALANCE } from '../../sim/balance';
import { weeklyExpenses } from '../../sim/engine';
import { businessPolicy, repoDamageMultiplier } from '../../sim/business';
import {
  buyMarginRange,
  dealFloorIsOff,
  marginAtZ,
  stateFinanceScale,
  stateMarginScale,
  zOfMargin,
  type MarginScale,
} from '../../sim/margins';
import { activeNotes } from '../../sim/notes';
import { getStage, typicalCarPrice, typicalRetailPrice } from '../../sim/stages';
import { carCapacity, collectionsCapacity, level } from '../../sim/upgrades';
import type { DealPolicy, GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, moneyShort, theme } from '../theme';
import { Button, Card, Label, Meter, Row } from './ui';
import { Slider, SliderAnchor } from './Slider';

/**
 * The house rules.
 *
 * Everything here is a constraint the player sets once and then stops thinking
 * about, which is the whole point of an idle game's mid-game: the business
 * should be able to run to your standards while you are not looking. They live
 * on the save, not in React, so they still apply offline. See `BusinessPolicy`
 * in types.ts.
 *
 * SLIDERS, NOT CHIPS. This panel shipped as rows of discrete choices on the
 * argument that a limit is something you can reason about after eight hours away
 * and a dial is not. What that missed is that the limits are not the same size
 * at every store: the ladder moves a thousandfold from a curbstone driveway to a
 * Valmont franchise, and any fixed set of stops is either uselessly coarse at
 * one end or absurd at the other. A slider whose ENDS are derived per store
 * keeps the "set it once" property while letting the setting mean the same thing
 * at every rung — which is exactly the argument margins.ts makes for putting the
 * sales floors in standard deviations rather than in percent.
 */

const POLICY_LABEL: Record<DealPolicy, string> = {
  manual: 'Ask me',
  cash: 'Always cash',
  finance: 'Always finance',
  auto: 'Whichever pays more',
};

const POLICY_HINT: Record<DealPolicy, string> = {
  manual: 'Every walk-up waits for you to decide.',
  cash: 'Take the money and move the next car in.',
  finance: 'Write paper on everyone who will sign, whatever their credit.',
  auto: 'Compare the cash offer against the expected value of the note, deal by deal.',
};

export function BusinessPanel({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const policy = businessPolicy(state);
  const stage = getStage(state.stage);
  const bill = weeklyExpenses(state);
  const hasDesk = level(state, 'salesDesk') > 0;
  const hasBuyer = level(state, 'autoBuy') > 0;

  const active = activeNotes(state.notes).length;
  const limit = collectionsCapacity(state);
  const full = active >= limit;

  const { repoTriggerMin, repoTriggerMax } = BALANCE.business;

  // What a deal at THIS store is worth, with this save's prestige edge and
  // transporter bill in it. Every margin rule below is quoted against it.
  const scale = stateMarginScale(state, stage);
  const gross = typicalRetailPrice(stage);

  // The damage the current trigger implies, quoted the way the player will feel
  // it: condition points off a car that comes back.
  const repoLoss = BALANCE.repoConditionLoss * repoDamageMultiplier(policy.repoAfterMissedPayments);

  const capitalMax = workingCapitalMax(bill.total, typicalCarPrice(stage) * carCapacity(state));
  const buyRange = buyMarginRange(scale);

  return (
    <View style={{ gap: 14 }}>
      {hasDesk ? (
        <View style={{ gap: 8 }}>
          <Label>Standing order</Label>
          <Card style={{ gap: 8 }}>
            <Text style={styles.hint}>{POLICY_HINT[state.dealPolicy]}</Text>
            <View style={styles.choices}>
              {(Object.keys(POLICY_LABEL) as DealPolicy[]).map((option) => (
                <Choice
                  key={option}
                  label={POLICY_LABEL[option]}
                  selected={state.dealPolicy === option}
                  onPress={() => apply((s) => setDealPolicy(s, option))}
                />
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <Label>House rules</Label>

        {/* ----------------------------------------------- working capital */}
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.ruleName}>Minimum working capital</Text>
            <Text style={styles.ruleValue}>{money(policy.minWorkingCapital)}</Text>
          </Row>
          <Text style={styles.hint}>
            Nothing that runs without you will spend the till below this. The shop order and the
            buyer on retainer both stop here — and nothing else does: this is the only floor, and
            bills come out whether the money is there or not.
          </Text>
          {/* The number the floor exists to cover, quoted from the same
              function the bill charges — set it blind and "why is my account
              overdrawn" is the next question. */}
          <Text style={styles.expensesNote}>
            Your bills run {money(bill.total)} a week right now
            {bill.debtService > 0
              ? ` — ${money(bill.rent + bill.payroll + bill.floorplan)} of costs and ${money(bill.debtService)} to the shark.`
              : ` (rent ${money(bill.rent)}, payroll ${money(bill.payroll)}, floorplan ${money(bill.floorplan)}).`}
          </Text>
          <Slider
            min={0}
            max={capitalMax.max}
            step={capitalMax.step}
            value={Math.min(policy.minWorkingCapital, capitalMax.max)}
            onChange={(next) => apply((s) => setBusinessPolicy(s, { minWorkingCapital: next }))}
            minLabel={<SliderAnchor value="$0" label="spend it all" />}
            maxLabel={
              <SliderAnchor value={moneyShort(capitalMax.max)} label="hoard it" align="flex-end" />
            }
          />
          {policy.minWorkingCapital > state.cash ? (
            <Text style={styles.warning}>
              You are under your own floor, so nothing is buying or reconditioning right now.
            </Text>
          ) : null}
        </Card>

        {/* ---------------------------------------------------- repo trigger */}
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.ruleName}>Take the car back after</Text>
            <Text style={styles.ruleValue}>
              {policy.repoAfterMissedPayments} missed
            </Text>
          </Row>
          <Text style={styles.hint}>
            Pull sooner and you recover a better car from a customer who might have caught up.
            Give them rope and you collect more from the ones who do — and get back a rougher
            car from the ones who never had it.
          </Text>
          <Slider
            min={repoTriggerMin}
            max={repoTriggerMax}
            step={1}
            value={policy.repoAfterMissedPayments}
            onChange={(next) =>
              apply((s) => setBusinessPolicy(s, { repoAfterMissedPayments: next }))
            }
            minLabel={<SliderAnchor value={`${repoTriggerMin} missed`} label="hair trigger" />}
            maxLabel={
              <SliderAnchor value={`${repoTriggerMax} missed`} label="all the rope" align="flex-end" />
            }
          />
          <Text style={styles.footnote}>
            A repo at this trigger costs the car about {Math.round(repoLoss * 100)} points of
            condition, before your recovery agent.
          </Text>
        </Card>
      </View>

      {/* ------------------------------------------------------ the sales desk */}
      {hasDesk ? (
        <View style={{ gap: 8 }}>
          <Label>What the desk will sign</Label>

          <MarginRule
            name={`${stage.desk.title}: cash deals`}
            z={policy.minCashMarginZ}
            scale={scale}
            gross={gross}
            hint="The least your staff will take on a cash sale, judged against what the car cost you. They will still counter to try to get there — this is what they refuse to sign, not what they open with."
            onChange={(z) => apply((s) => setBusinessPolicy(s, { minCashMarginZ: z }))}
          />

          {stage.financing ? (
            <MarginRule
              name={`${stage.desk.title}: financing`}
              z={policy.minFinanceMarginZ}
              // Paper has its own yardstick: it grosses the window price and then
              // collects only part of it, so an average contract is worth well
              // over an average cash deal and a shared scale would leave the
              // bottom two thirds of this slider doing nothing.
              scale={stateFinanceScale(state, stage, scale)}
              gross={gross}
              hint="The same rule for paper, judged on what the contract is expected to COLLECT rather than on what it says. Raise it and the desk stops writing deep subprime — it is an underwriting standard, not a price."
              onChange={(z) => apply((s) => setBusinessPolicy(s, { minFinanceMarginZ: z }))}
            />
          ) : null}

          <Text style={styles.footnote}>
            Neither rule touches a deal you close yourself. Grab a walk-up inside the first{' '}
            {Math.round(BALANCE.desk.graceMs / 1000)} seconds and the price is your call, as it
            always was.
          </Text>
        </View>
      ) : null}

      {/* ------------------------------------------------------ the buy side */}
      <View style={{ gap: 8 }}>
        <Label>What the buyer will pay</Label>
        <Card style={{ gap: 8, opacity: hasBuyer ? 1 : 0.55 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.ruleName}>Buyer's minimum margin</Text>
            <Text style={[styles.ruleValue, policy.minBuyMargin < 0 && { color: theme.colors.danger }]}>
              {formatMargin(policy.minBuyMargin)}
            </Text>
          </Row>
          <Text style={styles.hint}>
            {hasBuyer
              ? 'How far under the worst case your buyer on retainer insists on being before it spends your money. Higher means fewer cars and better ones; below zero it will overpay to keep the stalls full.'
              : 'Applies once you have a buyer on retainer. It sets how far under the worst case they insist on being before spending your money.'}
          </Text>
          <Slider
            min={buyRange.min}
            max={buyRange.max}
            step={niceMarginStep(scale.sd)}
            value={clamp(policy.minBuyMargin, buyRange.min, buyRange.max)}
            onChange={(next) => apply((s) => setBusinessPolicy(s, { minBuyMargin: next }))}
            minLabel={<SliderAnchor value={formatMargin(buyRange.min)} label="fill the lot" />}
            maxLabel={
              <SliderAnchor value={formatMargin(buyRange.max)} label="steals only" align="flex-end" />
            }
          />
          <ScaleNote margin={policy.minBuyMargin} scale={scale} gross={gross} />
        </Card>
      </View>

      {/* ------------------------------------------------------------ the book */}
      {stage.financing ? (
        <View style={{ gap: 8 }}>
          <Label>The book</Label>
          <Card style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.ruleName}>Contracts you can carry</Text>
              <Text style={[styles.ruleValue, full && { color: theme.colors.danger }]}>
                {active} / {limit}
              </Text>
            </Row>
            <Meter
              progress={active / Math.max(1, limit)}
              color={full ? theme.colors.danger : theme.colors.accent}
            />
            <Text style={styles.hint}>
              {full
                ? 'The desk is full. Walk-ups get sold the car, not the payment, until something on the book closes out. Staff the collections desk to carry more.'
                : `Room for ${limit - active} more. Past that the finance desk stops writing — staff the collections desk to raise it.`}
            </Text>
          </Card>
        </View>
      ) : null}
    </View>
  );
}

/**
 * One sales floor.
 *
 * The slider runs in STANDARD DEVIATIONS, with one stop below the scale that
 * means no floor at all — the position the rule ships in, and the one thing on
 * this panel that has to be a distinct stop rather than the bottom of a range.
 * At a franchise σ is under two margin points, so even the bottom of the scale
 * is a real rule there; "take anything" cannot be spelled as a small number.
 */
function MarginRule({
  name,
  z,
  scale,
  gross,
  hint,
  onChange,
}: {
  name: string;
  z: number;
  scale: MarginScale;
  gross: number;
  hint: string;
  onChange: (z: number) => void;
}) {
  const { marginZMin, marginZMax, marginZStep } = BALANCE.business;
  const off = dealFloorIsOff(z);
  // One stop to the left of the scale is the "any deal" position. Anything the
  // slider emits below the scale is clamped onto the stored off value by
  // `clampBusinessPolicy`, so the two ends of this only have to agree on which
  // side of `marginZMin` they are.
  const sliderMin = marginZMin - marginZStep;
  const margin = marginAtZ(scale, z);

  return (
    <Card style={{ gap: 8 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.ruleName}>{name}</Text>
        <Text style={[styles.ruleValue, off && { color: theme.colors.textDim }]}>
          {off ? 'Any deal' : formatMargin(margin)}
        </Text>
      </Row>
      <Text style={styles.hint}>{hint}</Text>
      <Slider
        min={sliderMin}
        max={marginZMax}
        step={marginZStep}
        value={off ? sliderMin : z}
        onChange={onChange}
        minLabel={<SliderAnchor value="Any deal" label="move the metal" />}
        maxLabel={<SliderAnchor value={`+${marginZMax}σ`} label="steals only" align="flex-end" />}
      />
      {off ? (
        <Text style={styles.footnote}>
          No floor. Whatever walks up gets sold, at whatever it takes — which is what the desk did
          before this rule existed.
        </Text>
      ) : (
        <ScaleNote margin={margin} scale={scale} gross={gross} />
      )}
    </Card>
  );
}

/**
 * Where a margin sits against the store's own deals, in σ and in dollars.
 *
 * Both halves earn their place. The σ figure is the only thing that makes two
 * stores comparable; the dollar figure is the only thing that makes either of
 * them mean anything on a Tuesday.
 */
function ScaleNote({
  margin,
  scale,
  gross,
}: {
  margin: number;
  scale: MarginScale;
  gross: number;
}) {
  const z = zOfMargin(scale, margin);
  const unreachable = margin > scale.best;
  // A financed deal grosses the window price and collects part of it, so the
  // dollars behind the same percentage are not the same dollars. The scale
  // carries its own multiple rather than the caller guessing.
  const deal = gross * scale.grossOfRetail;
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.footnote}>
        {describeZ(z)} — the average deal here is {formatMargin(scale.mean)}, and this one keeps{' '}
        {money(Math.round(margin * deal))} of a typical {money(Math.round(deal))} deal.
      </Text>
      {unreachable ? (
        <Text style={styles.warning}>
          Nothing this store sources clears that on its own. Only a trim grade or a customer paying
          over sticker will get there.
        </Text>
      ) : null}
    </View>
  );
}

/** Plain English for a z-score, because "+1.75σ" is not a sentence. */
function describeZ(z: number): string {
  const tag = `${z >= 0 ? '+' : ''}${z.toFixed(1)}σ`;
  if (z <= -2) return `${tag}, a deal nobody would take twice`;
  if (z <= -0.75) return `${tag}, well under an average deal`;
  if (z < 0.75) return `${tag}, about an average deal`;
  if (z < 1.75) return `${tag}, a good deal`;
  return `${tag}, a steal`;
}

/** Margins are quoted as whole points; a slider stop that reads 5% must not store 5.4%. */
function formatMargin(margin: number): string {
  return `${Math.round(margin * 100)}%`;
}

/**
 * Step size for the buy slider: about a quarter of a standard deviation, rounded
 * to a figure a person would say. Snapped against zero by the slider itself, so
 * break-even — the default, and the one landmark on this scale — is always
 * exactly reachable whatever the store.
 */
function niceMarginStep(sd: number): number {
  const target = sd / 4;
  for (const step of [0.0025, 0.005, 0.01, 0.025, 0.05]) {
    if (target <= step) return step;
  }
  return 0.05;
}

/**
 * How far the working capital slider reaches.
 *
 * Sized against the two things the float is actually for — making rent, and
 * restocking a lot that has sold out — so it spans something usable on a
 * driveway and at a franchise without a table of magic numbers in between.
 * Holding back more than a full lot's worth of stock is not a house rule, it is
 * a decision to stop trading, so that is where the track ends.
 */
function workingCapitalMax(weeklyBill: number, restock: number): { max: number; step: number } {
  const raw = Math.max(2_000, weeklyBill * 8, restock);
  // Round the end of the track to a figure worth reading, then step it fine
  // enough that the early game can still pick a few hundred dollars.
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const max = Math.ceil(raw / magnitude) * magnitude;
  return { max, step: Math.max(50, magnitude / 20) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Button
      label={label}
      tone={selected ? 'primary' : 'ghost'}
      onPress={onPress}
      style={styles.choiceWide}
    />
  );
}

const styles = StyleSheet.create({
  expensesNote: {
    color: '#e3b341',
    fontSize: 12,
    lineHeight: 16,
    fontVariant: ['tabular-nums'],
  },
  ruleName: { color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  ruleValue: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  hint: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  footnote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 15 },
  warning: { color: theme.colors.warn, fontSize: 11, lineHeight: 15 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choiceWide: { flexGrow: 1, flexBasis: '45%' },
});
