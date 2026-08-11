import React, { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Ellipse } from 'react-native-svg';
import { stageMovePreview } from '../../sim/actions';
import { retailValue } from '../../sim/economy';
import { getStage } from '../../sim/stages';
import type { Car, GameState, Prospect } from '../../sim/types';
import { CarArt } from '../art/CarArt';
import { RARITY_COLOR, duration, money, moneyShort, theme } from '../theme';
import { LadderPylon } from './LadderPylon';
import { LotGround } from './LotGround';
import { fitCameraToWidth, type Camera } from './camera';
import { environmentFor } from './environment';
import { RARITIES, rarityRank } from '../../sim/rarity';
import { assignSlots, lotLayout, variantOf, type LotLayout, type LotSlot } from './layout';
import type { SurroundBounds } from './surroundings';

/**
 * The lot, seen from an isometric camera.
 *
 * A car now *occupies* a place instead of reporting from a row: status hangs off
 * the car as a windscreen sticker or a shop badge, a buyer is a person standing
 * next to the car they want, and an empty stall is empty tarmac rather than a
 * missing list item.
 *
 * A CAR WITH A BUYER AT IT IS A DEAL, NOT A CAR. Tapping it opens the deal
 * sheet rather than the inventory sheet — the buyer figure is a small target
 * beside a large one, and the inventory sheet exists to reprice and unlist,
 * which are not things you do with somebody standing at the bonnet. Declining
 * the buyer hands the car back.
 *
 * Rendered as layers rather than one big SVG:
 *  - the ground plate and everything standing on it, one memoised `Svg`,
 *    redrawn only when the lot changes shape;
 *  - a `Pressable` per car, which is what makes tapping one cheap;
 *  - markers and buyers on top.
 *
 * `layout.ts` still solves parking in flat lot coordinates, exactly as it did
 * when the camera pointed straight down. Everything here goes through
 * `camera.project`, which is the only thing that knows about the tilt or the
 * yaw. Two consequences worth keeping straight:
 *
 *  - A CAR IS ROTATED WITH THE GROUND. It is a flat drawing lying on the tarmac,
 *    so it takes the same in-plane rotation and foreshortening the stall paint
 *    under it takes, and it stays tappable because the pressable is rotated with
 *    it.
 *  - A MARKER IS NOT. A price tag, a shop timer and a buyer are readouts, not
 *    scenery. They are billboarded — positioned by projecting the point on the
 *    car they belong to, then drawn square to the screen. A sheared price is a
 *    price nobody reads.
 */

interface Props {
  state: GameState;
  capacity: number;
  onSelectCar: (carId: string) => void;
  onSelectProspect: (prospectId: string) => void;
  onPressSign: () => void;
}

/**
 * How much room the lot leaves itself inside the viewport, as a share of its own
 * plan. The neighbourhood fills the rest — and, more to the point, fills the two
 * triangles the yaw opens up at the corners.
 */
const LOT_INSET = 0.14;

/**
 * A car is never allowed to shrink below this, in screen pixels.
 *
 * Rotating an eleven-row premium franchise into a phone's width would put a car
 * at about 16px, which is a coloured speck. Below this floor the camera stops
 * shrinking and the scene is panned sideways instead — see `LotScreen`. The
 * early stages never reach it, so they never pan.
 */
const MIN_CAR_WIDTH = 30;

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

  const camera = useMemo(
    () =>
      fitCameraToWidth(
        {
          u0: -layout.width * LOT_INSET,
          u1: layout.width * (1 + LOT_INSET),
          v0: -layout.height * LOT_INSET * 0.6,
          v1: layout.height,
        },
        width,
        env.buildingHeight,
        MIN_CAR_WIDTH / Math.max(1, layout.carWidth),
      ),
    [layout, width, env.buildingHeight],
  );

  // How much world the neighbourhood has to cover: whatever the four corners of
  // the finished scene are looking at, plus a margin so a warehouse straddling
  // the edge is drawn rather than clipped away entirely.
  const world = useMemo<SurroundBounds>(() => {
    const corners = [
      camera.unproject(0, 0),
      camera.unproject(camera.width, 0),
      camera.unproject(0, camera.height),
      camera.unproject(camera.width, camera.height),
    ];
    const pad = 220;
    return {
      u0: Math.min(...corners.map((c) => c.u)) - pad,
      u1: Math.max(...corners.map((c) => c.u)) + pad,
      v0: Math.min(...corners.map((c) => c.v)) - pad,
      v1: Math.max(...corners.map((c) => c.v)) + pad,
      lotWidth: layout.width,
      frontageY: layout.frontageY,
    };
  }, [camera, layout.width, layout.frontageY]);

  // Parking is derived from the car id, never stored: see `assignSlots`.
  const parked = useMemo(() => {
    const slots = assignSlots(held.map((c) => c.id), layout.slots.length);
    return held.map((car, i) => ({ car, slot: layout.slots[slots[i]] })).filter((p) => p.slot);
  }, [held, layout]);

  /**
   * Who is standing at which car. Built once rather than searched per car — at
   * a premium franchise that was sixty scans of the prospect list per render,
   * and both the car and its marker need the answer.
   */
  const shoppers = useMemo(() => {
    const byCar = new Map<string, Prospect>();
    for (const p of state.prospects) if (!byCar.has(p.carId)) byCar.set(p.carId, p);
    return byCar;
  }, [state.prospects]);

  const occupied = new Set(parked.map((p) => p.slot.index));
  const carWidthPx = layout.carWidth * camera.scale;
  const markerScale = Math.max(0.5, Math.min(1.05, carWidthPx / 70));

  // What the pylon out front is counting toward. Read from the same preview the
  // ladder card acts on, so the sign and the card can never disagree about how
  // close the next store is.
  const move = stageMovePreview(state);

  // The building band, as a screen-space box. The band is a parallelogram now,
  // so this is its bounding box: generous, but the cars are rendered after it
  // and take their own taps, so the only thing it can swallow is empty tarmac.
  const signBox = useMemo(() => boundsOf(camera, layout, 0, layout.showroomDepth, env.buildingHeight), [camera, layout, env.buildingHeight]);

  // Only the stages that hit the car-size floor are pannable, and they open
  // looking at the middle of the lot rather than at the neighbours.
  const pan = useRef<ScrollView | null>(null);
  useEffect(() => {
    if (!camera.panned) return;
    pan.current?.scrollTo({ x: (camera.width - width) / 2, animated: false });
  }, [camera.panned, camera.width, width]);

  const scene = (
    <View style={{ width: camera.width, height: camera.height }}>
      <LotGround
        layout={layout}
        camera={camera}
        world={world}
        stage={state.stage}
        signText={stage.shortName}
        financing={stage.financing}
      />

      <LadderPylon
        layout={layout}
        camera={camera}
        env={env}
        progress={move.cost > 0 ? state.cash / move.cost : 1}
        targetName={move.target?.shortName ?? ''}
        atTop={move.target === null}
      />

      {/* the sign and the pylon both open the ladder — the store you are in is
          the store you leave. */}
      <Pressable
        onPress={onPressSign}
        accessibilityRole="button"
        accessibilityLabel={
          move.target
            ? `${stage.name} — ${Math.round(Math.min(1, state.cash / move.cost) * 100)}% of the way to the ${move.target.name.toLowerCase()}. See every store.`
            : `${stage.name} — see every store on the ladder`
        }
        style={[styles.signHit, signBox]}
      />

      {layout.slots.map((slot) =>
        occupied.has(slot.index) ? null : (
          <EmptyStall key={`empty_${slot.index}`} slot={slot} camera={camera} scale={markerScale} />
        ),
      )}

      {parked.map(({ car, slot }) => (
        <ParkedCar
          key={car.id}
          car={car}
          slot={slot}
          layout={layout}
          camera={camera}
          prospect={shoppers.get(car.id)}
          onPress={() => {
            // THE CAR IS THE DEAL WHILE SOMEBODY IS STANDING AT IT. The buyer
            // figure is a ~30px target beside a car that fills the stall, and
            // tapping the obvious thing used to open the inventory sheet — a
            // screen whose whole purpose is repricing and unlisting, neither of
            // which you can honestly do with a customer looking over the
            // bonnet. Declining the buyer hands the car back.
            const shopper = shoppers.get(car.id);
            if (shopper) onSelectProspect(shopper.id);
            else onSelectCar(car.id);
          }}
        />
      ))}

      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {parked.map(({ car, slot }) => (
          <CarMarkers
            key={`m_${car.id}`}
            car={car}
            slot={slot}
            layout={layout}
            camera={camera}
            scale={markerScale}
            prospect={shoppers.get(car.id)}
            onPressProspect={onSelectProspect}
          />
        ))}
      </View>
    </View>
  );

  if (!camera.panned) return scene;

  return (
    <ScrollView
      ref={pan}
      horizontal
      showsHorizontalScrollIndicator={false}
      bounces={false}
      style={{ height: camera.height }}
      contentContainerStyle={{ width: camera.width }}
    >
      {scene}
    </ScrollView>
  );
}

/** Screen-space bounding box of a band of lot, allowing for how tall it stands. */
function boundsOf(camera: Camera, layout: LotLayout, v0: number, v1: number, height: number) {
  const pts = [
    camera.project(0, v0, height),
    camera.project(layout.width, v0, height),
    camera.project(0, v1, 0),
    camera.project(layout.width, v1, 0),
    camera.project(0, v0, 0),
    camera.project(layout.width, v1, height),
  ];
  const left = Math.min(...pts.map((p) => p.x));
  const top = Math.min(...pts.map((p) => p.y));
  return {
    left,
    top,
    width: Math.max(...pts.map((p) => p.x)) - left,
    height: Math.max(...pts.map((p) => p.y)) - top,
  };
}

/** Where a car sits on the ground, in lot coordinates. */
function carAnchor(slot: LotSlot, layout: LotLayout) {
  const cu = slot.x + slot.width / 2;
  const nose = slot.y + (slot.height - layout.carLength) / 2;
  return { cu, nose, tail: nose + layout.carLength };
}

function EmptyStall({ slot, camera, scale }: { slot: LotSlot; camera: Camera; scale: number }) {
  const at = camera.project(slot.x + slot.width / 2, slot.y + slot.height / 2);
  return (
    <View style={[styles.pin, { left: at.x, top: at.y }]} pointerEvents="none">
      <Text style={[styles.emptyText, { fontSize: 10 * scale }]}>OPEN</Text>
    </View>
  );
}

function ParkedCar({
  car,
  slot,
  layout,
  camera,
  prospect,
  onPress,
}: {
  car: Car;
  slot: LotSlot;
  layout: LotLayout;
  camera: Camera;
  prospect?: Prospect;
  onPress: () => void;
}) {
  // Drive-in: a car eases into its stall when it first appears.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 420, useNativeDriver: true }).start();
  }, [enter]);

  const { cu } = carAnchor(slot, layout);
  const at = camera.project(cu, slot.y + slot.height / 2);
  const w = layout.carWidth * camera.scale;
  const h = layout.carLength * camera.scale;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Names what the tap will actually open, which is the whole point of the
      // buyer branch — a label that always said "open the car" would be wrong
      // exactly when it mattered.
      accessibilityLabel={
        prospect
          ? `Buyer at this car offering ${money(prospect.negotiation.currentOffer)} — open the deal`
          : 'Open this car'
      }
      style={({ pressed }) => [
        styles.car,
        {
          left: at.x - w / 2,
          top: at.y - h / 2,
          width: w,
          height: h,
          // Lying on the ground: the same in-plane rotation and foreshortening
          // the tarmac under it takes. The pressable rotates with the art, so
          // the hit target stays on the car.
          transform: [{ rotate: `${camera.artRotationDeg}deg` }, { scaleY: camera.artSquash }],
        },
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
          rarity={car.rarity}
          width={w}
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
 *
 * Anchored in lot coordinates and then projected, so a marker follows its car
 * around the rotation. Markers hang off the car, never off the stall: a badge
 * placed above the stall lands on the tail of the car in the row in front, which
 * is what the first cut did, and on a 62-car lot it put a price tag on the wrong
 * car.
 */
function CarMarkers({
  car,
  slot,
  layout,
  camera,
  scale,
  prospect,
  onPressProspect,
}: {
  car: Car;
  slot: LotSlot;
  layout: LotLayout;
  camera: Camera;
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

  const { cu, nose, tail } = carAnchor(slot, layout);
  const reconProgress =
    car.status === 'recon' && car.reconTotalMs > 0
      ? 1 - car.reconRemainingMs / car.reconTotalMs
      : 0;

  /** Where a windscreen sticker actually goes. */
  const windscreen = camera.project(cu, nose + layout.carLength * 0.16);
  const middle = camera.project(cu, (nose + tail) / 2);
  const back = camera.project(cu, tail - layout.carLength * 0.04);
  // Stood at the back door, not the windscreen: at six columns the stall is
  // ~60px wide and a buyer beside the price tag sits on it.
  const beside = camera.project(cu + layout.carWidth * 0.62, nose + layout.carLength * 0.62);

  return (
    <>
      {car.status === 'listed' ? (
        <View style={[styles.pin, { left: windscreen.x, top: windscreen.y }]} pointerEvents="none">
          <View style={[styles.sticker, { transform: [{ scale }] }]}>
            <Text style={styles.stickerText}>{moneyShort(car.askPrice)}</Text>
          </View>
        </View>
      ) : null}

      {car.status === 'recon' ? (
        <View style={[styles.pin, { left: middle.x, top: middle.y }]} pointerEvents="none">
          <View style={[styles.shop, { transform: [{ scale }] }]}>
            <Text style={styles.shopText}>IN SHOP · {duration(car.reconRemainingMs)}</Text>
            <View style={styles.shopTrack}>
              <View style={[styles.shopFill, { width: `${Math.round(reconProgress * 100)}%` }]} />
            </View>
          </View>
        </View>
      ) : null}

      {car.status === 'ready' ? (
        <View style={[styles.pin, { left: windscreen.x, top: windscreen.y }]} pointerEvents="none">
          <View style={[styles.ready, { transform: [{ scale }] }]}>
            <Text style={styles.readyText}>READY {moneyShort(retailValue(car))}</Text>
          </View>
        </View>
      ) : null}

      {rarityRank(car.rarity) >= rarityRank('epic') ? (
        // Epic and above only. Sport is one car in eleven, and five extra
        // labels on a lot that already carries fifty-four price tags is clutter
        // bought for the least notable grade — the spoiler already says it, and
        // the feed chip and the inventory sheet both spell it out.
        //
        // Hung off the tail rather than the windscreen, which already carries a
        // price tag or a READY flag. Markers hang off the CAR and never off the
        // stall — a badge placed over the stall lands on the tail of the car in
        // the row in front.
        <View style={[styles.pin, { left: back.x, top: back.y }]} pointerEvents="none">
          <View
            style={[
              styles.grade,
              { borderColor: RARITY_COLOR[car.rarity], transform: [{ scale }] },
            ]}
          >
            <Text style={[styles.gradeText, { color: RARITY_COLOR[car.rarity] }]}>
              {RARITIES[car.rarity].badge.toUpperCase()}
            </Text>
          </View>
        </View>
      ) : null}

      {car.repoCount > 0 ? (
        <View style={[styles.pin, { left: back.x, top: back.y }]} pointerEvents="none">
          <View style={[styles.repo, { transform: [{ scale }] }]}>
            <Text style={styles.repoText}>REPO ×{car.repoCount}</Text>
          </View>
        </View>
      ) : null}

      {prospect ? (
        <Animated.View
          style={[
            styles.pin,
            {
              left: beside.x,
              top: beside.y,
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
            <Shopper size={Math.max(20, 30 * scale)} />
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
  /**
   * A marker anchored to a projected point. Zero-sized and centred on it, so the
   * thing inside hangs off the point rather than off a box — which is what lets
   * every marker be positioned by projecting one spot on the car.
   */
  pin: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  car: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.72 },
  signHit: { position: 'absolute' },
  emptyText: {
    color: theme.colors.stripe,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  sticker: {
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
    backgroundColor: theme.colors.dangerDim,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  grade: {
    borderWidth: 1,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
    backgroundColor: 'rgba(16,18,25,0.82)',
  },
  gradeText: { fontSize: 8, fontWeight: '800', letterSpacing: 0.5 },
  repoText: { color: '#ffd9d2', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  buyerHit: { alignItems: 'center', justifyContent: 'center' },
});
