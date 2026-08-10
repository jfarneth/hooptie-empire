import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { BALANCE } from '../../sim/balance';
import {
  appraisalSigma,
  deskCounterFraction,
  listingSlotBonus,
  maxPlayerCounters,
  reconCostMultiplier,
  reconMaxLift,
  reconSpeedMultiplier,
  skillProgress,
  tellJitter,
  walkChanceMultiplier,
  type SkillDef,
} from '../../sim/skills';
import type { GameState, SkillId } from '../../sim/types';
import { theme } from '../theme';
import { Chip, Meter, Row } from './ui';

/**
 * What a skill is currently worth, in the player's terms.
 *
 * Phrased as the thing it does rather than the constant it moves — "reads a car
 * to within 12%" beats "appraisalSigma 0.12". The one number deliberately not
 * shown anywhere is a buyer's walk-away price; everything here is a property of
 * the player, which is exactly what someone doing this job would know about
 * themselves.
 */
function currentEffects(state: GameState, id: SkillId): string[] {
  switch (id) {
    case 'buy': {
      const sigma = appraisalSigma(state);
      const slots = listingSlotBonus(state);
      const lines = [`Reads a car to within about ${Math.round(sigma * 100)} points of condition`];
      if (slots > 0) lines.push(`+${slots} car${slots > 1 ? 's' : ''} on the feed at once`);
      return lines;
    }
    case 'sell': {
      const jitter = tellJitter(state);
      const walk = walkChanceMultiplier(state);
      const lines = [
        jitter <= 0.08
          ? 'Reads a buyer almost exactly'
          : `Misreads a buyer about ${Math.round(jitter * 100)}% of the time`,
      ];
      if (walk < 1) lines.push(`${Math.round((1 - walk) * 100)}% fewer buyers walk on a counter`);
      lines.push(`${maxPlayerCounters(state)} counters per buyer`);
      const desk = deskCounterFraction(state);
      if (desk > BALANCE.negotiation.deskCounterFraction) {
        lines.push('The sales desk counters harder for you');
      }
      return lines;
    }
    case 'repair': {
      const cost = reconCostMultiplier(state);
      const speed = reconSpeedMultiplier(state);
      const lift = reconMaxLift(state);
      const lines = [`One job lifts condition up to ${Math.round(lift * 100)} points`];
      if (cost < 1) lines.push(`${Math.round((1 - cost) * 100)}% cheaper parts and labour`);
      if (speed < 1) lines.push(`${Math.round((1 - speed) * 100)}% faster out of the shop`);
      return lines;
    }
  }
}

export function SkillCard({ def, state }: { def: SkillDef; state: GameState }) {
  const { level, xp, needed, ratio } = skillProgress(state, def.id);
  const maxed = level >= BALANCE.skills.maxLevel;

  return (
    <View style={styles.card}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={8}>
          <Text style={styles.name}>{def.name}</Text>
          <Chip
            text={maxed ? 'MAX' : `LVL ${level}`}
            color={maxed ? theme.colors.money : theme.colors.accent}
          />
        </Row>
        <Text style={styles.xp}>
          {maxed ? 'nothing left to learn' : `${Math.round(xp)} / ${needed} xp`}
        </Text>
      </Row>

      <Meter progress={ratio} color={maxed ? theme.colors.money : theme.colors.accent} />

      <Text style={styles.description}>{def.description}</Text>

      <View style={styles.effects}>
        {currentEffects(state, def.id).map((line) => (
          <Text key={line} style={styles.effect}>
            · {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 8,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: '700' },
  xp: {
    color: theme.colors.textFaint,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  description: { color: theme.colors.textDim, fontSize: 12, lineHeight: 16 },
  effects: { gap: 2 },
  effect: { color: theme.colors.textFaint, fontSize: 11, lineHeight: 15 },
});
