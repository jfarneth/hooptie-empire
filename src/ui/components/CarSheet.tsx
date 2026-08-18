import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { canRecon, reconCost, reconDurationMs, reconLift, reconValueGain } from '../../sim/cars';
import { reconModsFor } from '../../sim/skills';
import { retailValue, wholesaleValue } from '../../sim/economy';
import { BALANCE, MS_PER_GAME_DAY } from '../../sim/balance';
import { STALE_DAYS, inventoryLine } from '../../sim/inventory';
import { getModel } from '../../sim/models';
import { RARITIES, rarityValueMult } from '../../sim/rarity';
import { getStage } from '../../sim/stages';
import { windowPrice } from '../../sim/engine';
import type { Car, GameState } from '../../sim/types';
import { RARITY_COLOR, duration, money, theme } from '../theme';
import { CarArt } from '../art/CarArt';
import { costTrail } from './costTrail';
import { Sheet } from './Sheet';
import { Button, Chip, Meter, Row } from './ui';

/** Inventory detail: what this car is worth, what it needs, and what to do with it. */
export function CarSheet({
  state,
  car,
  onRecon,
  onList,
  onUnlist,
  onReprice,
  onWholesale,
  onClose,
}: {
  state: GameState;
  car: Car | null;
  onRecon: () => void;
  onList: () => void;
  onUnlist: () => void;
  onReprice: (price: number) => void;
  onWholesale: () => void;
  onClose: () => void;
}) {
  if (!car) return <Sheet visible={false} title="" onClose={onClose} children={null} />;

  const model = getModel(car.modelId);
  const badge = RARITIES[car.rarity].badge;
  const retail = retailValue(car);
  // THE PRICING REFERENCE IS CASH RETAIL, because that is what the sticker is
  // denominated in and what traffic is judged against. It used to be
  // `windowPrice`, which on a financing stage is retail x the store's subprime
  // markup — so this sheet told a player that a car priced at exactly what it is
  // worth was "under market", and its "Match market" button repriced that car to
  // 1.5x retail, a whisker under `maxViablePriceRatio`, killing its traffic
  // almost dead. Both were invisible while cars sold in a day and obvious the
  // moment they started sitting: the sheet read "42 days on the lot" and
  // "priced under market, it will move fast" one line apart.
  //
  // Same lesson `listCar` already carries. The subprime premium belongs on the
  // contract, not on the windscreen; the Financed figure above is where it is
  // shown, and it is not what anybody shops against.
  const reference = retail;
  const shop = reconModsFor(state);
  const cost = reconCost(car, shop);
  const canWork = canRecon(car, shop);
  const affordable = state.cash >= cost;

  // Quoted straight from the sim so the sheet can never promise a different
  // number than the engine delivers.
  const gain = reconValueGain(car, shop);
  const reconProgress = car.reconTotalMs > 0 ? 1 - car.reconRemainingMs / car.reconTotalMs : 0;

  // Days on the lot: the number a real dealer runs their whole week off, and
  // until now the one thing the game tracked and never showed. `listedAt` has
  // been on every car since listings existed. Cars are meant to sit for weeks,
  // so "how long has this one been sitting" is the question the sheet exists to
  // answer — and it is what turns the price buttons below from decoration into a
  // decision.
  const daysListed = car.listedAt === null ? null : (state.t - car.listedAt) / MS_PER_GAME_DAY;
  const wholesale = Math.round(wholesaleValue(car) * BALANCE.forcedSaleRate);

  // The same line the ageing report shows for this car, from the same
  // derivation. Two screens describing one car's cost out of two computations
  // is how a sheet ends up saying "priced under market" and "42 days on the
  // lot" one line apart.
  const ledger = inventoryLine(state, car);

  return (
    <Sheet
      visible
      title={model.name}
      subtitle={`${car.mileage.toLocaleString('en-US')} mi · ${Math.round(car.condition * 100)}% condition${
        car.repoCount > 0 ? ` · repossessed ${car.repoCount}×` : ''
      }`}
      onClose={onClose}
    >
      <View style={styles.hero}>
        <CarArt
          modelId={car.modelId}
          colorIndex={car.colorIndex}
          condition={car.condition}
          rarity={car.rarity}
          width={220}
        />
      </View>

      {car.repoCount > 0 ? (
        <Row gap={8} style={styles.grade}>
          <Chip text="BACK ON THE LOT" color={theme.colors.warn} filled />
          {/* This used to quote `costBasis` and call it "Carrying", which put
              two different meanings of that word on one screen the moment the
              cost trail below started naming floorplan interest as carrying —
              $41,022 in one place and $1,313 in the other, both correct, both
              labelled the same. It explains the All in figure now instead of
              competing with it, using the money the customer actually handed
              over, which is the interesting half anyway. */}
          <Text style={styles.gradeNote}>
            {ledger.allIn <= 0
              ? 'This one has already paid for itself. Whatever it sells for now is all profit.'
              : `The customer handed over ${money(ledger.returned)} before it came home, which is why it is in for less than it cost.`}
          </Text>
        </Row>
      ) : null}

      {badge ? (
        <Row gap={8} style={styles.grade}>
          <Chip text={badge.toUpperCase()} color={RARITY_COLOR[car.rarity]} filled />
          <Text style={styles.gradeNote}>
            Worth {Math.round((rarityValueMult(car.rarity) - 1) * 100)}% more than the same car in
            stock trim — and nobody charged you for it.
          </Text>
        </Row>
      ) : null}

      <View style={styles.figures}>
        {/* "You paid" was never quite true and stopped being true at all the
            moment a car came back: `costBasis` folds recon in, and a repo
            rewrites it to what is LEFT in the unit. ALL IN is the honest
            headline — every dollar this car has taken out of the till, less
            anything a customer has handed back — and the trail underneath is
            what it is made of. */}
        <Figure label="All in" value={money(ledger.allIn)} />
        <Figure label="Cash retail" value={money(retail)} accent />
        {getStage(state.stage).financing ? (
          // What somebody who needs financing pays for the same car. The premium
          // is the price of getting approved and it belongs on the contract, not
          // on the windscreen — a cash buyer never sees this number.
          <Figure label="Financed" value={money(windowPrice(state, car))} />
        ) : (
          <Figure label="Wholesale" value={money(wholesaleValue(car))} />
        )}
      </View>

      <Text style={styles.trail}>{costTrail(ledger)}</Text>

      {car.status === 'recon' ? (
        <View style={styles.block}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.blockTitle}>In the shop</Text>
            <Text style={styles.blockValue}>{duration(car.reconRemainingMs)} left</Text>
          </Row>
          <Meter progress={reconProgress} />
          <Text style={styles.hint}>
            Coming out at {Math.round(car.reconTargetCondition * 100)}% condition.
          </Text>
        </View>
      ) : null}

      {canWork ? (
        <View style={styles.block}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.blockTitle}>Recondition</Text>
            <Text style={styles.blockValue}>{money(cost)}</Text>
          </Row>
          <Text style={styles.hint}>
            Takes {duration(reconDurationMs(car, shop))}, lifts condition to{' '}
            {Math.round(Math.min(1, car.condition + reconLift(car, shop)) * 100)}% and adds roughly{' '}
            {money(gain)} of value.
          </Text>
          <Button
            label={affordable ? 'Send it to the shop' : 'Not enough cash'}
            onPress={onRecon}
            disabled={!affordable}
            style={{ marginTop: 8 }}
          />
        </View>
      ) : null}

      {car.status === 'listed' ? (
        <View style={styles.block}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.blockTitle}>Asking</Text>
            <Text style={styles.askPrice}>{money(car.askPrice)}</Text>
          </Row>
          {daysListed !== null ? (
            <Text style={[styles.hint, daysListed >= STALE_DAYS && styles.stale]}>
              {daysOnLot(daysListed)}
            </Text>
          ) : null}
          <Text style={styles.hint}>
            {priceAdvice(car.askPrice, reference)}
          </Text>
          <Row style={{ marginTop: 8 }} gap={6}>
            <Button
              label="−10%"
              tone="ghost"
              style={{ flex: 1 }}
              onPress={() => onReprice(car.askPrice * 0.9)}
            />
            <Button
              label="Match market"
              tone="ghost"
              style={{ flex: 1.4 }}
              onPress={() => onReprice(reference)}
            />
            <Button
              label="+10%"
              tone="ghost"
              style={{ flex: 1 }}
              onPress={() => onReprice(car.askPrice * 1.1)}
            />
          </Row>
          <Button label="Pull the listing" tone="ghost" onPress={onUnlist} style={{ marginTop: 6 }} />
        </View>
      ) : car.status === 'ready' ? (
        <Button label={`List it at ${money(reference)}`} tone="primary" onPress={onList} />
      ) : null}

      {car.status !== 'recon' ? (
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Cut it loose</Text>
          <Text style={styles.hint}>
            The wholesaler takes anything, today, at {money(wholesale)} — well under what it is
            worth. A stall costs you money every week it holds a car nobody wants.
          </Text>
          <Button
            label={`Wholesale it for ${money(wholesale)}`}
            tone="ghost"
            onPress={onWholesale}
            style={{ marginTop: 8 }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}

function daysOnLot(days: number): string {
  if (days < 1) return 'Listed today.';
  const whole = Math.floor(days);
  const plural = whole === 1 ? '' : 's';
  if (days >= STALE_DAYS) return `${whole} day${plural} on the lot — this one is not moving.`;
  return `${whole} day${plural} on the lot.`;
}

function priceAdvice(ask: number, reference: number): string {
  const ratio = ask / Math.max(1, reference);
  if (ratio > 1.35) return 'Priced way over market. Almost nobody will stop to look.';
  if (ratio > 1.1) return 'Priced above market. Expect it to sit a while.';
  if (ratio < 0.85) return 'Priced under market. It will move fast, but you are leaving money behind.';
  return 'Priced about right for this market.';
}

function Figure({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureLabel}>{label}</Text>
      <Text style={[styles.figureValue, accent && { color: theme.colors.accent }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  grade: { alignItems: 'flex-start' },
  gradeNote: { flex: 1, color: theme.colors.textDim, fontSize: 11, lineHeight: 15 },
  hero: {
    alignItems: 'center',
    paddingVertical: 8,
    backgroundColor: theme.colors.asphalt,
    borderRadius: theme.radius.md,
  },
  figures: { flexDirection: 'row', gap: 8 },
  figure: {
    flex: 1,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 9,
    gap: 2,
  },
  figureLabel: { color: theme.colors.textDim, fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },
  figureValue: {
    color: theme.colors.text,
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  block: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 6,
  },
  blockTitle: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  blockValue: { color: theme.colors.textDim, fontSize: 13, fontVariant: ['tabular-nums'] },
  askPrice: {
    color: theme.colors.money,
    fontSize: 18,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  hint: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16 },
  trail: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 15, marginTop: -4 },
  // Old stock reads in the warning colour: the sheet should look different when
  // a car has been sitting long enough to be a decision.
  stale: { color: theme.colors.warn },
});
