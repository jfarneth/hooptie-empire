import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { advanceStage, stageMovePreview } from '../../sim/actions';
import { getStage } from '../../sim/stages';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, moneyShort, theme } from '../theme';
import { Button, Card, Label, Meter, Row } from './ui';

/**
 * The ladder, and the price of the next rung.
 *
 * This card carries one job the old "buy the lot" button did not: moving up
 * costs you your entire payroll, and the player has to know that *before* they
 * commit, not from watching their automation stop. So the button opens a
 * confirmation that lists exactly who walks and what the book looks like on the
 * other side, rather than firing on the first tap.
 *
 * Everything shown here comes from `stageMovePreview`, which is built from the
 * same data `advanceStage` acts on — a warning computed separately from the
 * thing it warns about drifts, and then lies.
 */
export function StageCard({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const [confirming, setConfirming] = useState(false);

  const here = getStage(state.stage);
  const preview = stageMovePreview(state);
  const next = preview.next;

  if (!next) {
    return (
      <Card style={styles.card}>
        <Label>{here.name}</Label>
        <Text style={styles.topText}>
          There is nothing above this. Every car on the lot is a Valmont and the book is the
          business.
        </Text>
      </Card>
    );
  }

  const progress = preview.cost > 0 ? state.cash / preview.cost : 1;
  const bookWillBeOver = preview.bookAfter.active > preview.bookAfter.capacity;

  return (
    <Card style={styles.card}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>Next: {next.name.toLowerCase()}</Label>
        <Text style={styles.here}>now: {here.shortName}</Text>
      </Row>

      <Text style={styles.goalValue}>
        {money(state.cash)} <Text style={styles.goalOf}>of {money(preview.cost)}</Text>
      </Text>
      <Meter progress={progress} color={theme.colors.accent} height={5} />
      <Text style={styles.blurb}>{next.blurb}</Text>

      {confirming ? (
        <View style={styles.confirm}>
          <Text style={styles.confirmTitle}>Before you sign</Text>

          {preview.staffLost.length > 0 ? (
            <>
              <Text style={styles.confirmBody}>
                Your staff does not come with you. You are rehiring all of it at{' '}
                {next.name.toLowerCase()} prices — about {next.staffCostMultiplier}× what you paid
                here.
              </Text>
              <View style={styles.staffList}>
                {preview.staffLost.map((s) => (
                  <Text key={s.name} style={styles.staffRow}>
                    · {s.name}
                    {s.level > 1 ? ` (level ${s.level})` : ''}
                  </Text>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.confirmBody}>
              You have nobody on the payroll, so there is nothing to lose but the cheque.
            </Text>
          )}

          {bookWillBeOver ? (
            <Text style={styles.confirmWarn}>
              The collections desk goes with them. {preview.bookAfter.active} live contracts against
              room for {preview.bookAfter.capacity} — everyone on the book gets likelier to miss,
              and you write no new paper, until you have staffed back up.
            </Text>
          ) : null}

          <Text style={styles.confirmKeep}>
            Cash, inventory, the book, your property and everything the work has taught you all come
            with you.
          </Text>

          <Row gap={6} style={{ marginTop: 4 }}>
            <Button
              label="Not yet"
              tone="ghost"
              onPress={() => setConfirming(false)}
              style={{ flex: 1 }}
            />
            <Button
              label={`Sign — ${moneyShort(preview.cost)}`}
              tone="primary"
              onPress={() => {
                setConfirming(false);
                apply(advanceStage);
              }}
              style={{ flex: 1 }}
            />
          </Row>
        </View>
      ) : (
        <Button
          label={preview.affordable ? `Take on the ${next.name.toLowerCase()}` : 'Keep selling'}
          sublabel={preview.affordable ? `${money(preview.cost)} — resets your payroll` : undefined}
          tone={preview.affordable ? 'primary' : 'ghost'}
          disabled={!preview.affordable}
          onPress={() => setConfirming(true)}
          style={{ marginTop: 10 }}
        />
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 6 },
  here: { color: theme.colors.textFaint, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  goalValue: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  goalOf: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  blurb: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  topText: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  confirm: {
    marginTop: 8,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    gap: 6,
  },
  confirmTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  confirmBody: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  staffList: { gap: 1, paddingLeft: 2 },
  staffRow: { color: theme.colors.warn, fontSize: 11, lineHeight: 15 },
  confirmWarn: { color: theme.colors.danger, fontSize: 11, lineHeight: 15 },
  confirmKeep: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 15, fontStyle: 'italic' },
});
