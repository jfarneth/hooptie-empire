import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MS_PER_GAME_WEEK } from '../../sim/balance';
import { portfolioValue } from '../../sim/economy';
import { activeNotes, remainingScheduled } from '../../sim/notes';
import { collectionsCapacity } from '../../sim/upgrades';
import type { GameState, Note } from '../../sim/types';
import { TIER_COLOR, duration, money, moneyShort, theme } from '../theme';
import { Card, Chip, EmptyState, Label, Meter, Row } from '../components/ui';

/**
 * The book. Once this screen has more on it than the lot does, the player has
 * stopped being a car dealer and started being a lender, which is the actual
 * arc of the business.
 */
export function NotesScreen({ state }: { state: GameState }) {
  if (state.stage !== 'bhph') {
    return (
      <EmptyState
        title="No finance desk yet"
        hint="Buy the lot and you can start carrying the paper yourself instead of handing the customer to a bank."
      />
    );
  }

  const active = activeNotes(state.notes);
  const closed = state.notes.filter((n) => n.status === 'paid' || n.status === 'defaulted');
  const capacity = collectionsCapacity(state);
  const atLimit = active.length >= capacity;
  const overCapacity = active.length > capacity;
  const delinquent = active.filter((n) => n.status === 'delinquent');

  const weeklyScheduled = active.reduce((sum, n) => sum + n.paymentAmount, 0);
  const outstanding = active.reduce((sum, n) => sum + remainingScheduled(n), 0);

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Card style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Label>Portfolio</Label>
            <Text style={styles.headline}>{money(portfolioValue(state.notes))}</Text>
            <Text style={styles.sub}>principal outstanding</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Label>Per week</Label>
            <Text style={[styles.headline, { color: theme.colors.money }]}>
              {moneyShort(weeklyScheduled)}
            </Text>
            <Text style={styles.sub}>if everyone pays</Text>
          </View>
        </Row>

        <View style={{ gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.metaLabel}>Collections desk</Text>
            <Text style={[styles.metaValue, atLimit && { color: theme.colors.danger }]}>
              {active.length} / {capacity} notes
            </Text>
          </Row>
          <Meter
            progress={active.length / Math.max(1, capacity)}
            color={atLimit ? theme.colors.danger : theme.colors.accent}
          />
          {/* Two distinct states, and they are not the same problem. Full is the
              rule working; over is a book that predates the rule, or one whose
              desk shrank underneath it, and that one still bleeds. */}
          {overCapacity ? (
            <Text style={styles.warning}>
              Over capacity. Everyone on the book is likelier to miss, and no new contracts get
              written, until it comes back under {capacity}.
            </Text>
          ) : atLimit ? (
            <Text style={styles.warning}>
              Full. Walk-ups get sold the car instead of the payment until something closes out.
            </Text>
          ) : null}
        </View>

        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="Scheduled" value={moneyShort(outstanding)} />
          <Stat label="Collected" value={moneyShort(state.stats.totalCollected)} />
          <Stat label="Paid off" value={String(state.stats.notesPaidOff)} />
          <Stat label="Repos" value={String(state.stats.reposCompleted)} tone={theme.colors.danger} />
        </Row>
      </Card>

      {delinquent.length > 0 ? (
        <>
          <Label>Behind ({delinquent.length})</Label>
          {delinquent.map((n) => (
            <NoteRow key={n.id} note={n} now={state.t} />
          ))}
        </>
      ) : null}

      <Label>Current ({active.length - delinquent.length})</Label>
      {active.filter((n) => n.status === 'current').length === 0 ? (
        <EmptyState title="No active contracts" hint="Finance a deal on the lot to start the book." />
      ) : (
        active
          .filter((n) => n.status === 'current')
          .map((n) => <NoteRow key={n.id} note={n} now={state.t} />)
      )}

      {closed.length > 0 ? (
        <>
          <Label>History</Label>
          {closed.slice(-12).reverse().map((n) => (
            <NoteRow key={n.id} note={n} now={state.t} />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={{ gap: 1 }}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, tone ? { color: tone } : null]}>{value}</Text>
    </View>
  );
}

function NoteRow({ note, now }: { note: Note; now: number }) {
  const paid = note.paymentsTotal - note.paymentsRemaining;
  const progress = paid / Math.max(1, note.paymentsTotal);
  const closed = note.status === 'paid' || note.status === 'defaulted';

  const statusColor =
    note.status === 'paid'
      ? theme.colors.money
      : note.status === 'defaulted'
        ? theme.colors.danger
        : note.status === 'delinquent'
          ? theme.colors.warn
          : theme.colors.textDim;

  return (
    <View style={[styles.note, closed && styles.noteClosed]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flex: 1 }}>
          <Chip text={note.customerTier} color={TIER_COLOR[note.customerTier]} filled />
          <Text style={styles.noteName} numberOfLines={1}>
            {note.customerName}
          </Text>
        </Row>
        <Text style={[styles.noteStatus, { color: statusColor }]}>
          {note.status === 'delinquent'
            ? `${note.missedPayments} MISSED`
            : note.status.toUpperCase()}
        </Text>
      </Row>

      <Text style={styles.noteCar} numberOfLines={1}>
        {note.carLabel}
      </Text>

      <Meter progress={progress} color={statusColor} height={3} />

      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.noteMeta}>
          {paid}/{note.paymentsTotal} payments · {money(note.paymentAmount)}/wk
        </Text>
        <Text style={styles.noteCollected}>{money(note.collected)} in</Text>
      </Row>

      {!closed ? (
        <Text style={styles.noteDue}>
          next payment in {duration(Math.max(0, note.nextDueAt - now))} · {money(note.principal)} left
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 32 },
  headline: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sub: { color: theme.colors.textFaint, fontSize: 10 },
  metaLabel: { color: theme.colors.textDim, fontSize: 12 },
  metaValue: { color: theme.colors.text, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  warning: { color: theme.colors.danger, fontSize: 11, lineHeight: 15 },
  statLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  statValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  note: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
    gap: 5,
  },
  noteClosed: { opacity: 0.55 },
  noteName: { color: theme.colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  noteStatus: { fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },
  noteCar: { color: theme.colors.textDim, fontSize: 11 },
  noteMeta: { color: theme.colors.textDim, fontSize: 11, fontVariant: ['tabular-nums'] },
  noteCollected: {
    color: theme.colors.money,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  noteDue: { color: theme.colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
});
