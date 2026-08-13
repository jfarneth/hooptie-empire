import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { theme } from '../theme';
import { Button } from './ui';

/**
 * The first sixty seconds.
 *
 * Three cards, and the constraint that shaped all three is that **the copy must
 * describe the store the player is actually standing in.** A curbstone has
 * `financing: false`, so a coach mark promising weekly collections would be
 * selling the game's best mechanic to somebody who cannot reach it for another
 * two hours — the same class of mistake as a sheet judging price against a
 * number the sticker is not denominated in. What it does instead is name the
 * thing and say where it unlocks, which is a hook rather than a lie.
 *
 * Deliberately not a guided tutorial. Nothing here gates input, nothing waits
 * for the player to perform a step, and the whole sequence is two taps to leave.
 * An idle game's opening is thin by design and the grand opening promotion is
 * already running underneath this; the job is orientation, not instruction.
 */

export type CoachTab = 'lot' | 'buy' | 'notes' | 'upgrades';

interface Step {
  /** Which bottom tab to point at, and to switch to. Omitted for the opener. */
  tab?: CoachTab;
  title: string;
  body: string;
}

const STEPS: readonly Step[] = [
  {
    title: 'Hooptie Empire',
    // Six businesses TOTAL, and this driveway is the first of them — an earlier
    // draft said six sat between here and a franchise, which is off by the
    // whole used half of the ladder.
    body: 'A driveway, a few thousand dollars, and nobody to answer to. This is the first of six businesses; the last is a premium franchise store.',
  },
  {
    tab: 'buy',
    title: 'Start on the feed',
    body: "Cars come up all day. You get an estimate of condition and an honest margin of error — never the truth. Reading the gap between that and the asking price is the whole job.",
  },
  {
    tab: 'lot',
    title: 'Then sell it twice',
    body: 'Buyers walk up on their own — tap one to haggle. Out here it is cash only. Get yourself a real lot and you can sell the car and the loan behind it, and the loan pays every week whether this app is open or not.',
  },
];

/** Which tab each step wants shown, so the copy matches what is behind it. */
export function coachTabFor(step: number): CoachTab | undefined {
  return STEPS[step]?.tab;
}

export const COACH_STEPS = STEPS.length;

export function Onboarding({
  step,
  tabCount,
  bottomInset,
  onNext,
  onSkip,
}: {
  step: number;
  /** How many bottom tabs there are, so the caret can find one without measuring it. */
  tabCount: number;
  /** Height of everything below the body — the promotion tray and the tab bar. */
  bottomInset: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { width } = useWindowDimensions();
  const current = STEPS[step];
  if (!current) return null;

  const last = step === STEPS.length - 1;
  const tabIndex = current.tab ? TAB_ORDER.indexOf(current.tab) : -1;

  // The caret lands on the middle of its tab. Tabs are evenly weighted, so this
  // is arithmetic rather than a measurement — no onLayout, nothing to go stale
  // when the promotion tray appears or disappears underneath.
  const caretLeft = ((tabIndex + 0.5) * width) / tabCount - CARD_MARGIN - CARET / 2;

  return (
    <View style={styles.root} pointerEvents="box-none">
      {/* Swallows taps on the game underneath. Advancing on a scrim tap as well
          as on the button is what keeps this two taps to leave. */}
      <Pressable
        style={styles.scrim}
        onPress={onNext}
        accessibilityRole="button"
        accessibilityLabel={last ? 'Dismiss' : 'Next'}
      />

      <View style={[styles.dock, { bottom: bottomInset + theme.space(3) }]} pointerEvents="box-none">
        <View style={styles.card}>
          <Text style={styles.step}>
            {step + 1} of {STEPS.length}
          </Text>
          <Text style={styles.title}>{current.title}</Text>
          <Text style={styles.body}>{current.body}</Text>

          <View style={styles.actions}>
            {!last ? (
              <Pressable onPress={onSkip} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.skip}>Skip</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Button label={last ? "Let's go" : 'Next'} tone="primary" onPress={onNext} />
          </View>
        </View>

        {tabIndex >= 0 ? <View style={[styles.caret, { left: caretLeft }]} /> : null}
      </View>
    </View>
  );
}

const TAB_ORDER: CoachTab[] = ['lot', 'buy', 'notes', 'upgrades'];

const CARD_MARGIN = 16;
const CARET = 16;

const FILL = { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 } as const;

const styles = StyleSheet.create({
  root: { ...FILL, zIndex: 50 },
  scrim: { ...FILL, backgroundColor: 'rgba(8,10,14,0.72)' },
  dock: { position: 'absolute', left: CARD_MARGIN, right: CARD_MARGIN },
  card: {
    backgroundColor: theme.colors.surfaceAlt,
    borderColor: theme.colors.accentDim,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space(4),
    gap: theme.space(2),
  },
  step: { color: theme.colors.textFaint, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  title: { color: theme.colors.accent, fontSize: 20, fontWeight: '900' },
  body: { color: theme.colors.text, fontSize: 15, lineHeight: 21 },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: theme.space(2),
  },
  skip: { color: theme.colors.textDim, fontSize: 14, fontWeight: '600' },
  // A square rotated 45° — the bottom half reads as an arrow into the tab, and
  // it needs no svg on a screen that is otherwise plain views.
  caret: {
    position: 'absolute',
    bottom: -CARET / 2,
    width: CARET,
    height: CARET,
    backgroundColor: theme.colors.surfaceAlt,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: theme.colors.accentDim,
    transform: [{ rotate: '45deg' }],
  },
});
