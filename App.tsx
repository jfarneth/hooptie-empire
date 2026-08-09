import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { activeNotes } from './src/sim/notes';
import { useGame } from './src/state/store';
import { AwaySummaryModal } from './src/ui/components/AwaySummaryModal';
import { Hud } from './src/ui/components/Hud';
import { Loading } from './src/ui/components/ui';
import { BuyScreen } from './src/ui/screens/BuyScreen';
import { LotScreen } from './src/ui/screens/LotScreen';
import { NotesScreen } from './src/ui/screens/NotesScreen';
import { UpgradesScreen } from './src/ui/screens/UpgradesScreen';
import { theme } from './src/ui/theme';

/** How often the UI asks the sim to catch up. The sim itself is driven by real
 *  elapsed time, so this only controls smoothness, never game speed. */
const TICK_INTERVAL_MS = 250;
const AUTOSAVE_INTERVAL_MS = 5_000;

type Tab = 'lot' | 'buy' | 'notes' | 'upgrades';

const TABS: { id: Tab; label: string }[] = [
  { id: 'lot', label: 'Lot' },
  { id: 'buy', label: 'Buy' },
  { id: 'notes', label: 'Notes' },
  { id: 'upgrades', label: 'Office' },
];

export default function App() {
  const state = useGame((s) => s.state);
  const ready = useGame((s) => s.ready);
  const awaySummary = useGame((s) => s.awaySummary);
  const load = useGame((s) => s.load);
  const dismissAwaySummary = useGame((s) => s.dismissAwaySummary);
  const [tab, setTab] = useState<Tab>('lot');

  useEffect(() => {
    void load();
  }, [load]);

  // Game clock.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => useGame.getState().tick(), TICK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [ready]);

  // Autosave on a timer and, critically, the moment the app goes to background —
  // that timestamp is what offline catch-up measures from.
  useEffect(() => {
    if (!ready) return;
    const id = setInterval(() => void useGame.getState().save(), AUTOSAVE_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') void useGame.getState().save();
      else useGame.setState({ lastTickAt: Date.now() });
    });
    return () => {
      clearInterval(id);
      sub.remove();
      void useGame.getState().save();
    };
  }, [ready]);

  if (!ready || !state) {
    return (
      <SafeAreaProvider>
        <View style={styles.root}>
          <Loading />
        </View>
      </SafeAreaProvider>
    );
  }

  const walkUps = state.prospects.length;
  const behind = activeNotes(state.notes).filter((n) => n.status === 'delinquent').length;
  const badges: Record<Tab, number> = {
    lot: walkUps,
    buy: 0,
    notes: behind,
    upgrades: 0,
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <StatusBar style="light" />

        <View style={styles.body}>
          {tab === 'lot' ? <LotScreen state={state} /> : null}
          {tab === 'buy' ? <BuyScreen state={state} /> : null}
          {tab === 'notes' ? <NotesScreen state={state} /> : null}
          {tab === 'upgrades' ? <UpgradesScreen state={state} /> : null}

          {/* Floats over the screen, which is why every screen pads by HUD_HEIGHT. */}
          <View style={styles.hudLayer} pointerEvents="box-none">
            <Hud state={state} />
          </View>
        </View>

        <View style={styles.tabBar}>
          {TABS.map(({ id, label }) => {
            const active = tab === id;
            const badge = badges[id];
            return (
              <Pressable
                key={id}
                onPress={() => setTab(id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={styles.tab}
              >
                <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
                {badge > 0 ? (
                  <View style={[styles.badge, id === 'notes' && styles.badgeWarn]}>
                    <Text style={styles.badgeText}>{badge}</Text>
                  </View>
                ) : null}
                {active ? <View style={styles.tabUnderline} /> : null}
              </Pressable>
            );
          })}
        </View>

        <AwaySummaryModal summary={awaySummary} onDismiss={dismissAwaySummary} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.colors.bg },
  body: { flex: 1 },
  hudLayer: { position: 'absolute', left: 0, right: 0, top: 0 },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: theme.colors.surface,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  tabLabel: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  tabLabelActive: { color: theme.colors.accent, fontWeight: '800' },
  tabUnderline: {
    position: 'absolute',
    top: 0,
    height: 2,
    width: 32,
    borderRadius: 1,
    backgroundColor: theme.colors.accent,
  },
  badge: {
    position: 'absolute',
    top: 6,
    right: '26%',
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeWarn: { backgroundColor: theme.colors.danger },
  badgeText: { color: theme.colors.bg, fontSize: 10, fontWeight: '900' },
});
