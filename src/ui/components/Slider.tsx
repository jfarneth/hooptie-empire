import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { theme } from '../theme';

/**
 * The one slider.
 *
 * Hand-rolled on PanResponder rather than pulling in a native slider package:
 * one fewer native dependency to keep aligned with the Expo SDK, it behaves the
 * same in the web build used for verification, and it lets the track show what
 * actually matters at each call site.
 *
 * Drags are tracked relative to where the gesture started, so the component
 * never needs its position on the page.
 *
 * WORKS IN ABSTRACT UNITS. It knows nothing about money, margins or standard
 * deviations — callers hand it a range and format their own end labels. That is
 * what lets the counteroffer slider (dollars, thousands wide) and a house rule
 * (a margin, less than one unit wide) share it. The old version divided by
 * `Math.max(1, max - min)`, which was harmless for prices and would have pinned
 * a margin slider to its left end forever.
 */
export function Slider({
  min,
  max,
  step,
  value,
  onChange,
  minLabel,
  maxLabel,
  disabled = false,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  minLabel?: React.ReactNode;
  maxLabel?: React.ReactNode;
  disabled?: boolean;
}) {
  const [width, setWidth] = useState(0);

  // The PanResponder is memoised, so it would otherwise close over stale
  // bounds after any re-render. Everything it reads lives in a ref.
  const geom = useRef({ width: 0, min, max, step, disabled });
  geom.current = { width, min, max, step, disabled };

  const startRatio = useRef(0);
  const emit = useRef(onChange);
  emit.current = onChange;

  const ratioToValue = (ratio: number) => {
    const g = geom.current;
    const clamped = Math.min(1, Math.max(0, ratio));
    const raw = g.min + clamped * (g.max - g.min);
    // Snapped against zero rather than against `min`, so a scale that spans
    // break-even can always land exactly on it. Every house rule in the game
    // has a landmark at zero and a stop that misses it by a rounding error is
    // a stop the player cannot set.
    const stepped = g.step > 0 ? Math.round(raw / g.step) * g.step : raw;
    return Math.min(g.max, Math.max(g.min, stepped));
  };

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !geom.current.disabled,
        onMoveShouldSetPanResponder: () => !geom.current.disabled,
        onPanResponderGrant: (e) => {
          const g = geom.current;
          if (g.width <= 0) return;
          startRatio.current = e.nativeEvent.locationX / g.width;
          emit.current(ratioToValue(startRatio.current));
        },
        onPanResponderMove: (_e, gesture) => {
          const g = geom.current;
          if (g.width <= 0) return;
          emit.current(ratioToValue(startRatio.current + gesture.dx / g.width));
        },
      }),
    [],
  );

  const span = max - min || 1;
  const ratio = Math.min(1, Math.max(0, (value - min) / span));

  return (
    <View style={styles.wrap}>
      <View style={styles.touch} onLayout={onLayout} {...responder.panHandlers}>
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${ratio * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { left: `${ratio * 100}%` }]}>
          <View style={styles.thumbInner} />
        </View>
      </View>

      {minLabel || maxLabel ? (
        <View style={styles.labels}>
          <View style={{ alignItems: 'flex-start', flex: 1 }}>{minLabel}</View>
          <View style={{ alignItems: 'flex-end', flex: 1 }}>{maxLabel}</View>
        </View>
      ) : null}
    </View>
  );
}

/** The end labels every slider in the game uses: a value, and what it means. */
export function SliderAnchor({
  value,
  label,
  align = 'flex-start',
}: {
  value: string;
  label?: string;
  align?: 'flex-start' | 'flex-end';
}) {
  return (
    <View style={{ alignItems: align }}>
      <Text style={styles.anchorValue}>{value}</Text>
      {label ? <Text style={styles.anchorLabel}>{label}</Text> : null}
    </View>
  );
}

const THUMB = 26;

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  touch: { height: THUMB + 14, justifyContent: 'center' },
  track: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surfaceHigh,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: theme.colors.accent },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    marginLeft: -THUMB / 2,
    borderRadius: THUMB / 2,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.colors.bg,
  },
  thumbInner: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.bg },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  anchorValue: {
    color: theme.colors.textDim,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  anchorLabel: { color: theme.colors.textFaint, fontSize: 9 },
});
