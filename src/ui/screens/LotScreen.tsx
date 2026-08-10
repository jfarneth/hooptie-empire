import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  counterOffer,
  declineProspect,
  listForSale,
  repriceCar,
  startRecon,
  takeCashDeal,
  takeFinanceDeal,
  unlist,
} from '../../sim/actions';
import { getStage } from '../../sim/stages';
import { carCapacity } from '../../sim/upgrades';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, theme } from '../theme';
import { HUD_HEIGHT } from '../components/Hud';
import { CarSheet } from '../components/CarSheet';
import { StageCard } from '../components/StageCard';
import { DealSheet } from '../components/DealSheet';
import { Sheet } from '../components/Sheet';
import { LotScene } from '../lot/LotScene';
import { Card, Label } from '../components/ui';

/** The main screen: your lot, your walk-ups, and the road to a bigger store. */
export function LotScreen({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const [carId, setCarId] = useState<string | null>(null);
  const [prospectId, setProspectId] = useState<string | null>(null);
  const [ladderOpen, setLadderOpen] = useState(false);

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

  const stage = getStage(state.stage);
  const held = state.cars.filter((c) => c.status !== 'sold').length;

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        // The lot is a surface, not a list: it must not bounce away from the
        // showroom at the top or the street at the bottom.
        bounces={false}
      >
        <LotScene
          state={state}
          // Paved for whichever is larger: the space you own, or the cars you
          // are actually holding. A lot can be over capacity — a repo comes back
          // to a full lot, and walking back down the ladder lands thirty cars on
          // a driveway — and a car with no stall is a car the player cannot tap,
          // which is a car they can never sell. The HUD still reports the real
          // number, so nothing here pretends the space was bought.
          capacity={Math.max(carCapacity(state), held)}
          onSelectCar={setCarId}
          onSelectProspect={setProspectId}
          onPressSign={() => setLadderOpen(true)}
        />

        <View style={styles.below}>
          {held === 0 ? (
            <Card>
              <Text style={styles.hint}>
                Nothing on the lot yet. Head to <Text style={styles.hintStrong}>Buy</Text> and pick
                something up — look for anything priced under wholesale.
              </Text>
            </Card>
          ) : null}

          <RecentActivity state={state} />
        </View>
      </ScrollView>

      <Sheet
        visible={ladderOpen}
        title="The ladder"
        subtitle={`Every store, what it costs, and what it takes. You are at ${stage.shortName}.`}
        onClose={() => setLadderOpen(false)}
      >
        <StageCard state={state} />
      </Sheet>

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
        onCounter={(price) => {
          if (!prospect) return;
          // Deliberately stays open: they may have come back with a better
          // number, and closing the sheet would hide the reply.
          apply((s) => counterOffer(s, prospect.id, price));
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
    kind === 'repo' || kind === 'note-default' || kind === 'stage-down'
      ? theme.colors.danger
      : kind === 'payment' || kind === 'sale-cash' || kind === 'sale-finance'
        ? theme.colors.money
        : kind === 'skill-up' || kind === 'stage-up'
          ? theme.colors.accent
          : kind === 'appraisal'
            ? theme.colors.warn
            : theme.colors.textDim;

  return (
    <View style={{ gap: 6 }}>
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
  content: { paddingTop: HUD_HEIGHT, paddingBottom: 32 },
  below: { padding: 16, gap: 12 },
  hint: { color: theme.colors.textDim, fontSize: 13, lineHeight: 19 },
  hintStrong: { color: theme.colors.accent, fontWeight: '700' },
  eventRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  eventLabel: { color: theme.colors.textDim, fontSize: 12, flex: 1 },
  eventAmount: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
