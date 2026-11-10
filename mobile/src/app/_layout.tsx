import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Brand } from '@/constants/brand';
import { ChatProvider } from '@/context/ChatContext';
import { InThaRouteProvider } from '@/context/InThaRouteContext';

SplashScreen.preventAutoHideAsync();

const theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: Brand.colors.bg,
    card: Brand.colors.surface,
    primary: Brand.colors.primary,
    text: Brand.colors.ink,
    border: Brand.colors.line,
  },
};

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <SafeAreaProvider>
      <InThaRouteProvider>
        <ChatProvider>
          <ThemeProvider value={theme}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
            </Stack>
          </ThemeProvider>
        </ChatProvider>
      </InThaRouteProvider>
    </SafeAreaProvider>
  );
}
