import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveMap, MapPin } from '@/components/LiveMap';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  IconTile,
  ListRow,
  Screen,
  SectionLabel,
  Segmented,
  Sheet,
  Stat,
  Stepper,
} from '@/components/ui';
import { API_URL } from '@/constants/api';
import { Brand, formatGbp, sourceColor } from '@/constants/brand';
import { coordsForPostcode } from '@/constants/geo';
import { DriverPolicy, DriverProfile, KycDocument, LiveOrder, useInThaRoute } from '@/context/InThaRouteContext';
import { getAccessToken } from '@/services/apiClient';

const C = Brand.colors;
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th'];
const cleanTitle = (t: string) => t.replace(/\s*\(.*?\)/g, '');
const shortName = (n: string) => n.split(' - ')[0];
const VEHICLE_SHORT: Record<DriverProfile['vehicle'], string> = {
  'Motorcycle / Scooter': 'Scooter',
  Car: 'Car',
  'E-Bike': 'E-Bike',
};

export function AdminView() {
  const { activeScreen } = useInThaRoute();
  switch (activeScreen) {
    case 'pricing_algorithm':
      return <PricingScreen />;
    case 'driver_kyc':
      return <DriversScreen />;
    case 'partner_restaurants':
      return <RestaurantsScreen />;
    default:
      return <OverviewScreen />;
  }
}

/* ========================================================================== */
/* Overview                                                                    */
/* ========================================================================== */

function OverviewScreen() {
  const { orders, restaurants, totals, drivers, cancelOrder, releaseOrder } = useInThaRoute();
  // Online drivers whose app has sent a recent GPS position.
  const liveDrivers = drivers.filter((d) => d.isOnline && d.location);
  const active = orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled');
  // Today's live and delivered orders, totalled by the server.
  const billed = totals?.billedGbp ?? 0;
  const paid = totals?.driverPayGbp ?? 0;
  const profit = totals?.profitGbp ?? 0;

  const pins: MapPin[] = [
    ...liveDrivers.map((d) => ({
      id: `drv-${d.id}`,
      kind: 'driver' as const,
      coordinate: { latitude: d.location!.latitude, longitude: d.location!.longitude },
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

  return (
    <Screen>
      <Card style={styles.noPad}>
        <LiveMap style={styles.map} pins={pins} />
        <View style={styles.mapFooter}>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.ink }]} />
            <Text style={styles.muted}>Restaurants</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.primary }]} />
            <Text style={styles.muted}>Drop-offs</Text>
          </View>
          <View style={styles.legend}>
            <View style={[styles.legendDot, { backgroundColor: C.info }]} />
            <Text style={styles.muted}>Drivers</Text>
          </View>
        </View>
      </Card>

      <Card style={styles.statsCard}>
        <Stat label="Billed" value={formatGbp(billed)} />
        <View style={styles.vDivider} />
        <Stat label="Driver pay" value={formatGbp(paid)} />
        <View style={styles.vDivider} />
        <Stat label="Profit" value={formatGbp(profit)} tone="success" />
      </Card>

      <SectionLabel>{`Live orders · ${active.length}`}</SectionLabel>
      <Card>
        {active.length === 0 ? (
          <EmptyState icon="receipt-outline" title="No live orders" />
        ) : (
          active.map((o, i) => {
            const margin = o.platformMarginGbp ?? o.restaurantFeeGbp - o.driverPayoutGbp;
            const inHouse = o.dispatchType === 'own_driver';
            return (
              <View key={o.id} style={styles.gap12}>
                {i > 0 && <Divider />}
                <View style={styles.ledgerRow}>
                  <View style={styles.indexDot}>
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
                  {inHouse ? (
                    <Badge label="No fee" />
                  ) : (
                    <Text style={styles.profit}>+{formatGbp(margin)}</Text>
                  )}
                </View>
                <OrderControls order={o} onCancel={cancelOrder} onRelease={releaseOrder} />
              </View>
            );
          })
        )}
      </Card>
    </Screen>
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

/** Status, any alert, and what the admin can do about an order. */
function OrderControls({
  order: o,
  onCancel,
  onRelease,
}: {
  order: LiveOrder;
  onCancel: (id: string) => Promise<boolean>;
  onRelease: (id: string) => Promise<boolean>;
}) {
  const withDriver = !!o.batchId && (o.status === 'batched_offered' || o.status === 'driver_assigned');
  // The admin can cancel until delivery, even after the driver has collected the food.
  const cancellable = o.status !== 'delivered' && o.status !== 'cancelled';
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
        : 'The restaurant and driver are told. The restaurant is not charged.',
      [
      { text: 'Keep order', style: 'cancel' },
        { text: 'Cancel order', style: 'destructive', onPress: () => void onCancel(o.id) },
      ]
    );

  return (
    <View style={styles.gap8}>
      <Text style={styles.muted} numberOfLines={1}>
        {ADMIN_STATUS[o.status]}
        {driver && o.status !== 'preparing' && o.status !== 'ready_for_pickup' ? ` · ${driver}` : ''}
      </Text>
      {o.attention && (
        <View style={styles.attention}>
          <Ionicons name="alert-circle" size={16} color={C.primary} />
          <Text style={styles.attentionText}>
            {o.attention === 'no_driver' ? 'No driver has taken this yet.' : 'Collected but not delivered for a long time.'}
          </Text>
        </View>
      )}
      {(withDriver || cancellable) && (
        <View style={styles.controlRow}>
          {withDriver && (
            <Button label="Move driver" icon="swap-horizontal" compact variant="secondary" onPress={confirmRelease} />
          )}
          {cancellable && <Button label="Cancel" icon="close" compact variant="ghost" onPress={confirmCancel} />}
        </View>
      )}
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
            <Text style={styles.cardBody}>Restaurants pay</Text>
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
            <Text style={styles.cardTitle}>Restaurant fee</Text>
            <Text style={styles.muted}>Per order</Text>
          </View>
          <Stepper
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
            value={`${algorithm.baseDistanceMiles} mi`}
            onDecrement={() => nudge('baseDistanceMiles', -0.5, 0.5, 20)}
            onIncrement={() => nudge('baseDistanceMiles', 0.5, 0.5, 20)}
          />
        </View>
        <Divider />
        <View style={styles.settingRow}>
          <View style={styles.flexText}>
            <Text style={styles.cardTitle}>Extra mile · restaurant</Text>
            <Text style={styles.muted}>Charged per mile beyond</Text>
          </View>
          <Stepper
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
            value={`${algorithm.offerRadiusMiles} mi`}
            onDecrement={() => nudge('offerRadiusMiles', -0.5, 0.5, 20)}
            onIncrement={() => nudge('offerRadiusMiles', 0.5, 0.5, 20)}
          />
        </View>
      </Card>

      <SectionLabel>Driver pay per order</SectionLabel>
      <Card>
        {algorithm.steppedDriverPayoutsGbp.slice(0, algorithm.maxBatchSize).map((pay, i) => (
          <View key={i} style={styles.gap12}>
            {i > 0 && <Divider />}
            <View style={styles.settingRow}>
              <View style={styles.flexText}>
                <Text style={styles.cardTitle}>{ORDINALS[i]} order</Text>
                <Text style={styles.muted} numberOfLines={1}>
                  You keep{' '}
                  {formatGbp(
                    pricingSummary?.tiers[i]?.platformKeepsGbp ?? algorithm.baseRestaurantChargeGbp - pay
                  )}
                </Text>
              </View>
              <Stepper
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

function DriversScreen() {
  const { drivers, approveDriverKyc, rejectDriverKyc } = useInThaRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const [photoDoc, setPhotoDoc] = useState<KycDocument | null>(null);

  const approve = async (d: DriverProfile) => {
    setBusy(`approve-${d.id}`);
    await approveDriverKyc(d.id);
    setBusy(null);
  };

  const reject = (d: DriverProfile) =>
    Alert.alert(
      `Reject ${d.name}?`,
      'Their documents are cleared and they will be asked to upload them again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reject',
          style: 'destructive',
          onPress: async () => {
            setBusy(`reject-${d.id}`);
            await rejectDriverKyc(d.id);
            setBusy(null);
          },
        },
      ]
    );
  const platform = drivers.filter((d) => d.driverType === 'platform_contracted');
  const inHouse = drivers.filter((d) => d.driverType === 'restaurant_own');
  const [tab, setTab] = useState<'platform' | 'inhouse'>('platform');
  const [expanded, setExpanded] = useState<string | null>(
    platform.find((d) => d.approval === 'pending')?.id ?? null
  );

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

      {tab === 'platform' ? (
        platform.map((d) => {
          const verified = d.kycDocuments.filter((k) => k.status === 'verified').length;
          const total = d.kycDocuments.length;
          const approved = d.approval ? d.approval === 'approved' : d.status === 'approved_online';
          const rejected = d.approval === 'rejected';
          const missing = d.kycDocuments.some((k) => k.status === 'missing');
          const open = expanded === d.id;
          return (
            <Card key={d.id}>
              <ListRow
                left={<Avatar name={d.name} tone={approved ? 'success' : 'warning'} />}
                title={d.name}
                subtitle={`${VEHICLE_SHORT[d.vehicle]} · ${d.plateNumber}`}
                right={
                  <Badge
                    label={approved ? 'Active' : rejected ? 'Rejected' : 'Pending'}
                    tone={approved ? 'success' : rejected ? 'primary' : 'warning'}
                  />
                }
              />

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
                    onPress={() => setPhotoDoc(doc)}>
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
                    {doc.hasFile && <Ionicons name="image-outline" size={16} color={C.ink3} />}
                  </Pressable>
                ))}

              {!approved && (
                <View style={styles.actionRow}>
                  {!rejected && (
                    <Button
                      label="Reject"
                      variant="secondary"
                      icon="close"
                      loading={busy === `reject-${d.id}`}
                      disabled={!!busy}
                      onPress={() => reject(d)}
                      style={styles.flex1}
                    />
                  )}
                  <Button
                    label="Approve driver"
                    variant="success"
                    icon="checkmark"
                    loading={busy === `approve-${d.id}`}
                    disabled={!!busy || missing || d.kycDocuments.length === 0}
                    onPress={() => approve(d)}
                    style={styles.flex2}
                  />
                </View>
              )}
            </Card>
          );
        })
      ) : (
        <Card>
          {inHouse.map((d, i) => (
            <View key={d.id} style={styles.gap12}>
              {i > 0 && <Divider />}
              <ListRow
                left={<Avatar name={d.name} tone="info" />}
                title={d.name}
                subtitle={shortName(d.employerRestaurantName ?? '')}
                right={<Badge label="No docs" tone="info" />}
              />
            </View>
          ))}
        </Card>
      )}

      <Sheet
        visible={!!photoDoc}
        onClose={() => setPhotoDoc(null)}
        title={photoDoc ? cleanTitle(photoDoc.title) : ''}>
        {photoDoc && <DocumentPhoto doc={photoDoc} />}
      </Sheet>
    </Screen>
  );
}

/** The photo a driver uploaded, fetched with the admin's sign-in. */
function DocumentPhoto({ doc }: { doc: KycDocument }) {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getAccessToken()
      .then((t) => !cancelled && setToken(t))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [doc.id]);

  return (
    <View style={styles.photoWrap}>
      {failed ? (
        <Text style={styles.muted}>The photo couldn’t be loaded.</Text>
      ) : token ? (
        <Image
          style={styles.photo}
          resizeMode="contain"
          onError={() => setFailed(true)}
          source={{
            uri: `${API_URL}/api/admin/kyc-documents/${doc.id}/file`,
            headers: { Authorization: `Bearer ${token}` },
          }}
        />
      ) : (
        <ActivityIndicator color={C.primary} />
      )}
      <Text style={styles.muted}>{doc.updatedAt}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Restaurants                                                                 */
/* ========================================================================== */

function RestaurantsScreen() {
  const { restaurants, updateRestaurantPolicy } = useInThaRoute();

  return (
    <Screen>
      {restaurants.map((r) => (
        <Card key={r.id}>
          <ListRow
            left={<IconTile icon="storefront-outline" tone="primary" />}
            title={shortName(r.name)}
            subtitle={`${r.address.split(',').pop()?.trim()} · ${r.postcode}`}
          />
          <View style={styles.inlineStats}>
            <View style={styles.legend}>
              <Ionicons name="flash-outline" size={14} color={C.ink3} />
              <Text style={styles.muted}>{r.activeOrdersCount} live</Text>
            </View>
            <View style={styles.legend}>
              <Ionicons name="checkmark-done-outline" size={14} color={C.ink3} />
              <Text style={styles.muted}>{r.completedTodayCount} today</Text>
            </View>
          </View>
          <Segmented<DriverPolicy>
            value={r.driverPolicy}
            onChange={(p) => updateRestaurantPolicy(r.id, p)}
            options={[
              { value: 'open_platform', label: 'Platform' },
              { value: 'hybrid', label: 'Hybrid' },
              { value: 'own_drivers', label: 'Own' },
            ]}
          />
        </Card>
      ))}
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
  photoWrap: { alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 200 },
  photo: { width: '100%', height: 360, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },
  gap10: { gap: 10 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  noPad: { padding: 0, gap: 0, overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },

  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  cardBody: { ...Brand.type.body, color: C.ink2 },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  mutedStrong: { ...Brand.type.captionStrong, color: C.ink2 },
  attention: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: C.primarySoft,
  },
  attentionText: { ...Brand.type.caption, color: C.ink, flex: 1 },
  controlRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },

  map: { height: 240 },
  mapFooter: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, padding: 14 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },

  statsCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },

  ledgerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  indexDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: C.primary, fontSize: 12, fontWeight: '700' },
  profit: { ...Brand.type.bodyStrong, color: C.success },
  profitLarge: { ...Brand.type.heading, color: C.success },

  splitBar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: C.line },
  splitDriver: { backgroundColor: C.ink },
  splitProfit: { backgroundColor: C.success },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  docsToggle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: C.line, overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2 },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 2 },
  docTitle: { ...Brand.type.caption, color: C.ink, flex: 1 },

  inlineStats: { flexDirection: 'row', gap: 16, paddingLeft: 2 },
});
