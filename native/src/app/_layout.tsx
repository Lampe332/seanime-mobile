import '../global.css';

import { AppServices } from '@/main/app-services';
import { ClientProviders } from '@/main/client-providers';
import { Stack } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { HiddenBrowserHost } from '@/lib/hidden-browser/hidden-browser';
import { hideSystemBars } from '@/lib/system-bars';
import { showStatusBarAtom } from '@/lib/status-bar-setting';
import { player_fullscreenAtom } from '@/main/_features/player/player.atoms';
import { useAtomValue } from 'jotai';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { AppState, Dimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { startDiagnostics } from '@/lib/diagnostics/collect-diagnostics';

// the last log lines and error toasts, in memory for the diagnostic report (settings → Logs & cache)
startDiagnostics();

/*
 * The old app hid the bars again on every resume, window focus and fullscreen change (MainActivity.hideSystemBars at
 * :408/646/656/693/741). The components below only act when they mount or change, so a bar that came back (another app,
 * the lock screen, PiP, a turn, a window that took the focus) stayed visible over the page. Window focus is AppState's
 * Android-only "focus" event; hideSystemBars bypasses RN's StatusBar record (lib/system-bars.ts). With "Show status bar"
 * on (settings → Appearance) only the navigation bar is hidden again, except in the fullscreen player.
 */
function useKeepSystemBarsHidden(statusBarHidden: boolean) {
  React.useEffect(() => {
    const hide = () => hideSystemBars(statusBarHidden ? undefined : null);
    const app = AppState.addEventListener('change', state => { if (state === 'active') hide(); });
    const focus = AppState.addEventListener('focus', hide);
    const turn = Dimensions.addEventListener('change', hide);
    return () => { app.remove(); focus.remove(); turn.remove(); };
  }, [statusBarHidden]);
}

export default function RootLayout() {
  const showStatusBar = useAtomValue(showStatusBarAtom);
  const playerFullscreen = useAtomValue(player_fullscreenAtom);
  const statusBarHidden = !showStatusBar || playerFullscreen;
  useKeepSystemBarsHidden(statusBarHidden);
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#070707' }}>
      {/* The hidden page for extensions (docs/EIGENER-KERN.md §4k): nothing until one is asked for, then beneath everything */}
      <HiddenBrowserHost />
      <ClientProviders>
        <AppServices />
        {/* Full screen like the old app (MainActivity.hideSystemBars): status and navigation bar hidden, a swipe from the
            edge shows them for a moment. app.json hides them already at start (expo-status-bar/-navigation-bar plugins).
            The status bar can be shown outside the fullscreen player (settings → Appearance). */}
        <StatusBar style="light" hidden={statusBarHidden} />
        <NavigationBar hidden />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#070707' } }} />
      </ClientProviders>
    </GestureHandlerRootView>
  );
}
