import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { AppHeader } from '@/components/AppHeader';
import { LoginScreen } from '@/components/LoginScreen';
import { AdminView } from '@/components/admin/AdminView';
import { DriverView } from '@/components/driver/DriverView';
import { RestaurantView } from '@/components/restaurant/RestaurantView';
import { Brand } from '@/constants/brand';
import { useInThaRoute } from '@/context/InThaRouteContext';

export default function HomeScreen() {
  const { isLoggedIn, role } = useInThaRoute();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />
      {!isLoggedIn ? (
        <LoginScreen />
      ) : (
        <>
          <AppHeader />
          <View style={styles.body}>
            {role === 'restaurant' && <RestaurantView />}
            {role === 'driver' && <DriverView />}
            {role === 'admin' && <AdminView />}
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.colors.bg },
  body: { flex: 1 },
});
