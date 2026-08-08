import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { retailValue } from '../../sim/economy';
import { getModel } from '../../sim/models';
import type { Car, GameState, Prospect } from '../../sim/types';
import { duration, moneyShort, theme } from '../theme';
import { CarSvg } from './CarSvg';
import { Meter } from './ui';

/**
 * The lot. Empty bays are painted stripes; occupied bays hold a car that drives
 * in when you buy it. Everything the player needs to triage inventory is on the
 * bay itself, so the lot is a working screen rather than a decoration.
 */

interface Props {
  state: GameState;
  capacity: number;
  onSelectCar: (carId: string) => void;
  onSelectProspect: (prospectId: string) => void;
}

export function LotGrid({ state, capacity, onSelectCar, onSelectProspect }: Props) {
  const held = state.cars.filter((c) => c.status !== 'sold');
  const emptyCount = Math.max(0, capacity - held.length);

  return (
    <View style={styles.grid}>
      {held.map((car) => (
        <CarBay
          key={car.id}
          car={car}
          state={state}
          prospect={state.prospects.find((p) => p.carId === car.id)}
          onPress={() => onSelectCar(car.id)}
          onPressProspect={onSelectProspect}
        />
      ))}
      {Array.from({ length: emptyCount }).map((_, i) => (
        <EmptyBay key={`empty_${i}`} />
      ))}
    </View>
  );
}

function EmptyBay() {
  return (
    <View style={[styles.bay, styles.bayEmpty]}>
      <View style={styles.stripeLeft} />
      <View style={styles.stripeRight} />
      <Text style={styles.emptyText}>OPEN</Text>
    </View>
  );
}

function CarBay({
  car,
  state,
  prospect,
  onPress,
  onPressProspect,
}: {
  car: Car;
  state: GameState;
  prospect?: Prospect;
  onPress: () => void;
  onPressProspect: (id: string) => void;
}) {
  const model = getModel(car.modelId);

  // Drive-in: the car slides and fades into the bay when it first appears.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 420,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  // A waiting buyer pulses so it is impossible to miss on a busy lot.
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

  const reconProgress =
    car.status === 'recon' && car.reconTotalMs > 0
      ? 1 - car.reconRemainingMs / car.reconTotalMs
      : 0;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.bay, pressed && styles.bayPressed]}>
      <View style={styles.stripeLeft} />
      <View style={styles.stripeRight} />

      <Animated.View
        style={{
          opacity: enter,
          transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [34, 0] }) }],
        }}
      >
        <CarSvg
          bodyStyle={model.bodyStyle}
          colorIndex={car.colorIndex}
          condition={car.condition}
          width={112}
        />
      </Animated.View>

      <Text style={styles.bayName} numberOfLines={1}>
        {model.name}
      </Text>

      <View style={styles.bayStatus}>
        {car.status === 'recon' ? (
          <>
            <Text style={styles.statusShop}>IN SHOP · {duration(car.reconRemainingMs)}</Text>
            <Meter progress={reconProgress} height={3} />
          </>
        ) : car.status === 'listed' ? (
          <Text style={styles.statusListed}>{moneyShort(car.askPrice)}</Text>
        ) : (
          <Text style={styles.statusReady}>READY · {moneyShort(retailValue(car))}</Text>
        )}
      </View>

      {car.repoCount > 0 ? (
        <View style={styles.repoBadge}>
          <Text style={styles.repoBadgeText}>REPO ×{car.repoCount}</Text>
        </View>
      ) : null}

      {prospect ? (
        <Animated.View style={[styles.prospectBadge, { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) }]}>
          <Pressable onPress={() => onPressProspect(prospect.id)} hitSlop={8}>
            <Text style={styles.prospectText}>BUYER</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  bay: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 150,
    backgroundColor: theme.colors.asphalt,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingTop: 10,
    paddingBottom: 8,
    paddingHorizontal: 10,
    alignItems: 'center',
    overflow: 'hidden',
  },
  bayPressed: { borderColor: theme.colors.accent },
  bayEmpty: {
    borderStyle: 'dashed',
    borderColor: theme.colors.stripe,
    justifyContent: 'center',
    minHeight: 116,
  },
  stripeLeft: {
    position: 'absolute',
    left: 5,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: theme.colors.stripe,
    opacity: 0.5,
  },
  stripeRight: {
    position: 'absolute',
    right: 5,
    top: 8,
    bottom: 8,
    width: 2,
    backgroundColor: theme.colors.stripe,
    opacity: 0.5,
  },
  emptyText: {
    color: theme.colors.stripe,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.5,
  },
  bayName: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
    maxWidth: '100%',
  },
  bayStatus: { width: '100%', alignItems: 'center', gap: 3, marginTop: 3, minHeight: 16 },
  statusShop: { color: theme.colors.accent, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  statusReady: { color: theme.colors.textDim, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  statusListed: {
    color: theme.colors.money,
    fontSize: 13,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  repoBadge: {
    position: 'absolute',
    top: 5,
    left: 8,
    backgroundColor: theme.colors.dangerDim,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  repoBadgeText: { color: '#ffd9d2', fontSize: 8, fontWeight: '800', letterSpacing: 0.4 },
  prospectBadge: {
    position: 'absolute',
    top: 5,
    right: 6,
    backgroundColor: theme.colors.accent,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  prospectText: { color: '#1a1206', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
});
