import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import {
  getPromotion,
  livePromotions,
  promotionRemaining,
  type PromotionIcon,
} from '../../sim/promotions';
import type { GameState } from '../../sim/types';
import { duration, theme } from '../theme';

/**
 * What the business is currently running, sat on top of the tab bar.
 *
 * Renders nothing at all when nothing is running, which is most of a career —
 * this is a state the game is briefly in, not a permanent fixture, and a bar
 * that said "no promotions" would be a row of furniture for a thing that is off.
 *
 * It lives in the tray rather than the HUD because the HUD is the two scores
 * (cash and the book) and adding a third readout with a clock on it to a bar
 * that floats over the lot would crowd exactly the surface the game most wants
 * you looking at. Down here it sits next to the navigation, where a countdown
 * reads as status rather than as a number you are meant to be doing sums with.
 *
 * Deliberately not pressable. There is nothing to open yet — one promotion, no
 * choices — and a control that does nothing when tapped teaches players to stop
 * tapping. When promotions become something a player buys or picks, this is the
 * surface that grows the sheet.
 */
export function PromotionBar({ state }: { state: GameState }) {
  const live = livePromotions(state);
  if (live.length === 0) return null;

  return (
    <View style={styles.tray}>
      {live.map((active) => {
        const def = getPromotion(active.id);
        if (!def) return null;
        return (
          <View
            key={active.id}
            style={styles.row}
            accessibilityRole="text"
            accessibilityLabel={`${def.name} promotion running: ${def.effect}, ${duration(promotionRemaining(state, active))} left`}
          >
            <PromotionGlyph icon={def.icon} />
            <Text style={styles.name} numberOfLines={1}>
              {def.name.toUpperCase()}
            </Text>
            <Text style={styles.effect} numberOfLines={1}>
              {def.effect}
            </Text>
            <Text style={styles.clock}>{duration(promotionRemaining(state, active))}</Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The icon, resolved from the id the sim carries.
 *
 * Same seam `CarArt` uses: the simulation names a drawing and this is the only
 * place that knows what that drawing is. An unknown icon renders nothing rather
 * than crashing, which is what lets a promotion ship before its art does.
 */
function PromotionGlyph({ icon }: { icon: PromotionIcon }) {
  if (icon !== 'pennant') return null;
  return (
    <Svg width={14} height={14} viewBox="0 0 14 14">
      {/* A pennant on a pole: bunting on the fence, which is what a grand
          opening looks like from the road. */}
      <Rect x={2.2} y={1} width={1.4} height={12} rx={0.7} fill={theme.colors.textFaint} />
      <Path d="M3.6 1.6 L12.4 4.4 L3.6 7.6 Z" fill={theme.colors.accent} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  tray: {
    backgroundColor: theme.colors.surfaceAlt,
    borderTopWidth: 1,
    borderTopColor: theme.colors.accentDim,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  name: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  // Takes the slack so the countdown stays pinned to the right edge and does
  // not slide about as the digits change.
  effect: { flex: 1, color: theme.colors.textDim, fontSize: 11 },
  clock: {
    color: theme.colors.text,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
