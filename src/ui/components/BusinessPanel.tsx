import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { setBusinessPolicy, setDealPolicy } from '../../sim/actions';
import { BALANCE } from '../../sim/balance';
import { businessPolicy, repoDamageMultiplier } from '../../sim/business';
import { activeNotes } from '../../sim/notes';
import { getStage } from '../../sim/stages';
import { collectionsCapacity, level } from '../../sim/upgrades';
import type { DealPolicy, GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, moneyShort, theme } from '../theme';
import { Button, Card, Label, Meter, Row } from './ui';

/**
 * The house rules.
 *
 * Everything here is a constraint the player sets once and then stops thinking
 * about, which is the whole point of an idle game's mid-game: the business
 * should be able to run to your standards while you are not looking. These are
 * deliberately *limits* rather than dials — a floor under the till, a trigger on
 * the hook, a price the buyer will not go above — because a limit is something
 * you can reason about after eight hours away and a dial is not.
 *
 * They live on the save, not in React, so they still apply offline. See
 * `BusinessPolicy` in types.ts.
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
  const hasDesk = level(state, 'salesDesk') > 0;
  const hasBuyer = level(state, 'autoBuy') > 0;

  const active = activeNotes(state.notes).length;
  const limit = collectionsCapacity(state);
  const full = active >= limit;

  const { workingCapitalChoices, buyMarginChoices, repoTriggerMin, repoTriggerMax } =
    BALANCE.business;
  const repoTriggers = [];
  for (let n = repoTriggerMin; n <= repoTriggerMax; n++) repoTriggers.push(n);

  // The damage the current trigger implies, quoted the way the player will feel
  // it: condition points off a car that comes back.
  const repoLoss = BALANCE.repoConditionLoss * repoDamageMultiplier(policy.repoAfterMissedPayments);

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
                  wide
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
            buyer on retainer both stop here.
          </Text>
          <View style={styles.choices}>
            {workingCapitalChoices.map((amount) => (
              <Choice
                key={amount}
                label={moneyShort(amount)}
                selected={policy.minWorkingCapital === amount}
                onPress={() => apply((s) => setBusinessPolicy(s, { minWorkingCapital: amount }))}
              />
            ))}
          </View>
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
          <View style={styles.choices}>
            {repoTriggers.map((n) => (
              <Choice
                key={n}
                label={String(n)}
                selected={policy.repoAfterMissedPayments === n}
                onPress={() =>
                  apply((s) => setBusinessPolicy(s, { repoAfterMissedPayments: n }))
                }
              />
            ))}
          </View>
          <Text style={styles.footnote}>
            A repo at this trigger costs the car about {Math.round(repoLoss * 100)} points of
            condition, before your recovery agent.
          </Text>
        </Card>

        {/* ------------------------------------------------------ buy margin */}
        <Card style={{ gap: 8, opacity: hasBuyer ? 1 : 0.55 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.ruleName}>Buyer's minimum margin</Text>
            <Text style={styles.ruleValue}>{Math.round(policy.minBuyMargin * 100)}%</Text>
          </Row>
          <Text style={styles.hint}>
            {hasBuyer
              ? 'How far under the worst case your buyer on retainer insists on being before it spends your money. Higher means fewer cars and better ones.'
              : 'Applies once you have a buyer on retainer. It sets how far under the worst case they insist on being before spending your money.'}
          </Text>
          <View style={styles.choices}>
            {buyMarginChoices.map((margin) => (
              <Choice
                key={margin}
                label={`${Math.round(margin * 100)}%`}
                selected={policy.minBuyMargin === margin}
                onPress={() => apply((s) => setBusinessPolicy(s, { minBuyMargin: margin }))}
              />
            ))}
          </View>
        </Card>
      </View>

      {/* ------------------------------------------------------------ the book */}
      {getStage(state.stage).financing ? (
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

function Choice({
  label,
  selected,
  onPress,
  wide = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  wide?: boolean;
}) {
  return (
    <Button
      label={label}
      tone={selected ? 'primary' : 'ghost'}
      onPress={onPress}
      style={wide ? styles.choiceWide : styles.choice}
    />
  );
}

const styles = StyleSheet.create({
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
  // Sized so the widest row — six repo triggers — stays on one line on a 360pt
  // phone, and so `$2.5k` is not ellipsised into `$2…`. At the shared button
  // padding both of those failed; a scale that wraps its last step reads as a
  // separate control rather than as the end of the scale.
  choice: { flexGrow: 1, flexBasis: 40, paddingHorizontal: 4 },
  choiceWide: { flexGrow: 1, flexBasis: '45%' },
});
