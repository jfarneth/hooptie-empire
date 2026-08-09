import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { resetTuning, setTuning } from '../../sim/actions';
import {
  TUNABLES,
  TUNABLE_GROUPS,
  currentValue,
  defaultValue,
  type TunableDef,
} from '../../sim/tuning';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { money, theme } from '../theme';
import { Button, Card, Label, Row } from './ui';

/**
 * The admin console: every tuning constant, editable in the running game.
 *
 * Deliberately not disguised as a game screen. It shows raw numbers in the units
 * the simulation actually uses, says what each one does in one line, and marks
 * anything you have moved away from its shipped value — because the failure mode
 * of a tool like this is losing track of what you changed and then mistaking a
 * knob you forgot about for a balance discovery.
 *
 * Values commit on blur rather than per keystroke. Committing per character
 * would apply "0" the moment you cleared the field to type "0.35", and every
 * intermediate state would land in the live economy.
 */
export function AdminPanel({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const overrides = state.tuning ?? {};
  const changedCount = Object.keys(overrides).length;

  const byGroup = useMemo(() => {
    const map = new Map<string, TunableDef[]>();
    for (const def of TUNABLES) {
      const list = map.get(def.group) ?? [];
      list.push(def);
      map.set(def.group, list);
    }
    return map;
  }, []);

  // Groups holding something you changed start open, so a modified knob is never
  // hidden behind a collapsed header you have to remember to check.
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    for (const group of TUNABLE_GROUPS) {
      initial[group] = (byGroup.get(group) ?? []).some((d) => d.path in overrides);
    }
    return initial;
  });

  return (
    <View style={{ gap: 12 }}>
      <Card style={{ gap: 8 }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.title}>Admin console</Text>
          <Text style={[styles.count, changedCount > 0 && { color: theme.colors.accent }]}>
            {changedCount === 0 ? 'all default' : `${changedCount} changed`}
          </Text>
        </Row>
        <Text style={styles.blurb}>
          Live tuning constants. Changes take effect immediately, save with your game, and apply
          while the app is closed. They do not rewrite history — cars you already own keep the
          cost basis they were bought at, and contracts already written keep their terms.
        </Text>
        {changedCount > 0 ? (
          <Button
            label="Reset everything to defaults"
            tone="danger"
            onPress={() => apply(resetTuning)}
          />
        ) : null}
      </Card>

      {TUNABLE_GROUPS.map((group) => {
        const rows = byGroup.get(group) ?? [];
        if (rows.length === 0) return null;
        const changedHere = rows.filter((d) => d.path in overrides).length;
        const expanded = open[group];

        return (
          <View key={group} style={{ gap: 6 }}>
            <Pressable
              onPress={() => setOpen((o) => ({ ...o, [group]: !o[group] }))}
              accessibilityRole="button"
              style={styles.groupHeader}
            >
              <Label>
                {expanded ? '▾' : '▸'}  {group}
              </Label>
              <Text style={styles.groupMeta}>
                {changedHere > 0 ? `${changedHere} changed` : `${rows.length}`}
              </Text>
            </Pressable>

            {expanded
              ? rows.map((def) => (
                  <TunableRow
                    key={def.path}
                    def={def}
                    overridden={def.path in overrides}
                    onCommit={(v) => apply((s) => setTuning(s, def.path, v))}
                    onReset={() => apply((s) => setTuning(s, def.path, defaultValue(def.path)!))}
                  />
                ))
              : null}
          </View>
        );
      })}
    </View>
  );
}

function TunableRow({
  def,
  overridden,
  onCommit,
  onReset,
}: {
  def: TunableDef;
  overridden: boolean;
  onCommit: (value: number) => void;
  onReset: () => void;
}) {
  const live = currentValue(def.path) ?? 0;
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const parsed = Number(draft.replace(/[^0-9.eE+-]/g, ''));
    // An unparseable entry reverts rather than clamping to the minimum. Typing
    // nonsense should leave the number alone, not silently set it to zero.
    if (Number.isFinite(parsed)) onCommit(parsed);
    setDraft(null);
  };

  return (
    <View style={[styles.row, overridden && styles.rowChanged]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.rowLabel}>{def.label}</Text>
        {def.help ? <Text style={styles.rowHelp}>{def.help}</Text> : null}
        <Text style={styles.rowMeta}>
          {overridden ? `default ${format(def, defaultValue(def.path) ?? 0)} · ` : ''}
          range {format(def, def.min)}–{format(def, def.max)}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <TextInput
          value={draft ?? String(round(live))}
          onChangeText={setDraft}
          onBlur={commit}
          onSubmitEditing={commit}
          keyboardType="numbers-and-punctuation"
          selectTextOnFocus
          style={[styles.input, overridden && styles.inputChanged]}
          accessibilityLabel={def.label}
        />
        <Text style={styles.rowValue}>{format(def, live)}</Text>
        {overridden ? (
          <Pressable onPress={onReset} accessibilityRole="button">
            <Text style={styles.resetLink}>reset</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Trim float noise so a field shows 0.35 rather than 0.35000000000000003. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The value in units a person reads, next to the raw one they type. */
function format(def: TunableDef, n: number): string {
  switch (def.kind) {
    case 'money':
      return money(n);
    case 'percent':
      return `${(n * 100).toFixed(n < 0.1 ? 1 : 0)}%`;
    case 'ms':
      return n >= 60_000 ? `${(n / 60_000).toFixed(1)}m` : `${(n / 1000).toFixed(1)}s`;
    case 'int':
      return String(Math.round(n));
    default:
      return String(round(n));
  }
}

const styles = StyleSheet.create({
  title: { color: theme.colors.text, fontSize: 15, fontWeight: '800' },
  count: { color: theme.colors.textFaint, fontSize: 11, fontWeight: '700' },
  blurb: { color: theme.colors.textDim, fontSize: 12, lineHeight: 17 },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  groupMeta: { color: theme.colors.textFaint, fontSize: 11, fontWeight: '700' },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
  },
  rowChanged: { borderColor: theme.colors.accent },
  rowLabel: { color: theme.colors.text, fontSize: 13, fontWeight: '700' },
  rowHelp: { color: theme.colors.textDim, fontSize: 11, lineHeight: 15 },
  rowMeta: { color: theme.colors.textFaint, fontSize: 10 },
  rowValue: { color: theme.colors.textDim, fontSize: 10, fontVariant: ['tabular-nums'] },
  resetLink: {
    color: theme.colors.accent,
    fontSize: 10,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  input: {
    minWidth: 96,
    color: theme.colors.text,
    backgroundColor: theme.colors.surfaceHigh,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  inputChanged: { borderColor: theme.colors.accent, color: theme.colors.accent },
});
