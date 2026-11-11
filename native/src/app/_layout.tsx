import '../global.css';

import { AppServices } from '@/main/app-services';
import { ClientProviders } from '@/main/client-providers';
import { Stack } from 'expo-router';
import { NavigationBar } from 'expo-navigation-bar';
import { hideSystemBars } from '@/lib/system-bars';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { AppState, Dimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

/*
 * The old app hid the bars again on every resume, window focus and fullscreen change (MainActivity.hideSystemBars at
 * :408/646/656/693/741). The components below only act when they mount or change, so a bar that came back (another app,
 * the lock screen, PiP, a turn, a window that took the focus) stayed visible over the page. Window focus is AppState's
 * Android-only "focus" event; hideSystemBars bypasses RN's StatusBar record (lib/system-bars.ts).
 */
function useKeepSystemBarsHidden() {
  React.useEffect(() => {
    const hide = () => hideSystemBars();
    const app = AppState.addEventListener('change', state => { if (state === 'active') hide(); });
    const focus = AppState.addEventListener('focus', hide);
    const turn = Dimensions.addEventListener('change', hide);
    return () => { app.remove(); focus.remove(); turn.remove(); };
  }, []);
}

export default function RootLayout() {
  useKeepSystemBarsHidden();
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#070707' }}>
      <ClientProviders>
        <AppServices />
        {/* Full screen like the old app (MainActivity.hideSystemBars): status and navigation bar hidden, a swipe from the
            edge shows them for a moment. app.json hides them already at start (expo-status-bar/-navigation-bar plugins). */}
        <StatusBar style="light" hidden />
        <NavigationBar hidden />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#070707' } }} />
      </ClientProviders>
    </GestureHandlerRootView>
  );
}
