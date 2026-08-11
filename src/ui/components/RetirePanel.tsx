import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { payOffLoan, retire, takeLoan } from '../../sim/actions';
import { BALANCE } from '../../sim/balance';
import { loanBalance, prestigeEdge, retirementPreview, sharkOffer } from '../../sim/prestige';
import { getStage } from '../../sim/stages';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, moneyShort, theme } from '../theme';
import { Button, Card, Label, Row } from './ui';

/**
 * Retirement, the scoreboard, and the shark. One tab because they are one
 * system: the loan is the first way out of a stuck run and retirement is the
 * last one, and a player weighing one should be looking at the other.
 *
 * Every number on this screen comes from `retirementPreview`, `sharkOffer` or
 * `prestigeEdge`. The panel computes NOTHING itself — the confirmation must not
 * be able to promise a figure the action does not pay, which is the same rule
 * the stage ladder follows and for the same reason.
 */
export function RetirePanel({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const [confirming, setConfirming] = useState(false);

  const sale = retirementPreview(state);
  const edge = prestigeEdge(state);
  const offer = sharkOffer(state);
  const owed = loanBalance(state.loan);
  const history = [...state.prestige.history].reverse();

  return (
    <View style={{ gap: 12 }}>
      {/* ------------------------------------------------------ the career */}
      <Card style={{ gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.title}>Retirement</Text>
          <Text style={styles.badge}>
            {state.prestige.count === 0
              ? 'first career'
              : `retired ×${state.prestige.count} · ${state.prestige.points} pts`}
          </Text>
        </Row>
        {edge > 0 ? (
          <Text style={styles.blurb}>
            You know where the bodies are buried: every ask on the feed, auction or invoice, is{' '}
            {(edge * 100).toFixed(1)}% cheaper for you. Forever.
          </Text>
        ) : (
          <Text style={styles.blurb}>
            Sell the whole operation, bank a point per {moneyShort(BALANCE.prestige.pointDollars)}{' '}
            of the sale, and start over on a driveway. Points make every future buy cheaper — this
            is how a career outgrows a single run.
          </Text>
        )}

        {!confirming ? (
          <Button
            label="Sell the empire"
            sublabel={`Fetches about ${money(sale.net)}${sale.points > 0 ? ` · +${sale.points} point${sale.points > 1 ? 's' : ''}` : ' · no points'}`}
            tone="danger"
            onPress={() => setConfirming(true)}
          />
        ) : (
          <View style={styles.confirm}>
            <Text style={styles.confirmTitle}>The bill of sale</Text>
            <SaleRow label="Cash on hand" value={sale.cash} />
            <SaleRow label={`The lot — ${sale.lotCars} car${sale.lotCars === 1 ? '' : 's'}, forced sale`} value={sale.lotValue} />
            <SaleRow label={`The book — ${sale.bookNotes} note${sale.bookNotes === 1 ? '' : 's'}, sold at a discount`} value={sale.bookValue} />
            {sale.debt > 0 ? <SaleRow label="The shark, settled off the top" value={-sale.debt} /> : null}
            <View style={styles.rule} />
            <SaleRow label="You walk away with" value={sale.net} strong />
            <Text style={styles.confirmBody}>
              {sale.points > 0
                ? `That is ${sale.points} retirement point${sale.points > 1 ? 's' : ''} — your buying edge goes to ${(sale.edgeAfter * 100).toFixed(1)}%. `
                : 'No points at this size — the fresh start is the whole prize. '}
              Skills and house rules come with you. The store, the stock, the paper and every
              upgrade do not.
            </Text>
            <Row gap={6}>
              <Button label="Keep working" tone="ghost" onPress={() => setConfirming(false)} style={{ flex: 1 }} />
              <Button label="Sign it away" tone="danger" onPress={() => { setConfirming(false); apply(retire); }} style={{ flex: 1 }} />
            </Row>
          </View>
        )}
      </Card>

      {/* ------------------------------------------------------- the shark */}
      <Card style={{ gap: 8 }}>
        <Text style={styles.title}>The shark</Text>
        {state.loan ? (
          <>
            <Text style={styles.blurb}>
              He is owed {money(owed)} — {money(state.loan.paymentAmount)} a week,{' '}
              {state.loan.paymentsRemaining} payments left. His cut comes out whether you have it
              or not; he is the only bill that can put you below zero.
            </Text>
            <Button
              label={`Pay him off — ${money(owed)}`}
              sublabel="Every remaining payment, vig included"
              tone={state.cash >= owed ? 'primary' : 'ghost'}
              disabled={state.cash < owed}
              onPress={() => apply(payOffLoan)}
            />
          </>
        ) : (
          <>
            <Text style={styles.blurb}>
              {money(offer.principal)} on the table, {offer.termWeeks} weeks at{' '}
              {Math.round(offer.apr * 100)}% — {money(offer.weeklyPayment)} a week, {money(offer.totalRepay)} all
              in. Take it or leave it. If the run dies with him unpaid, retirement settles him from
              the sale — even if that leaves you nothing.
            </Text>
            <Button
              label={`Take the ${money(offer.principal)}`}
              sublabel={`${money(offer.weeklyPayment)}/wk for ${offer.termWeeks} weeks`}
              tone="primary"
              onPress={() => apply(takeLoan)}
            />
          </>
        )}
      </Card>

      {/* ----------------------------------------------------- scoreboard */}
      <Card style={{ gap: 6 }}>
        <Label>Scoreboard</Label>
        {history.length === 0 ? (
          <Text style={styles.blurb}>Nobody has retired yet. The board remembers everything — including the bail-outs.</Text>
        ) : (
          history.map((r) => (
            <Row key={r.n} style={styles.scoreRow}>
              <Text style={styles.scoreN}>#{r.n}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.scoreValue}>{money(r.net)}</Text>
                <Text style={styles.scoreMeta}>
                  {getStage(r.stage).shortName} · {r.hours.toFixed(1)}h ·{' '}
                  {new Date(r.at).toLocaleDateString()}
                </Text>
              </View>
              <Text style={[styles.scorePts, r.points === 0 && styles.scorePtsZero]}>
                {r.points > 0 ? `+${r.points} pt${r.points > 1 ? 's' : ''}` : 'bailed'}
              </Text>
            </Row>
          ))
        )}
      </Card>
    </View>
  );
}

function SaleRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <Row style={{ justifyContent: 'space-between' }}>
      <Text style={[styles.saleLabel, strong && styles.saleStrong]}>{label}</Text>
      <Text style={[styles.saleValue, strong && styles.saleStrong, value < 0 && styles.saleNeg]}>
        {value < 0 ? `−${money(-value)}` : money(value)}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  title: { color: theme.colors.text, fontSize: 16, fontWeight: '800' },
  badge: { color: theme.colors.accent, fontSize: 12, fontWeight: '800' },
  blurb: { color: theme.colors.textDim, fontSize: 12.5, lineHeight: 18 },
  confirm: {
    gap: 6,
    backgroundColor: theme.colors.surfaceHigh,
    borderRadius: theme.radius.md,
    padding: 12,
  },
  confirmTitle: { color: theme.colors.text, fontSize: 13, fontWeight: '800' },
  confirmBody: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17, marginVertical: 4 },
  rule: { height: 1, backgroundColor: theme.colors.stripe, marginVertical: 2 },
  saleLabel: { color: theme.colors.textDim, fontSize: 12 },
  saleValue: { color: theme.colors.text, fontSize: 12, fontVariant: ['tabular-nums'] },
  saleStrong: { fontWeight: '800', fontSize: 13, color: theme.colors.money },
  saleNeg: { color: theme.colors.danger },
  scoreRow: { alignItems: 'center', gap: 8, paddingVertical: 3 },
  scoreN: { color: theme.colors.textFaint, fontSize: 12, fontWeight: '800', width: 28 },
  scoreValue: { color: theme.colors.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreMeta: { color: theme.colors.textFaint, fontSize: 10.5 },
  scorePts: { color: theme.colors.money, fontSize: 12, fontWeight: '800' },
  scorePtsZero: { color: theme.colors.textFaint, fontWeight: '600' },
});
