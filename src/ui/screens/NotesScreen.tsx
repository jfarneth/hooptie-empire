import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { MS_PER_GAME_WEEK } from '../../sim/balance';
import { portfolioValue } from '../../sim/economy';
import { activeNotes, remainingScheduled } from '../../sim/notes';
import { activePlans, expectedLossRatio, hasServiceDept, planExposure } from '../../sim/service';
import { getStage } from '../../sim/stages';
import { collectionsCapacity } from '../../sim/upgrades';
import type { GameState, Note, ServiceContract } from '../../sim/types';
import { TIER_COLOR, duration, money, moneyShort, theme } from '../theme';
import { HUD_HEIGHT } from '../components/Hud';
import { Button, Card, Chip, EmptyState, Label, Meter, Row } from '../components/ui';

/**
 * The book. Once this screen has more on it than the lot does, the player has
 * stopped being a car dealer and started being a lender, which is the actual
 * arc of the business.
 */
export function NotesScreen({ state }: { state: GameState }) {
  const stage = getStage(state.stage);
  const [tab, setTab] = React.useState<'paper' | 'plans'>('paper');

  if (!stage.financing) {
    return (
      <EmptyState
        title="No finance desk yet"
        hint="Buy the lot and you can start carrying the paper yourself instead of handing the customer to a bank."
      />
    );
  }

  // Two books, and they are mirror images: one collects and one pays out. The
  // segmented control rather than a second tab in the nav, because they are the
  // same kind of object — contracts on the save with a weekly beat — and a
  // player thinking about one is usually thinking about the other.
  if (stage.serviceContracts && tab === 'plans') {
    return (
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <BookTabs tab={tab} onChange={setTab} />
        <PlansTab state={state} />
      </ScrollView>
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
      {stage.serviceContracts ? <BookTabs tab={tab} onChange={setTab} /> : null}
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

function BookTabs({
  tab,
  onChange,
}: {
  tab: 'paper' | 'plans';
  onChange: (tab: 'paper' | 'plans') => void;
}) {
  return (
    <Row gap={6}>
      <Button
        label="Paper"
        tone={tab === 'paper' ? 'primary' : 'ghost'}
        onPress={() => onChange('paper')}
        style={{ flex: 1 }}
      />
      <Button
        label="Plans"
        tone={tab === 'plans' ? 'primary' : 'ghost'}
        onPress={() => onChange('plans')}
        style={{ flex: 1 }}
      />
    </Row>
  );
}

/**
 * The other book.
 *
 * A note is an asset that collects; a service contract is a liability that pays
 * out. The screen is deliberately laid out the same way as the paper side, with
 * one number the paper side has no equivalent of: the LOSS RATIO, which is the
 * whole product. A book returning 65% of what it took is working exactly as
 * designed, and one returning 110% is a desk writing cover on cars it should
 * not be.
 */
function PlansTab({ state }: { state: GameState }) {
  const live = activePlans(state.serviceContracts);
  const closed = state.serviceContracts.filter((c) => c.status !== 'active');
  const income = state.stats.planIncome;
  const paid = state.stats.planPayouts;
  const ratio = income > 0 ? paid / income : 0;
  const shop = hasServiceDept(state);
  const target = expectedLossRatio(state);

  return (
    <>
      <Card style={{ gap: 10 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View>
            <Label>Taken in</Label>
            <Text style={styles.headline}>{money(income)}</Text>
            <Text style={styles.sub}>{state.stats.plansSold} plans sold</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Label>Paid out</Label>
            <Text style={[styles.headline, { color: theme.colors.danger }]}>{money(paid)}</Text>
            <Text style={styles.sub}>in claims</Text>
          </View>
        </Row>

        <View style={{ gap: 4 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.metaLabel}>Of every dollar taken</Text>
            <Text
              style={[
                styles.metaValue,
                { color: ratio > 1 ? theme.colors.danger : theme.colors.money },
              ]}
            >
              {Math.round(ratio * 100)}¢ paid back out
            </Text>
          </Row>
          <Meter
            progress={Math.min(1, ratio)}
            color={ratio > 1 ? theme.colors.danger : theme.colors.money}
          />
          <Text style={styles.sub}>
            {income === 0
              ? 'Nothing sold yet. Cover is offered on every car you sell.'
              : `Around ${Math.round(target * 100)}¢ is what to expect over a full book${
                  shop ? ', with your own bays doing the work' : ''
                }. A young book always looks better than it is — the money comes in first and the claims come later.`}
          </Text>
        </View>

        <Row style={{ justifyContent: 'space-between' }}>
          <Stat label="In force" value={String(live.length)} />
          <Stat label="Kept" value={moneyShort(income - paid)} tone={theme.colors.money} />
          <Stat
            label="Exposure"
            value={moneyShort(planExposure(state.serviceContracts))}
            tone={theme.colors.warn}
          />
          <Stat label="Closed" value={String(state.stats.plansSold - live.length)} />
        </Row>
      </Card>

      <Label>In force ({live.length})</Label>
      {live.length === 0 ? (
        <EmptyState
          title="No cover in force"
          hint="A share of your buyers take a service contract when they buy the car. Set what it costs in Office → Business."
        />
      ) : (
        live.map((c) => <PlanRow key={c.id} plan={c} now={state.t} />)
      )}

      {closed.length > 0 ? (
        <>
          <Label>History</Label>
          {closed
            .slice(-12)
            .reverse()
            .map((c) => (
              <PlanRow key={c.id} plan={c} now={state.t} />
            ))}
        </>
      ) : null}
    </>
  );
}

function PlanRow({ plan, now }: { plan: ServiceContract; now: number }) {
  const used = plan.paidOut / Math.max(1, plan.price);
  const closed = plan.status !== 'active';
  const underwater = plan.paidOut > plan.price;

  const statusColor = underwater
    ? theme.colors.danger
    : plan.status === 'void'
      ? theme.colors.textDim
      : plan.status === 'expired'
        ? theme.colors.money
        : theme.colors.textDim;

  return (
    <View style={[styles.note, closed && styles.noteClosed]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.noteName} numberOfLines={1}>
          {plan.customerName}
        </Text>
        <Text style={[styles.noteStatus, { color: statusColor }]}>
          {plan.status === 'void'
            ? 'TORN UP'
            : plan.status === 'expired'
              ? 'RAN OUT'
              : plan.claims === 0
                ? 'UNUSED'
                : `${plan.claims} CLAIM${plan.claims > 1 ? 'S' : ''}`}
        </Text>
      </Row>

      <Text style={styles.noteCar} numberOfLines={1}>
        {plan.carLabel}
      </Text>

      {/* Against the PRICE, not against the cap: the line a player cares about
          is the one where this plan stopped making money. */}
      <Meter
        progress={Math.min(1, used)}
        color={underwater ? theme.colors.danger : theme.colors.money}
        height={3}
      />

      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.noteMeta}>
          {money(plan.price)} in · {money(plan.paidOut)} out
        </Text>
        <Text style={[styles.noteCollected, underwater && { color: theme.colors.danger }]}>
          {underwater ? '-' : ''}
          {money(Math.abs(plan.price - plan.paidOut))}
        </Text>
      </Row>

      {!closed ? (
        <Text style={styles.noteDue}>
          {plan.weeksRemaining} of {plan.weeksTotal} weeks left · next check in{' '}
          {duration(Math.max(0, plan.nextCheckAt - now))}
        </Text>
      ) : null}
    </View>
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
  content: { padding: 16, paddingTop: HUD_HEIGHT + 12, gap: 8, paddingBottom: 32 },
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
