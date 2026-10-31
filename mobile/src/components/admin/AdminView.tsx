import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
  Stat,
  Stepper,
} from '@/components/ui';
import { Brand, formatGbp } from '@/constants/brand';
import { coordsForPostcode, DRIVER_START } from '@/constants/geo';
import { DriverPolicy, DriverProfile, useInThaRoute } from '@/context/InThaRouteContext';

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
  const { orders, restaurants } = useInThaRoute();
  const active = orders.filter((o) => o.status !== 'delivered');
  const billed = orders.reduce((s, o) => s + o.restaurantFeeGbp, 0);
  const paid = orders
    .filter((o) => o.dispatchType === 'open_platform')
    .reduce((s, o) => s + o.driverPayoutGbp, 0);
  const profit = billed - paid;

  const pins: MapPin[] = [
    { id: 'driver', kind: 'driver', coordinate: DRIVER_START },
    ...restaurants.map((r) => ({
      id: r.id,
      kind: 'restaurant' as const,
      coordinate: coordsForPostcode(r.postcode),
    })),
    ...active.map((o, i) => ({
      id: o.id,
      kind: 'dropoff' as const,
      label: `${i + 1}`,
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
            const margin = o.restaurantFeeGbp - o.driverPayoutGbp;
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
              </View>
            );
          })
        )}
      </Card>
    </Screen>
  );
}

/* ========================================================================== */
/* Pricing                                                                     */
/* ========================================================================== */

function PricingScreen() {
  const { algorithm, updateAlgorithmConfig, updateSteppedPayoutAt } = useInThaRoute();
  const [size, setSize] = useState('2');
  const n = Number(size);

  const restaurantsPay = n * algorithm.baseRestaurantChargeGbp;
  const driverEarns = algorithm.steppedDriverPayoutsGbp.slice(0, n).reduce((s, v) => s + v, 0);
  const profit = restaurantsPay - driverEarns;
  const driverShare = restaurantsPay > 0 ? Math.min(1, driverEarns / restaurantsPay) : 0;

  const setFee = (delta: number) =>
    updateAlgorithmConfig({
      baseRestaurantChargeGbp: Math.max(2.5, Math.min(12, +(algorithm.baseRestaurantChargeGbp + delta).toFixed(2))),
    });
  const setMax = (delta: number) => {
    const next = Math.max(1, Math.min(5, algorithm.maxBatchSize + delta));
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
            <Text style={styles.cardTitle}>Max batch</Text>
            <Text style={styles.muted}>Orders per run</Text>
          </View>
          <Stepper
            value={`${algorithm.maxBatchSize}`}
            onDecrement={() => setMax(-1)}
            onIncrement={() => setMax(1)}
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
                  You keep {formatGbp(algorithm.baseRestaurantChargeGbp - pay)}
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
  const { drivers, approveDriverKyc } = useInThaRoute();
  const platform = drivers.filter((d) => d.driverType === 'platform_contracted');
  const inHouse = drivers.filter((d) => d.driverType === 'restaurant_own');
  const [tab, setTab] = useState<'platform' | 'inhouse'>('platform');
  const [expanded, setExpanded] = useState<string | null>(
    platform.find((d) => d.status === 'pending_kyc')?.id ?? null
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
          const approved = d.status === 'approved_online';
          const open = expanded === d.id;
          return (
            <Card key={d.id}>
              <ListRow
                left={<Avatar name={d.name} tone={approved ? 'success' : 'warning'} />}
                title={d.name}
                subtitle={`${VEHICLE_SHORT[d.vehicle]} · ${d.plateNumber}`}
                right={<Badge label={approved ? 'Active' : 'Pending'} tone={approved ? 'success' : 'warning'} />}
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
                  <View key={doc.id} style={styles.docRow}>
                    <Ionicons
                      name={doc.status === 'verified' ? 'checkmark-circle' : 'time'}
                      size={18}
                      color={doc.status === 'verified' ? C.success : C.warning}
                    />
                    <Text style={styles.docTitle} numberOfLines={1}>
                      {cleanTitle(doc.title)}
                    </Text>
                  </View>
                ))}

              {!approved && (
                <Button label="Approve driver" variant="success" icon="checkmark" onPress={() => approveDriverKyc(d.id)} />
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
    </Screen>
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
  gap10: { gap: 10 },
  gap12: { gap: 12 },
  noPad: { padding: 0, gap: 0, overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },

  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  cardBody: { ...Brand.type.body, color: C.ink2 },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  mutedStrong: { ...Brand.type.captionStrong, color: C.ink2 },

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
