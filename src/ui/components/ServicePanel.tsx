import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  dismissServiceTech,
  hireServiceTech,
  promoteServiceTech,
  setBusinessPolicy,
} from '../../sim/actions';
import { BALANCE } from '../../sim/balance';
import { businessPolicy } from '../../sim/business';
import {
  TECH_GRADES,
  TOP_GRADE,
  bayCount,
  canHireTech,
  canPromote,
  hireCost,
  hoursToPromote,
  referenceRate,
  shopDemandPerSec,
  shopPayroll,
  shopRate,
  techGrade,
  techWage,
} from '../../sim/shop';
import { SHOP_RATE_NAMES, getStage } from '../../sim/stages';
import type { GameState, ServiceJob, ServiceTech } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, moneyShort, theme } from '../theme';
import { Button, Card, Chip, EmptyState, Label, Meter, Row } from './ui';
import { Slider, SliderAnchor } from './Slider';

/**
 * The service department.
 *
 * The one screen in the game about people rather than about cars, and the only
 * place where the constraint is BENCHES instead of stalls or cash. Everything
 * here is built around making that constraint visible: how many bays, who is on
 * them, how much of the day they are actually turning work, and — the number
 * that matters most — how many customers went down the road because there was
 * nowhere to put them.
 *
 * The labour rate lives here rather than on the Business tab with the other
 * house rules, which is a deliberate exception. It is the same KIND of thing —
 * a standing instruction that applies while the app is closed — but it cannot
 * be reasoned about without the bay count and the turned-away number sitting
 * next to it, because the right rate is entirely a function of how much bench
 * you have to fill.
 */
export function ServicePanel({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const stage = getStage(state.stage);
  const policy = businessPolicy(state);

  if (!stage.shop) {
    return (
      <EmptyState
        title="No service department here"
        hint="Bays behind the showroom are a franchise thing. Take on a manufacturer's contract and you can start billing labour as well as selling metal."
      />
    );
  }

  const bays = bayCount(state);
  if (bays === 0) {
    return (
      <EmptyState
        title="The bays are empty"
        hint="Buy a service bay on the Upgrades tab to open the department. It bills labour, it works on your own stock, and it honours your service contracts at cost instead of paying a garage retail to do it."
      />
    );
  }

  const techs = state.shop.techs;
  const jobs = state.shop.jobs;
  const rate = shopRate(stage, policy.shopRateLevel);
  const busy = techs.filter((t) => t.jobId !== null).length;
  const queued = jobs.filter((j) => j.techId === null).length;
  const payroll = shopPayroll(state);

  // What the rate is doing to the queue, in the unit the player can act on:
  // hours of work walking in against hours of bench available to do it.
  const demandHours =
    shopDemandPerSec(state, rate) *
    (BALANCE.shop.jobHoursMin + BALANCE.shop.jobHoursSpan / 3) *
    3600;
  const benchHours = techs.reduce((n, t) => n + 3600 / (techGrade(t).speed * BALANCE.shop.msPerLabourHour / 1000), 0);

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Label>The bays</Label>
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View>
              <Text style={styles.headline}>{money(state.shop.weekRevenue)}</Text>
              <Text style={styles.sub}>billed this week · {state.shop.weekJobs} jobs</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[styles.headline, { color: theme.colors.danger }]}>
                {moneyShort(payroll)}
              </Text>
              <Text style={styles.sub}>a week in wages</Text>
            </View>
          </Row>

          <View style={{ gap: 4 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.metaLabel}>Benches working</Text>
              <Text style={styles.metaValue}>
                {busy} / {techs.length} staffed · {bays} bay{bays > 1 ? 's' : ''}
              </Text>
            </Row>
            <Meter
              progress={techs.length > 0 ? busy / techs.length : 0}
              color={busy === techs.length && techs.length > 0 ? theme.colors.money : theme.colors.accent}
            />
          </View>

          {/* The diagnosis, in one sentence. A shop turning customers away and a
              shop with idle techs look identical on the cash line and need
              opposite fixes, so the panel says which one is happening. */}
          <Text style={styles.hint}>{diagnose({ techs: techs.length, bays, busy, queued, demandHours, benchHours })}</Text>

          <Row style={{ justifyContent: 'space-between' }}>
            <Stat label="Jobs done" value={String(state.stats.shopJobsDone)} />
            <Stat label="Billed" value={moneyShort(state.stats.shopRevenue)} tone={theme.colors.money} />
            <Stat
              label="Comebacks"
              value={String(state.stats.shopReworks)}
              tone={state.stats.shopReworks > 0 ? theme.colors.warn : undefined}
            />
            <Stat
              label="Turned away"
              value={String(state.stats.shopTurnedAway)}
              tone={state.stats.shopTurnedAway > 0 ? theme.colors.danger : undefined}
            />
          </Row>
        </Card>
      </View>

      {/* ------------------------------------------------------- the rate */}
      <View style={{ gap: 8 }}>
        <Label>What you charge</Label>
        <Card style={{ gap: 8 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={styles.ruleName}>{SHOP_RATE_NAMES[policy.shopRateLevel - 1] ?? 'Going rate'}</Text>
            <Text style={styles.ruleValue}>{money(rate)}/hr</Text>
          </Row>
          <Text style={styles.hint}>
            Charge less and more cars book in than you can get to; charge more and the benches go
            quiet on full wages. The right number moves every time you hire.
          </Text>
          <Slider
            min={1}
            max={SHOP_RATE_NAMES.length}
            step={1}
            value={Math.min(policy.shopRateLevel, SHOP_RATE_NAMES.length)}
            onChange={(next) => apply((s) => setBusinessPolicy(s, { shopRateLevel: next }))}
            minLabel={
              <SliderAnchor value={`${money(shopRate(stage, 1))}/hr`} label="fill the bays" />
            }
            maxLabel={
              <SliderAnchor
                value={`${money(shopRate(stage, SHOP_RATE_NAMES.length))}/hr`}
                label="pick your jobs"
                align="flex-end"
              />
            }
          />
          <Text style={styles.footnote}>
            The going rate around here is {money(referenceRate(stage))} an hour. An average repair
            order is about {(BALANCE.shop.jobHoursMin + BALANCE.shop.jobHoursSpan / 3).toFixed(1)}{' '}
            hours.
          </Text>
        </Card>
      </View>

      {/* --------------------------------------------------------- the crew */}
      <View style={{ gap: 8 }}>
        <Label>
          The crew ({techs.length}/{bays})
        </Label>

        {techs.length === 0 ? (
          <Card>
            <Text style={styles.hint}>
              Nobody on the benches. Cars are booking in and finding an empty workshop.
            </Text>
          </Card>
        ) : null}

        {techs.map((tech) => (
          <TechRow
            key={tech.id}
            tech={tech}
            job={jobs.find((j) => j.id === tech.jobId) ?? null}
            wage={techWage(stage, tech.grade)}
            onPromote={() => apply((s) => promoteServiceTech(s, tech.id))}
            onDismiss={() => apply((s) => dismissServiceTech(s, tech.id))}
          />
        ))}

        {canHireTech(state) ? (
          <Card style={{ gap: 8 }}>
            <Text style={styles.ruleName}>Take somebody on</Text>
            <Text style={styles.hint}>
              Entry techs are cheap and slow and their work comes back. Certified techs cost more of
              everything and turn nearly twice the work per bench — which is what matters once the
              bays are full. Growing your own costs nothing but time.
            </Text>
            <View style={styles.hireRow}>
              {TECH_GRADES.map((grade, index) => {
                const cost = hireCost(stage, index);
                return (
                  <Button
                    key={grade.name}
                    label={grade.shortName}
                    sublabel={moneyShort(cost)}
                    tone={state.cash >= cost ? 'money' : 'ghost'}
                    disabled={state.cash < cost}
                    onPress={() => apply((s) => hireServiceTech(s, index))}
                    style={styles.hireButton}
                  />
                );
              })}
            </View>
            <Text style={styles.footnote}>
              A signing fee of {BALANCE.shop.hireWeeks} weeks' wage, then{' '}
              {moneyShort(techWage(stage, 0))}–{moneyShort(techWage(stage, TOP_GRADE))} a week
              depending on grade.
            </Text>
          </Card>
        ) : (
          <Text style={styles.footnote}>
            Every bay has somebody in it. Pave another one on the Upgrades tab to hire again.
          </Text>
        )}
      </View>

      {/* ------------------------------------------------------ on the ramp */}
      {jobs.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Label>On the ramp ({jobs.length})</Label>
          {jobs.slice(0, 10).map((job) => (
            <JobRow key={job.id} job={job} rate={rate} />
          ))}
        </View>
      ) : null}

      <Text style={styles.footnote}>
        The bays also work on your own stock — reconditioning is{' '}
        {Math.round((1 - Math.pow(BALANCE.shop.reconSpeedPerBay, bays)) * 100)}% faster and{' '}
        {Math.round((1 - Math.pow(BALANCE.shop.reconCostPerBay, bays)) * 100)}% cheaper here — and
        they honour your service contracts at cost instead of paying a garage retail to do it.
      </Text>
    </View>
  );
}

/**
 * Which problem this shop has, if any.
 *
 * Deliberately one sentence and deliberately actionable. "Utilisation 62%" is a
 * statistic; "your techs are idle, drop the rate" is a decision.
 */
function diagnose(s: {
  techs: number;
  bays: number;
  busy: number;
  queued: number;
  demandHours: number;
  benchHours: number;
}): string {
  if (s.techs === 0) return 'Nobody on the benches — every car that books in is turned away.';
  if (s.queued > 0 && s.busy === s.techs) {
    return s.techs < s.bays
      ? 'Work is queueing and you have an empty bay. Hire somebody.'
      : 'Work is queueing and every bench is full. Another bay, or put the rate up and pick your jobs.';
  }
  if (s.demandHours < s.benchHours * 0.7) {
    return 'More bench than work. Drop the rate and the queue will fill up.';
  }
  return 'Steady — about as much work coming in as there are hands to do it.';
}

function TechRow({
  tech,
  job,
  wage,
  onPromote,
  onDismiss,
}: {
  tech: ServiceTech;
  job: ServiceJob | null;
  wage: number;
  onPromote: () => void;
  onDismiss: () => void;
}) {
  const grade = techGrade(tech);
  const top = Math.round(tech.grade) >= TOP_GRADE;
  const target = hoursToPromote(tech);
  const previous = BALANCE.shop.promoteAtHours[Math.round(tech.grade)] ?? 0;
  const progress = top ? 1 : (tech.xp - previous) / Math.max(1, target - previous);
  const ready = canPromote(tech);

  return (
    <View style={styles.tech}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={6} style={{ flex: 1 }}>
          <Chip
            text={grade.shortName}
            color={top ? theme.colors.money : theme.colors.accent}
            filled={top}
          />
          <Text style={styles.techName} numberOfLines={1}>
            {tech.name}
          </Text>
        </Row>
        <Text style={styles.techWage}>{moneyShort(wage)}/wk</Text>
      </Row>

      <Text style={styles.techJob} numberOfLines={1}>
        {job ? (job.rework ? `Comeback — ${job.label}` : job.label) : 'Waiting for work'}
      </Text>

      <Meter
        progress={Math.max(0, Math.min(1, progress))}
        color={ready ? theme.colors.money : theme.colors.border}
        height={3}
      />
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.techMeta}>
          {top
            ? `${Math.round(tech.xp)} hours turned · top of the ladder`
            : ready
              ? `${Math.round(tech.xp)} hours turned · ready for ${TECH_GRADES[Math.round(tech.grade) + 1].shortName}`
              : `${Math.round(tech.xp)} / ${target} hours to ${TECH_GRADES[Math.round(tech.grade) + 1].shortName}`}
        </Text>
        <Text style={styles.techMeta}>{Math.round(grade.rework * 100)}% comeback rate</Text>
      </Row>

      <Row gap={6}>
        {ready ? (
          <Button label="Promote" tone="money" onPress={onPromote} style={{ flex: 1 }} />
        ) : null}
        <Button label="Let go" tone="ghost" onPress={onDismiss} style={{ flex: ready ? 0.6 : 1 }} />
      </Row>
    </View>
  );
}

function JobRow({ job, rate }: { job: ServiceJob; rate: number }) {
  const working = job.techId !== null && job.totalMs > 0;
  const progress = working ? 1 - job.remainingMs / job.totalMs : 0;

  return (
    <View style={styles.job}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text style={styles.jobLabel} numberOfLines={1}>
          {job.label}
        </Text>
        <Text style={[styles.jobPrice, job.rework && { color: theme.colors.warn }]}>
          {job.rework ? 'no charge' : money(job.price)}
        </Text>
      </Row>
      <Meter
        progress={progress}
        color={job.rework ? theme.colors.warn : theme.colors.accent}
        height={3}
      />
      <Text style={styles.jobMeta}>
        {job.hours.toFixed(1)} hours
        {job.rework ? ' · back in for the same fault' : ` at ${money(rate)}/hr`}
        {working ? '' : ' · waiting for a bench'}
      </Text>
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

const styles = StyleSheet.create({
  headline: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  sub: { color: theme.colors.textFaint, fontSize: 10 },
  metaLabel: { color: theme.colors.textDim, fontSize: 12 },
  metaValue: {
    color: theme.colors.text,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  ruleName: { color: theme.colors.text, fontSize: 14, fontWeight: '700', flex: 1 },
  ruleValue: {
    color: theme.colors.accent,
    fontSize: 14,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  hint: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  footnote: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 15 },
  statLabel: { color: theme.colors.textFaint, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  statValue: { color: theme.colors.text, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  hireRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  hireButton: { flexGrow: 1, flexBasis: '30%' },
  tech: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
    gap: 5,
  },
  techName: { color: theme.colors.text, fontSize: 13, fontWeight: '600', flex: 1 },
  techWage: {
    color: theme.colors.textDim,
    fontSize: 11,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  techJob: { color: theme.colors.textDim, fontSize: 11 },
  techMeta: { color: theme.colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
  job: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 9,
    gap: 4,
  },
  jobLabel: { color: theme.colors.text, fontSize: 12, fontWeight: '600', flex: 1 },
  jobPrice: {
    color: theme.colors.money,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  jobMeta: { color: theme.colors.textFaint, fontSize: 10, fontVariant: ['tabular-nums'] },
});
