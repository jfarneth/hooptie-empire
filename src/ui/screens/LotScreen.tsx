import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  buyLot,
  canBuyLot,
  declineProspect,
  listForSale,
  repriceCar,
  startRecon,
  takeCashDeal,
  takeFinanceDeal,
  unlist,
} from '../../sim/actions';
import { BALANCE } from '../../sim/balance';
import { carCapacity } from '../../sim/upgrades';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, theme } from '../theme';
import { CarSheet } from '../components/CarSheet';
import { DealSheet } from '../components/DealSheet';
import { LotGrid } from '../components/LotGrid';
import { Button, Card, EmptyState, Label, Meter } from '../components/ui';

/** The main screen: your inventory, your walk-ups, and the road to the lot. */
export function LotScreen({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const [carId, setCarId] = useState<string | null>(null);
  const [prospectId, setProspectId] = useState<string | null>(null);

  const car = carId ? (state.cars.find((c) => c.id === carId) ?? null) : null;
  const prospect = prospectId ? (state.prospects.find((p) => p.id === prospectId) ?? null) : null;

  // A walk-up that expires (or a car that sells) while its sheet is open should
  // close the sheet rather than strand the player on a dead deal.
  useEffect(() => {
    if (prospectId && !prospect) setProspectId(null);
  }, [prospectId, prospect]);
  useEffect(() => {
    if (carId && !car) setCarId(null);
  }, [carId, car]);

  const held = state.cars.filter((c) => c.status !== 'sold').length;
  const lotProgress = state.cash / BALANCE.lotPurchaseCost;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {state.stage === 'curbstoner' ? (
          <Card style={styles.goalCard}>
            <Label>Next: your own lot</Label>
            <View style={styles.goalRow}>
              <Text style={styles.goalValue}>
                {money(state.cash)} <Text style={styles.goalOf}>of {money(BALANCE.lotPurchaseCost)}</Text>
              </Text>
            </View>
            <Meter progress={lotProgress} color={theme.colors.accent} height={5} />
            <Text style={styles.goalHint}>
              A lot means a finance desk. Instead of selling a car once, you sell it once for the
              down payment and again as paper.
            </Text>
            <Button
              label={canBuyLot(state) ? `Buy the lot — ${money(BALANCE.lotPurchaseCost)}` : 'Keep flipping'}
              tone={canBuyLot(state) ? 'primary' : 'ghost'}
              disabled={!canBuyLot(state)}
              onPress={() => apply(buyLot)}
              style={{ marginTop: 10 }}
            />
          </Card>
        ) : null}

        <Label>{state.stage === 'curbstoner' ? 'Driveway' : 'The lot'}</Label>

        {held === 0 ? (
          <EmptyState
            title="Nothing to sell"
            hint="Head to Buy and pick something up. Look for anything priced under wholesale."
          />
        ) : (
          <LotGrid
            state={state}
            capacity={carCapacity(state)}
            onSelectCar={setCarId}
            onSelectProspect={setProspectId}
          />
        )}

        <RecentActivity state={state} />
      </ScrollView>

      <CarSheet
        state={state}
        car={car}
        onClose={() => setCarId(null)}
        onRecon={() => car && apply((s) => startRecon(s, car.id))}
        onList={() => {
          if (!car) return;
          apply((s) => listForSale(s, car.id));
          setCarId(null);
        }}
        onUnlist={() => car && apply((s) => unlist(s, car.id))}
        onReprice={(price) => car && apply((s) => repriceCar(s, car.id, price))}
      />

      <DealSheet
        state={state}
        prospect={prospect}
        onClose={() => setProspectId(null)}
        onCash={() => {
          if (!prospect) return;
          apply((s) => takeCashDeal(s, prospect.id));
          setProspectId(null);
        }}
        onFinance={() => {
          if (!prospect) return;
          apply((s) => takeFinanceDeal(s, prospect.id));
          setProspectId(null);
        }}
        onDecline={() => {
          if (!prospect) return;
          apply((s) => declineProspect(s, prospect.id));
          setProspectId(null);
        }}
      />
    </>
  );
}

function RecentActivity({ state }: { state: GameState }) {
  const recent = [...state.events].reverse().slice(0, 8);
  if (recent.length === 0) return null;

  const color = (kind: string) =>
    kind === 'repo' || kind === 'note-default'
      ? theme.colors.danger
      : kind === 'payment' || kind === 'sale-cash' || kind === 'sale-finance'
        ? theme.colors.money
        : theme.colors.textDim;

  return (
    <View style={{ gap: 6, marginTop: 8 }}>
      <Label>Activity</Label>
      <Card style={{ gap: 5, paddingVertical: 10 }}>
        {recent.map((e, i) => (
          <View key={`${e.t}_${i}`} style={styles.eventRow}>
            <Text style={styles.eventLabel} numberOfLines={1}>
              {e.label}
            </Text>
            {e.amount !== undefined ? (
              <Text style={[styles.eventAmount, { color: color(e.kind) }]}>
                {e.amount >= 0 ? '+' : ''}
                {money(e.amount)}
              </Text>
            ) : null}
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 10, paddingBottom: 32 },
  goalCard: { gap: 8, borderColor: theme.colors.accentDim },
  goalRow: { flexDirection: 'row', alignItems: 'baseline' },
  goalValue: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  goalOf: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  goalHint: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 17 },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  eventLabel: { color: theme.colors.textDim, fontSize: 12, flex: 1 },
  eventAmount: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
