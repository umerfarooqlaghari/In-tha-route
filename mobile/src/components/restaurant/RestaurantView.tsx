import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { LiveMap, MapPin } from '@/components/LiveMap';
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
  SourceBadge,
  Stat,
} from '@/components/ui';
import { Brand, formatCountdown, formatGbp, sourceColor } from '@/constants/brand';
import { coordsForPostcode } from '@/constants/geo';
import {
  DriverPolicy,
  LiveOrder,
  ReceiptTemplate,
  useInThaRoute,
  Vehicle,
} from '@/context/InThaRouteContext';
import { InboxScreen } from '@/components/chat/Chat';
import { useChat } from '@/context/ChatContext';
import { pickImage } from '@/utils/pickImage';

const C = Brand.colors;

export function RestaurantView() {
  const { activeScreen } = useInThaRoute();
  switch (activeScreen) {
    case 'live_orders':
      return <LiveOrdersScreen />;
    case 'own_drivers':
      return <MyDriversScreen />;
    case 'messages':
      return <InboxScreen />;
    case 'dispatch_policy':
      return <DeliverySettingsScreen />;
    default:
      return <NewOrderScreen />;
  }
}

/* ========================================================================== */
/* New order — 3 step flow                                                     */
/* ========================================================================== */

type Step = 'scan' | 'confirm' | 'prep' | 'done';
const STEP_INDEX: Record<Step, number> = { scan: 0, confirm: 1, prep: 2, done: 3 };
const PREP_OPTIONS = [10, 15, 20, 30, 40];

function StepProgress({ step }: { step: Step }) {
  const idx = STEP_INDEX[step];
  const labels = ['Scan', 'Confirm', 'Prep time'];
  return (
    <View style={styles.progressWrap}>
      <View style={styles.progressBars}>
        {labels.map((_, i) => (
          <View key={i} style={[styles.progressBar, i <= idx && styles.progressBarActive]} />
        ))}
      </View>
      <Text style={styles.progressText}>
        Step {Math.min(idx + 1, 3)} of 3 · {labels[Math.min(idx, 2)]}
      </Text>
    </View>
  );
}

function NewOrderScreen() {
  const { publishScannedOrder, scanReceipt, orders, drivers, restaurants, activeRestaurantId, setActiveScreen } =
    useInThaRoute();
  const restaurant = restaurants.find((r) => r.id === activeRestaurantId) ?? restaurants[0];
  const ownDrivers = drivers.filter(
    (d) => d.driverType === 'restaurant_own' && d.employerRestaurantId === restaurant.id
  );

  const [step, setStep] = useState<Step>('scan');
  const [template, setTemplate] = useState<ReceiptTemplate | null>(null);
  const [scanning, setScanning] = useState(false);
  const [posting, setPosting] = useState(false);
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [showItems, setShowItems] = useState(false);
  const [prep, setPrep] = useState(20);
  const [dispatch, setDispatch] = useState<'open_platform' | 'own_driver'>(
    restaurant.driverPolicy === 'own_drivers' ? 'own_driver' : 'open_platform'
  );
  const [ownDriverId, setOwnDriverId] = useState<string | undefined>(ownDrivers[0]?.id);
  const [published, setPublished] = useState<LiveOrder | null>(null);

  // Camera ("Scan receipt") or photo library ("Upload receipt"); the server reads it with OCR.
  const startScan = async (source: 'camera' | 'library') => {
    const image = await pickImage(source);
    if (!image) return;
    setScanning(true);
    const draft = await scanReceipt(image);
    setScanning(false);
    if (!draft) return;
    setTemplate(draft);
    setAddress(draft.deliveryAddress);
    setPostcode(draft.postcode);
    setAccessCode(draft.phoneAccessCode ?? '');
    setPrep(PREP_OPTIONS.reduce((a, b) =>
      Math.abs(b - draft.suggestedPrepMinutes) < Math.abs(a - draft.suggestedPrepMinutes) ? b : a
    ));
    setShowItems(false);
    setStep('confirm');
  };

  const post = async () => {
    if (!template || posting) return;
    setPosting(true);
    const order = await publishScannedOrder({
      template,
      prepMinutes: prep,
      dispatchType: dispatch,
      ownDriverId: dispatch === 'own_driver' ? ownDriverId : undefined,
      customAddress: address.trim(),
      customPostcode: postcode.trim(),
      customAccessCode: accessCode.trim(),
    });
    setPosting(false);
    if (!order) return;
    setPublished(order);
    setStep('done');
  };

  const reset = () => {
    setStep('scan');
    setPublished(null);
    setTemplate(null);
    setShowItems(false);
  };

  // Drivers load with the dashboard, so pick a default once they arrive.
  useEffect(() => {
    if (!ownDriverId && ownDrivers[0]) setOwnDriverId(ownDrivers[0].id);
  }, [ownDriverId, ownDrivers]);

  if (step === 'done' && published) {
    // Follow the live copy so the countdown keeps ticking.
    const live = orders.find((o) => o.id === published.id) ?? published;
    return (
      <Screen contentStyle={styles.doneContent}>
        <View style={styles.doneIcon}>
          <Ionicons name="checkmark" size={40} color="#FFFFFF" />
        </View>
        <Text style={styles.doneTitle}>Order is live</Text>
        <Text style={styles.doneSubtitle} numberOfLines={2}>
          {live.dispatchType === 'own_driver'
            ? `Assigned to ${live.assignedDriverName ?? 'your driver'}`
            : 'Nearby drivers can see it now'}
        </Text>

        <Card style={styles.doneCard}>
          <View style={styles.rowBetween}>
            <SourceBadge source={live.source} />
            <Text style={styles.mutedStrong}>{live.externalOrderId}</Text>
          </View>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {live.deliveryAddress}
          </Text>
          <Divider />
          <View style={styles.rowBetween}>
            <Text style={styles.muted}>Ready in</Text>
            <Text style={styles.bigTimer}>{formatCountdown(live.remainingSeconds)}</Text>
          </View>
        </Card>

        <View style={styles.fullWidth}>
          <Button
            label="View live orders"
            variant="dark"
            onPress={() => {
              reset();
              setActiveScreen('live_orders');
            }}
          />
          <Button label="Scan another receipt" variant="secondary" onPress={reset} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <StepProgress step={step} />

      {step === 'scan' && (
        <>
          <Viewfinder scanning={scanning} />

          <Button
            label={scanning ? 'Reading receipt…' : 'Scan receipt'}
            icon="scan"
            loading={scanning}
            disabled={scanning}
            onPress={() => startScan('camera')}
          />
          <Button
            label="Upload receipt"
            icon="image-outline"
            variant="secondary"
            disabled={scanning}
            onPress={() => startScan('library')}
          />
        </>
      )}

      {step === 'confirm' && template && (
        <>
          <Card style={styles.noPad}>
            <LiveMap
              style={styles.miniMap}
              interactive={false}
              pins={[
                {
                  id: 'p',
                  kind: 'pickup',
                  coordinate: coordsForPostcode(template.restaurantPostcode),
                },
                {
                  id: 'd',
                  kind: 'dropoff',
                  color: sourceColor(template.source),
                  coordinate: coordsForPostcode(postcode),
                },
              ]}
              route={[coordsForPostcode(template.restaurantPostcode), coordsForPostcode(postcode)]}
            />
            <View style={styles.mapFooter}>
              <SourceBadge source={template.source} />
              <Text style={styles.mutedStrong} numberOfLines={1}>
                {[template.externalOrderId, template.distanceMiles ? `${template.distanceMiles} mi` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
          </Card>

          <Card>
            <ListRow
              left={<Avatar name={template.customerName || 'Customer'} size={36} />}
              title={template.customerName || 'Customer'}
              subtitle={template.customerPhone || '—'}
            />
            <Field label="Delivery address" value={address} onChangeText={setAddress} />
            <View style={styles.twoCol}>
              <View style={styles.flex1}>
                <Field
                  label="Postcode"
                  value={postcode}
                  onChangeText={setPostcode}
                  autoCapitalize="characters"
                />
              </View>
              <View style={styles.flex1}>
                <Field label="Access code" value={accessCode} onChangeText={setAccessCode} />
              </View>
            </View>
          </Card>

          <Card onPress={() => setShowItems((v) => !v)}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>
                {template.items.reduce((n, i) => n + i.quantity, 0)} items
              </Text>
              <View style={styles.rowGap}>
                <Text style={styles.cardTitle}>{formatGbp(template.orderTotalGbp)}</Text>
                <Ionicons
                  name={showItems ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={C.ink3}
                />
              </View>
            </View>
            {showItems &&
              template.items.map((item, i) => (
                <View key={i} style={styles.itemRow}>
                  <Text style={styles.itemQty}>{item.quantity}×</Text>
                  <Text style={styles.itemName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.muted}>{formatGbp(item.price)}</Text>
                </View>
              ))}
          </Card>

          <View style={styles.actions}>
            <Button label="Back" variant="secondary" onPress={() => setStep('scan')} style={styles.flex1} />
            <Button
              label="Continue"
              onPress={() => setStep('prep')}
              disabled={!address.trim() || !postcode.trim()}
              style={styles.flex2}
            />
          </View>
        </>
      )}

      {step === 'prep' && template && (
        <>
          <Card>
            <Text style={styles.cardTitle}>Ready in</Text>
            <Text style={styles.prepValue}>{prep} min</Text>
            <View style={styles.wrapRow}>
              {PREP_OPTIONS.map((m) => (
                <Chip key={m} label={`${m} min`} selected={m === prep} onPress={() => setPrep(m)} />
              ))}
            </View>
          </Card>

          <Card>
            <Text style={styles.cardTitle}>Who delivers?</Text>
            <Segmented
              value={dispatch}
              onChange={setDispatch}
              options={[
                { value: 'open_platform', label: 'Platform driver' },
                { value: 'own_driver', label: 'My driver' },
              ]}
            />
            {dispatch === 'own_driver' ? (
              ownDrivers.length ? (
                ownDrivers.map((d) => (
                  <ListRow
                    key={d.id}
                    onPress={() => setOwnDriverId(d.id)}
                    left={<Avatar name={d.name} tone="info" size={36} />}
                    title={d.name}
                    subtitle={d.vehicle}
                    right={
                      <Ionicons
                        name={ownDriverId === d.id ? 'radio-button-on' : 'radio-button-off'}
                        size={22}
                        color={ownDriverId === d.id ? C.primary : C.lineStrong}
                      />
                    }
                  />
                ))
              ) : (
                <Hint>Add a driver under My drivers first.</Hint>
              )
            ) : (
              <View style={styles.rowBetween}>
                <Text style={styles.muted}>Delivery fee</Text>
                <Text style={styles.mutedStrong}>{formatGbp(template.estimatedFeeGbp)}</Text>
              </View>
            )}
          </Card>

          <View style={styles.actions}>
            <Button label="Back" variant="secondary" onPress={() => setStep('confirm')} style={styles.flex1} />
            <Button
              label="Post order"
              icon="send"
              onPress={post}
              loading={posting}
              disabled={posting || (dispatch === 'own_driver' && !ownDriverId)}
              style={styles.flex2}
            />
          </View>
        </>
      )}
    </Screen>
  );
}

function Viewfinder({ scanning }: { scanning: boolean }) {
  const line = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!scanning) {
      line.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(line, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [scanning, line]);

  const translateY = line.interpolate({ inputRange: [0, 1], outputRange: [0, 200] });

  return (
    <View style={styles.viewfinder}>
      {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
        <View key={c} style={[styles.corner, styles[c]]} />
      ))}
      {scanning && <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />}
      <Ionicons name="receipt-outline" size={44} color={scanning ? C.primary : C.ink3} />
      <Text style={styles.viewfinderText}>
        {scanning ? 'Reading receipt…' : 'Place the receipt inside the frame'}
      </Text>
    </View>
  );
}

/* ========================================================================== */
/* Live orders                                                                 */
/* ========================================================================== */

const STATUS_META: Record<
  LiveOrder['status'],
  { label: string; tone: 'neutral' | 'primary' | 'success' | 'warning' | 'info' }
> = {
  preparing: { label: 'Finding driver', tone: 'warning' },
  batched_offered: { label: 'Offered', tone: 'info' },
  driver_assigned: { label: 'Driver assigned', tone: 'info' },
  ready_for_pickup: { label: 'Ready', tone: 'success' },
  picked_up: { label: 'On the way', tone: 'success' },
  delivered: { label: 'Delivered', tone: 'neutral' },
};

function orderPins(orders: LiveOrder[]): MapPin[] {
  const pins: MapPin[] = [];
  const seen = new Set<string>();
  orders.forEach((o, i) => {
    if (!seen.has(o.restaurantPostcode)) {
      seen.add(o.restaurantPostcode);
      pins.push({ id: `r-${o.restaurantPostcode}`, kind: 'restaurant', coordinate: coordsForPostcode(o.restaurantPostcode) });
    }
    pins.push({
      id: `d-${o.id}`,
      kind: 'dropoff',
      label: `${i + 1}`,
      color: sourceColor(o.source),
      coordinate: coordsForPostcode(o.postcode),
    });
  });
  return pins;
}

function LiveOrdersScreen() {
  const { orders, markOrderReady, setActiveScreen, restaurants, activeRestaurantId } = useInThaRoute();
  const { openForOrder } = useChat();
  const restaurant = restaurants.find((r) => r.id === activeRestaurantId);
  const active = useMemo(
    () => orders.filter((o) => o.status !== 'delivered').sort((a, b) => a.remainingSeconds - b.remainingSeconds),
    [orders]
  );
  const ready = active.filter((o) => o.remainingSeconds === 0 || o.status === 'ready_for_pickup').length;

  return (
    <Screen>
      <Card style={styles.noPad}>
        <LiveMap style={styles.map} pins={orderPins(active)} />
      </Card>

      <Card style={styles.statsCard}>
        <Stat label="Active" value={`${active.length}`} />
        <View style={styles.vDivider} />
        <Stat label="Ready" value={`${ready}`} tone="success" />
        <View style={styles.vDivider} />
        <Stat label="Today" value={`${restaurant?.completedTodayCount ?? 0}`} />
      </Card>

      <SectionLabel>Orders</SectionLabel>
      {active.length === 0 ? (
        <Card>
          <EmptyState icon="receipt-outline" title="No live orders" subtitle="Scan a receipt to post one." />
          <Button label="New order" onPress={() => setActiveScreen('scan_receipt')} />
        </Card>
      ) : (
        active.map((o, i) => {
          const isReady = o.remainingSeconds === 0 || o.status === 'ready_for_pickup';
          const meta = isReady ? STATUS_META.ready_for_pickup : STATUS_META[o.status];
          const urgent = !isReady && o.remainingSeconds < 180;
          return (
            <Card key={o.id}>
              <View style={styles.rowBetween}>
                <View style={styles.rowGapShrink}>
                  <View style={styles.indexDot}>
                    <Text style={styles.indexText}>{i + 1}</Text>
                  </View>
                  <SourceBadge source={o.source} />
                  <Text style={styles.muted} numberOfLines={1}>
                    {o.externalOrderId}
                  </Text>
                </View>
                <View style={[styles.timerPill, isReady ? styles.timerReady : urgent && styles.timerUrgent]}>
                  <Ionicons
                    name={isReady ? 'checkmark' : 'time-outline'}
                    size={14}
                    color={isReady ? C.success : urgent ? C.primary : C.ink}
                  />
                  <Text
                    style={[
                      styles.timerText,
                      { color: isReady ? C.success : urgent ? C.primary : C.ink },
                    ]}>
                    {isReady ? 'Ready' : formatCountdown(o.remainingSeconds)}
                  </Text>
                </View>
              </View>

              <View style={styles.gap2}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {o.customerName}
                </Text>
                <Text style={styles.muted} numberOfLines={1}>
                  {o.deliveryAddress}, {o.postcode}
                </Text>
              </View>

              <Divider />

              <View style={styles.rowBetween}>
                <View style={styles.rowGapShrink}>
                  <Badge label={meta.label} tone={meta.tone} />
                  {o.assignedDriverName ? (
                    <Text style={styles.muted} numberOfLines={1}>
                      {o.assignedDriverName.split(' ')[0]}
                    </Text>
                  ) : null}
                </View>
                <View style={styles.rowGap}>
                  {/* Chat opens once a driver has accepted the order. */}
                  {o.assignedDriverId && (o.status === 'driver_assigned' || o.status === 'picked_up') && (
                    <Button
                      label="Chat"
                      icon="chatbubble-outline"
                      compact
                      variant="secondary"
                      onPress={() => openForOrder(o.id)}
                    />
                  )}
                  {!isReady && (
                    <Button label="Mark ready" compact variant="secondary" onPress={() => markOrderReady(o.id)} />
                  )}
                </View>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

/* ========================================================================== */
/* My drivers                                                                  */
/* ========================================================================== */

const VEHICLES = ['Motorcycle / Scooter', 'Car', 'E-Bike'] as const;
const VEHICLE_LABEL: Record<(typeof VEHICLES)[number], string> = {
  'Motorcycle / Scooter': 'Scooter',
  Car: 'Car',
  'E-Bike': 'E-Bike',
};

function MyDriversScreen() {
  const { drivers, activeRestaurantId, addRestaurantOwnDriver } = useInThaRoute();
  const own = drivers.filter(
    (d) => d.driverType === 'restaurant_own' && d.employerRestaurantId === activeRestaurantId
  );
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('Motorcycle / Scooter');
  const [plate, setPlate] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const canSave = !!name.trim() && !!email.trim() && password.length > 0 && !saving;

  // The driver signs in with this email and password; no documents or approval needed.
  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setErrors({});
    setFormError(null);
    const res = await addRestaurantOwnDriver({
      name: name.trim(),
      email: email.trim(),
      password,
      phone: phone.trim(),
      vehicle,
      plateNumber: plate.trim(),
    });
    setSaving(false);
    if (!res.ok) {
      setErrors(res.fields);
      if (Object.keys(res.fields).length === 0) setFormError(res.message);
      return;
    }
    setName('');
    setEmail('');
    setPassword('');
    setPhone('');
    setPlate('');
    setOpen(false);
  };

  return (
    <Screen>
      <Hint icon="shield-checkmark-outline">In-house drivers don’t need documents.</Hint>

      <Card>
        {own.length === 0 ? (
          <EmptyState icon="people-outline" title="No drivers yet" />
        ) : (
          own.map((d, i) => (
            <View key={d.id} style={styles.gap12}>
              {i > 0 && <Divider />}
              <ListRow
                left={<Avatar name={d.name} tone="info" />}
                title={d.name}
                subtitle={`${VEHICLE_LABEL[d.vehicle]} · ${d.completedDeliveries} trips`}
                right={
                  d.isOnline ? <Badge label="Online" tone="success" /> : <Badge label="Offline" />
                }
              />
            </View>
          ))
        )}
      </Card>

      <Button label="Add driver" icon="person-add-outline" variant="dark" onPress={() => setOpen(true)} />

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add driver">
        <Field
          label="Full name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Sam Patel"
          error={errors.fullName}
        />
        <Field
          label="Email (for login)"
          value={email}
          onChangeText={setEmail}
          placeholder="sam@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          error={errors.email}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="At least 8 characters"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          error={errors.password}
        />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          placeholder="07…"
          error={errors.phone}
        />
        <View style={styles.gap8}>
          <Text style={styles.fieldLabel}>Vehicle</Text>
          <View style={styles.wrapRow}>
            {VEHICLES.map((v) => (
              <Chip key={v} label={VEHICLE_LABEL[v]} selected={v === vehicle} onPress={() => setVehicle(v)} />
            ))}
          </View>
        </View>
        <Field
          label="Plate (optional)"
          value={plate}
          onChangeText={setPlate}
          autoCapitalize="characters"
          error={errors.plateNumber}
        />
        {formError ? <Hint icon="alert-circle-outline">{formError}</Hint> : null}
        <Button label="Add driver" onPress={save} loading={saving} disabled={!canSave} />
      </Sheet>
    </Screen>
  );
}

/* ========================================================================== */
/* Delivery settings                                                           */
/* ========================================================================== */

const POLICIES: {
  value: DriverPolicy;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { value: 'open_platform', title: 'Platform drivers', subtitle: 'Any verified driver nearby', icon: 'globe-outline' },
  { value: 'hybrid', title: 'Hybrid', subtitle: 'Your drivers first, then platform', icon: 'git-merge-outline' },
  { value: 'own_drivers', title: 'My drivers only', subtitle: 'Only your in-house team', icon: 'people-outline' },
];

function DeliverySettingsScreen() {
  const { restaurants, activeRestaurantId, updateRestaurantPolicy, algorithm } = useInThaRoute();
  const restaurant = restaurants.find((r) => r.id === activeRestaurantId) ?? restaurants[0];

  return (
    <Screen>
      <SectionLabel>Who delivers your orders</SectionLabel>
      {POLICIES.map((p) => {
        const selected = restaurant.driverPolicy === p.value;
        return (
          <Pressable
            key={p.value}
            onPress={() => updateRestaurantPolicy(restaurant.id, p.value)}
            style={({ pressed }) => [styles.optionCard, selected && styles.optionSelected, pressed && { opacity: 0.8 }]}>
            <IconTile icon={p.icon} tone={selected ? 'primary' : 'neutral'} size={44} />
            <View style={styles.flexText}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {p.title}
              </Text>
              <Text style={styles.muted} numberOfLines={1}>
                {p.subtitle}
              </Text>
            </View>
            <Ionicons
              name={selected ? 'radio-button-on' : 'radio-button-off'}
              size={24}
              color={selected ? C.primary : C.lineStrong}
            />
          </Pressable>
        );
      })}

      <SectionLabel>Billing</SectionLabel>
      <Card>
        <ListRow
          left={<IconTile icon="card-outline" size={36} />}
          title="Platform delivery"
          subtitle="Per order"
          right={<Text style={styles.cardTitle}>{formatGbp(algorithm.baseRestaurantChargeGbp)}</Text>}
        />
        <Divider />
        <ListRow
          left={<IconTile icon="people-outline" size={36} />}
          title="Your own drivers"
          subtitle="No platform fee"
          right={<Text style={styles.cardTitle}>{formatGbp(0)}</Text>}
        />
      </Card>
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
  fullWidth: { alignSelf: 'stretch', gap: 10 },
  gap2: { gap: 2 },
  gap8: { gap: 8 },
  gap12: { gap: 12 },
  noPad: { padding: 0, gap: 0, overflow: 'hidden' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowGapShrink: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, minWidth: 0 },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  twoCol: { flexDirection: 'row', gap: 12 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  chipRow: { gap: 8, paddingHorizontal: 2 },

  cardTitle: { ...Brand.type.bodyStrong, color: C.ink },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  mutedStrong: { ...Brand.type.captionStrong, color: C.ink2, flexShrink: 1 },
  fieldLabel: { ...Brand.type.captionStrong, color: C.ink2 },

  progressWrap: { gap: 8, marginBottom: 4 },
  progressBars: { flexDirection: 'row', gap: 6 },
  progressBar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.line },
  progressBarActive: { backgroundColor: C.primary },
  progressText: { ...Brand.type.captionStrong, color: C.ink3 },

  viewfinder: {
    height: 260,
    borderRadius: Brand.radius.lg,
    backgroundColor: C.surface,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  viewfinderText: { ...Brand.type.caption, color: C.ink3 },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: C.ink, borderWidth: 0 },
  tl: { top: 20, left: 20, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 10 },
  tr: { top: 20, right: 20, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 10 },
  bl: { bottom: 20, left: 20, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 10 },
  br: { bottom: 20, right: 20, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 10 },
  scanLine: {
    position: 'absolute',
    top: 30,
    left: 32,
    right: 32,
    height: 2,
    borderRadius: 1,
    backgroundColor: C.primary,
    opacity: 0.8,
  },

  miniMap: { height: 170 },
  map: { height: 220 },
  mapFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 14,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemQty: { ...Brand.type.captionStrong, color: C.ink2, width: 26 },
  itemName: { ...Brand.type.caption, color: C.ink, flex: 1, minWidth: 0 },

  prepValue: { fontSize: 34, fontWeight: '700', color: C.ink, letterSpacing: -0.8 },

  doneContent: { alignItems: 'center', paddingTop: 40, gap: 12 },
  doneIcon: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: C.success,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  doneTitle: { ...Brand.type.title, color: C.ink },
  doneSubtitle: { ...Brand.type.body, color: C.ink2, textAlign: 'center', marginBottom: 8 },
  doneCard: { alignSelf: 'stretch' },
  bigTimer: { fontSize: 24, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },

  statsCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },
  indexDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Brand.radius.pill,
    backgroundColor: C.surfaceAlt,
    flexShrink: 0,
  },
  timerReady: { backgroundColor: C.successSoft },
  timerUrgent: { backgroundColor: C.primarySoft },
  timerText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },

  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: Brand.radius.lg,
    backgroundColor: C.surface,
    borderWidth: 1.5,
    borderColor: C.line,
  },
  optionSelected: { borderColor: C.primary, backgroundColor: C.primarySoft },
});
