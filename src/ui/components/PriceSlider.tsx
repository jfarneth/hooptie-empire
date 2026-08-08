import React, { useCallback, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { money, theme } from '../theme';

/**
 * Price slider for counteroffers.
 *
 * Hand-rolled on PanResponder rather than pulling in a native slider package:
 * one fewer native dependency to keep aligned with the Expo SDK, it behaves the
 * same in the web build used for verification, and it lets the track show what
 * actually matters — where their offer sits, where your ask is, and the fact
 * that values snap to prices a person would say out loud.
 *
 * Drags are tracked relative to where the gesture started, so the component
 * never needs its position on the page.
 */
export function PriceSlider({
  min,
  max,
  step,
  value,
  onChange,
  minLabel,
  maxLabel,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  minLabel?: string;
  maxLabel?: string;
}) {
  const [width, setWidth] = useState(0);

  // The PanResponder is memoised, so it would otherwise close over stale
  // bounds after any re-render. Everything it reads lives in a ref.
  const geom = useRef({ width: 0, min, max, step });
  geom.current = { width, min, max, step };

  const startRatio = useRef(0);
  const emit = useRef(onChange);
  emit.current = onChange;

  const ratioToValue = (ratio: number) => {
    const g = geom.current;
    const clamped = Math.min(1, Math.max(0, ratio));
    const raw = g.min + clamped * (g.max - g.min);
    const stepped = Math.round(raw / g.step) * g.step;
    return Math.min(g.max, Math.max(g.min, stepped));
  };

  const onLayout = useCallback((e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width), []);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
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

  const span = Math.max(1, max - min);
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

      <View style={styles.labels}>
        <View style={{ alignItems: 'flex-start' }}>
          <Text style={styles.anchorValue}>{money(min)}</Text>
          {minLabel ? <Text style={styles.anchorLabel}>{minLabel}</Text> : null}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.anchorValue}>{money(max)}</Text>
          {maxLabel ? <Text style={styles.anchorLabel}>{maxLabel}</Text> : null}
        </View>
      </View>
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
