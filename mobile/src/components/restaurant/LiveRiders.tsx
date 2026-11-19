import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveMap, MapPin } from '@/components/LiveMap';
import { Avatar, Badge, Card, Divider, EmptyState, Screen, SectionLabel, Stat } from '@/components/ui';
import { Brand } from '@/constants/brand';
import { LatLng, coordsForPostcode, milesBetween } from '@/constants/geo';
import { useInThaRoute } from '@/context/InThaRouteContext';

const C = Brand.colors;
const FREE = C.success;
const BUSY = C.primary;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');

const ago = (iso: string, now: number) => {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)} min ago`;
};

/** Your own riders: who is online, where they are and how far from the shop, live (same as the web). */
export function LiveRidersScreen() {
  const { drivers, restaurants, activeRestaurantId, dashboardSyncedAt } = useInThaRoute();
  const restaurant = restaurants.find((r) => r.id === activeRestaurantId) ?? restaurants[0];
  const [focus, setFocus] = useState<{ key: string; coordinate: LatLng } | null>(null);

  const shop: LatLng | null = restaurant ? restaurant.coords ?? coordsForPostcode(restaurant.postcode) : null;
  // The "x ago" labels follow the last refresh (every few seconds).
  const now = dashboardSyncedAt;

  const riders = drivers
    .filter((d) => d.driverType === 'restaurant_own')
    .map((d) => ({ d, miles: d.isOnline && d.location && shop ? milesBetween(shop, d.location) : null }))
    .sort((a, b) => {
      const rank = (x: typeof a) => (x.d.isOnline ? (x.miles != null ? 0 : 1) : 2);
      return rank(a) - rank(b) || (a.miles ?? 0) - (b.miles ?? 0) || a.d.name.localeCompare(b.d.name);
    });
  const online = riders.filter((r) => r.d.isOnline);
  const located = online.filter((r) => r.miles != null);
  const onDelivery = online.filter((r) => (r.d.activeOrders ?? 0) > 0).length;

  const pins: MapPin[] = [
    ...(shop && restaurant
      ? [{ id: 'shop', kind: 'restaurant' as const, coordinate: shop, title: restaurant.name, description: restaurant.postcode }]
      : []),
    ...located.map(({ d, miles }) => ({
      id: `rider-${d.id}`,
      kind: 'driver' as const,
      label: initials(d.name) || '?',
      color: (d.activeOrders ?? 0) > 0 ? BUSY : FREE,
      coordinate: { latitude: d.location!.latitude, longitude: d.location!.longitude },
      title: d.name,
      description: `${miles!.toFixed(1)} mi from you · ${d.activeOrders ?? 0} active order${d.activeOrders === 1 ? '' : 's'}`,
    })),
  ];

  return (
    <Screen>
      <Card style={styles.noPad}>
        <View>
          <LiveMap style={styles.map} pins={pins} focus={focus} />
          <View style={styles.liveTag} pointerEvents="none">
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{`Live · ${located.length} on the map`}</Text>
          </View>
        </View>
        <View style={styles.legendRow}>
          <View style={styles.legend}>
            <Ionicons name="storefront" size={13} color={C.ink} />
            <Text style={styles.muted}>Your shop</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.dot, { backgroundColor: FREE }]} />
            <Text style={styles.muted}>Free</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.dot, { backgroundColor: BUSY }]} />
            <Text style={styles.muted}>On a delivery</Text>
          </View>
        </View>
      </Card>

      <Card>
        <View style={styles.statsRow}>
          <Stat label="Online now" value={`${online.length}`} tone="success" style={styles.flex1} />
          <View style={styles.vDivider} />
          <Stat label="On a delivery" value={`${onDelivery}`} tone="primary" style={styles.flex1} />
        </View>
        <Divider />
        <View style={styles.statsRow}>
          <Stat
            label={located[0] ? `Nearest · ${located[0].d.name.split(' ')[0]}` : 'Nearest'}
            value={located.length ? `${located[0].miles!.toFixed(1)} mi` : '—'}
            tone="info"
            style={styles.flex1}
          />
          <View style={styles.vDivider} />
          <Stat label={`Team · ${riders.length - online.length} offline`} value={`${riders.length}`} style={styles.flex1} />
        </View>
      </Card>

      <SectionLabel>Your riders</SectionLabel>
      <Card>
        {riders.length === 0 ? (
          <EmptyState icon="people-outline" title="No drivers yet" subtitle="Add your in-house drivers under My drivers." />
        ) : (
          riders.map(({ d, miles }, i) => {
            const busy = (d.activeOrders ?? 0) > 0;
            const canFocus = miles != null;
            return (
              <View key={d.id} style={styles.gap12}>
                {i > 0 && <Divider />}
                <Pressable
                  disabled={!canFocus}
                  onPress={() =>
                    canFocus &&
                    setFocus({ key: `${d.id}-${Date.now()}`, coordinate: { latitude: d.location!.latitude, longitude: d.location!.longitude } })
                  }
                  accessibilityRole={canFocus ? 'button' : undefined}
                  accessibilityLabel={canFocus ? `Show ${d.name} on the map` : undefined}
                  style={({ pressed }) => [styles.riderRow, pressed && styles.pressed]}>
                  <View>
                    <Avatar name={d.name} tone={d.isOnline ? (busy ? 'primary' : 'success') : 'neutral'} />
                    {d.isOnline && <View style={styles.onlineDot} />}
                  </View>
                  <View style={styles.flexText}>
                    <Text style={styles.title} numberOfLines={1}>
                      {d.name}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {!d.isOnline
                        ? 'Offline'
                        : miles == null
                          ? 'Online · waiting for GPS'
                          : `${busy ? `${d.activeOrders} active order${d.activeOrders === 1 ? '' : 's'}` : 'Free'} · seen ${ago(d.location!.updatedAt, now)}`}
                    </Text>
                  </View>
                  {miles != null ? (
                    <View style={styles.miles}>
                      <Text style={styles.milesValue}>{miles.toFixed(1)}</Text>
                      <Text style={styles.milesLabel}>MILES</Text>
                    </View>
                  ) : d.isOnline ? (
                    <Badge label="No GPS" tone="warning" />
                  ) : (
                    <Ionicons name="cloud-offline-outline" size={18} color={C.ink3} />
                  )}
                </Pressable>
              </View>
            );
          })
        )}
      </Card>
      <Text style={[styles.muted, styles.center]}>Distances are in a straight line from your shop. Tap a rider to find them on the map.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  noPad: { padding: 0, gap: 0, overflow: 'hidden' },
  map: { height: 300 },
  flex1: { flex: 1 },
  flexText: { flex: 1, minWidth: 0, gap: 3 },
  gap12: { gap: 12 },
  center: { textAlign: 'center' },
  pressed: { opacity: 0.7 },
  title: { ...Brand.type.bodyStrong, color: C.ink },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  liveTag: {
    position: 'absolute',
    top: 12,
    left: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Brand.radius.pill,
    backgroundColor: 'rgba(255,255,255,0.95)',
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
  liveText: { ...Brand.type.captionStrong, color: C.ink },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 14 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  onlineDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.success,
    borderWidth: 2,
    borderColor: C.surface,
  },
  miles: { alignItems: 'flex-end' },
  milesValue: { ...Brand.type.heading, color: C.ink, fontVariant: ['tabular-nums'] },
  milesLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: C.ink3 },
});
