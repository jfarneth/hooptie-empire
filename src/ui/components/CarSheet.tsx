import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { canRecon, reconCost, reconDurationMs, reconLift, reconValueGain } from '../../sim/cars';
import { reconModsFor } from '../../sim/skills';
import { bhphPrice, retailValue, wholesaleValue } from '../../sim/economy';
import { getModel } from '../../sim/models';
import type { Car, GameState } from '../../sim/types';
import { duration, money, theme } from '../theme';
import { CarSvg } from './CarSvg';
import { Sheet } from './Sheet';
import { Button, Meter, Row } from './ui';

/** Inventory detail: what this car is worth, what it needs, and what to do with it. */
export function CarSheet({
  state,
  car,
  onRecon,
  onList,
  onUnlist,
  onReprice,
  onClose,
}: {
  state: GameState;
  car: Car | null;
  onRecon: () => void;
  onList: () => void;
  onUnlist: () => void;
  onReprice: (price: number) => void;
  onClose: () => void;
}) {
  if (!car) return <Sheet visible={false} title="" onClose={onClose} children={null} />;

  const model = getModel(car.modelId);
  const retail = retailValue(car);
  const reference = state.stage === 'bhph' ? bhphPrice(car) : retail;
  const shop = reconModsFor(state);
  const cost = reconCost(car, shop);
  const canWork = canRecon(car, shop);
  const affordable = state.cash >= cost;

  // Quoted straight from the sim so the sheet can never promise a different
  // number than the engine delivers.
  const gain = reconValueGain(car, shop);
  const reconProgress = car.reconTotalMs > 0 ? 1 - car.reconRemainingMs / car.reconTotalMs : 0;

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
        <CarSvg
          bodyStyle={model.bodyStyle}
          colorIndex={car.colorIndex}
          condition={car.condition}
          width={220}
        />
      </View>

      <View style={styles.figures}>
        <Figure label="You paid" value={money(car.costBasis)} />
        <Figure label="Cash retail" value={money(retail)} />
        {state.stage === 'bhph' ? (
          <Figure label="Lot price" value={money(bhphPrice(car))} accent />
        ) : (
          <Figure label="Wholesale" value={money(wholesaleValue(car))} />
        )}
      </View>

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
    </Sheet>
  );
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
});
