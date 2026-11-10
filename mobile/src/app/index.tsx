import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { LoginScreen } from '@/components/LoginScreen';
import { Button } from '@/components/ui';
import { AdminView } from '@/components/admin/AdminView';
import { DriverView } from '@/components/driver/DriverView';
import { RestaurantView } from '@/components/restaurant/RestaurantView';
import { Brand } from '@/constants/brand';
import { useInThaRoute } from '@/context/InThaRouteContext';

export default function HomeScreen() {
  const { isRestoring, isLoggedIn, role } = useInThaRoute();

  // Brief blank frame while the saved session is read, so the welcome screen doesn't flash.
  if (isRestoring) return <View style={styles.root} />;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {!isLoggedIn ? (
        <LoginScreen />
      ) : (
        <>
          <AppHeader />
          <View style={styles.body}>
            <DashboardGate>
              {role === 'restaurant' && <RestaurantView />}
              {role === 'driver' && <DriverView />}
              {role === 'admin' && <AdminView />}
            </DashboardGate>
          </View>
        </>
      )}
    </View>
  );
}

/** Waits for the first dashboard from the server; offers a retry if it can't be loaded. */
function DashboardGate({ children }: { children: React.ReactNode }) {
  const { isDashboardReady, dashboardError, refreshDashboard } = useInThaRoute();
  const [retrying, setRetrying] = React.useState(false);

  if (isDashboardReady) return <>{children}</>;

  if (dashboardError && !retrying) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Couldn’t load your dashboard</Text>
        <Text style={styles.caption}>{dashboardError}</Text>
        <Button
          label="Try again"
          icon="refresh"
          onPress={async () => {
            setRetrying(true);
            await refreshDashboard();
            setRetrying(false);
          }}
        />
      </View>
    );
  }

  return (
    <View style={styles.center}>
      <ActivityIndicator color={Brand.colors.primary} />
      <Text style={styles.caption}>Loading…</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.colors.bg },
  body: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { ...Brand.type.heading, color: Brand.colors.ink, textAlign: 'center' },
  caption: { ...Brand.type.caption, color: Brand.colors.ink3, textAlign: 'center' },
});
