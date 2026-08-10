import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { stageMovePreview } from '../../sim/actions';
import { retailValue } from '../../sim/economy';
import { getStage } from '../../sim/stages';
import type { Car, GameState, Prospect } from '../../sim/types';
import { CarArt } from '../art/CarArt';
import { duration, money, moneyShort, theme } from '../theme';
import { LadderPylon } from './LadderPylon';
import { LotGround } from './LotGround';
import { environmentFor } from './environment';
import { assignSlots, lotLayout, variantOf, type LotSlot } from './layout';

/**
 * The lot, seen from above.
 *
 * Replaces the card grid this screen used to be. The difference is not the
 * camera, it is that a car now *occupies* a place instead of reporting from a
 * row: status hangs off the car as a windscreen sticker or a shop badge, a buyer
 * is a person standing next to the car they want, and an empty stall is empty
 * tarmac rather than a missing list item.
 *
 * Rendered as layers rather than one big SVG:
 *  - the ground plate, one memoised `Svg`, redrawn only when the lot changes
 *    shape;
 *  - a `Pressable` per car, which is what makes tapping one cheap and what lets
 *    a sprite drop in later as an `Image` with no restructuring;
 *  - markers and buyers on top, positioned in lot coordinates so nothing gets
 *    clipped by its parent.
 */

interface Props {
  state: GameState;
  capacity: number;
  onSelectCar: (carId: string) => void;
  onSelectProspect: (prospectId: string) => void;
  onPressSign: () => void;
}

export function LotScene({ state, capacity, onSelectCar, onSelectProspect, onPressSign }: Props) {
  const { width } = useWindowDimensions();
  const stage = getStage(state.stage);

  const held = useMemo(() => state.cars.filter((c) => c.status !== 'sold'), [state.cars]);
  // Building depth varies by store — a house needs more room than a portable
  // office — so the environment feeds the layout rather than the other way round.
  const env = environmentFor(state.stage);
  const layout = useMemo(
    () => lotLayout(capacity, width, env.buildingDepth, env.edgePad),
    [capacity, width, env.buildingDepth, env.edgePad],
  );

  // Parking is derived from the car id, never stored: see `assignSlots`.
  const parked = useMemo(() => {
    const slots = assignSlots(held.map((c) => c.id), layout.slots.length);
    return held.map((car, i) => ({ car, slot: layout.slots[slots[i]] })).filter((p) => p.slot);
  }, [held, layout]);

  const occupied = new Set(parked.map((p) => p.slot.index));
  const markerScale = Math.max(0.66, Math.min(1.1, layout.carScale));

  // What the pylon out front is counting toward. Read from the same preview the
  // ladder card acts on, so the sign and the card can never disagree about how
  // close the next store is.
  const move = stageMovePreview(state);

  return (
    <View style={{ width: layout.width, height: layout.height }}>
      <LotGround
        layout={layout}
        stage={state.stage}
        signText={stage.shortName}
        financing={stage.financing}
      />

      <LadderPylon
        layout={layout}
        env={env}
        progress={move.cost > 0 ? state.cash / move.cost : 1}
        targetName={move.target?.shortName ?? ''}
        atTop={move.target === null}
      />

      {/* the sign and the pylon both open the ladder — the store you are in is
          the store you leave. Last of the building-band layers so it takes the
          tap; the pylon above it has pointer events off. */}
      <Pressable
        onPress={onPressSign}
        accessibilityRole="button"
        accessibilityLabel={
          move.target
            ? `${stage.name} — ${Math.round(Math.min(1, state.cash / move.cost) * 100)}% of the way to the ${move.target.name.toLowerCase()}. See every store.`
            : `${stage.name} — see every store on the ladder`
        }
        style={[styles.signHit, { width: layout.width, height: layout.showroomDepth }]}
      />

      {layout.slots.map((slot) =>
        occupied.has(slot.index) ? null : <EmptyStall key={`empty_${slot.index}`} slot={slot} />,
      )}

      {parked.map(({ car, slot }) => (
        <ParkedCar
          key={car.id}
          car={car}
          slot={slot}
          carWidth={layout.carWidth}
          onPress={() => onSelectCar(car.id)}
        />
      ))}

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {parked.map(({ car, slot }) => (
          <CarMarkers
            key={`m_${car.id}`}
            car={car}
            slot={slot}
            carLength={layout.carLength}
            scale={markerScale}
            prospect={state.prospects.find((p) => p.carId === car.id)}
            onPressProspect={onSelectProspect}
          />
        ))}
      </View>
    </View>
  );
}

function EmptyStall({ slot }: { slot: LotSlot }) {
  return (
    <View
      style={[styles.stall, { left: slot.x, top: slot.y, width: slot.width, height: slot.height }]}
      pointerEvents="none"
    >
      <Text style={styles.emptyText}>OPEN</Text>
    </View>
  );
}

function ParkedCar({
  car,
  slot,
  carWidth,
  onPress,
}: {
  car: Car;
  slot: LotSlot;
  carWidth: number;
  onPress: () => void;
}) {
  // Drive-in: a car eases into its stall when it first appears.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [enter]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.stall,
        { left: slot.x, top: slot.y, width: slot.width, height: slot.height },
        pressed && styles.pressed,
      ]}
    >
      <Animated.View
        style={{
          opacity: enter,
          transform: [
            { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
          ],
        }}
      >
        <CarArt
          modelId={car.modelId}
          colorIndex={car.colorIndex}
          condition={car.condition}
          width={carWidth}
          angle="top"
          variant={variantOf(car.id, 4)}
        />
      </Animated.View>
    </Pressable>
  );
}

/**
 * Everything the old bay card said, hung off the car instead.
 *
 * Deliberately not everything the card said: the model name is gone. On a lot
 * you recognise a car by looking at it, and the sheet is one tap away — putting
 * thirty name labels back over the tarmac would rebuild the spreadsheet on top
 * of the picture.
 */
function CarMarkers({
  car,
  slot,
  carLength,
  scale,
  prospect,
  onPressProspect,
}: {
  car: Car;
  slot: LotSlot;
  carLength: number;
  scale: number;
  prospect?: Prospect;
  onPressProspect: (id: string) => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!prospect) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 620, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [prospect, pulse]);

  const cx = slot.x + slot.width / 2;
  const reconProgress =
    car.status === 'recon' && car.reconTotalMs > 0
      ? 1 - car.reconRemainingMs / car.reconTotalMs
      : 0;

  // Everything hangs off the car, not off the stall. A marker placed above the
  // stall lands on the tail of the car in the row in front — which is what the
  // first cut did, and on a 62-car lot it put a price tag on the wrong car.
  const carTop = slot.y + (slot.height - carLength) / 2;
  const carBottom = carTop + carLength;
  /** Where a windscreen sticker actually goes. */
  const windscreen = carTop + carLength * 0.16;

  return (
    <>
      {car.status === 'listed' ? (
        <View
          style={[styles.sticker, { left: cx - 30 * scale, top: windscreen, transform: [{ scale }] }]}
          pointerEvents="none"
        >
          <Text style={styles.stickerText}>{moneyShort(car.askPrice)}</Text>
        </View>
      ) : null}

      {car.status === 'recon' ? (
        <View
          style={[
            styles.shop,
            { left: cx - 34 * scale, top: carTop + carLength / 2 - 12 * scale, transform: [{ scale }] },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.shopText}>IN SHOP · {duration(car.reconRemainingMs)}</Text>
          <View style={styles.shopTrack}>
            <View style={[styles.shopFill, { width: `${Math.round(reconProgress * 100)}%` }]} />
          </View>
        </View>
      ) : null}

      {car.status === 'ready' ? (
        <View
          style={[styles.ready, { left: cx - 26 * scale, top: windscreen, transform: [{ scale }] }]}
          pointerEvents="none"
        >
          <Text style={styles.readyText}>READY {moneyShort(retailValue(car))}</Text>
        </View>
      ) : null}

      {car.repoCount > 0 ? (
        <View
          style={[
            styles.repo,
            { left: cx - 22 * scale, top: carBottom - 16 * scale, transform: [{ scale }] },
          ]}
          pointerEvents="none"
        >
          <Text style={styles.repoText}>REPO ×{car.repoCount}</Text>
        </View>
      ) : null}

      {prospect ? (
        <Animated.View
          style={[
            styles.buyer,
            {
              left: slot.x + slot.width - 26 * scale,
              // Stood at the back door, not the windscreen: at six columns the
              // stall is ~60px wide and a buyer beside the price tag sits on it.
              top: carTop + carLength * 0.62,
              opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }),
            },
          ]}
        >
          <Pressable
            onPress={() => onPressProspect(prospect.id)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Buyer offering ${money(prospect.negotiation.currentOffer)}`}
            style={styles.buyerHit}
          >
            <Shopper size={Math.max(22, 30 * scale)} />
          </Pressable>
        </Animated.View>
      ) : null}
    </>
  );
}

/**
 * A customer, from above: shoulders and the top of a head.
 *
 * Ringed in the accent because at the top of the ladder there can be thirty of
 * these on screen at once and an unringed figure is a brown speck on tarmac.
 * This is the moment the game most wants you to notice.
 */
function Shopper({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 28 28">
      <Circle cx={14} cy={14} r={13} fill="#0b0d11" opacity={0.5} />
      <Circle cx={14} cy={14} r={12} fill="none" stroke={theme.colors.accent} strokeWidth={2} />
      <Ellipse cx={14} cy={16} rx={7.6} ry={6.4} fill={theme.colors.accent} />
      <Circle cx={14} cy={12.4} r={4.8} fill="#c99a72" />
      <Circle cx={12.5} cy={11.2} r={1.8} fill="#fff" opacity={0.24} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  stall: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72 },
  signHit: { position: 'absolute', left: 0, top: 0 },
  emptyText: {
    color: theme.colors.stripe,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sticker: {
    position: 'absolute',
    minWidth: 60,
    alignItems: 'center',
    backgroundColor: 'rgba(10,12,16,0.88)',
    borderWidth: 1,
    borderColor: theme.colors.money,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  stickerText: {
    color: theme.colors.money,
    fontSize: 11,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  ready: {
    position: 'absolute',
    minWidth: 52,
    alignItems: 'center',
    backgroundColor: 'rgba(10,12,16,0.78)',
    borderRadius: theme.radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  readyText: {
    color: theme.colors.textDim,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
  },
  shop: {
    position: 'absolute',
    width: 68,
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(10,12,16,0.82)',
    borderRadius: theme.radius.sm,
    paddingHorizontal: 5,
    paddingVertical: 3,
  },
  shopText: { color: theme.colors.accent, fontSize: 8.5, fontWeight: '800', letterSpacing: 0.3 },
  shopTrack: {
    width: '100%',
    height: 3,
    borderRadius: 1.5,
    backgroundColor: theme.colors.surfaceHigh,
    overflow: 'hidden',
  },
  shopFill: { height: '100%', backgroundColor: theme.colors.accent, borderRadius: 1.5 },
  repo: {
    position: 'absolute',
    backgroundColor: theme.colors.dangerDim,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  repoText: { color: '#ffd9d2', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  buyer: { position: 'absolute' },
  buyerHit: { alignItems: 'center', justifyContent: 'center' },
});
