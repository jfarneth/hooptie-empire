import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { moveToStage, stageMovePreview } from '../../sim/actions';
import { STAGE_ORDER, getStage, isFranchise, nextStage, stageRank } from '../../sim/stages';
import type { GameState, StageId } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, moneyShort, theme } from '../theme';
import { Button, Card, Chip, Label, Meter, Row } from './ui';

/**
 * The whole ladder, one store at a time.
 *
 * This started as a card about the next rung and is now a browser, because three
 * things a player wants to do here are all the same screen: read ahead at a
 * store they cannot afford yet, jump straight past a rung when they can, and —
 * rarely, and expensively — walk back down to a smaller one. Paging through the
 * six stores is the honest way to show a ladder; a card that only ever names the
 * next rung hides four fifths of the game from someone deciding whether to grind.
 *
 * Everything shown comes from `stageMovePreview(state, id)`, which is built from
 * the same data `moveToStage` acts on — a warning computed separately from the
 * thing it warns about drifts, and then lies. That includes the sums for a move
 * the player cannot make: reading ahead has to be truthful too.
 *
 * The confirmation is unchanged in spirit and mandatory in both directions. Up,
 * it is the payroll. Down, it is every dollar the current store cost.
 */
export function StageCard({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);

  const here = getStage(state.stage);
  // Open on the thing the player came here for: the next store up, or the one
  // they are standing in once there is nothing above it.
  const [viewing, setViewing] = useState<StageId>(nextStage(state.stage)?.id ?? state.stage);
  const [confirming, setConfirming] = useState(false);

  // A move changes what "next" means, so follow it rather than stranding the
  // card on the store that was just bought.
  useEffect(() => {
    setViewing(nextStage(state.stage)?.id ?? state.stage);
    setConfirming(false);
  }, [state.stage]);

  const rank = stageRank(viewing);
  const target = getStage(viewing);
  const move = stageMovePreview(state, viewing);

  const show = (id: StageId) => {
    setViewing(id);
    setConfirming(false);
  };

  return (
    <Card style={styles.card}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Arrow
          dir="prev"
          disabled={rank <= 0}
          onPress={() => show(STAGE_ORDER[rank - 1])}
        />
        <View style={styles.heading}>
          <Text style={styles.name}>{target.name}</Text>
          <Text style={styles.rank}>
            Store {rank + 1} of {STAGE_ORDER.length}
            {move.direction === 'stay' ? '' : ` · you are at ${here.shortName}`}
          </Text>
        </View>
        <Arrow
          dir="next"
          disabled={rank >= STAGE_ORDER.length - 1}
          onPress={() => show(STAGE_ORDER[rank + 1])}
        />
      </Row>

      {move.direction === 'up' ? (
        <>
          <Text style={styles.goalValue}>
            {money(state.cash)} <Text style={styles.goalOf}>of {money(move.cost)}</Text>
          </Text>
          <Meter
            progress={move.cost > 0 ? state.cash / move.cost : 1}
            color={move.affordable ? theme.colors.money : theme.colors.accent}
            height={5}
          />
        </>
      ) : null}

      {move.direction === 'stay' ? (
        <Row>
          <Chip text="You are here" color={theme.colors.money} />
        </Row>
      ) : null}

      <Text style={styles.blurb}>{target.blurb}</Text>

      <View style={styles.facts}>
        <Fact k="To move in" v={target.entryCost > 0 ? money(target.entryCost) : 'Nothing — you start here'} />
        <Fact k="Room for" v={`${target.baseCarCapacity} cars before you pave anything`} />
        <Fact k="Stock" v={inventoryLine(viewing)} />
        <Fact k="Finance desk" v={target.financing ? 'Yours to write' : 'Cash only'} />
        <Fact
          k="Payroll"
          v={
            target.upgradeCostMultiplier > 1
              ? `${target.upgradeCostMultiplier}× to hire`
              : 'Base rates'
          }
        />
      </View>

      {confirming ? (
        <Confirmation
          move={move}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            apply((s) => moveToStage(s, viewing));
          }}
        />
      ) : (
        <MoveButton move={move} cash={state.cash} onPress={() => setConfirming(true)} />
      )}
    </Card>
  );
}

type Move = ReturnType<typeof stageMovePreview>;

function MoveButton({
  move,
  cash,
  onPress,
}: {
  move: Move;
  cash: number;
  onPress: () => void;
}) {
  if (move.direction === 'stay') {
    return (
      <Text style={styles.hereNote}>
        This is the store you are running. Page across to see what is above it — or below.
      </Text>
    );
  }

  const target = move.target!;

  if (move.direction === 'down') {
    return (
      <Button
        label={`Walk back down to the ${target.name.toLowerCase()}`}
        sublabel={`Costs nothing — and writes off the ${moneyShort(move.forfeit)} this store cost`}
        tone="ghost"
        onPress={onPress}
        style={{ marginTop: 10 }}
      />
    );
  }

  return (
    <Button
      label={move.affordable ? `Take on the ${target.name.toLowerCase()}` : 'Keep selling'}
      sublabel={
        move.affordable
          ? `${money(move.cost)}, and ${money(move.float)} left to reopen with${move.rungsSkipped > 0 ? ` — skips ${move.rungsSkipped} store${move.rungsSkipped > 1 ? 's' : ''}` : ''}`
          : `${money(Math.max(0, move.cost + move.float - cash))} short of the ${money(move.cost)} price plus ${money(move.float)} to restock`
      }
      tone={move.affordable ? 'primary' : 'ghost'}
      disabled={!move.affordable}
      onPress={onPress}
      style={{ marginTop: 10 }}
    />
  );
}

/**
 * The two-step. Up, the thing the player must not learn from watching their
 * automation stop is the payroll reset; down, it is that nobody buys the store
 * back off them.
 */
function Confirmation({
  move,
  onCancel,
  onConfirm,
}: {
  move: Move;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const target = move.target!;
  const down = move.direction === 'down';
  const bookWillBeOver = move.bookAfter.active > move.bookAfter.capacity;
  const selling = move.liquidation.cars > 0;

  return (
    <View style={styles.confirm}>
      <Text style={styles.confirmTitle}>{down ? 'Before you walk' : 'Before you sign'}</Text>

      {down ? (
        <Text style={styles.confirmWarn}>
          You paid {money(move.forfeit)} to move into the {move.from.name.toLowerCase()}. Walking out
          of it gets you none of that back, and coming back later costs the full price again.
        </Text>
      ) : null}

      {!down && move.rungsSkipped > 0 ? (
        <Text style={styles.confirmBody}>
          You are stepping straight past {move.rungsSkipped} store
          {move.rungsSkipped > 1 ? 's' : ''} — you pay what this dealership costs and nothing for the
          ones you skipped, but you arrive with the payroll of the store you left.
        </Text>
      ) : null}

      <Text style={styles.confirmWarn}>
        You arrive with nothing but cash, paper and what you know. That is why the ladder makes you
        keep {money(move.float)} back on top of the price — enough to restock the lot and cover the
        first few weeks of rent, because an empty lot earns nothing and the rent arrives anyway.
      </Text>

      {move.staffLost.length > 0 ? (
        <>
          <Text style={styles.confirmBody}>
            Nothing on the upgrade table comes with you — not the payroll, not the paving, not the
            process. You rebuild all of it at {target.name.toLowerCase()} prices, about{' '}
            {target.upgradeCostMultiplier}× base.
          </Text>
          <View style={styles.staffList}>
            {move.staffLost.map((s) => (
              <Text key={s.name} style={styles.staffRow}>
                · {s.name}
                {s.level > 1 ? ` (level ${s.level})` : ''}
              </Text>
            ))}
          </View>
        </>
      ) : (
        <Text style={styles.confirmBody}>
          You have nobody on the payroll, so there is nothing to lose but the cheque.
        </Text>
      )}

      {bookWillBeOver ? (
        <Text style={styles.confirmWarn}>
          The collections desk goes with them. {move.bookAfter.active} live contracts against room
          for {move.bookAfter.capacity} — everyone on the book gets likelier to miss, and you write
          no new paper, until you have staffed back up.
        </Text>
      ) : null}

      {selling ? (
        <Text style={styles.confirmWarn}>
          You do not take the lot with you. All {move.liquidation.cars} car
          {move.liquidation.cars > 1 ? 's' : ''} go to a wholesaler for{' '}
          {money(move.liquidation.proceeds)} — under what they are worth, because he knows you are
          leaving. Sell them yourself first if you want retail for them.
        </Text>
      ) : null}

      <Text style={styles.confirmBody}>
        You arrive with an empty lot with room for {move.lotAfter.capacity}.
      </Text>

      <Text style={styles.confirmKeep}>
        {down
          ? 'Your cash, every contract on the book and everything the work has taught you all come with you. The store, the stock and the whole office are what you are giving up.'
          : 'Cash, the book and everything the work has taught you come with you. The lot is sold and the office is left behind.'}
      </Text>

      <Row gap={6} style={{ marginTop: 4 }}>
        <Button label="Not yet" tone="ghost" onPress={onCancel} style={{ flex: 1 }} />
        <Button
          label={down ? 'Walk away' : `Sign — ${moneyShort(move.cost)}`}
          tone={down ? 'danger' : 'primary'}
          onPress={onConfirm}
          style={{ flex: 1 }}
        />
      </Row>
    </View>
  );
}

/** What turns up on the feed at a given store, in a line. */
function inventoryLine(id: StageId): string {
  const stage = getStage(id);
  if (isFranchise(id)) return `New ${stage.shortName} stock, priced off the invoice`;
  const tiers = stage.sourcing.tiers ?? [];
  return tiers.map((t) => t[0].toUpperCase() + t.slice(1)).join(' · ');
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <View style={styles.factRow}>
      <Text style={styles.factKey}>{k}</Text>
      <Text style={styles.factValue}>{v}</Text>
    </View>
  );
}

function Arrow({
  dir,
  disabled,
  onPress,
}: {
  dir: 'prev' | 'next';
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={dir === 'prev' ? 'Previous store' : 'Next store'}
      style={({ pressed }) => [
        styles.arrow,
        disabled && styles.arrowOff,
        pressed && !disabled && { opacity: 0.6 },
      ]}
    >
      <Text style={[styles.arrowText, disabled && styles.arrowTextOff]}>
        {dir === 'prev' ? '‹' : '›'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  heading: { flex: 1, alignItems: 'center' },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  rank: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  arrow: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surfaceHigh,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  arrowOff: { backgroundColor: 'transparent', borderColor: theme.colors.surfaceHigh },
  arrowText: { color: theme.colors.text, fontSize: 20, fontWeight: '800', lineHeight: 22 },
  arrowTextOff: { color: theme.colors.stripe },
  goalValue: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  goalOf: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  blurb: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  facts: {
    gap: 3,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  factRow: { flexDirection: 'row', gap: 10 },
  factKey: { color: theme.colors.textFaint, fontSize: 11, width: 92 },
  factValue: { color: theme.colors.textDim, fontSize: 11, flex: 1, fontWeight: '600' },
  hereNote: {
    color: theme.colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
    marginTop: 6,
  },
  confirm: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 6,
  },
  confirmTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  confirmBody: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  staffList: { gap: 1, paddingLeft: 2 },
  staffRow: { color: theme.colors.warn, fontSize: 11, lineHeight: 15 },
  confirmWarn: { color: theme.colors.danger, fontSize: 11, lineHeight: 15 },
  confirmKeep: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 15, fontStyle: 'italic' },
});
