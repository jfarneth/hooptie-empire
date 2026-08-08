import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { purchaseUpgrade } from '../../sim/actions';
import { UPGRADES, getUpgrade, level, upgradeCost, upgradeUnlocked, type UpgradeDef } from '../../sim/upgrades';
import { SKILLS } from '../../sim/skills';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, theme } from '../theme';
import { Button, Chip, Label, Row } from '../components/ui';
import { BusinessPanel } from '../components/BusinessPanel';
import { SkillCard } from '../components/SkillCard';

const CATEGORY_TITLE: Record<string, string> = {
  automation: 'Take your hands off it',
  capacity: 'Room to work',
  speed: 'Move faster',
  finance: 'The book',
};

type OfficeTab = 'upgrades' | 'skills' | 'business';

const TAB_LABEL: Record<OfficeTab, string> = {
  upgrades: 'Upgrades',
  skills: 'Skills',
  business: 'Business',
};

/**
 * The office: the three things that are true about the business rather than
 * about any one car. What money buys, what the work has taught you, and the
 * rules the place runs under while you are not in it.
 *
 * The standing order lives on the Business tab rather than next to the upgrade
 * that unlocks it, because it is the same kind of object as the house rules —
 * an instruction that keeps applying with the app closed — and it reads as one
 * decision surface alongside them instead of as a footnote to a purchase.
 */
export function UpgradesScreen({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const [tab, setTab] = useState<OfficeTab>('upgrades');

  const available = UPGRADES.filter((u) => upgradeUnlocked(state, u));
  const categories = ['automation', 'capacity', 'speed', 'finance'] as const;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.tabs}>
        {(Object.keys(TAB_LABEL) as OfficeTab[]).map((id) => (
          <Button
            key={id}
            label={TAB_LABEL[id]}
            tone={tab === id ? 'primary' : 'ghost'}
            onPress={() => setTab(id)}
            style={styles.tab}
          />
        ))}
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
      ) : tab === 'business' ? (
        <BusinessPanel state={state} />
      ) : (
        <>
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
  const cost = upgradeCost(getUpgrade(def.id), lvl, state.stage);
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
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1 },
  skillsHint: { color: theme.colors.textFaint, fontSize: 12, lineHeight: 16 },
});
