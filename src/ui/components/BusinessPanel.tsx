import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { setBusinessPolicy, setDealPolicy } from '../../sim/actions';
import { BALANCE } from '../../sim/balance';
import { weeklyExpenses } from '../../sim/engine';
import {
  OFFER_FLOOR_LEVELS,
  OFFER_FLOOR_NAMES,
  PAYMENT_PUSH_LEVELS,
  PAYMENT_PUSH_NAMES,
  businessPolicy,
  offerFloorIsOff,
  paymentPushIsOff,
  repoDamageMultiplier,
  retailMarkup,
} from '../../sim/business';
import { bookValue } from '../../sim/economy';
import { buyMarginRange, stateMarginScale, zOfMargin, type MarginScale } from '../../sim/margins';
import { activeNotes } from '../../sim/notes';
import {
  SERVICE_PLAN_BANDS,
  SERVICE_PLAN_LEVELS,
  attachChance,
  expectedLossRatio,
  hasServiceDept,
  planBandIsOff,
  planBandMultiplier,
  planBandName,
} from '../../sim/service';
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
 * one end or absurd at the other. A slider whose ends are per store keeps the
 * "set it once" property while letting the setting mean the same thing at every
 * rung.
 *
 * WHAT A STOP MEANS IS FIXED, AND THAT IS THE POINT. The two sales floors ran
 * on standard deviations off a distribution derived from the store's ask band,
 * which meant the number behind a setting moved every time the economy was
 * retuned. They are levels on a hard-coded per-store ladder now — see
 * `dealFloors` in stages.ts — so a rule set today reads the same next month.
 * The derived distribution has not gone anywhere; it is what every readout on
 * this panel quotes a setting AGAINST, which is how a fixed number can still
 * tell you it is a good one for this lot right now.
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
  const buyRange = buyMarginRange(stage);

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
              ? ` — ${money(bill.total - bill.debtService)} of costs and ${money(bill.debtService)} to the shark.`
              : ` (rent ${money(bill.rent)}, payroll ${money(bill.payroll)}, floorplan ${money(bill.floorplan)}${
                  bill.shopPayroll > 0 ? `, the bays ${money(bill.shopPayroll)}` : ''
                }).`}
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

          <Card style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.ruleName}>{stage.desk.title}: cash offers</Text>
              <Text
                style={[
                  styles.ruleValue,
                  offerFloorIsOff(policy.offerFloorLevel) && { color: theme.colors.textDim },
                ]}
              >
                {offerFloorIsOff(policy.offerFloorLevel)
                  ? 'Any offer'
                  : `${Math.round(offerStop(policy.offerFloorLevel) * 100)}% of ask`}
              </Text>
            </Row>
            <Text style={styles.hint}>
              How close to your sticker they have to get. The same scale the lot paints buyers with,
              so a shopper showing red is one your desk turns down at "Nothing red". It says nothing
              about profit — price the lot cheap and this will sell cheap.
            </Text>
            <Slider
              min={0}
              max={OFFER_FLOOR_LEVELS}
              step={1}
              value={Math.min(policy.offerFloorLevel, OFFER_FLOOR_LEVELS)}
              onChange={(next) => apply((s) => setBusinessPolicy(s, { offerFloorLevel: next }))}
              minLabel={<SliderAnchor value="Any offer" label="move the metal" />}
              maxLabel={
                <SliderAnchor value="Near sticker" label="turn most away" align="flex-end" />
              }
            />
            <OfferNote level={policy.offerFloorLevel} gross={gross} />
          </Card>

          {stage.financing ? (
            <Card style={{ gap: 8 }}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text style={styles.ruleName}>{stage.desk.title}: financed deals</Text>
                <Text
                  style={[
                    styles.ruleValue,
                    paymentPushIsOff(policy.paymentPushLevel) && { color: theme.colors.textDim },
                  ]}
                >
                  {paymentPushIsOff(policy.paymentPushLevel)
                    ? 'Their number'
                    : `+${Math.round((pushStop(policy.paymentPushLevel) - 1) * 100)}% payment`}
                </Text>
              </Row>
              <Text style={styles.hint}>
                A financed customer is buying a weekly payment; you are selling what the contract
                collects. This is how far past their own number the desk pushes — worth more on
                every deal that signs, and some of them will not.
              </Text>
              <Slider
                min={0}
                max={PAYMENT_PUSH_LEVELS}
                step={1}
                value={Math.min(policy.paymentPushLevel, PAYMENT_PUSH_LEVELS)}
                onChange={(next) => apply((s) => setBusinessPolicy(s, { paymentPushLevel: next }))}
                minLabel={<SliderAnchor value="Their number" label="never lose one" />}
                maxLabel={
                  <SliderAnchor value="All they carry" label="price some out" align="flex-end" />
                }
              />
              <PushNote level={policy.paymentPushLevel} />
            </Card>
          ) : null}

          <Text style={styles.footnote}>
            Neither rule touches a deal you close yourself. Grab a walk-up inside the first{' '}
            {Math.round(BALANCE.desk.graceMs / 1000)} seconds and both numbers are your call, as
            they always were.
          </Text>
        </View>
      ) : null}

      {/* -------------------------------------------------------- the pricing */}
      <View style={{ gap: 8 }}>
        <Label>What you ask for a car</Label>
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.ruleName}>Listing markup over book</Text>
            <Text style={styles.ruleValue}>+{Math.round(policy.listMarkup * 100)}%</Text>
          </Row>
          <Text style={styles.hint}>
            Your buyer works off an appraisal and is often wrong. By the time a car is on the lot
            there is nothing left to guess, so this prices it off what it is really worth —
            reconditioning included. A car that cleaned up better than it looked simply lists for
            more.
          </Text>
          <Slider
            min={BALANCE.business.listMarkupMin}
            max={BALANCE.business.listMarkupMax}
            step={0.01}
            value={clamp(
              policy.listMarkup,
              BALANCE.business.listMarkupMin,
              BALANCE.business.listMarkupMax,
            )}
            onChange={(next) => apply((s) => setBusinessPolicy(s, { listMarkup: next }))}
            minLabel={<SliderAnchor value="At book" label="clear the lot" />}
            maxLabel={
              <SliderAnchor
                value={`+${Math.round(BALANCE.business.listMarkupMax * 100)}%`}
                label="hold out"
                align="flex-end"
              />
            }
          />
          <MarkupNote state={state} markup={policy.listMarkup} />
        </Card>
      </View>

      {/* --------------------------------------------------- service contracts */}
      {stage.serviceContracts ? (
        <View style={{ gap: 8 }}>
          <Label>What cover costs</Label>
          <Card style={{ gap: 8 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.ruleName}>Service contract pricing</Text>
              <Text
                style={[
                  styles.ruleValue,
                  planBandIsOff(policy.servicePlanBand) && { color: theme.colors.textDim },
                ]}
              >
                {planBandName(policy.servicePlanBand)}
              </Text>
            </Row>
            <Text style={styles.hint}>
              What a plan costs is the car's risk, not your call — cover on a rough one is dearer
              because it will be claimed on. What you set is the markup, and the share of buyers who
              say yes moves against it.
            </Text>
            <Slider
              min={0}
              max={SERVICE_PLAN_LEVELS}
              step={1}
              value={Math.min(policy.servicePlanBand, SERVICE_PLAN_LEVELS)}
              onChange={(next) => apply((s) => setBusinessPolicy(s, { servicePlanBand: next }))}
              minLabel={<SliderAnchor value="Don't sell" label="no cover" />}
              maxLabel={
                <SliderAnchor
                  value={SERVICE_PLAN_BANDS[SERVICE_PLAN_LEVELS - 1].name}
                  label="fewest takers"
                  align="flex-end"
                />
              }
            />
            {planBandIsOff(policy.servicePlanBand) ? (
              <Text style={styles.footnote}>
                No cover offered. The margin goes with it — and so does the risk: a bad plan costs
                you half again what it sold for.
              </Text>
            ) : (
              <PlanNote state={state} band={policy.servicePlanBand} />
            )}
          </Card>
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
 * What a cash floor lets through, in the language of the lot.
 *
 * Quoted against the ASK rather than against a distribution, because that is
 * what the rule now is. The dollar figure is what makes a percentage mean
 * something on a Tuesday, and it is the store's typical sticker.
 */
function OfferNote({ level, gross }: { level: number; gross: number }) {
  if (offerFloorIsOff(level)) {
    return (
      <Text style={styles.footnote}>
        No floor. Whatever walks up gets sold, at whatever they will pay — which is what the desk
        did before this rule existed, and is still how you clear a lot in a hurry.
      </Text>
    );
  }
  const stop = offerStop(level);
  const { strong, fair } = BALANCE.negotiation.offerRead;
  const colour =
    stop >= strong ? 'only the green ones' : stop >= fair ? 'green and amber' : 'everything but a deep lowball';
  return (
    <Text style={styles.footnote}>
      {OFFER_FLOOR_NAMES[Math.min(level, OFFER_FLOOR_LEVELS) - 1]} — takes {colour}. On a typical{' '}
      {money(Math.round(gross))} sticker here that is {money(Math.round(gross * stop))} or better.
    </Text>
  );
}

/** What a push is worth, and what it risks. */
function PushNote({ level }: { level: number }) {
  if (paymentPushIsOff(level)) {
    return (
      <Text style={styles.footnote}>
        The desk writes whatever payment the customer walked in able to make. Nobody is ever priced
        out, and nobody ever pays a dollar more than they offered.
      </Text>
    );
  }
  const push = pushStop(level);
  return (
    <Text style={styles.footnote}>
      {PAYMENT_PUSH_NAMES[Math.min(level, PAYMENT_PUSH_LEVELS) - 1]} — about{' '}
      {Math.round((push - 1) * 100)}% more collected on every contract that signs. Past what a
      customer can carry they balk, and some of them leave rather than take the cash deal.
    </Text>
  );
}

/**
 * What the markup implies HERE, which is the only way a single percentage can
 * mean anything across a thousandfold ladder.
 *
 * A franchise buys at invoice, already well over book, so the same +20% that is
 * a fat margin at a curbstone lists a Valmont under cost. The count of cars it
 * would list under cost is the number that matters, and it is here rather than
 * on a warning at listing time because listing is automatic and nobody is
 * watching when it happens.
 */
function MarkupNote({ state, markup }: { state: GameState; markup: number }) {
  const retail = retailMarkup();
  const held = state.cars.filter((c) => c.status !== 'sold');
  const underCost = held.filter((c) => bookValue(c) * (1 + markup) < c.costBasis).length;
  const relative = Math.round((markup - retail) * 100);

  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.footnote}>
        {Math.abs(relative) <= 1
          ? 'Cash retail — what the lot has always asked. Traffic is exactly what it is used to.'
          : relative < 0
            ? `About ${-relative}% under cash retail. More buyers through the door, less on each one.`
            : `About ${relative}% over cash retail. Fewer buyers, and past half again they stop coming at all.`}
      </Text>
      {underCost > 0 ? (
        <Text style={styles.warning}>
          {underCost} car{underCost > 1 ? 's' : ''} on your lot would list under what
          {underCost > 1 ? ' they' : ' it'} cost you at this markup.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * What this band means, in the two numbers a player can act on: how many buyers
 * take it, and what the house keeps if the book behaves.
 *
 * The margin quoted is the one the loss ratio implies at THIS band, not the
 * headline 35% — pricing under cost is a real position on this slider (the
 * bottom band sits below the loss ratio) and the panel has to say so rather
 * than quietly reporting the middle band's number everywhere.
 */
function PlanNote({ state, band }: { state: GameState; band: number }) {
  const odds = attachChance(state, band);
  const multiplier = planBandMultiplier(band);
  const loss = expectedLossRatio(state);
  const margin = multiplier > 0 ? 1 - loss / multiplier : 0;

  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.footnote}>
        About {Math.round(odds * 100)} buyers in a hundred take it, and the house keeps roughly{' '}
        {Math.round(margin * 100)}% of what they pay — averaged over a book, not on any one plan.
      </Text>
      {hasServiceDept(state) ? (
        <Text style={styles.footnote}>
          Your own bays honour the claims, which is worth fifteen points of that margin. It also
          means the cheaper bands pay better here than they would without a shop.
        </Text>
      ) : null}
      {margin < 0 ? (
        <Text style={styles.warning}>
          Priced under what the claims cost. You are buying customers with your own money.
        </Text>
      ) : null}
    </View>
  );
}

/**
 * What a margin is worth here — against the store's own deals, and in dollars.
 *
 * Both halves earn their place. The comparison against the store's average is
 * the only thing that says whether 15% is a shrug or a wall; the dollar figure
 * is the only thing that makes either of them mean anything on a Tuesday. This
 * is where the derived distribution still does its job now that the rules
 * themselves are tabulated: the numbers do not move, so this is how the panel
 * tells you what today's economy makes of them.
 */
function ScaleNote({
  margin,
  scale,
  gross,
  lead,
}: {
  margin: number;
  scale: MarginScale;
  gross: number;
  /** The stop's name, where it has one. The buy slider is a plain margin. */
  lead?: string;
}) {
  const unreachable = margin > scale.best;
  // A financed deal grosses the window price and collects part of it, so the
  // dollars behind the same percentage are not the same dollars. The scale
  // carries its own multiple rather than the caller guessing.
  const deal = gross * scale.grossOfRetail;
  return (
    <View style={{ gap: 2 }}>
      <Text style={styles.footnote}>
        {lead ? `${lead} — ${describeAgainst(margin, scale)}` : sentenceCase(describeAgainst(margin, scale))}
        , at a store averaging {formatMargin(scale.mean)}. Keeps{' '}
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

/**
 * Plain English for where a fixed margin lands on this store's live spread.
 *
 * Deliberately not "+1.75σ". The player is setting a percentage now, and the
 * only thing they need from the distribution is how much of the lot it lets
 * through — a sentence, not a statistic.
 */
function describeAgainst(margin: number, scale: MarginScale): string {
  const z = zOfMargin(scale, margin);
  if (z <= -2) return 'a floor almost anything clears';
  if (z <= -0.75) return 'well under an average deal';
  if (z < 0.75) return 'about an average deal';
  if (z < 1.75) return 'a good deal';
  return 'a steal, and rare';
}

/** The verdict leads the sentence when there is no stop name in front of it. */
function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
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

/** The stop a cash floor level indexes, as a share of the ask. */
function offerStop(level: number): number {
  const stops = BALANCE.business.offerFloors;
  return stops[Math.min(Math.round(level), stops.length) - 1] ?? 0;
}

/** The stop a payment push level indexes, as a multiple of their own payment. */
function pushStop(level: number): number {
  const stops = BALANCE.business.paymentPushes;
  return stops[Math.min(Math.round(level), stops.length) - 1] ?? 1;
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
