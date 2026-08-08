import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { AwaySummary } from '../../state/store';
import { money, theme } from '../theme';
import { Sheet } from './Sheet';
import { Button, Row } from './ui';

/**
 * What happened while the app was closed.
 *
 * These numbers are not an estimate or a reward table — the engine actually ran
 * those hours on load. Saying so plainly is worth more than a bigger number.
 */
export function AwaySummaryModal({
  summary,
  onDismiss,
}: {
  summary: AwaySummary | null;
  onDismiss: () => void;
}) {
  if (!summary) return <Sheet visible={false} title="" onClose={onDismiss} children={null} />;

  const away = describeSpan(summary.elapsedMs);
  const ran = describeSpan(summary.simulatedMs);

  return (
    <Sheet
      visible
      title="While you were gone"
      subtitle={summary.capped ? `Away ${away} — the lot ran for ${ran}` : `The lot ran for ${ran}`}
      onClose={onDismiss}
    >
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>Cash collected</Text>
        <Text
          style={[
            styles.heroValue,
            { color: summary.cashDelta >= 0 ? theme.colors.money : theme.colors.danger },
          ]}
        >
          {summary.cashDelta >= 0 ? '+' : ''}
          {money(summary.cashDelta)}
        </Text>
      </View>

      <View style={styles.grid}>
        <Tile label="Cars sold" value={String(summary.carsSold)} />
        <Tile label="Payments in" value={money(summary.collected)} tone={theme.colors.money} />
        <Tile label="Notes paid off" value={String(summary.notesPaid)} />
        <Tile
          label="Repossessions"
          value={String(summary.repos)}
          tone={summary.repos > 0 ? theme.colors.danger : undefined}
        />
      </View>

      {summary.skillUps.length > 0 ? (
        <View style={styles.skills}>
          {summary.skillUps.map((line, i) => (
            <Text key={`${line}-${i}`} style={styles.skillLine}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {summary.capped ? (
        <Text style={styles.capNote}>
          Your night manager only covers so much. Hire more coverage to keep the lot running longer
          while you are away.
        </Text>
      ) : null}

      <Button label="Back to work" tone="primary" onPress={onDismiss} />
    </Sheet>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={[styles.tileValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function describeSpan(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return rem > 0 ? `${hours}h ${rem}m` : `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

const styles = StyleSheet.create({
  skills: {
    gap: 3,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.accent,
    paddingLeft: 10,
    marginTop: 4,
  },
  skillLine: { color: theme.colors.accent, fontSize: 12 },
  hero: {
    alignItems: 'center',
    paddingVertical: 16,
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    gap: 2,
  },
  heroLabel: { color: theme.colors.textDim, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  heroValue: { fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.sm,
    padding: 10,
    gap: 2,
  },
  tileLabel: { color: theme.colors.textDim, fontSize: 11 },
  tileValue: {
    color: theme.colors.text,
    fontSize: 17,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  capNote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
