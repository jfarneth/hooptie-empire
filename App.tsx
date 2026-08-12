import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View, type AppStateStatus } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { activeNotes } from './src/sim/notes';
import { hasSeenOnboarding, markOnboardingSeen } from './src/state/onboarding';
import { useGame } from './src/state/store';
import { AwaySummaryModal } from './src/ui/components/AwaySummaryModal';
import { Hud } from './src/ui/components/Hud';
import { COACH_STEPS, Onboarding, coachTabFor } from './src/ui/components/Onboarding';
import { PromotionBar } from './src/ui/components/PromotionBar';
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

  /** Which coach mark is showing, or null for none — the normal case. */
  const [coach, setCoach] = useState<number | null>(null);
  /** Measured height of the promotion tray plus the tab bar, for the caret. */
  const [chromeHeight, setChromeHeight] = useState(0);

  useEffect(() => {
    void load();
  }, [load]);

  // Coach marks, for a genuinely new game only. Read once on ready rather than
  // subscribed: whether to teach somebody is decided at the door, and a flag
  // that could flip mid-session would put a card over a live negotiation.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      if (await hasSeenOnboarding()) return;
      if (cancelled) return;
      if (!useGame.getState().isNewGame) {
        // An existing save on a build that just added this. Nothing to explain.
        await markOnboardingSeen();
        return;
      }
      setCoach(0);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready]);

  // Each card names a tab, so put the player on it — the copy is describing
  // what is behind the scrim and would be talking about nothing otherwise.
  useEffect(() => {
    if (coach === null) return;
    const want = coachTabFor(coach);
    if (want) setTab(want);
  }, [coach]);

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

  // Written the moment the player is done rather than on the last card, so
  // skipping and finishing are the same promise: this does not come back.
  const finish = () => {
    setCoach(null);
    void markOnboardingSeen();
  };

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

        {/* Measured as one block so the coach mark can sit above whatever is
            actually there — the tray comes and goes with the grand opening,
            which is running during the only session that shows a coach mark. */}
        <View onLayout={(e) => setChromeHeight(e.nativeEvent.layout.height)}>
          {/* Above the tabs rather than over the lot: the HUD is the two scores,
              and a promotion is status. Renders nothing when nothing is running. */}
          <PromotionBar state={state} />

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
        </View>

        {coach !== null ? (
          <Onboarding
            step={coach}
            tabCount={TABS.length}
            bottomInset={chromeHeight}
            onNext={() => {
              const next = coach + 1;
              if (next >= COACH_STEPS) finish();
              else setCoach(next);
            }}
            onSkip={finish}
          />
        ) : null}

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
