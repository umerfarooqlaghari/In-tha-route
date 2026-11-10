import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LiveMap, MapPin } from '@/components/LiveMap';
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Hint,
  IconButton,
  IconTile,
  ListRow,
  Screen,
  SectionLabel,
  Sheet,
  SourceBadge,
  Stat,
} from '@/components/ui';
import { Brand, formatCountdown, formatGbp } from '@/constants/brand';
import { coordsForPostcode, DRIVER_START, LatLng } from '@/constants/geo';
import { KycDocument, LiveOrder, useInThaRoute } from '@/context/InThaRouteContext';
import { chooseImage } from '@/utils/pickImage';

const C = Brand.colors;

export function DriverView() {
  const { activeScreen } = useInThaRoute();
  switch (activeScreen) {
    case 'open_pool':
      return <OrderPoolScreen />;
    case 'earnings':
      return <EarningsScreen />;
    case 'kyc_docs':
      return <DocumentsScreen />;
    default:
      return <DriveScreen />;
  }
}

/* ========================================================================== */
/* Helpers                                                                     */
/* ========================================================================== */

interface Stop {
  key: string;
  type: 'pickup' | 'dropoff';
  order: LiveOrder;
  coordinate: LatLng;
}

function useActiveBatch() {
  const { orders, currentBatchId } = useInThaRoute();
  return useMemo(() => {
    const inBatch = (o: LiveOrder) => !!currentBatchId && o.batchId === currentBatchId;
    const batch = orders
      .filter((o) => inBatch(o) && o.status !== 'delivered')
      .sort((a, b) => (a.batchPosition ?? 0) - (b.batchPosition ?? 0));
    const stops: Stop[] = [
      ...batch.map((o) => ({
        key: `p-${o.id}`,
        type: 'pickup' as const,
        order: o,
        coordinate: coordsForPostcode(o.restaurantPostcode),
      })),
      ...batch.map((o) => ({
        key: `d-${o.id}`,
        type: 'dropoff' as const,
        order: o,
        coordinate: coordsForPostcode(o.postcode),
      })),
    ];
    const delivered = orders.filter((o) => inBatch(o) && o.status === 'delivered');
    return { batch, stops, delivered };
  }, [orders, currentBatchId]);
}

/** Opens the phone dialer. */
const callNumber = (phone?: string) => {
  const digits = (phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) {
    Alert.alert('No phone number', 'There is no phone number for this stop.');
    return;
  }
  Linking.openURL(`tel:${digits}`).catch(() => {});
};

/** Shows a spinner on a button while its request runs, and ignores double taps. */
function useBusy() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

const shortArea = (address: string) => {
  const parts = address.split(',').map((p) => p.trim());
  return parts[parts.length - 1] || address;
};

/* ========================================================================== */
/* Drive — map + bottom sheet                                                  */
/* ========================================================================== */

function DriveScreen() {
  const insets = useSafeAreaInsets();
  const {
    driverBatchStatus,
    activeStopIndex,
    acceptCurrentBatch,
    declineCurrentBatch,
    advanceActiveStop,
    findNewOrders,
    setActiveScreen,
    isOnline: online,
    setOnline,
    myLocation,
    routeEstimate,
    orders,
  } = useInThaRoute();
  const { batch, stops, delivered } = useActiveBatch();
  const { busy, run } = useBusy();
  const [sheetHeight, setSheetHeight] = useState(320);
  const toggleOnline = () => run('online', () => setOnline(!online));

  const navigating = driverBatchStatus === 'accepted_navigating' && batch.length > 0;
  const offered = driverBatchStatus === 'offered' && batch.length > 0;
  const completed = driverBatchStatus === 'accepted_navigating' && batch.length === 0;

  const stopIndex = Math.min(activeStopIndex, Math.max(stops.length - 1, 0));
  const current = stops[stopIndex];
  // Real GPS position when available; otherwise the last stop reached, or the area default.
  const driverPos: LatLng =
    myLocation ?? (navigating && stopIndex > 0 ? stops[stopIndex - 1].coordinate : DRIVER_START);
  const poolCount = orders.filter(
    (o) => !o.batchId && o.status !== 'delivered' && o.dispatchType === 'open_platform'
  ).length;

  const pins: MapPin[] = useMemo(() => {
    const list: MapPin[] = [{ id: 'driver', kind: 'driver', coordinate: driverPos }];
    if (!online || (!offered && !navigating)) return list;
    const seenPickup = new Set<string>();
    stops.forEach((s, i) => {
      if (navigating && i < stopIndex) return;
      if (s.type === 'pickup') {
        if (seenPickup.has(s.order.restaurantPostcode)) return;
        seenPickup.add(s.order.restaurantPostcode);
      }
      list.push({
        id: s.key,
        kind: s.type,
        coordinate: s.coordinate,
        label: s.type === 'dropoff' ? `${s.order.batchPosition ?? 1}` : undefined,
        active: navigating && i === stopIndex,
      });
    });
    return list;
  }, [stops, stopIndex, navigating, offered, online, driverPos]);

  const route: LatLng[] | undefined =
    online && (offered || navigating)
      ? [driverPos, ...stops.slice(navigating ? stopIndex : 0).map((s) => s.coordinate)]
      : undefined;

  const openNavigation = (c: LatLng) =>
    Linking.openURL(`maps://?daddr=${c.latitude},${c.longitude}&dirflg=d`).catch(() => {});

  const totalPay = batch.reduce((sum, o) => sum + o.driverPayoutGbp, 0);
  const totalMiles = batch.reduce((sum, o) => sum + o.distanceMiles, 0);

  return (
    <View style={styles.flex1}>
      <LiveMap
        style={StyleSheet.absoluteFill}
        pins={pins}
        route={route}
        bottomInset={sheetHeight}
        topInset={40}
      />

      {/* Online toggle */}
      <View style={styles.topFloat} pointerEvents="box-none">
        <Pressable
          onPress={toggleOnline}
          disabled={!!busy}
          style={[styles.onlinePill, Brand.shadow.floating]}>
          <View style={[styles.onlineDot, { backgroundColor: online ? C.success : C.ink3 }]} />
          <Text style={styles.onlineText}>{online ? 'Online' : 'Offline'}</Text>
        </Pressable>
      </View>

      {/* Bottom sheet */}
      <View
        onLayout={(e) => setSheetHeight(e.nativeEvent.layout.height)}
        style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.handle} />

        {!online ? (
          <View style={styles.sheetBody}>
            <Text style={styles.sheetTitle}>You’re offline</Text>
            <Text style={styles.muted}>Go online to receive orders.</Text>
            <Button label="Go online" loading={busy === 'online'} onPress={toggleOnline} />
          </View>
        ) : offered ? (
          <View style={styles.sheetBody}>
            <View style={styles.rowGap}>
              <Badge label="New batch" tone="primary" icon="flash" />
              {batch.length > 1 && <Badge label="Multiple drop-offs" />}
            </View>
            <View style={styles.rowBetween}>
              <View style={styles.flexText}>
                <Text style={styles.payout}>{formatGbp(totalPay)}</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {batch.length} {batch.length === 1 ? 'order' : 'orders'} ·{' '}
                  {(routeEstimate?.miles || totalMiles).toFixed(1)} mi
                  {routeEstimate ? ` · ~${routeEstimate.minutes} min` : ''}
                </Text>
              </View>
            </View>

            <View style={styles.timeline}>
              {stops.slice(0, 4).map((s, i) => (
                <TimelineRow key={s.key} stop={s} last={i === Math.min(stops.length, 4) - 1} />
              ))}
              {stops.length > 4 && <Text style={styles.moreText}>+{stops.length - 4} more stops</Text>}
            </View>

            <View style={styles.actions}>
              <Button
                label="Decline"
                variant="secondary"
                loading={busy === 'decline'}
                disabled={!!busy}
                onPress={() => run('decline', declineCurrentBatch)}
                style={styles.flex1}
              />
              <Button
                label="Accept"
                loading={busy === 'accept'}
                disabled={!!busy}
                onPress={() => run('accept', acceptCurrentBatch)}
                style={styles.flex2}
              />
            </View>
          </View>
        ) : navigating && current ? (
          <View style={styles.sheetBody}>
            <View style={styles.rowBetween}>
              <Text style={styles.mutedStrong}>
                Stop {stopIndex + 1} of {stops.length}
              </Text>
              <Text style={styles.mutedStrong}>{formatGbp(totalPay)}</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${((stopIndex + 1) / stops.length) * 100}%` }]} />
            </View>

            <View style={styles.rowGap}>
              <Badge
                label={current.type === 'pickup' ? 'Pick up' : 'Drop off'}
                tone={current.type === 'pickup' ? 'neutral' : 'primary'}
                icon={current.type === 'pickup' ? 'bag-handle-outline' : 'home-outline'}
              />
              <SourceBadge source={current.order.source} />
              <Text style={styles.muted} numberOfLines={1}>
                {current.order.externalOrderId}
              </Text>
            </View>

            <View style={styles.gap2}>
              <Text style={styles.sheetTitle} numberOfLines={1}>
                {current.type === 'pickup' ? current.order.restaurantName : current.order.customerName}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {current.type === 'pickup'
                  ? current.order.restaurantAddress
                  : `${current.order.deliveryAddress}, ${current.order.postcode}`}
              </Text>
            </View>

            {current.type === 'pickup' ? (
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={16} color={C.ink2} />
                <Text style={styles.infoText} numberOfLines={1}>
                  {current.order.remainingSeconds > 0
                    ? `Ready in ${formatCountdown(current.order.remainingSeconds)}`
                    : 'Ready for collection'}
                </Text>
              </View>
            ) : current.order.phoneAccessCode ? (
              <View style={styles.infoRow}>
                <Ionicons name="keypad-outline" size={16} color={C.ink2} />
                <Text style={styles.infoText} numberOfLines={1}>
                  Access code {current.order.phoneAccessCode}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <IconButton
                icon="call-outline"
                onPress={() =>
                  callNumber(
                    current.type === 'pickup'
                      ? current.order.restaurantPhone
                      : current.order.directCustomerPhone || current.order.customerPhone
                  )
                }
              />
              <IconButton icon="navigate-outline" onPress={() => openNavigation(current.coordinate)} />
              <Button
                label={current.type === 'pickup' ? 'Picked up' : 'Delivered'}
                variant={current.type === 'pickup' ? 'dark' : 'success'}
                loading={busy === 'advance'}
                disabled={!!busy}
                onPress={() => run('advance', advanceActiveStop)}
                style={styles.flex1}
              />
            </View>
          </View>
        ) : completed ? (
          <View style={[styles.sheetBody, styles.center]}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={30} color="#FFFFFF" />
            </View>
            <Text style={styles.sheetTitle}>Batch complete</Text>
            <Text style={styles.payout}>
              {formatGbp(delivered.reduce((s, o) => s + o.driverPayoutGbp, 0))}
            </Text>
            <Text style={styles.muted}>Added to this week’s earnings</Text>
            <Button
              label="Find new orders"
              loading={busy === 'next'}
              disabled={!!busy}
              onPress={() => run('next', findNewOrders)}
              style={styles.stretch}
            />
          </View>
        ) : (
          <View style={styles.sheetBody}>
            <SearchingRow poolCount={poolCount} />
            <View style={styles.actions}>
              <Button
                label="Order pool"
                variant="secondary"
                icon="layers-outline"
                onPress={() => setActiveScreen('open_pool')}
                style={styles.flex1}
              />
              <Button
                label="Refresh"
                icon="refresh"
                loading={busy === 'next'}
                disabled={!!busy}
                onPress={() => run('next', findNewOrders)}
                style={styles.flex1}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function TimelineRow({ stop, last }: { stop: Stop; last: boolean }) {
  const pickup = stop.type === 'pickup';
  return (
    <View style={styles.tlRow}>
      <View style={styles.tlRail}>
        <View style={[styles.tlDot, pickup ? styles.tlDotPickup : styles.tlDotDrop]} />
        {!last && <View style={styles.tlLine} />}
      </View>
      <View style={[styles.flexText, styles.tlContent]}>
        <Text style={styles.tlTitle} numberOfLines={1}>
          {pickup ? stop.order.restaurantName : shortArea(stop.order.deliveryAddress)}
        </Text>
        <Text style={styles.muted} numberOfLines={1}>
          {pickup ? 'Pick up' : `Drop off · ${stop.order.postcode}`}
        </Text>
      </View>
    </View>
  );
}

function SearchingRow({ poolCount }: { poolCount: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <View style={styles.rowGap}>
      <Animated.View
        style={[
          styles.searchDot,
          { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }) },
        ]}
      />
      <View style={styles.flexText}>
        <Text style={styles.sheetTitle}>Finding orders</Text>
        <Text style={styles.muted}>
          {poolCount > 0
            ? `${poolCount} open ${poolCount === 1 ? 'order' : 'orders'} in the pool`
            : 'No open orders right now'}
        </Text>
      </View>
    </View>
  );
}

/* ========================================================================== */
/* Order pool                                                                  */
/* ========================================================================== */

function OrderPoolScreen() {
  const { orders, algorithm, appendOrderToDriverBatch, setActiveScreen, myLocation } = useInThaRoute();
  const { batch } = useActiveBatch();
  const { busy, run } = useBusy();
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(null);

  const pool = orders.filter(
    (o) => !o.batchId && o.status !== 'delivered' && o.dispatchType === 'open_platform'
  );
  const full = batch.length >= algorithm.maxBatchSize;

  const pins: MapPin[] = [
    { id: 'driver', kind: 'driver', coordinate: myLocation ?? DRIVER_START },
    ...pool.map((o, i) => ({
      id: o.id,
      kind: 'dropoff' as const,
      label: `${i + 1}`,
      coordinate: coordsForPostcode(o.postcode),
    })),
  ];

  const add = (id: string) =>
    run(id, async () => {
      const res = await appendOrderToDriverBatch(id);
      setToast(res);
      setTimeout(() => setToast(null), 2500);
    });

  return (
    <Screen>
      <Card style={styles.noPad}>
        <LiveMap style={styles.map} pins={pins} />
      </Card>

      <Card>
        <View style={styles.rowBetween}>
          <Text style={styles.cardTitle}>Your route</Text>
          <Text style={styles.mutedStrong}>
            {batch.length} / {algorithm.maxBatchSize} orders
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(batch.length / algorithm.maxBatchSize) * 100}%` },
            ]}
          />
        </View>
      </Card>

      {toast && (
        <View style={[styles.toast, !toast.ok && styles.toastError]}>
          <Ionicons
            name={toast.ok ? 'checkmark-circle' : 'alert-circle'}
            size={18}
            color={toast.ok ? C.success : C.primary}
          />
          <Text style={styles.toastText} numberOfLines={2}>
            {toast.message}
          </Text>
        </View>
      )}

      <SectionLabel>{`Nearby · ${pool.length}`}</SectionLabel>
      {pool.length === 0 ? (
        <Card>
          <EmptyState icon="layers-outline" title="Pool is empty" subtitle="New orders appear here." />
          <Button label="Back to map" variant="secondary" onPress={() => setActiveScreen('live_route')} />
        </Card>
      ) : (
        pool.map((o, i) => {
          // Worked out by the server for the position this order would take in your run.
          const pay = o.nextPayoutGbp ?? o.driverPayoutGbp;
          return (
            <Card key={o.id}>
              <View style={styles.rowBetween}>
                <View style={styles.rowGapShrink}>
                  <View style={styles.indexDot}>
                    <Text style={styles.indexText}>{i + 1}</Text>
                  </View>
                  <SourceBadge source={o.source} />
                </View>
                <Text style={styles.earn}>+{formatGbp(pay)}</Text>
              </View>
              <View style={styles.gap2}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {o.restaurantName}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  To {shortArea(o.deliveryAddress)} · {o.postcode}
                </Text>
              </View>
              <Divider />
              <View style={styles.rowBetween}>
                <Text style={styles.muted} numberOfLines={1}>
                  {o.distanceMiles} mi ·{' '}
                  {o.remainingSeconds > 0 ? `Ready ${formatCountdown(o.remainingSeconds)}` : 'Ready'}
                </Text>
                <Button
                  label="Add"
                  icon="add"
                  compact
                  loading={busy === o.id}
                  disabled={full || !!busy}
                  onPress={() => add(o.id)}
                />
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

/* ========================================================================== */
/* Earnings                                                                    */
/* ========================================================================== */

function EarningsScreen() {
  const { algorithm, earnings } = useInThaRoute();
  // Last 7 days from the server; the last entry is today.
  const days = earnings?.week ?? [];
  const total = earnings?.totalGbp ?? 0;
  const max = Math.max(1, ...days.map((d) => d.value));
  const recentTrips = earnings?.recentTrips ?? [];
  const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];

  return (
    <Screen>
      <Card>
        <Text style={styles.muted}>This week</Text>
        <Text style={styles.display}>{formatGbp(total)}</Text>
        <View style={styles.chart}>
          {days.map((d, i) => {
            const isToday = i === days.length - 1;
            return (
              <View key={i} style={styles.barCol}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.bar,
                      { height: `${Math.max(8, (d.value / max) * 100)}%` },
                      isToday && styles.barToday,
                    ]}
                  />
                </View>
                <Text style={[styles.barLabel, isToday && styles.barLabelToday]}>{d.day}</Text>
              </View>
            );
          })}
        </View>
      </Card>

      <Card style={styles.statsCard}>
        <Stat label="Trips" value={`${earnings?.trips ?? 0}`} />
        <View style={styles.vDivider} />
        <Stat label="Online" value={`${earnings?.onlineHours ?? 0}h`} />
        <View style={styles.vDivider} />
        <Stat label="Rating" value={(earnings?.rating ?? 5).toFixed(2)} />
      </Card>

      <SectionLabel>Batch pay</SectionLabel>
      <Card>
        {algorithm.steppedDriverPayoutsGbp.slice(0, algorithm.maxBatchSize).map((p, i) => (
          <View key={i} style={styles.payRow}>
            <Text style={styles.cardBody}>{ordinals[i]} order</Text>
            <Text style={styles.cardTitle}>{formatGbp(p)}</Text>
          </View>
        ))}
      </Card>
      <Hint icon="layers-outline">More orders per run means more per hour.</Hint>

      <SectionLabel>Recent trips</SectionLabel>
      <Card>
        {recentTrips.length === 0 && (
          <EmptyState icon="bicycle-outline" title="No trips yet" subtitle="Finished runs appear here." />
        )}
        {recentTrips.map((t, i) => (
          <View key={t.id} style={styles.gap12}>
            {i > 0 && <Divider />}
            <ListRow
              left={<IconTile icon="bicycle-outline" size={36} />}
              title={t.title}
              subtitle={t.time}
              right={<Text style={styles.cardTitle}>{formatGbp(t.pay)}</Text>}
            />
          </View>
        ))}
      </Card>
    </Screen>
  );
}

/* ========================================================================== */
/* Documents                                                                   */
/* ========================================================================== */

const DOC_ICONS: (keyof typeof Ionicons.glyphMap)[] = [
  'car-outline',
  'id-card-outline',
  'card-outline',
  'shield-checkmark-outline',
  'person-outline',
];

const cleanTitle = (t: string) => t.replace(/\s*\(.*?\)/g, '');

function DocumentsScreen() {
  const { me, uploadDriverKycDoc } = useInThaRoute();
  const [openDoc, setOpenDoc] = useState<KycDocument | null>(null);
  const [uploading, setUploading] = useState(false);

  const docs = me?.kycDocuments ?? [];
  const verified = docs.filter((d) => d.status === 'verified').length;
  const missing = docs.filter((d) => d.status === 'missing').length;
  const allGood = verified === docs.length;
  const rejected = me?.approval === 'rejected';
  const headline = allGood
    ? 'You’re verified'
    : rejected
    ? 'Not approved yet'
    : missing > 0
    ? 'Upload your documents'
    : 'Under review';

  const upload = async (doc: KycDocument) => {
    const image = await chooseImage(cleanTitle(doc.title));
    if (!image) return;
    setUploading(true);
    const ok = await uploadDriverKycDoc(doc.id, image);
    setUploading(false);
    if (ok) setOpenDoc(null);
  };

  return (
    <Screen>
      <Card>
        <View style={styles.rowGap}>
          <IconTile
            icon={allGood ? 'shield-checkmark' : 'hourglass-outline'}
            tone={allGood ? 'success' : 'warning'}
            size={44}
          />
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>{headline}</Text>
            <Text style={styles.muted}>
              {verified} of {docs.length} documents approved
            </Text>
          </View>
        </View>
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${(verified / Math.max(docs.length, 1)) * 100}%`, backgroundColor: allGood ? C.success : C.warning },
            ]}
          />
        </View>
      </Card>

      <SectionLabel>Required documents</SectionLabel>
      <Card>
        {docs.map((d, i) => (
          <View key={d.id} style={styles.gap12}>
            {i > 0 && <Divider />}
            <ListRow
              onPress={() => setOpenDoc(d)}
              left={<IconTile icon={DOC_ICONS[i] ?? 'document-outline'} size={36} />}
              title={cleanTitle(d.title)}
              subtitle={d.updatedAt}
              right={
                <Badge
                  label={d.status === 'verified' ? 'Verified' : d.status === 'pending' ? 'Pending' : 'Missing'}
                  tone={d.status === 'verified' ? 'success' : d.status === 'pending' ? 'warning' : 'primary'}
                />
              }
            />
          </View>
        ))}
      </Card>

      <Sheet visible={!!openDoc} onClose={() => setOpenDoc(null)} title={openDoc ? cleanTitle(openDoc.title) : ''}>
        {openDoc && (
          <>
            <Card style={styles.docPreview}>
              <Ionicons name="document-text-outline" size={36} color={C.ink3} />
              <Text style={styles.cardTitle} numberOfLines={1}>
                {openDoc.value}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {openDoc.subtitle}
              </Text>
            </Card>
            {openDoc.status !== 'verified' && (
              <Text style={styles.muted}>{openDoc.updatedAt}</Text>
            )}
            <Button
              label={openDoc.hasFile ? 'Upload new photo' : 'Upload photo'}
              icon="camera-outline"
              loading={uploading}
              disabled={uploading}
              onPress={() => upload(openDoc)}
            />
          </>
        )}
      </Sheet>
    </Screen>
  );
}

/* ========================================================================== */
/* Styles                                                                      */
/* ========================================================================== */

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  flex2: { flex: 2 },
  flexText: { flex: 1, minWidth: 0, gap: 2 },
  stretch: { alignSelf: 'stretch' },
  center: { alignItems: 'center' },
  gap2: { gap: 2 },
  gap12: { gap: 12 },
  noPad: { padding: 0, gap: 0, overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  rowGapShrink: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },

  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  cardBody: { ...Brand.type.body, color: C.ink2 },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  mutedStrong: { ...Brand.type.captionStrong, color: C.ink2 },
  display: { ...Brand.type.display, color: C.ink },

  map: { height: 220 },
  topFloat: { position: 'absolute', top: 14, left: 0, right: 0, alignItems: 'center' },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    height: 40,
    borderRadius: 20,
    backgroundColor: C.surface,
  },
  onlineDot: { width: 10, height: 10, borderRadius: 5 },
  onlineText: { ...Brand.type.bodyStrong, color: C.ink },

  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: C.surface,
    borderTopLeftRadius: Brand.radius.xl,
    borderTopRightRadius: Brand.radius.xl,
    paddingHorizontal: 20,
    paddingTop: 8,
    ...Brand.shadow.floating,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: 3,
    backgroundColor: C.lineStrong,
    marginBottom: 14,
  },
  sheetBody: { gap: 14 },
  sheetTitle: { ...Brand.type.title, color: C.ink },
  payout: { fontSize: 32, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },

  timeline: { paddingVertical: 2 },
  tlRow: { flexDirection: 'row', gap: 12 },
  tlRail: { width: 14, alignItems: 'center' },
  tlDot: { width: 12, height: 12, marginTop: 4 },
  tlDotPickup: { backgroundColor: C.ink, borderRadius: 3 },
  tlDotDrop: { backgroundColor: C.primary, borderRadius: 6 },
  tlLine: { flex: 1, width: 2, backgroundColor: C.line, marginVertical: 2 },
  tlContent: { paddingBottom: 12 },
  tlTitle: { ...Brand.type.bodyStrong, color: C.ink },
  moreText: { ...Brand.type.captionStrong, color: C.ink3, marginLeft: 26 },

  progressTrack: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: C.primary },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Brand.radius.md,
    backgroundColor: C.surfaceAlt,
  },
  infoText: { ...Brand.type.captionStrong, color: C.ink, flex: 1 },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: C.success },

  indexDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  earn: { ...Brand.type.heading, color: C.success },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Brand.radius.md,
    backgroundColor: C.successSoft,
  },
  toastError: { backgroundColor: C.primarySoft },
  toastText: { ...Brand.type.captionStrong, color: C.ink, flex: 1 },

  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 130, marginTop: 8 },
  barCol: { flex: 1, alignItems: 'center', gap: 6, height: '100%' },
  barTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 6, backgroundColor: C.line },
  barToday: { backgroundColor: C.primary },
  barLabel: { ...Brand.type.captionStrong, color: C.ink3 },
  barLabelToday: { color: C.ink },
  statsCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },
  payRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },

  docPreview: { alignItems: 'center', backgroundColor: C.surfaceAlt, borderWidth: 0, shadowOpacity: 0 },
});
