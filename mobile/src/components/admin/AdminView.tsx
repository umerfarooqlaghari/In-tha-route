import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

import { CreditAdjustSheet, CreditsAdminScreen, FeeSheet, isLowOnCredits } from '@/components/admin/AdminCredits';
import { LiveMap, MapPin } from '@/components/LiveMap';
import { ReceiptSheet } from '@/components/ReceiptSheet';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Chip,
  Divider,
  EmptyState,
  Field,
  Hint,
  IconTile,
  ListRow,
  Screen,
  SectionLabel,
  Segmented,
  Sheet,
  Stat,
  Stepper,
} from '@/components/ui';
import { Brand, formatGbp, sourceColor } from '@/constants/brand';
import { coordsForPostcode } from '@/constants/geo';
import { DriverPolicy, DriverProfile, KycDocument, LiveOrder, RestaurantPartner, useInThaRoute } from '@/context/InThaRouteContext';
import { UploadedFile } from '@/components/UploadedFile';

const C = Brand.colors;
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const cleanTitle = (t: string) => t.replace(/\s*\(.*?\)/g, '');
const shortName = (n: string) => (n ?? '').split(' - ')[0];
/** Orders not from a delivery app are the merchant's own (direct) orders. */
const sourceLabel = (source: string) => (source === 'Eat Presto POS' || source === 'Other' ? 'Direct' : source);
const PLATFORM_DRIVER_COLOR = '#2F6FED';
const OWN_DRIVER_COLOR = '#7A5AF8';
const isLive = (o: LiveOrder) => o.status !== 'delivered' && o.status !== 'cancelled';
const marginOf = (o: LiveOrder) => o.platformMarginGbp ?? o.restaurantFeeGbp - o.driverPayoutGbp;
const formatCountdown = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, '0')}`;
const VEHICLE_SHORT: Record<DriverProfile['vehicle'], string> = {
  'Motorcycle / Scooter': 'Scooter',
  Car: 'Car',
  'E-Bike': 'E-Bike',
};

/** The same order filters as the web admin panel. */
type OrderFilter = 'live' | 'attention' | 'waiting' | 'moving' | 'delivered' | 'cancelled';
const ORDER_FILTERS: { key: OrderFilter; label: string; test: (o: LiveOrder) => boolean }[] = [
  { key: 'live', label: 'All live', test: isLive },
  { key: 'attention', label: 'Needs attention', test: (o) => isLive(o) && !!o.attention },
  {
    key: 'waiting',
    label: 'Waiting for driver',
    test: (o) => o.status === 'preparing' || o.status === 'ready_for_pickup' || o.status === 'batched_offered',
  },
  { key: 'moving', label: 'With a driver', test: (o) => o.status === 'driver_assigned' || o.status === 'picked_up' },
  { key: 'delivered', label: 'Delivered today', test: (o) => o.status === 'delivered' },
  { key: 'cancelled', label: 'Cancelled today', test: (o) => o.status === 'cancelled' },
];

/** A platform driver who is new, or approved but with a new document to check. */
const needsReview = (d: DriverProfile) =>
  d.driverType === 'platform_contracted' &&
  (d.approval === 'pending' || (d.approval === 'approved' && d.kycDocuments.some((k) => k.status === 'pending')));

export function AdminView() {
  const { activeScreen, setActiveScreen } = useInThaRoute();
  // The Overview can open Live orders on a chosen filter ("Needs attention", "Delivered today").
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('live');
  const openOrders = (filter: OrderFilter) => {
    setOrderFilter(filter);
    setActiveScreen('admin_orders');
  };

  switch (activeScreen) {
    case 'admin_orders':
      return <LiveOrdersScreen filter={orderFilter} onFilter={setOrderFilter} />;
    case 'pricing_algorithm':
      return <PricingScreen />;
    case 'driver_kyc':
      return <DriversScreen />;
    case 'partner_restaurants':
      return <RestaurantsScreen />;
    case 'admin_credits':
      return <CreditsAdminScreen syncBar={<SyncBar />} />;
    default:
      return <OverviewScreen openOrders={openOrders} openDrivers={() => setActiveScreen('driver_kyc')} />;
  }
}

/* ========================================================================== */
/* Shared pieces                                                               */
/* ========================================================================== */

/** Seconds since a moment, updated every second (null before the first value). */
function useSecondsSince(ts: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return ts ? Math.max(0, Math.floor((now - ts) / 1000)) : null;
}

/**
 * "Live · synced 4s ago". The app and the web panel read the same dashboard,
 * so whatever changes on one shows on the other within seconds. Tap to refresh now.
 */
function SyncBar() {
  const { dashboardSyncedAt, dashboardError, refreshDashboard } = useInThaRoute();
  const secs = useSecondsSince(dashboardSyncedAt);
  const [busy, setBusy] = useState(false);
  const offline = !!dashboardError;
  const label = offline
    ? 'Can’t reach the server · retrying'
    : secs === null
    ? 'Connecting…'
    : `Live · synced ${secs < 3 ? 'just now' : secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`}`;

  const refresh = async () => {
    setBusy(true);
    await refreshDashboard();
    setBusy(false);
  };

  return (
    <Pressable
      onPress={refresh}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to refresh`}
      style={({ pressed }) => [styles.syncBar, pressed && styles.pressed]}>
      <View style={[styles.syncDot, { backgroundColor: offline ? C.primary : secs !== null && secs < 30 ? C.success : C.warning }]} />
      <Text style={styles.syncText} numberOfLines={1}>
        {label}
      </Text>
      {busy ? <ActivityIndicator size="small" color={C.ink3} /> : <Ionicons name="refresh" size={16} color={C.ink3} />}
    </Pressable>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={C.ink3} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={C.ink3}
        style={styles.searchInput}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="never"
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChange('')} hitSlop={10} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={18} color={C.ink3} />
        </Pressable>
      )}
    </View>
  );
}

/** A row of chips that scrolls sideways. */
function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      style={styles.chipScroll}
      keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

/* ========================================================================== */
/* Overview                                                                    */
/* ========================================================================== */

function OverviewScreen({
  openOrders,
  openDrivers,
}: {
  openOrders: (filter: OrderFilter) => void;
  openDrivers: () => void;
}) {
  const { orders, restaurants, totals, drivers, cancelOrder, releaseOrder } = useInThaRoute();
  const [receiptOrder, setReceiptOrder] = useState<LiveOrder | null>(null);
  // Online drivers whose app has sent a recent GPS position.
  const liveDrivers = drivers.filter((d) => d.isOnline && d.location);
  const active = orders.filter(isLive);
  const attention = active.filter((o) => o.attention);
  const deliveredToday = orders.filter((o) => o.status === 'delivered').length;
  // Today's live and delivered orders, totalled by the server.
  const billed = totals?.billedGbp ?? 0;
  const paid = totals?.driverPayGbp ?? 0;
  const profit = totals?.profitGbp ?? 0;

  const platform = drivers.filter((d) => d.driverType === 'platform_contracted');
  const toReview = drivers.filter(needsReview).length;

  const pins: MapPin[] = [
    // Every online driver: platform drivers in blue, merchants' own drivers in purple (same as the web).
    ...liveDrivers.map((d) => ({
      id: `drv-${d.id}`,
      kind: 'driver' as const,
      color: d.driverType === 'restaurant_own' ? OWN_DRIVER_COLOR : PLATFORM_DRIVER_COLOR,
      coordinate: { latitude: d.location!.latitude, longitude: d.location!.longitude },
      title: d.name,
      description: [
        d.driverType === 'restaurant_own' ? `In-house · ${shortName(d.employerRestaurantName ?? 'merchant')}` : 'Platform driver',
        `${d.activeOrders ?? 0} active order${d.activeOrders === 1 ? '' : 's'}`,
      ].join(' · '),
    })),
    ...restaurants.map((r) => ({
      id: r.id,
      kind: 'restaurant' as const,
      coordinate: coordsForPostcode(r.postcode),
    })),
    ...active.map((o, i) => ({
      id: o.id,
      kind: 'dropoff' as const,
      label: `${i + 1}`,
      color: sourceColor(o.source),
      coordinate: coordsForPostcode(o.postcode),
    })),
  ];

  // Charts: the same figures as the web Overview.
  const bySource = new Map<string, number>();
  orders
    .filter((o) => o.status !== 'cancelled')
    .forEach((o) => bySource.set(sourceLabel(o.source), (bySource.get(sourceLabel(o.source)) ?? 0) + 1));
  const sourceSlices = [...bySource.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value, color: sourceColor(label === 'Direct' ? 'Eat Presto POS' : label) }));

  const count = (...s: LiveOrder['status'][]) => orders.filter((o) => s.includes(o.status)).length;
  const pipeline = [
    { label: 'Waiting', value: count('preparing', 'ready_for_pickup'), color: C.warning },
    { label: 'Offered', value: count('batched_offered'), color: C.eatPresto },
    { label: 'On the way', value: count('driver_assigned'), color: C.info },
    { label: 'Collected', value: count('picked_up'), color: C.primary },
    { label: 'Delivered', value: count('delivered'), color: C.success },
  ];

  const busiest = [...restaurants]
    .map((r) => ({ id: r.id, label: shortName(r.name), live: r.activeOrdersCount, value: r.activeOrdersCount + r.completedTodayCount }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const latest = active.slice(0, 5);

  return (
    <Screen>
      <SyncBar />

      <Card style={styles.noPad}>
        <LiveMap style={styles.map} pins={pins} />
        <View style={styles.mapFooter}>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.ink }]} />
            <Text style={styles.muted}>Merchants · {restaurants.length}</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.primary }]} />
            <Text style={styles.muted}>Drop-offs · {active.length}</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: PLATFORM_DRIVER_COLOR }]} />
            <Text style={styles.muted}>
              Platform drivers · {liveDrivers.filter((d) => d.driverType !== 'restaurant_own').length}
            </Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: OWN_DRIVER_COLOR }]} />
            <Text style={styles.muted}>
              Merchants’ own · {liveDrivers.filter((d) => d.driverType === 'restaurant_own').length}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <View style={styles.statsRow}>
          <Stat label="Billed" value={formatGbp(billed)} style={styles.flex1} />
          <View style={styles.vDivider} />
          <Stat label="Driver pay" value={formatGbp(paid)} style={styles.flex1} />
          <View style={styles.vDivider} />
          <Stat label="Profit" value={formatGbp(profit)} tone="success" style={styles.flex1} />
        </View>
        <Divider />
        <View style={styles.statsRow}>
          <Pressable style={styles.flex1} onPress={() => openOrders('live')} accessibilityRole="button">
            <Stat label="Live orders" value={`${active.length}`} />
          </Pressable>
          <View style={styles.vDivider} />
          <Pressable style={styles.flex1} onPress={() => openOrders('delivered')} accessibilityRole="button">
            <Stat label="Delivered" value={`${deliveredToday}`} />
          </Pressable>
          <View style={styles.vDivider} />
          <Pressable style={styles.flex1} onPress={() => openOrders('attention')} accessibilityRole="button">
            <Stat label="Attention" value={`${attention.length}`} tone={attention.length ? 'primary' : undefined} />
          </Pressable>
        </View>
      </Card>

      <SectionLabel
        right={
          active.length > 0 ? (
            <Pressable onPress={() => openOrders('live')} hitSlop={8}>
              <Text style={styles.link}>View all</Text>
            </Pressable>
          ) : undefined
        }>
        {`Live orders · ${active.length}`}
      </SectionLabel>
      <Card>
        {active.length === 0 ? (
          <EmptyState icon="receipt-outline" title="No live orders" subtitle="New orders appear here the moment a merchant posts them." />
        ) : (
          latest.map((o, i) => {
            const inHouse = o.dispatchType === 'own_driver';
            return (
              <View key={o.id} style={styles.gap12}>
                {i > 0 && <Divider />}
                <View style={styles.ledgerRow}>
                  <View style={[styles.indexDot, { backgroundColor: sourceColor(o.source) }]}>
                    <Text style={styles.indexText}>{i + 1}</Text>
                  </View>
                  <View style={styles.flexText}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {shortName(o.restaurantName)} · {o.externalOrderId}
                    </Text>
                    {inHouse ? (
                      <Text style={styles.muted} numberOfLines={1}>
                        In-house driver
                      </Text>
                    ) : (
                      <Text style={styles.muted} numberOfLines={1}>
                        {formatGbp(o.restaurantFeeGbp)} in · {formatGbp(o.driverPayoutGbp)} out
                      </Text>
                    )}
                  </View>
                  {inHouse ? <Badge label="No fee" /> : <Text style={styles.profit}>+{formatGbp(marginOf(o))}</Text>}
                </View>
                <OrderControls order={o} onCancel={cancelOrder} onRelease={releaseOrder} onReceipt={setReceiptOrder} />
              </View>
            );
          })
        )}
        {active.length > latest.length && (
          <Button
            label={`View all ${active.length} live orders`}
            variant="secondary"
            icon="arrow-forward"
            compact
            onPress={() => openOrders('live')}
          />
        )}
      </Card>

      {attention.length > 0 && (
        <>
          <SectionLabel>{`Needs attention · ${attention.length}`}</SectionLabel>
          <Card onPress={() => openOrders('attention')}>
            {attention.slice(0, 4).map((o, i) => (
              <View key={o.id} style={styles.gap12}>
                {i > 0 && <Divider />}
                <View style={styles.ledgerRow}>
                  <Ionicons name="alert-circle" size={20} color={C.primary} />
                  <View style={styles.flexText}>
                    <Text style={styles.cardTitle} numberOfLines={1}>
                      {shortName(o.restaurantName)} · {o.externalOrderId}
                    </Text>
                    <Text style={styles.muted} numberOfLines={1}>
                      {o.attention === 'no_driver' ? 'No driver has taken this yet' : 'Collected, not delivered for a long time'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={C.ink3} />
                </View>
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionLabel>Fleet</SectionLabel>
      <View style={styles.tileGrid}>
        <FleetTile icon="bicycle" value={drivers.filter((d) => d.isOnline).length} label="Online now" tone="info" />
        <FleetTile
          icon="checkmark-done"
          value={platform.filter((d) => d.approval === 'approved').length}
          label="Approved"
          tone="success"
        />
        <FleetTile
          icon="people-outline"
          value={drivers.filter((d) => d.driverType === 'restaurant_own').length}
          label="In-house"
        />
        <FleetTile
          icon="shield-checkmark-outline"
          value={toReview}
          label="To review"
          tone={toReview ? 'primary' : undefined}
          onPress={openDrivers}
        />
      </View>

      <SectionLabel>Orders by channel</SectionLabel>
      <Card>
        {sourceSlices.length === 0 ? (
          <EmptyState icon="pie-chart-outline" title="No orders yet today" />
        ) : (
          <View style={styles.donutRow}>
            <Donut slices={sourceSlices} />
            <View style={[styles.flex1, styles.gap8]}>
              {sourceSlices.map((s) => (
                <View key={s.label} style={styles.rowBetween}>
                  <View style={styles.legend}>
                    <View style={[styles.legendDot, { backgroundColor: s.color }]} />
                    <Text style={styles.cardBody} numberOfLines={1}>
                      {s.label}
                    </Text>
                  </View>
                  <Text style={styles.cardTitle}>{s.value}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
      </Card>

      <SectionLabel>Delivery pipeline</SectionLabel>
      <Card>
        <Columns items={pipeline} />
      </Card>

      <SectionLabel>Busiest merchants</SectionLabel>
      <Card>
        {busiest.length === 0 ? (
          <EmptyState icon="storefront-outline" title="No merchants yet" />
        ) : (
          busiest.map((m) => {
            const max = Math.max(1, ...busiest.map((b) => b.value));
            return (
              <View key={m.id} style={styles.gap6}>
                <View style={styles.rowBetween}>
                  <Text style={styles.cardBody} numberOfLines={1}>
                    {m.label}
                  </Text>
                  <Text style={styles.mutedStrong}>
                    {m.value} · {m.live} live
                  </Text>
                </View>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${(m.value / max) * 100}%` }]} />
                </View>
              </View>
            );
          })
        )}
      </Card>

      <ReceiptSheet order={receiptOrder} as="admin" onClose={() => setReceiptOrder(null)} />
    </Screen>
  );
}

function FleetTile({
  icon,
  value,
  label,
  tone,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  value: number;
  label: string;
  tone?: 'info' | 'success' | 'primary';
  onPress?: () => void;
}) {
  const fg = tone === 'info' ? C.info : tone === 'success' ? C.success : tone === 'primary' ? C.primary : C.ink2;
  const bg = tone === 'info' ? C.infoSoft : tone === 'success' ? C.successSoft : tone === 'primary' ? C.primarySoft : C.surfaceAlt;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.fleetTile, pressed && styles.pressed]}>
      <View style={[styles.fleetIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={fg} />
      </View>
      <View style={styles.flexText}>
        <Text style={styles.fleetValue}>{value}</Text>
        <Text style={styles.muted} numberOfLines={1}>
          {label}
        </Text>
      </View>
      {onPress && <Ionicons name="chevron-forward" size={16} color={C.ink3} />}
    </Pressable>
  );
}

/** A ring chart: each slice is a stroke segment around one circle. */
function Donut({ slices, size = 120, stroke = 18 }: { slices: { label: string; value: number; color: string }[]; size?: number; stroke?: number }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 2 : 0;
  // Where each slice starts along the ring.
  const starts = slices.map((_, i) => slices.slice(0, i).reduce((sum, x) => sum + (x.value / Math.max(total, 1)) * circumference, 0));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={C.surfaceAlt} strokeWidth={stroke} fill="none" />
          {slices.map((s, i) => {
            const length = (s.value / Math.max(total, 1)) * circumference;
            const dash = Math.max(0, length - gap);
            return (
              <Circle
                key={s.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={s.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-starts[i]}
              />
            );
          })}
        </G>
      </Svg>
      <View style={styles.donutCenter} pointerEvents="none">
        <Text style={styles.donutValue}>{total}</Text>
        <Text style={styles.muted}>orders</Text>
      </View>
    </View>
  );
}

/** Upright bars with the value on top and the label underneath. */
function Columns({ items }: { items: { label: string; value: number; color: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <View style={styles.columns}>
      {items.map((it) => (
        <View key={it.label} style={styles.column}>
          <Text style={styles.mutedStrong}>{it.value}</Text>
          <View style={styles.columnTrack}>
            <View style={[styles.columnFill, { height: `${Math.max(it.value ? 6 : 0, (it.value / max) * 100)}%`, backgroundColor: it.color }]} />
          </View>
          <Text style={styles.columnLabel} numberOfLines={1}>
            {it.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const ADMIN_STATUS: Record<LiveOrder['status'], string> = {
  preparing: 'Waiting for a driver',
  ready_for_pickup: 'Ready · waiting for a driver',
  batched_offered: 'Offered',
  driver_assigned: 'Driver on the way',
  picked_up: 'Collected',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

/** "Driver on the way · Maya" */
const statusLine = (o: LiveOrder) => {
  const driver = o.assignedDriverName?.split(' ')[0];
  return `${ADMIN_STATUS[o.status]}${driver && o.status !== 'preparing' && o.status !== 'ready_for_pickup' ? ` · ${driver}` : ''}`;
};

/** Status, any alert, and what the admin can do about an order. */
function OrderControls({
  order: o,
  onCancel,
  onRelease,
  onReceipt,
  showStatus = true,
}: {
  order: LiveOrder;
  onCancel: (id: string) => Promise<boolean>;
  onRelease: (id: string) => Promise<boolean>;
  onReceipt: (order: LiveOrder) => void;
  /** Off when the card around it already shows the status and alert. */
  showStatus?: boolean;
}) {
  const withDriver = !!o.batchId && (o.status === 'batched_offered' || o.status === 'driver_assigned');
  // The admin can cancel until delivery, even after the driver has collected the food.
  const cancellable = isLive(o);
  const collected = o.status === 'picked_up';
  const driver = o.assignedDriverName?.split(' ')[0];
  const ref = o.externalOrderId || 'this order';

  const confirmRelease = () =>
    Alert.alert(`Move ${ref} to another driver?`, `${driver ?? 'The driver'} will be told not to collect it, and it is offered to other drivers.`, [
      { text: 'Keep', style: 'cancel' },
      { text: 'Move', onPress: () => void onRelease(o.id) },
    ]);
  const confirmCancel = () =>
    Alert.alert(
      `Cancel ${ref}?`,
      collected
        ? `${driver ?? 'The driver'} already has the food and will be told not to deliver it. The fee and driver pay for this trip stay.`
        : 'The merchant and driver are told. The merchant is not charged.',
      [
        { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: () => void onCancel(o.id) },
      ]
    );

  return (
    <View style={styles.gap8}>
      {showStatus && (
        <Text style={styles.muted} numberOfLines={1}>
          {statusLine(o)}
        </Text>
      )}
      {showStatus && o.attention && <AttentionNote order={o} />}
      {(withDriver || cancellable || o.hasReceipt) && (
        <View style={styles.controlRow}>
          {o.hasReceipt && (
            <Button
              label="Receipt"
              icon="receipt-outline"
              compact
              variant="secondary"
              style={styles.controlButton}
              onPress={() => onReceipt(o)}
            />
          )}
          {withDriver && (
            <Button
              label="Move driver"
              icon="swap-horizontal"
              compact
              variant="secondary"
              style={styles.controlButton}
              onPress={confirmRelease}
            />
          )}
          {cancellable && (
            <Button label="Cancel" icon="close" compact variant="ghost" style={styles.controlButton} onPress={confirmCancel} />
          )}
        </View>
      )}
    </View>
  );
}

function AttentionNote({ order: o }: { order: LiveOrder }) {
  return (
    <View style={styles.attention}>
      <Ionicons name="alert-circle" size={16} color={C.primary} />
      <Text style={styles.attentionText}>
        {o.attention === 'no_driver' ? 'No driver has taken this yet.' : 'Collected but not delivered for a long time.'}
      </Text>
    </View>
  );
}

/* ========================================================================== */
/* Live orders                                                                 */
/* ========================================================================== */

function LiveOrdersScreen({ filter, onFilter }: { filter: OrderFilter; onFilter: (f: OrderFilter) => void }) {
  const { orders, restaurants } = useInThaRoute();
  const [query, setQuery] = useState('');
  const [merchant, setMerchant] = useState('all');
  const [receiptOrder, setReceiptOrder] = useState<LiveOrder | null>(null);

  const counts = useMemo(
    () => Object.fromEntries(ORDER_FILTERS.map((f) => [f.key, orders.filter(f.test).length])) as Record<OrderFilter, number>,
    [orders]
  );

  const shown = useMemo(() => {
    const f = ORDER_FILTERS.find((x) => x.key === filter)!;
    const q = query.trim().toLowerCase();
    return orders.filter(
      (o) =>
        f.test(o) &&
        (merchant === 'all' || o.restaurantId === merchant) &&
        (!q ||
          [o.externalOrderId, o.restaurantName, o.customerName, o.postcode, o.deliveryAddress, o.assignedDriverName ?? '']
            .join(' ')
            .toLowerCase()
            .includes(q))
    );
  }, [orders, filter, query, merchant]);

  const margin = shown
    .filter((o) => o.status !== 'cancelled' && o.dispatchType === 'open_platform')
    .reduce((s, o) => s + marginOf(o), 0);

  return (
    <Screen>
      <SyncBar />
      <SearchBox value={query} onChange={setQuery} placeholder="Order, merchant, customer, postcode, driver" />

      <ChipRow>
        {ORDER_FILTERS.map((f) => (
          <Chip
            key={f.key}
            label={`${f.label} · ${counts[f.key]}`}
            selected={filter === f.key}
            icon={f.key === 'attention' && counts.attention > 0 ? 'alert-circle' : undefined}
            onPress={() => onFilter(f.key)}
          />
        ))}
      </ChipRow>

      {restaurants.length > 1 && (
        <ChipRow>
          <Chip label="All merchants" icon="storefront-outline" selected={merchant === 'all'} onPress={() => setMerchant('all')} />
          {restaurants.map((r) => (
            <Chip key={r.id} label={shortName(r.name)} selected={merchant === r.id} onPress={() => setMerchant(r.id)} />
          ))}
        </ChipRow>
      )}

      <View style={styles.summaryRow}>
        <Text style={styles.mutedStrong}>
          {shown.length} {shown.length === 1 ? 'order' : 'orders'}
        </Text>
        <Text style={styles.profit}>+{formatGbp(margin)} margin</Text>
      </View>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon="receipt-outline"
            title="No orders here"
            subtitle={query ? 'Try a different search.' : 'Orders show up here as soon as they match this filter.'}
          />
        </Card>
      ) : (
        shown.map((o, i) => <OrderCard key={o.id} order={o} index={i} onReceipt={setReceiptOrder} />)
      )}

      <ReceiptSheet order={receiptOrder} as="admin" onClose={() => setReceiptOrder(null)} />
    </Screen>
  );
}

/** Progress through the delivery, for the track on each card. */
const STEP: Record<LiveOrder['status'], number> = {
  preparing: 0,
  ready_for_pickup: 1,
  batched_offered: 1,
  driver_assigned: 2,
  picked_up: 3,
  delivered: 4,
  cancelled: -1,
};
const STEP_LABELS = ['Preparing', 'Ready', 'On the way', 'Collected'];

function OrderCard({ order: o, index, onReceipt }: { order: LiveOrder; index: number; onReceipt: (o: LiveOrder) => void }) {
  const { cancelOrder, releaseOrder } = useInThaRoute();
  const [open, setOpen] = useState(false);
  const inHouse = o.dispatchType === 'own_driver';
  const step = STEP[o.status];
  const prepping = (o.status === 'preparing' || o.status === 'ready_for_pickup') && o.remainingSeconds > 0;

  return (
    <Card style={o.attention ? styles.cardAttention : undefined}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.orderHead}>
        <View style={[styles.sourceTile, { backgroundColor: sourceColor(o.source) }]}>
          <Text style={styles.sourceTileText}>{index + 1}</Text>
          {o.attention && <View style={styles.alertDot} />}
        </View>
        <View style={styles.flexText}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {shortName(o.restaurantName)} · {o.externalOrderId}
          </Text>
          <Text style={styles.mutedStrong} numberOfLines={1}>
            {statusLine(o)}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {sourceLabel(o.source)} · {o.postcode} · {o.distanceMiles.toFixed(1)} mi · {o.createdAtLabel}
          </Text>
        </View>
        <View style={styles.orderRight}>
          {inHouse ? (
            <Badge label="No fee" />
          ) : (
            <Text style={[styles.profit, o.status === 'cancelled' && styles.struck]}>+{formatGbp(marginOf(o))}</Text>
          )}
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.ink3} />
        </View>
      </Pressable>

      {step >= 0 && (
        <View style={styles.gap6}>
          <View style={styles.steps}>
            {STEP_LABELS.map((label, i) => (
              <View key={label} style={styles.stepTrack}>
                <View
                  style={[
                    styles.stepFill,
                    {
                      width: step > i || step >= 4 ? '100%' : step === i ? '50%' : '0%',
                      backgroundColor: step >= 4 ? C.success : C.primary,
                    },
                  ]}
                />
              </View>
            ))}
          </View>
          {prepping && (
            <View style={styles.legend}>
              <Ionicons name="time-outline" size={14} color={C.warning} />
              <Text style={styles.prepText}>Ready in {formatCountdown(o.remainingSeconds)}</Text>
            </View>
          )}
        </View>
      )}

      {o.attention && <AttentionNote order={o} />}

      {open && (
        <View style={styles.details}>
          <Detail icon="storefront-outline" title="Pickup">
            <Text style={styles.cardTitle}>{o.restaurantName}</Text>
            <Text style={styles.cardBody}>
              {o.restaurantAddress}, {o.restaurantPostcode}
            </Text>
            {!!o.restaurantPhone && <Text style={styles.cardBody}>{o.restaurantPhone}</Text>}
            {!!o.restaurantPickupNote && <Text style={styles.italic}>“{o.restaurantPickupNote}”</Text>}
          </Detail>
          <Detail icon="location-outline" title="Drop-off">
            <Text style={styles.cardTitle}>{o.customerName}</Text>
            <Text style={styles.cardBody}>
              {o.deliveryAddress}, {o.postcode}
            </Text>
            {!!o.deliveryInstructions && <Text style={styles.italic}>“{o.deliveryInstructions}”</Text>}
          </Detail>
          <Detail icon="call-outline" title="Contact & driver">
            <Text style={styles.cardBody}>
              {o.customerPhone}
              {o.phoneAccessCode ? ` · code ${o.phoneAccessCode}` : ''}
            </Text>
            {!!o.directCustomerPhone && <Text style={styles.cardBody}>Direct: {o.directCustomerPhone}</Text>}
            <Text style={styles.cardBody}>
              {o.assignedDriverName
                ? `${o.assignedDriverName} · ${o.assignedDriverType === 'restaurant_own' ? 'in-house' : 'platform'}`
                : inHouse
                ? 'In-house driver'
                : o.hybrid
                ? 'Open to in-house and platform drivers'
                : 'Platform pool'}
            </Text>
            {!inHouse && (
              <Text style={styles.muted}>
                {formatGbp(o.restaurantFeeGbp)} in · {formatGbp(o.driverPayoutGbp)} out
              </Text>
            )}
          </Detail>
          {o.items.length > 0 && (
            <View style={styles.items}>
              {o.items.map((it, i) => (
                <View key={i} style={styles.rowBetween}>
                  <Text style={[styles.cardBody, styles.flex1]} numberOfLines={2}>
                    <Text style={styles.cardTitle}>{it.quantity}×</Text> {it.name}
                  </Text>
                  <Text style={styles.cardBody}>{formatGbp(it.price)}</Text>
                </View>
              ))}
              <Divider />
              <View style={styles.rowBetween}>
                <Text style={styles.cardTitle}>Order total</Text>
                <Text style={styles.cardTitle}>{formatGbp(o.orderTotalGbp)}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      <OrderControls order={o} onCancel={cancelOrder} onRelease={releaseOrder} onReceipt={onReceipt} showStatus={false} />
    </Card>
  );
}

function Detail({
  icon,
  title,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.gap4}>
      <View style={styles.legend}>
        <Ionicons name={icon} size={14} color={C.ink3} />
        <Text style={styles.detailTitle}>{title.toUpperCase()}</Text>
      </View>
      {children}
    </View>
  );
}

/* ========================================================================== */
/* Pricing                                                                     */
/* ========================================================================== */

function PricingScreen() {
  const { algorithm, pricingSummary, updateAlgorithmConfig, updateSteppedPayoutAt } = useInThaRoute();
  const [size, setSize] = useState('2');
  const n = Number(size);

  // Simulator and "you keep" figures are calculated on the server.
  const sim = pricingSummary?.simulations.find((s) => s.orders === n);
  const restaurantsPay = sim?.restaurantsPayGbp ?? 0;
  const driverEarns = sim?.driverEarnsGbp ?? 0;
  const profit = sim?.profitGbp ?? 0;
  const driverShare = sim?.driverShare ?? 0;

  useEffect(() => {
    if (n > algorithm.maxBatchSize) setSize(String(algorithm.maxBatchSize));
  }, [n, algorithm.maxBatchSize]);

  const setFee = (delta: number) =>
    updateAlgorithmConfig({
      baseRestaurantChargeGbp: Math.max(2.5, Math.min(12, +(algorithm.baseRestaurantChargeGbp + delta).toFixed(2))),
    });
  // Keeps a setting inside the limits the server accepts, rounded to pennies / tenths.
  const nudge = (key: 'baseDistanceMiles' | 'extraMileRestaurantChargeGbp' | 'extraMileDriverPayoutGbp' | 'offerRadiusMiles', delta: number, min: number, max: number) =>
    updateAlgorithmConfig({ [key]: Math.max(min, Math.min(max, +(algorithm[key] + delta).toFixed(2))) });
  const setMax = (delta: number) => {
    const next = Math.max(1, Math.min(8, algorithm.maxBatchSize + delta));
    updateAlgorithmConfig({ maxBatchSize: next });
    if (n > next) setSize(String(next));
  };
  const setTier = (i: number, delta: number) =>
    updateSteppedPayoutAt(i, Math.max(1, Math.min(8, +(algorithm.steppedDriverPayoutsGbp[i] + delta).toFixed(2))));

  const sizeOptions = Array.from({ length: algorithm.maxBatchSize }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1}`,
  }));

  const tiers = algorithm.steppedDriverPayoutsGbp.slice(0, algorithm.maxBatchSize);
  const keepAt = (i: number) => pricingSummary?.tiers[i]?.platformKeepsGbp ?? algorithm.baseRestaurantChargeGbp - tiers[i];
  const tierMax = Math.max(0.01, ...tiers.map((pay, i) => pay + Math.max(0, keepAt(i))));

  return (
    <Screen>
      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Batch simulator</Text>
          <Text style={styles.muted}>Orders per run</Text>
        </View>
        <Segmented value={size} onChange={setSize} options={sizeOptions} />

        <View style={styles.splitBar}>
          <View style={[styles.splitDriver, { flex: driverShare }]} />
          <View style={[styles.splitProfit, { flex: 1 - driverShare }]} />
        </View>

        <View style={styles.gap10}>
          <View style={styles.rowBetween}>
            <Text style={styles.cardBody}>Merchants pay</Text>
            <Text style={styles.cardTitle}>{formatGbp(restaurantsPay)}</Text>
          </View>
          <View style={styles.rowBetween}>
            <View style={styles.legend}>
              <View style={[styles.legendDot, { backgroundColor: C.ink }]} />
              <Text style={styles.cardBody}>Driver earns</Text>
            </View>
            <Text style={styles.cardTitle}>{formatGbp(driverEarns)}</Text>
          </View>
          <Divider />
          <View style={styles.rowBetween}>
            <View style={styles.legend}>
              <View style={[styles.legendDot, { backgroundColor: C.success }]} />
              <Text style={styles.cardTitle}>Your profit</Text>
            </View>
            <Text style={styles.profitLarge}>{formatGbp(profit)}</Text>
          </View>
        </View>
      </Card>

      <SectionLabel>Rates</SectionLabel>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Merchant fee</Text>
            <Text style={styles.muted}>Per order</Text>
          </View>
          <Stepper
            name="Merchant fee"
            value={formatGbp(algorithm.baseRestaurantChargeGbp)}
            onDecrement={() => setFee(-0.25)}
            onIncrement={() => setFee(0.25)}
          />
        </View>
        <Divider />
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Included distance</Text>
            <Text style={styles.muted}>Covered by the fee</Text>
          </View>
          <Stepper
            name="Included distance"
            value={`${algorithm.baseDistanceMiles} mi`}
            onDecrement={() => nudge('baseDistanceMiles', -0.5, 0.5, 20)}
            onIncrement={() => nudge('baseDistanceMiles', 0.5, 0.5, 20)}
          />
        </View>
        <Divider />
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Extra mile · merchant</Text>
            <Text style={styles.muted}>Charged per mile beyond</Text>
          </View>
          <Stepper
            name="Extra mile merchant"
            value={formatGbp(algorithm.extraMileRestaurantChargeGbp)}
            onDecrement={() => nudge('extraMileRestaurantChargeGbp', -0.05, 0, 10)}
            onIncrement={() => nudge('extraMileRestaurantChargeGbp', 0.05, 0, 10)}
          />
        </View>
        <Divider />
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Extra mile · driver</Text>
            <Text style={styles.muted}>Paid per mile beyond</Text>
          </View>
          <Stepper
            name="Extra mile driver"
            value={formatGbp(algorithm.extraMileDriverPayoutGbp)}
            onDecrement={() => nudge('extraMileDriverPayoutGbp', -0.05, 0, 10)}
            onIncrement={() => nudge('extraMileDriverPayoutGbp', 0.05, 0, 10)}
          />
        </View>
      </Card>

      <SectionLabel>Drivers</SectionLabel>
      <Card>
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Max batch</Text>
            <Text style={styles.muted}>Orders a driver holds at once</Text>
          </View>
          <Stepper
            name="Max batch"
            value={`${algorithm.maxBatchSize}`}
            onDecrement={() => setMax(-1)}
            onIncrement={() => setMax(1)}
          />
        </View>
        <Divider />
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Driver radius</Text>
            <Text style={styles.muted}>Who sees a new order</Text>
          </View>
          <Stepper
            name="Driver radius"
            value={`${algorithm.offerRadiusMiles} mi`}
            onDecrement={() => nudge('offerRadiusMiles', -0.5, 0.5, 20)}
            onIncrement={() => nudge('offerRadiusMiles', 0.5, 0.5, 20)}
          />
        </View>
      </Card>

      <SectionLabel>Pay per order in a run</SectionLabel>
      <Card>
        <View style={styles.tierChart}>
          {tiers.map((pay, i) => {
            const keep = keepAt(i);
            return (
              <View key={i} style={styles.tierCol}>
                <Text style={styles.tierKeep}>+{formatGbp(keep)}</Text>
                <View style={styles.tierTrack}>
                  <View style={[styles.tierKeepFill, { height: `${(Math.max(0, keep) / tierMax) * 100}%` }]} />
                  <View style={[styles.tierPayFill, { height: `${(pay / tierMax) * 100}%` }]} />
                </View>
                <Text style={styles.tierPay}>{formatGbp(pay)}</Text>
                <Text style={styles.columnLabel}>{ORDINALS[i]}</Text>
              </View>
            );
          })}
        </View>
        <View style={styles.mapFooterTight}>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.ink }]} />
            <Text style={styles.muted}>Driver pay</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.success }]} />
            <Text style={styles.muted}>You keep</Text>
          </View>
        </View>
      </Card>

      <SectionLabel>Driver pay per order</SectionLabel>
      <Card>
        {tiers.map((pay, i) => (
          <View key={i} style={styles.gap12}>
            {i > 0 && <Divider />}
            <View style={styles.settingRow}>
              <View style={styles.flexText}>
                <Text style={styles.cardTitle}>{ORDINALS[i]} order</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  You keep {formatGbp(keepAt(i))}
                </Text>
              </View>
              <Stepper
                name={`${ORDINALS[i]} order pay`}
                value={formatGbp(pay)}
                onDecrement={() => setTier(i, -0.1)}
                onIncrement={() => setTier(i, 0.1)}
              />
            </View>
          </View>
        ))}
      </Card>
    </Screen>
  );
}

/* ========================================================================== */
/* Drivers                                                                     */
/* ========================================================================== */

type DriverFilter = 'all' | 'pending' | 'active' | 'rejected';

function DriversScreen() {
  const { drivers, approveDriverKyc, rejectDriverKyc } = useInThaRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DriverFilter>('all');
  // Reject: an optional reason the driver is shown.
  const [rejecting, setRejecting] = useState<DriverProfile | null>(null);
  const [reason, setReason] = useState('');
  // The uploaded photos of one driver, stepped through one at a time.
  const [viewer, setViewer] = useState<{ docs: KycDocument[]; index: number } | null>(null);
  const photoDoc = viewer ? viewer.docs[viewer.index] : null;
  const openPhoto = (d: DriverProfile, doc: KycDocument) => {
    const docs = d.kycDocuments.filter((k) => k.hasFile);
    setViewer({ docs, index: Math.max(0, docs.findIndex((k) => k.id === doc.id)) });
  };
  const step = (by: number) => setViewer((v) => v && { ...v, index: v.index + by });

  const approve = async (d: DriverProfile) => {
    setBusy(`approve-${d.id}`);
    await approveDriverKyc(d.id);
    setBusy(null);
  };

  const confirmReject = async () => {
    const d = rejecting;
    if (!d) return;
    setBusy(`reject-${d.id}`);
    const ok = await rejectDriverKyc(d.id, reason.trim() || undefined);
    setBusy(null);
    if (ok) {
      setRejecting(null);
      setReason('');
    }
  };

  const isApproved = (d: DriverProfile) => (d.approval ? d.approval === 'approved' : d.status === 'approved_online');
  const stateOf = (d: DriverProfile): Exclude<DriverFilter, 'all'> =>
    d.approval === 'rejected' ? 'rejected' : isApproved(d) && !needsReview(d) ? 'active' : 'pending';

  const matches = (d: DriverProfile) => {
    const q = query.trim().toLowerCase();
    return (
      !q ||
      [d.name, d.email, d.phone, d.plateNumber, d.employerRestaurantName ?? ''].join(' ').toLowerCase().includes(q)
    );
  };

  const platform = drivers.filter((d) => d.driverType === 'platform_contracted');
  const inHouse = drivers.filter((d) => d.driverType === 'restaurant_own');
  const [tab, setTab] = useState<'platform' | 'inhouse'>('platform');
  const [expanded, setExpanded] = useState<string | null>(
    platform.find((d) => d.approval === 'pending')?.id ?? null
  );

  const statusCounts: Record<DriverFilter, number> = {
    all: platform.length,
    pending: platform.filter((d) => stateOf(d) === 'pending').length,
    active: platform.filter((d) => stateOf(d) === 'active').length,
    rejected: platform.filter((d) => stateOf(d) === 'rejected').length,
  };
  const shownPlatform = platform.filter((d) => matches(d) && (statusFilter === 'all' || stateOf(d) === statusFilter));
  const shownInHouse = inHouse.filter(matches);

  return (
    <Screen>
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'platform', label: `Platform · ${platform.length}` },
          { value: 'inhouse', label: `In-house · ${inHouse.length}` },
        ]}
      />
      <SearchBox value={query} onChange={setQuery} placeholder="Name, email, phone or plate" />

      {tab === 'platform' && (
        <ChipRow>
          {(
            [
              ['all', 'All'],
              ['pending', 'To review'],
              ['active', 'Active'],
              ['rejected', 'Rejected'],
            ] as const
          ).map(([key, label]) => (
            <Chip
              key={key}
              label={`${label} · ${statusCounts[key]}`}
              selected={statusFilter === key}
              onPress={() => setStatusFilter(key)}
            />
          ))}
        </ChipRow>
      )}

      {tab === 'platform' ? (
        shownPlatform.length === 0 ? (
          <Card>
            <EmptyState icon="people-outline" title="No drivers found" subtitle={query ? 'Try a different search.' : undefined} />
          </Card>
        ) : (
          shownPlatform.map((d) => {
            const verified = d.kycDocuments.filter((k) => k.status === 'verified').length;
            const total = d.kycDocuments.length;
            const approved = isApproved(d);
            const rejected = d.approval === 'rejected';
            const missing = d.kycDocuments.some((k) => k.status === 'missing');
            // An approved driver who uploads a new or replaced document still needs it checked.
            const toVerify = approved && d.kycDocuments.some((k) => k.status === 'pending');
            const open = expanded === d.id;
            return (
              <Card key={d.id}>
                <ListRow
                  left={<OnlineAvatar name={d.name} tone={approved ? 'success' : 'warning'} online={!!d.isOnline} />}
                  title={d.name}
                  subtitle={`${VEHICLE_SHORT[d.vehicle]} · ${d.plateNumber}`}
                  right={
                    toVerify ? (
                      <Badge label="Check docs" tone="warning" />
                    ) : (
                      <Badge
                        label={approved ? 'Active' : rejected ? 'Rejected' : 'Pending'}
                        tone={approved ? 'success' : rejected ? 'primary' : 'warning'}
                      />
                    )
                  }
                />
                <DriverMeta driver={d} />

                <Pressable onPress={() => setExpanded(open ? null : d.id)} style={styles.docsToggle}>
                  <View style={styles.flexText}>
                    <Text style={styles.mutedStrong}>
                      {verified} of {total} documents
                    </Text>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          {
                            width: `${(verified / Math.max(total, 1)) * 100}%`,
                            backgroundColor: verified === total ? C.success : C.warning,
                          },
                        ]}
                      />
                    </View>
                  </View>
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.ink3} />
                </Pressable>

                {open &&
                  d.kycDocuments.map((doc) => (
                    <Pressable
                      key={doc.id}
                      style={styles.docRow}
                      disabled={!doc.hasFile}
                      onPress={() => openPhoto(d, doc)}>
                      <Ionicons
                        name={
                          doc.status === 'verified'
                            ? 'checkmark-circle'
                            : doc.status === 'missing'
                            ? 'close-circle'
                            : 'time'
                        }
                        size={18}
                        color={
                          doc.status === 'verified' ? C.success : doc.status === 'missing' ? C.primary : C.warning
                        }
                      />
                      <Text style={styles.docTitle} numberOfLines={1}>
                        {cleanTitle(doc.title)}
                      </Text>
                      {doc.hasFile ? (
                        <Text style={styles.docView}>View</Text>
                      ) : (
                        <Text style={styles.muted}>Not uploaded</Text>
                      )}
                    </Pressable>
                  ))}

                {(!approved || toVerify) && (
                  <View style={styles.actionRow}>
                    {!approved && !rejected && (
                      <Button
                        label="Reject"
                        variant="secondary"
                        icon="close"
                        loading={busy === `reject-${d.id}`}
                        disabled={!!busy}
                        onPress={() => {
                          setReason('');
                          setRejecting(d);
                        }}
                        style={styles.flex1}
                      />
                    )}
                    <Button
                      label={approved ? 'Verify documents' : 'Approve driver'}
                      variant="success"
                      icon="checkmark"
                      loading={busy === `approve-${d.id}`}
                      disabled={!!busy || (!approved && missing) || d.kycDocuments.length === 0}
                      onPress={() => approve(d)}
                      style={styles.flex2}
                    />
                  </View>
                )}
              </Card>
            );
          })
        )
      ) : shownInHouse.length === 0 ? (
        <Card>
          <EmptyState icon="people-outline" title="No in-house drivers found" />
        </Card>
      ) : (
        <Card>
          {shownInHouse.map((d, i) => (
            <View key={d.id} style={styles.gap12}>
              {i > 0 && <Divider />}
              <ListRow
                left={<OnlineAvatar name={d.name} tone="info" online={!!d.isOnline} />}
                title={d.name}
                subtitle={`${shortName(d.employerRestaurantName ?? '')} · ${VEHICLE_SHORT[d.vehicle]}`}
                right={<Badge label="No docs" tone="info" />}
              />
              <DriverMeta driver={d} />
            </View>
          ))}
        </Card>
      )}

      <Sheet visible={!!rejecting} onClose={() => setRejecting(null)} title={rejecting ? `Reject ${rejecting.name}?` : ''}>
        <Text style={styles.cardBody}>Their documents are cleared and they will be asked to upload them again.</Text>
        <Field
          label="Reason (optional)"
          value={reason}
          onChangeText={setReason}
          placeholder="e.g. The licence photo is blurry"
          multiline
          maxLength={300}
        />
        <View style={styles.actionRow}>
          <Button label="Keep" variant="secondary" onPress={() => setRejecting(null)} style={styles.flex1} />
          <Button
            label="Reject driver"
            variant="primary"
            icon="close"
            loading={!!rejecting && busy === `reject-${rejecting.id}`}
            onPress={confirmReject}
            style={styles.flex2}
          />
        </View>
      </Sheet>

      <Sheet
        visible={!!photoDoc}
        onClose={() => setViewer(null)}
        title={photoDoc ? cleanTitle(photoDoc.title) : ''}>
        {viewer && photoDoc && (
          <>
            <Text style={styles.muted}>Should show: {photoDoc.subtitle}</Text>
            <DocumentPhoto key={photoDoc.id} doc={photoDoc} />
            {viewer.docs.length > 1 && (
              <View style={styles.actionRow}>
                <Button
                  label="Previous"
                  variant="secondary"
                  icon="chevron-back"
                  disabled={viewer.index === 0}
                  onPress={() => step(-1)}
                  style={styles.flex1}
                />
                <Text style={styles.viewerCount}>
                  {viewer.index + 1} of {viewer.docs.length}
                </Text>
                <Button
                  label="Next"
                  variant="secondary"
                  icon="chevron-forward"
                  disabled={viewer.index === viewer.docs.length - 1}
                  onPress={() => step(1)}
                  style={styles.flex1}
                />
              </View>
            )}
          </>
        )}
      </Sheet>
    </Screen>
  );
}

function OnlineAvatar({ name, tone, online }: { name: string; tone: 'success' | 'warning' | 'info'; online: boolean }) {
  return (
    <View>
      <Avatar name={name} tone={tone} />
      {online && <View style={styles.onlineDot} accessibilityLabel="Online" />}
    </View>
  );
}

/** Rating, deliveries, orders on hand, and how to reach the driver. */
function DriverMeta({ driver: d }: { driver: DriverProfile }) {
  return (
    <View style={styles.gap4}>
      <View style={styles.inlineStats}>
        <View style={styles.legend}>
          <Ionicons name="star" size={13} color={C.warning} />
          <Text style={styles.mutedStrong}>{d.rating ? d.rating.toFixed(1) : '–'}</Text>
        </View>
        <View style={styles.legend}>
          <Ionicons name="checkmark-done-outline" size={14} color={C.ink3} />
          <Text style={styles.muted}>{d.completedDeliveries} deliveries</Text>
        </View>
        {!!d.activeOrders && (
          <View style={styles.legend}>
            <Ionicons name="flash-outline" size={14} color={C.ink3} />
            <Text style={styles.muted}>{d.activeOrders} on hand</Text>
          </View>
        )}
        <Text style={[styles.muted, { color: d.isOnline ? C.success : C.ink3 }]}>{d.isOnline ? 'Online' : 'Offline'}</Text>
      </View>
      {(!!d.email || !!d.phone) && (
        <Text style={styles.muted} numberOfLines={1}>
          {[d.phone, d.email].filter(Boolean).join(' · ')}
        </Text>
      )}
    </View>
  );
}

/** The photo, PDF or .docx file a driver uploaded, fetched with the admin's sign-in. */
function DocumentPhoto({ doc }: { doc: KycDocument }) {
  return (
    <View style={styles.gap10}>
      <UploadedFile doc={doc} path={`/api/admin/kyc-documents/${doc.id}/file`} />
      <Text style={[styles.muted, styles.centerText]}>{doc.updatedAt}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Restaurants                                                                 */
/* ========================================================================== */

const POLICY_LABEL: Record<DriverPolicy, string> = {
  open_platform: 'Platform drivers',
  hybrid: 'Hybrid',
  own_drivers: 'Own drivers only',
};

const POLICY_HELP: Record<DriverPolicy, string> = {
  open_platform: 'Orders go to platform drivers.',
  hybrid: 'Orders go to the merchant’s own drivers and platform drivers.',
  own_drivers: 'Only the merchant’s own drivers deliver. No platform fee.',
};

function RestaurantsScreen() {
  const { restaurants, algorithm, setMerchantActive } = useInThaRoute();
  const [query, setQuery] = useState('');
  const [policy, setPolicy] = useState<DriverPolicy | 'all' | 'disabled'>('all');
  const [feeFor, setFeeFor] = useState<RestaurantPartner | null>(null);
  const [creditsFor, setCreditsFor] = useState<RestaurantPartner | null>(null);
  const disabledCount = restaurants.filter((r) => r.isActive === false).length;

  const toggleActive = (r: RestaurantPartner) => {
    if (r.isActive === false) {
      setMerchantActive(r.id, true);
      return;
    }
    Alert.alert(
      `Disable ${shortName(r.name)}?`,
      'They are signed out on the web and in the app straight away and can’t sign in until you enable them again. Their orders, drivers and credits are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disable', style: 'destructive', onPress: () => setMerchantActive(r.id, false) },
      ]
    );
  };

  const counts = {
    open_platform: restaurants.filter((r) => r.driverPolicy === 'open_platform').length,
    hybrid: restaurants.filter((r) => r.driverPolicy === 'hybrid').length,
    own_drivers: restaurants.filter((r) => r.driverPolicy === 'own_drivers').length,
  };
  const q = query.trim().toLowerCase();
  const shown = restaurants.filter(
    (r) =>
      (policy === 'all' || (policy === 'disabled' ? r.isActive === false : r.driverPolicy === policy)) &&
      (!q ||
        [r.name, r.address, r.postcode, r.phone, r.ownerName ?? '', r.ownerEmail ?? ''].join(' ').toLowerCase().includes(q))
  );

  return (
    <Screen>
      <SearchBox value={query} onChange={setQuery} placeholder="Merchant, address or postcode" />
      <ChipRow>
        <Chip label={`All · ${restaurants.length}`} selected={policy === 'all'} onPress={() => setPolicy('all')} />
        <Chip label={`Platform · ${counts.open_platform}`} selected={policy === 'open_platform'} onPress={() => setPolicy('open_platform')} />
        <Chip label={`Hybrid · ${counts.hybrid}`} selected={policy === 'hybrid'} onPress={() => setPolicy('hybrid')} />
        <Chip label={`Own · ${counts.own_drivers}`} selected={policy === 'own_drivers'} onPress={() => setPolicy('own_drivers')} />
        {disabledCount > 0 && (
          <Chip label={`Disabled · ${disabledCount}`} selected={policy === 'disabled'} onPress={() => setPolicy('disabled')} />
        )}
      </ChipRow>

      {shown.length === 0 && (
        <Card>
          <EmptyState icon="storefront-outline" title="No merchants found" />
        </Card>
      )}

      {shown.map((r) => (
        <Card key={r.id} style={r.isActive === false ? styles.cardDisabled : undefined}>
          <ListRow
            left={<IconTile icon="storefront-outline" tone="primary" />}
            title={shortName(r.name)}
            subtitle={`${r.address} · ${r.postcode}`}
            right={r.isActive === false ? <Badge label="Disabled" tone="primary" icon="ban-outline" /> : undefined}
          />
          {!!(r.ownerName || r.ownerEmail) && (
            <View style={[styles.legend, styles.indent]}>
              <Ionicons name="person-outline" size={14} color={C.ink3} />
              <Text style={styles.muted} numberOfLines={1}>
                {[r.ownerName, r.ownerEmail].filter(Boolean).join(' · ')}
              </Text>
            </View>
          )}
          {!!r.phone && (
            <View style={[styles.legend, styles.indent]}>
              <Ionicons name="call-outline" size={14} color={C.ink3} />
              <Text style={styles.muted}>{r.phone}</Text>
            </View>
          )}
          <View style={styles.merchantStats}>
            <View style={styles.merchantStat}>
              <View style={styles.legend}>
                <Ionicons name="flash" size={14} color={C.primary} />
                <Text style={styles.fleetValue}>{r.activeOrdersCount}</Text>
              </View>
              <Text style={styles.muted}>Live now</Text>
            </View>
            <View style={styles.merchantStat}>
              <View style={styles.legend}>
                <Ionicons name="checkmark-done" size={14} color={C.success} />
                <Text style={styles.fleetValue}>{r.completedTodayCount}</Text>
              </View>
              <Text style={styles.muted}>Delivered today</Text>
            </View>
          </View>
          {/* Who delivers is the merchant's own choice (their Delivery settings); admins only see it. */}
          <Text style={styles.detailTitle}>WHO DELIVERS</Text>
          <View style={styles.legend}>
            <Badge label={POLICY_LABEL[r.driverPolicy]} tone="info" />
            <Text style={styles.muted}>Set by the merchant</Text>
          </View>
          <Hint>{POLICY_HELP[r.driverPolicy]}</Hint>
          {!!r.pickupSafetyNote && (
            <View style={styles.pickupNote}>
              <Text style={styles.cardBody}>
                <Text style={styles.pickupNoteLabel}>Pickup note: </Text>
                {r.pickupSafetyNote}
              </Text>
            </View>
          )}
          <View style={styles.merchantStats}>
            <Pressable
              onPress={() => setFeeFor(r)}
              accessibilityRole="button"
              accessibilityLabel={`Change ${shortName(r.name)}’s delivery fee`}
              style={({ pressed }) => [styles.editTile, pressed && styles.pressed]}>
              <View style={styles.rowBetween}>
                <Text style={styles.detailTitle}>FEE</Text>
                <Ionicons name="pencil" size={13} color={C.ink3} />
              </View>
              <Text style={styles.fleetValue}>{formatGbp(r.feePerDeliveryGbp ?? algorithm.baseRestaurantChargeGbp)}</Text>
              <Text style={[styles.mutedStrong, r.customFeeGbp != null && { color: C.info }]}>
                {r.customFeeGbp != null ? 'Custom rate' : 'Standard'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setCreditsFor(r)}
              accessibilityRole="button"
              accessibilityLabel={`Adjust ${shortName(r.name)}’s credits`}
              style={({ pressed }) => [styles.editTile, pressed && styles.pressed]}>
              <View style={styles.rowBetween}>
                <Text style={styles.detailTitle}>CREDITS</Text>
                <Ionicons name="pencil" size={13} color={C.ink3} />
              </View>
              <Text style={[styles.fleetValue, isLowOnCredits(r) && { color: C.primary }]}>
                {(r.credits?.available ?? 0).toFixed(2)}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {`${r.credits?.deliveriesLeft == null ? '—' : `≈ ${r.credits.deliveriesLeft} left`} · ${(r.credits?.usedCredits ?? 0).toFixed(0)} used`}
              </Text>
            </Pressable>
          </View>
          <Button
            label={r.isActive === false ? 'Enable merchant' : 'Disable merchant'}
            icon="power"
            variant={r.isActive === false ? 'success' : 'secondary'}
            compact
            onPress={() => toggleActive(r)}
          />
        </Card>
      ))}

      <FeeSheet merchant={feeFor} onClose={() => setFeeFor(null)} />
      <CreditAdjustSheet merchant={creditsFor} onClose={() => setCreditsFor(null)} />
    </Screen>
  );
}

/* ========================================================================== */
/* Styles                                                                      */
/* ========================================================================== */

const styles = StyleSheet.create({
  flexText: { flex: 1, minWidth: 0, gap: 4 },
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  actionRow: { flexDirection: 'row', gap: 10 },
  centerText: { textAlign: 'center' },
  gap4: { gap: 4 },
  gap6: { gap: 6 },
  gap8: { gap: 8 },
  gap10: { gap: 10 },
  gap12: { gap: 12 },
  noPad: { padding: 0, gap: 0, overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pressed: { opacity: 0.7 },
  indent: { paddingLeft: 2 },

  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  cardBody: { ...Brand.type.body, color: C.ink2 },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  mutedStrong: { ...Brand.type.captionStrong, color: C.ink2 },
  italic: { ...Brand.type.caption, color: C.ink2, fontStyle: 'italic' },
  link: { ...Brand.type.captionStrong, color: C.primary },
  struck: { color: C.ink3, textDecorationLine: 'line-through' },
  attention: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: C.primarySoft,
  },
  attentionText: { ...Brand.type.caption, color: C.ink, flex: 1 },
  controlRow: { flexDirection: 'row', gap: 8 },
  controlButton: { flex: 1 },

  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: Brand.radius.pill,
    backgroundColor: C.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  syncDot: { width: 8, height: 8, borderRadius: 4 },
  syncText: { ...Brand.type.captionStrong, color: C.ink2 },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: Brand.radius.md,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.lineStrong,
  },
  searchInput: { flex: 1, ...Brand.type.body, color: C.ink, paddingVertical: 0 },
  chipScroll: { flexGrow: 0, marginHorizontal: -16 },
  chipRow: { gap: 8, paddingHorizontal: 16 },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },

  map: { height: 240 },
  mapFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 14 },
  mapFooterTight: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },

  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },

  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  indexDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  profit: { ...Brand.type.bodyStrong, color: C.success },
  profitLarge: { ...Brand.type.heading, color: C.success },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  fleetTile: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: Brand.radius.lg,
    backgroundColor: C.surface,
    ...Brand.shadow.card,
  },
  fleetIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fleetValue: { ...Brand.type.heading, color: C.ink },

  donutRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  donutCenter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  donutValue: { ...Brand.type.heading, color: C.ink },
  columns: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, height: 150 },
  column: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  columnTrack: {
    flex: 1,
    width: '100%',
    maxWidth: 40,
    borderRadius: 8,
    backgroundColor: C.surfaceAlt,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  columnFill: { width: '100%', borderRadius: 8 },
  columnLabel: { fontSize: 11, fontWeight: '600', color: C.ink3 },
  barTrack: { height: 8, borderRadius: 4, backgroundColor: C.surfaceAlt, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: C.primary },

  cardAttention: { borderWidth: 1, borderColor: C.primaryLine },
  orderHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderRight: { alignItems: 'flex-end', gap: 4 },
  sourceTile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sourceTileText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  alertDot: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: C.primary,
    borderWidth: 2,
    borderColor: C.surface,
  },
  steps: { flexDirection: 'row', gap: 5 },
  stepTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.surfaceAlt, overflow: 'hidden' },
  stepFill: { height: 4, borderRadius: 2 },
  prepText: { ...Brand.type.captionStrong, color: C.warning },
  details: { gap: 14, paddingTop: 2 },
  detailTitle: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: C.ink3 },
  items: { gap: 6, padding: 12, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },

  splitBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: C.line },
  splitDriver: { backgroundColor: C.ink },
  splitProfit: { backgroundColor: C.success },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tierChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 190 },
  tierCol: { flex: 1, alignItems: 'center', gap: 4, height: '100%' },
  tierTrack: {
    flex: 1,
    width: '100%',
    maxWidth: 36,
    borderRadius: 8,
    backgroundColor: C.surfaceAlt,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  tierKeepFill: { width: '100%', backgroundColor: C.success },
  tierPayFill: { width: '100%', backgroundColor: C.ink },
  tierKeep: { fontSize: 10, fontWeight: '700', color: C.success },
  tierPay: { fontSize: 11, fontWeight: '700', color: C.ink },

  docsToggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 2 },
  docTitle: { ...Brand.type.caption, color: C.ink, flex: 1 },
  docView: { ...Brand.type.captionStrong, color: C.primary },
  viewerCount: { ...Brand.type.captionStrong, color: C.ink2, alignSelf: 'center' },
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

  inlineStats: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, paddingLeft: 2 },
  merchantStats: { flexDirection: 'row', gap: 10 },
  merchantStat: { flex: 1, gap: 2, padding: 12, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },
  editTile: { flex: 1, gap: 2, padding: 12, borderRadius: Brand.radius.md, borderWidth: 1, borderColor: C.line },
  cardDisabled: { opacity: 0.7 },
  pickupNote: { padding: 10, borderRadius: 10, backgroundColor: C.warningSoft },
  pickupNoteLabel: { ...Brand.type.captionStrong, color: C.warning },
});
