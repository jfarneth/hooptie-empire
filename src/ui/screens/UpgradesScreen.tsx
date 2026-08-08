import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { purchaseUpgrade, setDealPolicy } from '../../sim/actions';
import { UPGRADES, getUpgrade, level, upgradeCost, type UpgradeDef } from '../../sim/upgrades';
import { SKILLS } from '../../sim/skills';
import type { DealPolicy, GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, theme } from '../theme';
import { Button, Card, Chip, Label, Row } from '../components/ui';
import { SkillCard } from '../components/SkillCard';

const CATEGORY_TITLE: Record<string, string> = {
  automation: 'Take your hands off it',
  capacity: 'Room to work',
  speed: 'Move faster',
  finance: 'The book',
};

const POLICY_LABEL: Record<DealPolicy, string> = {
  manual: 'Ask me',
  cash: 'Always cash',
  finance: 'Always finance',
  auto: 'Whichever pays more',
};

const POLICY_HINT: Record<DealPolicy, string> = {
  manual: 'Every walk-up waits for you to decide.',
  cash: 'Take the money and move the next car in.',
  finance: 'Write paper on everyone who will sign, whatever their credit.',
  auto: 'Compare the cash offer against the expected value of the note, deal by deal.',
};

/**
 * Two things you can improve, kept on one screen because they answer the same
 * question: what makes the business better tomorrow than it was today. The
 * distinction the tabs draw is the one that matters — the left column is what
 * money buys, the right is what the work teaches you.
 */
export function UpgradesScreen({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const [tab, setTab] = useState<'upgrades' | 'skills'>('upgrades');
  const hasDesk = level(state, 'salesDesk') > 0;

  const available = UPGRADES.filter((u) => u.stage === 'curbstoner' || state.stage === 'bhph');
  const categories = ['automation', 'capacity', 'speed', 'finance'] as const;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.tabs}>
        <Button
          label="Upgrades"
          tone={tab === 'upgrades' ? 'primary' : 'ghost'}
          onPress={() => setTab('upgrades')}
          style={styles.tab}
        />
        <Button
          label="Skills"
          tone={tab === 'skills' ? 'primary' : 'ghost'}
          onPress={() => setTab('skills')}
          style={styles.tab}
        />
      </View>

      {tab === 'skills' ? (
        <View style={{ gap: 8 }}>
          <Label>What the work has taught you</Label>
          <Text style={styles.skillsHint}>
            These level on their own, from doing the thing. Nothing here is for sale.
          </Text>
          {SKILLS.map((def) => (
            <SkillCard key={def.id} def={def} state={state} />
          ))}
        </View>
      ) : (
        <>
          {hasDesk ? (
        <Card style={{ gap: 8 }}>
          <Label>Standing order</Label>
          <Text style={styles.policyHint}>{POLICY_HINT[state.dealPolicy]}</Text>
          <View style={styles.policyRow}>
            {(Object.keys(POLICY_LABEL) as DealPolicy[]).map((policy) => {
              const selected = state.dealPolicy === policy;
              return (
                <Button
                  key={policy}
                  label={POLICY_LABEL[policy]}
                  tone={selected ? 'primary' : 'ghost'}
                  onPress={() => apply((s) => setDealPolicy(s, policy))}
                  style={styles.policyButton}
                />
              );
            })}
          </View>
        </Card>
      ) : null}

      {categories.map((category) => {
        const items = available.filter((u) => u.category === category);
        if (items.length === 0) return null;
        return (
          <View key={category} style={{ gap: 8 }}>
            <Label>{CATEGORY_TITLE[category]}</Label>
            {items.map((def) => (
              <UpgradeCard
                key={def.id}
                def={def}
                state={state}
                onBuy={() => apply((s) => purchaseUpgrade(s, def.id))}
              />
            ))}
          </View>
        );
      })}
        </>
      )}
    </ScrollView>
  );
}

function UpgradeCard({
  def,
  state,
  onBuy,
}: {
  def: UpgradeDef;
  state: GameState;
  onBuy: () => void;
}) {
  const lvl = level(state, def.id);
  const maxed = lvl >= def.maxLevel;
  const cost = upgradeCost(getUpgrade(def.id), lvl);
  const affordable = state.cash >= cost;

  return (
    <View style={[styles.card, maxed && styles.cardMaxed]}>
      <View style={{ flex: 1, gap: 3 }}>
        <Row gap={6}>
          <Text style={styles.name}>{def.name}</Text>
          {def.maxLevel > 1 ? (
            <Chip
              text={maxed ? 'MAX' : `${lvl}/${def.maxLevel}`}
              color={maxed ? theme.colors.money : theme.colors.textFaint}
            />
          ) : maxed ? (
            <Chip text="OWNED" color={theme.colors.money} />
          ) : null}
        </Row>
        <Text style={styles.description}>{def.description}</Text>
      </View>

      {!maxed ? (
        <Button
          label={money(cost)}
          tone={affordable ? 'money' : 'ghost'}
          disabled={!affordable}
          onPress={onBuy}
          style={styles.buyButton}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 14, paddingBottom: 32 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 12,
  },
  cardMaxed: { opacity: 0.6, borderColor: theme.colors.moneyDim },
  name: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  description: { color: theme.colors.textDim, fontSize: 12, lineHeight: 16 },
  buyButton: { minWidth: 92 },
  policyHint: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 16 },
  policyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  policyButton: { flexGrow: 1, flexBasis: '45%' },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1 },
  skillsHint: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 16 },
});
