import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Line, Rect } from 'react-native-svg';
import {
  BOOK_LINES,
  BOOK_LINE_COPY,
  WEEKS_IN_VIEW,
  lastWeek,
  lineActive,
  lineMargin,
  marginTrend,
  recentWeeks,
  weekMargin,
  weekSoFar,
} from '../../sim/books';
import type { BookLine, GameState, LineResult, WeekLines, WeekRecord } from '../../sim/types';
import {
  duration,
  formatMargin,
  marginColor,
  money,
  moneyShort,
  theme,
  withAlpha,
} from '../theme';
import { Sheet } from './Sheet';
import { EmptyState, Label } from './ui';

/**
 * The weekly books, behind the HUD's margin readout.
 *
 * The headline is one number — what was left of last week's takings — and the
 * chart exists because that number on its own is not readable. A 12% week is
 * good after three 4% weeks and a disaster after three 20% ones, and the till
 * cannot tell you which, because cash is a level and this is a rate.
 *
 * Everything drawn here comes out of `books.ts`, which is a pure read over the
 * weeks the engine files on the bill beat. Nothing is computed twice: the same
 * subtraction off `lifetimeProfit` that the ledger reconciles against is what
 * these bars are made of.
 */
export function BooksSheet({
  visible,
  state,
  onClose,
}: {
  visible: boolean;
  state: GameState;
  onClose: () => void;
}) {
  const weeks = recentWeeks(state, WEEKS_IN_VIEW);
  const last = lastWeek(state);
  const lastMargin = weekMargin(last);
  const trend = marginTrend(state, WEEKS_IN_VIEW);
  const running = weekSoFar(state);

  // Which week the tiles are showing. Defaults to the closed one, same rule the
  // headline follows and for the same reason: a Tuesday-morning split over four
  // sales is noise. The toggle exists because "is the shop bleeding right now"
  // is a real question and the answer is not in last week's figures.
  const [liveWeek, setLiveWeek] = useState(false);
  const shown = liveWeek ? running : (last ?? running);

  return (
    <Sheet
      visible={visible}
      title="Net operating profit"
      subtitle="What was left of what came in, week by week"
      onClose={onClose}
    >
      {weeks.length === 0 ? (
        <EmptyState
          title="The first week is still trading"
          hint="The books close when the bills fall due. Come back then and this is where the trend lives."
        />
      ) : (
        <>
          <View style={styles.headline}>
            <View style={{ flex: 1 }}>
              <Label>Last week</Label>
              <Text style={[styles.big, { color: marginColor(lastMargin) }]}>
                {formatMargin(lastMargin)}
              </Text>
              <Text style={styles.headlineSub}>
                {last ? `${money(last.profit)} on ${money(last.revenue)} taken` : 'nothing sold'}
              </Text>
            </View>
            <View style={styles.trendBox}>
              <Label>Trend</Label>
              <Text style={[styles.trendValue, { color: trendColor(trend) }]}>
                {formatPoints(trend)}
              </Text>
              <Text style={styles.headlineSub}>
                {trend === null ? 'not enough weeks yet' : 'against the weeks before'}
              </Text>
            </View>
          </View>

          <MarginChart weeks={weeks} running={running} />

          <Text style={styles.closing}>
            This week so far: {money(running.profit)} on {money(running.revenue)} taken. Books close
            in {duration(state.nextBillAt - state.t)}.
          </Text>

          <View style={styles.linesHead}>
            <Label>Where it came from</Label>
            <View style={styles.toggle}>
              <ToggleChip label="Last week" on={!liveWeek} onPress={() => setLiveWeek(false)} />
              <ToggleChip label="This week" on={liveWeek} onPress={() => setLiveWeek(true)} />
            </View>
          </View>
          <LineTiles week={shown} partial={liveWeek} />

          <View style={styles.table}>
            <View style={styles.row}>
              <Text style={[styles.rowAge, styles.head]}>Week</Text>
              <Text style={[styles.rowMoney, styles.head]}>Taken</Text>
              <Text style={[styles.rowMoney, styles.head]}>Kept</Text>
              <Text style={[styles.rowMargin, styles.head]}>Net</Text>
            </View>
            {[...weeks].reverse().map((week, i) => (
              <WeekRow key={week.endedAt} week={week} age={i} />
            ))}
          </View>

          {/*
            The one line that stops the chart being read as the cash graph it is
            not. Money spent filling the lot is not a bad week; it is stock.
          */}
          <Text style={styles.footnote}>
            Revenue is what customers paid — cash sales, down payments, weekly collections, plans
            and labour. The split is by deal: Metal is the cash car business, and The book is the
            finance business whole — a financed car charges its full cost against the book the day
            it signs, then pays it back a week at a time over the life of the contract. That lag is
            buy-here-pay-here: a week that wrote a lot of paper reads deep red on the book and is
            just contracts that have not paid yet. Profit charges the cars at what they cost, plus
            rent, wages, floorplan and claims, so buying stock is not a loss and selling it below
            cost is. A bar fades with how little came in: a quiet week of collections runs at a huge
            percentage on very little money.
          </Text>
        </>
      )}
    </Sheet>
  );
}

/** One filed week, most recent first. */
function WeekRow({ week, age }: { week: WeekRecord; age: number }) {
  const margin = weekMargin(week);
  return (
    <View style={styles.row}>
      <Text style={styles.rowAge}>{age === 0 ? 'Last week' : `${age + 1} weeks ago`}</Text>
      <Text style={styles.rowMoney}>{moneyShort(week.revenue)}</Text>
      <Text style={[styles.rowMoney, { color: week.profit < 0 ? theme.colors.danger : theme.colors.text }]}>
        {moneyShort(week.profit)}
      </Text>
      <Text style={[styles.rowMargin, { color: marginColor(margin) }]}>{formatMargin(margin)}</Text>
    </View>
  );
}

/**
 * Where the week's money came from, as one tile per business line.
 *
 * Four things the business sells and one thing it pays for regardless, coloured
 * green or red on the sign and washed deeper the bigger the line was — the read
 * a heat map gives you, where the eye finds the mover before it finds the
 * number. That matters here more than on most screens: the four lines run at
 * wildly different scales, and a franchise's metal line moving ten times what
 * its plan desk does is the whole point rather than a formatting problem.
 *
 * A line the store cannot run is not drawn at all. A curbstone has no finance
 * desk, no plan desk and no bays, so three of five tiles would be a permanent
 * row of zeroes — the same argument that keeps the admin tab out of a shipped
 * build. Read off the WEEK rather than off the stage, so a business that walked
 * back down the ladder still sees the claims it owes on cover it sold upstairs.
 *
 * Overhead gets the full width and sits under the rest, because it is not a
 * department competing with them — it is what the four of them have to cover
 * between them, and putting it in the grid invites reading it as a fifth line
 * that is doing badly.
 *
 * A PART-WEEK FLATTERS EVERY LINE and says so. Rent, wages and floorplan are one
 * cheque on the bill beat, so a Wednesday reading shows four departments that
 * have taken money and not yet paid anybody — the bays in particular read at
 * 100% until the technicians are paid on Sunday. It is the same reason the
 * chart draws the week in progress hollow, and it wants the same treatment: not
 * hidden, labelled.
 */
function LineTiles({ week, partial }: { week: WeekRecord; partial: boolean }) {
  const lines = week.lines;

  if (!lines) {
    return (
      <Text style={styles.footnote}>
        This week was filed before the books were split by department. Weeks from here on carry the
        breakdown; nothing is invented for the ones behind it, because one net figure cannot say
        which part of the business earned it.
      </Text>
    );
  }

  const earning = BOOK_LINES.filter((id) => id !== 'overhead' && lineActive(lines[id]));
  const overhead = lines.overhead;

  // The wash is scaled against the biggest line on screen, so an ordinary week
  // has one deep tile and the rest reading pale — the same argument the bar
  // chart's revenue fade makes, one level down.
  const peak = Math.max(1, ...earning.map((id) => Math.abs(lines[id].profit)));

  if (earning.length === 0 && !lineActive(overhead)) {
    return <Text style={styles.footnote}>Nothing happened this week — no money in, none out.</Text>;
  }

  return (
    <View style={{ gap: 6 }}>
      <View style={styles.tiles}>
        {earning.map((id) => (
          <LineTile key={id} id={id} line={lines[id]} peak={peak} />
        ))}
      </View>

      {lineActive(overhead) ? (
        <View style={[styles.overhead, { backgroundColor: withAlpha(theme.colors.danger, 0.1) }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tileName}>{BOOK_LINE_COPY.overhead.name.toUpperCase()}</Text>
            <Text style={styles.overheadNote}>{BOOK_LINE_COPY.overhead.note}</Text>
          </View>
          <Text style={[styles.tileValue, { color: theme.colors.danger }]}>
            {money(overhead.profit)}
          </Text>
        </View>
      ) : null}

      {/*
        The line that makes the tiles worth trusting. They are running totals and
        the headline above is a subtraction off lifetime profit — different
        arithmetic on the same money — so saying out loud that they meet is the
        only thing standing between a reconciliation screen and a decoration.
      */}
      <Text style={styles.reconcile}>
        Together they come to {money(sumProfit(lines))}, which is exactly what the week made.
      </Text>

      {partial ? (
        <Text style={styles.partial}>
          Part-week. Rent, the payroll and floorplan are one cheque on the bill beat, so nothing
          here has paid its people yet — the bays will read near 100% until they do.
        </Text>
      ) : null}

      <View style={styles.legend}>
        {[...earning, 'overhead' as BookLine]
          .filter((id) => id !== 'overhead' || lineActive(overhead))
          .map((id) => (
            <Text key={id} style={styles.legendRow}>
              <Text style={styles.legendName}>{BOOK_LINE_COPY[id].name}</Text> —{' '}
              {BOOK_LINE_COPY[id].note}
            </Text>
          ))}
      </View>
    </View>
  );
}

function LineTile({ id, line, peak }: { id: BookLine; line: LineResult; peak: number }) {
  const up = line.profit >= 0;
  const color = up ? theme.colors.money : theme.colors.danger;
  // Floored so a small line is still legibly its own colour, capped so the
  // biggest one does not drown the number written on it.
  const wash = 0.06 + Math.min(1, Math.abs(line.profit) / peak) * 0.24;
  const margin = lineMargin(line);

  return (
    <View style={[styles.tile, { backgroundColor: withAlpha(color, wash), borderColor: withAlpha(color, 0.45) }]}>
      <View style={styles.tileHead}>
        <Text style={styles.tileName} numberOfLines={1}>
          {BOOK_LINE_COPY[id].name.toUpperCase()}
        </Text>
        <Text style={[styles.tileMargin, { color }]}>{formatMargin(margin)}</Text>
      </View>
      <Text style={[styles.tileValue, { color }]} numberOfLines={1}>
        {line.profit > 0 ? '+' : ''}
        {money(line.profit)}
      </Text>
      <Text style={styles.tileTook}>
        {line.revenue > 0 ? `on ${moneyShort(line.revenue)} taken` : 'took nothing'}
      </Text>
    </View>
  );
}

function sumProfit(lines: WeekLines): number {
  return BOOK_LINES.reduce((n, id) => n + lines[id].profit, 0);
}

function ToggleChip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.toggleChip, on && styles.toggleChipOn, pressed && { opacity: 0.72 }]}
    >
      <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{label}</Text>
    </Pressable>
  );
}

const CHART_HEIGHT = 128;
const BAR_GAP = 6;

/**
 * The trend, as bars off a zero line.
 *
 * Bars rather than a line, because these are eight discrete weeks and not a
 * continuous signal — joining them up would draw a slope through Wednesday that
 * nothing in the game ever had. The zero line is always in view whether or not
 * any week lost money, so a run of thin weeks reads as thin rather than being
 * rescaled into looking healthy.
 *
 * The week in progress is drawn last and hollow. It is real money and it belongs
 * on the chart, but it is a part-week — a Tuesday margin over four sales swings
 * wildly — and drawing it solid would invite reading it as the newest data point.
 *
 * A BAR FADES WITH HOW LITTLE CAME IN, and that is not decoration. A quiet week
 * that sold no metal and only collected note payments runs at 70-80% net, because
 * the cars behind those payments were expensed the day they were financed — so
 * without it the tallest bar on the chart is routinely the smallest week, which
 * is the exact opposite of what the eye takes from it. Scaled off the median
 * rather than the largest week, so an ordinary week is solid and only a genuinely
 * thin one goes pale.
 */
function MarginChart({ weeks, running }: { weeks: WeekRecord[]; running: WeekRecord }) {
  const [width, setWidth] = useState(0);

  const revenues = weeks.map((w) => w.revenue).sort((a, b) => a - b);
  const typical = Math.max(1, revenues[Math.floor(revenues.length / 2)] ?? 1);
  const weight = (revenue: number) =>
    Math.max(0.35, Math.min(1, Math.sqrt(revenue / typical)));

  const bars = [
    ...weeks.map((w) => ({ margin: weekMargin(w), weight: weight(w.revenue), partial: false })),
    { margin: weekMargin(running), weight: weight(running.revenue), partial: true },
  ];
  const known = bars.map((b) => b.margin).filter((m): m is number => m !== null);

  // Zero is always in the domain, and the top never collapses onto it — a
  // business running at a flat 1% would otherwise draw eight full-height bars.
  const hi = Math.max(0.05, ...known);
  const lo = Math.min(0, ...known);
  const range = hi - lo;
  const y = (v: number) => ((hi - v) / range) * CHART_HEIGHT;
  const zero = y(0);

  const barWidth = width > 0 ? Math.max(4, (width - BAR_GAP * (bars.length - 1)) / bars.length) : 0;

  return (
    <View style={styles.chartCard}>
      <View style={styles.chartHead}>
        <Text style={styles.axis}>{formatMargin(hi)}</Text>
        <Text style={styles.axisDim}>{bars.length - 1} weeks and this one</Text>
      </View>

      <View style={styles.chartBody} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line
              x1={0}
              y1={zero}
              x2={width}
              y2={zero}
              stroke={theme.colors.border}
              strokeWidth={1}
            />
            {bars.map((bar, i) => {
              const x = i * (barWidth + BAR_GAP);
              if (bar.margin === null) {
                // A week that sold nothing has no percentage; a stub on the line
                // says "we were here and we took nothing", which is the truth.
                return (
                  <Rect
                    key={i}
                    x={x}
                    y={zero - 1}
                    width={barWidth}
                    height={2}
                    fill={theme.colors.textFaint}
                  />
                );
              }
              const top = Math.min(y(bar.margin), zero);
              const height = Math.max(2, Math.abs(y(bar.margin) - zero));
              const color = bar.margin < 0 ? theme.colors.danger : theme.colors.money;
              return (
                <Rect
                  key={i}
                  x={x}
                  y={top}
                  width={barWidth}
                  height={height}
                  rx={2}
                  fill={bar.partial ? 'none' : color}
                  fillOpacity={bar.weight}
                  stroke={bar.partial ? color : 'none'}
                  strokeOpacity={bar.weight}
                  strokeWidth={bar.partial ? 1.5 : 0}
                  strokeDasharray={bar.partial ? '3 2' : undefined}
                />
              );
            })}
          </Svg>
        ) : null}
      </View>

      <View style={styles.chartFoot}>
        <Text style={styles.axis}>{lo < 0 ? formatMargin(lo) : '0%'}</Text>
        <Text style={styles.axisDim}>this week, so far</Text>
      </View>
    </View>
  );
}

/** A change in margin, in points rather than percent — a 4% week off a 2% one is +2 points. */
function formatPoints(diff: number | null): string {
  if (diff === null) return '—';
  const points = diff * 100;
  if (Math.abs(points) < 0.5) return 'steady';
  return `${points > 0 ? '+' : '−'}${Math.abs(points).toFixed(1)} pts`;
}

function trendColor(diff: number | null): string {
  if (diff === null || Math.abs(diff) < 0.005) return theme.colors.textDim;
  return diff > 0 ? theme.colors.money : theme.colors.danger;
}

const styles = StyleSheet.create({
  headline: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  big: { fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 2 },
  headlineSub: { color: theme.colors.textFaint, fontSize: 11, marginTop: 1 },
  trendBox: { alignItems: 'flex-end' },
  trendValue: {
    fontSize: 18,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
    marginTop: 8,
  },
  chartCard: {
    backgroundColor: theme.colors.surfaceAlt,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
    gap: 6,
  },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chartFoot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  chartBody: { height: CHART_HEIGHT },
  axis: { color: theme.colors.textDim, fontSize: 10, fontVariant: ['tabular-nums'] },
  axisDim: { color: theme.colors.textFaint, fontSize: 10 },
  closing: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  table: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowAge: { flex: 1, color: theme.colors.textDim, fontSize: 12 },
  head: {
    color: theme.colors.textFaint,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  rowMoney: {
    width: 66,
    textAlign: 'right',
    color: theme.colors.text,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  rowMargin: {
    width: 54,
    textAlign: 'right',
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  footnote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 16 },

  linesHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  toggle: { flexDirection: 'row', gap: 4 },
  toggleChip: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.pill,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  toggleChipOn: { borderColor: theme.colors.accent, backgroundColor: theme.colors.accentDim },
  toggleText: { color: theme.colors.textDim, fontSize: 10, fontWeight: '700' },
  toggleTextOn: { color: theme.colors.text },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tile: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: theme.radius.md,
    borderWidth: 1,
    padding: 10,
    gap: 1,
  },
  tileHead: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  tileName: {
    flex: 1,
    color: theme.colors.textDim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  tileMargin: { fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileValue: { fontSize: 18, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileTook: { color: theme.colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },

  overhead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
  },
  overheadNote: { color: theme.colors.textFaint, fontSize: 10, marginTop: 1 },
  reconcile: { color: theme.colors.textFaint, fontSize: 11, fontVariant: ['tabular-nums'] },
  partial: { color: theme.colors.warn, fontSize: 11, lineHeight: 15, opacity: 0.85 },
  legend: { gap: 2, marginTop: 2 },
  legendRow: { color: theme.colors.textFaint, fontSize: 10, lineHeight: 14 },
  legendName: { color: theme.colors.textDim, fontWeight: '700' },
});
