import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { ReceiptSheet } from '@/components/ReceiptSheet';
import { Button, Card, Divider, EmptyState, SectionLabel, Segmented, Screen, SourceBadge } from '@/components/ui';
import { Brand, formatGbp, sourceColor } from '@/constants/brand';
import { errorMessage, LiveOrder, useInThaRoute } from '@/context/InThaRouteContext';
import { api } from '@/services/apiClient';

const C = Brand.colors;

// Charts use a lighter shade of the brand red, so large shapes stay easy on the eye.
const ACCENT = '#F27D81';
const ACCENT_SOFT = '#FCE1E2';

if (Platform.OS === 'android') UIManager.setLayoutAnimationEnabledExperimental?.(true);

const clock = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
};
const minutes = (n: number | null) => (n == null ? '—' : `${Math.round(n)} min`);

/**
 * Changes whenever one of the merchant's live orders is posted, moves on, or finishes,
 * so the screens below can reload the moment something happens.
 */
function useOrdersVersion() {
  const { orders } = useInThaRoute();
  return orders.map((o) => `${o.id}:${o.status}`).join('|');
}

/** Runs `fn` when `version` changes after the first render (not on mount). */
function useOnChange(version: string, fn: () => void) {
  const first = useRef(version);
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  });
  useEffect(() => {
    if (first.current === version) return;
    first.current = version;
    latest.current();
  }, [version]);
}

/** A 0 → 1 value that plays whenever `key` changes. */
function useGrow(key: unknown, duration = 700, delay = 0) {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    v.setValue(0);
    Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [v, key, duration, delay]);
  return v;
}

/** Fades and lifts a card into place, one after another. */
function Reveal({ index, children }: { index: number; children: React.ReactNode }) {
  const v = useGrow('once', 450, index * 70);
  return (
    <Animated.View
      style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

/** A number that counts up to its new value. */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const id = v.addListener(({ value: n }) => setShown(n));
    Animated.timing(v, { toValue: value, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(
      () => setShown(value)
    );
    return () => v.removeListener(id);
  }, [v, value]);
  return <>{format(shown)}</>;
}

const wholeNumber = (n: number) => `${Math.round(n)}`;

/** A softly pulsing dot: this screen keeps itself up to date. */
function LiveDot() {
  const [v] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(v, { toValue: 1, duration: 1600, easing: Easing.out(Easing.quad), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={styles.live}>
      <View style={styles.liveDotWrap}>
        <Animated.View
          style={[
            styles.liveHalo,
            {
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.6] }) }],
            },
          ]}
        />
        <View style={styles.liveDot} />
      </View>
      <Text style={styles.liveText}>Live</Text>
    </View>
  );
}

/* ========================================================================== */
/* Past orders                                                                 */
/* ========================================================================== */

interface PastOrder extends LiveOrder {
  createdAt: string;
  pickedUpAt: string | null;
  deliveredAt: string;
  deliveredLabel: string;
  totalMinutes: number | null;
  deliveryMinutes: number | null;
}

interface HistoryPage {
  orders: PastOrder[];
  totals: { orders: number; salesGbp: number; feesGbp: number };
  nextBefore: string | null;
}

export function PastOrdersScreen() {
  const [orders, setOrders] = useState<PastOrder[]>([]);
  const [totals, setTotals] = useState<HistoryPage['totals'] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<LiveOrder | null>(null);

  const fetchPage = async (before?: string) => {
    try {
      const page = await api<HistoryPage>(
        'GET',
        `/api/restaurant/history${before ? `?before=${encodeURIComponent(before)}` : ''}`
      );
      setOrders((prev) => (before ? [...prev, ...page.orders] : page.orders));
      setTotals(page.totals);
      setNextBefore(page.nextBefore);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  const load = (before?: string) => {
    setLoading(true);
    setError(null);
    fetchPage(before);
  };

  useEffect(() => {
    Promise.resolve().then(() => fetchPage());
  }, []);
  // An order just delivered appears at the top straight away.
  useOnChange(useOrdersVersion(), () => fetchPage());

  // Grouped by the day they were delivered ("Today", "Yesterday", "12 Nov").
  const groups = useMemo(() => {
    const out: { day: string; orders: PastOrder[] }[] = [];
    orders.forEach((o) => {
      const day = o.deliveredLabel.split(',')[0];
      const last = out[out.length - 1];
      if (last && last.day === day) last.orders.push(o);
      else out.push({ day, orders: [o] });
    });
    return out;
  }, [orders]);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.create(200, 'easeInEaseOut', 'opacity'));
    setOpenId((cur) => (cur === id ? null : id));
  };

  return (
    <Screen>
      <Card style={styles.totalsCard}>
        <TotalCell label="Delivered" value={`${totals?.orders ?? 0}`} />
        <View style={styles.vDivider} />
        <TotalCell label="Sales" value={formatGbp(totals?.salesGbp ?? 0)} tone={C.success} />
        <View style={styles.vDivider} />
        <TotalCell label="Delivery fees" value={formatGbp(totals?.feesGbp ?? 0)} />
      </Card>

      {error && (
        <Card>
          <Text style={styles.muted}>{error}</Text>
          <Button label="Try again" icon="refresh" variant="secondary" onPress={() => load()} />
        </Card>
      )}

      {!error && orders.length === 0 && !loading && (
        <Card>
          <EmptyState
            icon="receipt-outline"
            title="No past orders yet"
            subtitle="Orders appear here once the driver has delivered them."
          />
        </Card>
      )}

      {groups.map((g) => (
        <View key={g.day} style={styles.group}>
          <SectionLabel right={<Text style={styles.muted}>{`${g.orders.length} ${g.orders.length === 1 ? 'order' : 'orders'}`}</Text>}>
            {g.day}
          </SectionLabel>
          <Card style={styles.listCard}>
            {g.orders.map((o, i) => (
              <View key={o.id}>
                {i > 0 && <Divider />}
                <PastOrderRow
                  order={o}
                  open={openId === o.id}
                  onToggle={() => toggle(o.id)}
                  onReceipt={() => setReceiptOrder(o)}
                />
              </View>
            ))}
          </Card>
        </View>
      ))}

      {loading ? (
        <ActivityIndicator color={C.primary} />
      ) : (
        nextBefore && <Button label="Load more" variant="secondary" onPress={() => load(nextBefore)} />
      )}

      <ReceiptSheet order={receiptOrder} as="restaurant" onClose={() => setReceiptOrder(null)} />
    </Screen>
  );
}

function TotalCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <View style={styles.totalCell}>
      <Text style={styles.totalLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.totalValue, tone ? { color: tone } : null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
    </View>
  );
}

function PastOrderRow({
  order: o,
  open,
  onToggle,
  onReceipt,
}: {
  order: PastOrder;
  open: boolean;
  onToggle: () => void;
  onReceipt: () => void;
}) {
  const ownDriver = o.assignedDriverType === 'restaurant_own';
  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
        <View style={[styles.sourceBar, { backgroundColor: sourceColor(o.source) }]} />
        <View style={styles.flexText}>
          <View style={styles.rowGap}>
            <SourceBadge source={o.source} />
            <Text style={styles.muted} numberOfLines={1}>
              {o.externalOrderId}
            </Text>
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {o.customerName || 'Customer'}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            {`Delivered ${clock(o.deliveredAt)} · ${o.postcode}`}
          </Text>
        </View>
        <View style={styles.rowEnd}>
          <Text style={styles.amount}>{formatGbp(o.orderTotalGbp)}</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.ink3} />
        </View>
      </Pressable>

      {open && (
        <View style={styles.details}>
          <DetailBlock icon="home-outline" title={o.deliveryAddress} subtitle={o.postcode} />
          <DetailBlock
            icon={ownDriver ? 'people-outline' : 'bicycle-outline'}
            title={o.assignedDriverName ?? 'Driver'}
            subtitle={ownDriver ? 'Your driver' : 'Platform driver'}
          />

          {o.items.length > 0 && (
            <View style={styles.panel}>
              {o.items.map((it, i) => (
                <View key={`${it.name}-${i}`} style={styles.itemRow}>
                  <Text style={styles.itemQty}>{`${it.quantity}×`}</Text>
                  <Text style={styles.itemName} numberOfLines={2}>
                    {it.name}
                  </Text>
                  {it.price > 0 && <Text style={styles.itemPrice}>{formatGbp(it.price)}</Text>}
                </View>
              ))}
            </View>
          )}

          <View style={styles.timeline}>
            <TimelineStep label="Posted" time={clock(o.createdAt)} />
            <View style={styles.timelineLine} />
            <TimelineStep label="Picked up" time={clock(o.pickedUpAt)} />
            <View style={styles.timelineLine} />
            <TimelineStep label="Delivered" time={clock(o.deliveredAt)} done />
          </View>

          <View style={styles.panel}>
            <KeyValue label="Order total" value={formatGbp(o.orderTotalGbp)} strong />
            <KeyValue label="Delivery fee" value={ownDriver ? 'Your driver' : formatGbp(o.restaurantFeeGbp)} />
            <KeyValue label="Distance" value={`${o.distanceMiles} mi`} />
            <KeyValue label="Prep time" value={`${o.prepMinutes} min`} />
            <KeyValue label="On the road" value={minutes(o.deliveryMinutes)} />
            <KeyValue label="Posted to delivered" value={minutes(o.totalMinutes)} />
          </View>

          {o.hasReceipt && <Button label="View receipt" icon="document-text-outline" variant="secondary" onPress={onReceipt} />}
        </View>
      )}
    </View>
  );
}

function DetailBlock({ icon, title, subtitle }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string }) {
  return (
    <View style={styles.detailBlock}>
      <View style={styles.detailIcon}>
        <Ionicons name={icon} size={16} color={C.ink2} />
      </View>
      <View style={styles.flexText}>
        <Text style={styles.detailTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.muted}>{subtitle}</Text>
      </View>
    </View>
  );
}

function TimelineStep({ label, time, done }: { label: string; time: string; done?: boolean }) {
  return (
    <View style={styles.timelineStep}>
      <View style={[styles.timelineDot, done && { backgroundColor: C.success }]} />
      <Text style={styles.timelineTime}>{time}</Text>
      <Text style={styles.timelineLabel}>{label}</Text>
    </View>
  );
}

function KeyValue({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={[styles.kvValue, strong && styles.kvStrong]}>{value}</Text>
    </View>
  );
}

/* ========================================================================== */
/* Analytics                                                                   */
/* ========================================================================== */

type Range = '7' | '30' | '90';

interface Analytics {
  days: number;
  summary: {
    orders: number;
    salesGbp: number;
    feesGbp: number;
    averageOrderGbp: number;
    cancelled: number;
    active: number;
    completionRate: number | null;
    deliveryMinutes: number | null;
    totalMinutes: number | null;
    prepMinutes: number | null;
  };
  previous: { orders: number; salesGbp: number };
  daily: { date: string; weekday: string; orders: number; salesGbp: number }[];
  hours: { hour: number; orders: number }[];
  drivers: { own: number; platform: number };
  topItems: { name: string; quantity: number }[];
}

const RANGES: { value: Range; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** Percentage change on the period before, or null when there is nothing to compare. */
const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

export function AnalyticsScreen() {
  const [range, setRange] = useState<Range>('7');
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRange = async (r: Range) => {
    try {
      setData(await api<Analytics>('GET', `/api/restaurant/analytics?days=${r}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  const load = (r: Range) => {
    setLoading(true);
    setError(null);
    fetchRange(r);
  };
  const pickRange = (r: Range) => {
    setRange(r);
    load(r);
  };

  useEffect(() => {
    Promise.resolve().then(() => fetchRange('7'));
  }, []);
  // Live: reload quietly when an order changes, and every 30 seconds while open.
  const rangeNow = useRef(range);
  useEffect(() => {
    rangeNow.current = range;
  }, [range]);
  useOnChange(useOrdersVersion(), () => fetchRange(rangeNow.current));
  useEffect(() => {
    const timer = setInterval(() => fetchRange(rangeNow.current), 30_000);
    return () => clearInterval(timer);
  }, []);

  const s = data?.summary;
  const empty = !!data && s!.orders === 0 && s!.cancelled === 0 && s!.active === 0;

  return (
    <Screen>
      <View style={styles.rangeRow}>
        <View style={styles.flexText}>
          <Segmented options={RANGES} value={range} onChange={pickRange} />
        </View>
        <LiveDot />
      </View>

      {error && (
        <Card>
          <Text style={styles.muted}>{error}</Text>
          <Button label="Try again" icon="refresh" variant="secondary" onPress={() => load(range)} />
        </Card>
      )}

      {!data && loading && <ActivityIndicator color={C.primary} style={styles.loader} />}

      {data && s && (
        <View style={[styles.analytics, loading && { opacity: 0.5 }]}>
          <Reveal index={0}>
            <SalesHero data={data} />
          </Reveal>

          <Reveal index={1}>
            <View style={styles.kpiGrid}>
              <Kpi
                icon="bag-check-outline"
                label="Orders delivered"
                value={<CountUp value={s.orders} format={wholeNumber} />}
                delta={change(s.orders, data.previous.orders)}
              />
              <Kpi icon="pricetag-outline" label="Average order" value={<CountUp value={s.averageOrderGbp} format={formatGbp} />} />
              <Kpi icon="car-outline" label="Delivery fees" value={<CountUp value={s.feesGbp} format={formatGbp} />} />
              <Kpi
                icon="checkmark-done-outline"
                label="Completed"
                value={s.completionRate == null ? '—' : <CountUp value={s.completionRate} format={(n) => `${Math.round(n)}%`} />}
                hint={s.cancelled ? `${s.cancelled} cancelled` : undefined}
              />
            </View>
          </Reveal>

          {s.active > 0 && (
            <Reveal index={2}>
              <View style={styles.activeBanner}>
                <Ionicons name="pulse-outline" size={16} color={C.info} />
                <Text style={styles.activeText}>
                  {`${s.active} ${s.active === 1 ? 'order is' : 'orders are'} live right now. ${s.active === 1 ? 'It counts' : 'They count'} here once delivered.`}
                </Text>
              </View>
            </Reveal>
          )}

          {empty ? (
            <Card>
              <EmptyState
                icon="stats-chart-outline"
                title="No orders in this period"
                subtitle="Your charts fill in as orders are delivered."
              />
            </Card>
          ) : (
            <>
              <Reveal index={3}>
                <Card style={styles.chartCard}>
                  <ChartHeader title="Speed" subtitle="Average per delivered order" />
                  <View style={styles.speedRow}>
                    <SpeedCell icon="flame-outline" label="Prep" value={minutes(s.prepMinutes)} />
                    <SpeedCell icon="bicycle-outline" label="On the road" value={minutes(s.deliveryMinutes)} />
                    <SpeedCell icon="time-outline" label="Start to door" value={minutes(s.totalMinutes)} />
                  </View>
                </Card>
              </Reveal>

              <Reveal index={4}>
                <Card style={styles.chartCard}>
                  <ChartHeader title="Orders per day" subtitle={`${s.orders} delivered`} />
                  <DayBars daily={data.daily} />
                </Card>
              </Reveal>

              <Reveal index={5}>
                <Card style={styles.chartCard}>
                  <ChartHeader title="Busiest hours" subtitle="When delivered orders were posted" />
                  <HourBars hours={data.hours} />
                </Card>
              </Reveal>

              {data.drivers.own + data.drivers.platform > 0 && (
                <Reveal index={6}>
                  <Card style={styles.chartCard}>
                    <ChartHeader title="Who delivered" subtitle="Your drivers and platform drivers" />
                    <DriverSplit own={data.drivers.own} platform={data.drivers.platform} />
                  </Card>
                </Reveal>
              )}

              {data.topItems.length > 0 && (
                <Reveal index={7}>
                  <Card style={styles.chartCard}>
                    <ChartHeader title="Top items" subtitle="Most ordered" />
                    <TopItems items={data.topItems} />
                  </Card>
                </Reveal>
              )}
            </>
          )}
        </View>
      )}
    </Screen>
  );
}

function ChartHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.chartHeader}>
      <Text style={styles.chartTitle}>{title}</Text>
      {subtitle && <Text style={styles.muted}>{subtitle}</Text>}
    </View>
  );
}

function Delta({ value }: { value: number | null }) {
  if (value == null) return null;
  const up = value >= 0;
  return (
    <View style={[styles.delta, { backgroundColor: up ? C.successSoft : C.primarySoft }]}>
      <Ionicons name={up ? 'trending-up' : 'trending-down'} size={12} color={up ? C.success : ACCENT} />
      <Text style={[styles.deltaText, { color: up ? C.success : ACCENT }]}>{`${up ? '+' : ''}${value}%`}</Text>
    </View>
  );
}

/** Sales total with a smooth area chart of sales per day. */
function SalesHero({ data }: { data: Analytics }) {
  const [width, setWidth] = useState(0);
  const height = 120;
  const values = data.daily.map((d) => d.salesGbp);
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => ({
    // Inset so the end dot is not cut off at the edges.
    x: values.length === 1 ? width / 2 : 6 + (i / (values.length - 1)) * (width - 12),
    y: 8 + (1 - v / max) * (height - 16),
  }));
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L ${pts[pts.length - 1].x} ${height} L ${pts[0].x} ${height} Z` : '';
  const last = pts[pts.length - 1];
  // The line draws itself from left to right whenever the numbers change.
  const reveal = useGrow(line, 900);

  // A few dates under the chart: every day for a week, otherwise start, middle and end.
  const labels =
    data.daily.length <= 7
      ? data.daily.map((d) => d.weekday)
      : [0, Math.floor((data.daily.length - 1) / 2), data.daily.length - 1].map((i) => shortDate(data.daily[i].date));

  return (
    <Card style={styles.heroCard}>
      <View style={styles.rowBetween}>
        <Text style={styles.heroLabel}>Sales</Text>
        <Delta value={change(data.summary.salesGbp, data.previous.salesGbp)} />
      </View>
      <Text style={styles.heroValue} numberOfLines={1} adjustsFontSizeToFit>
        <CountUp value={data.summary.salesGbp} format={formatGbp} />
      </Text>
      <Text style={styles.muted}>{`Delivered orders, last ${data.days} days`}</Text>
      <View style={{ height }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Animated.View
            style={[
              styles.reveal,
              { width, transform: [{ scaleX: reveal }], opacity: reveal.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 1] }) },
            ]}>
          <Svg width={width} height={height}>
            <Defs>
              <LinearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={ACCENT} stopOpacity={0.18} />
                <Stop offset="1" stopColor={ACCENT} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={area} fill="url(#salesFill)" />
            <Path d={line} stroke={ACCENT} strokeWidth={2.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            {last && <Circle cx={last.x} cy={last.y} r={4.5} fill={C.surface} stroke={ACCENT} strokeWidth={2.5} />}
          </Svg>
          </Animated.View>
        )}
      </View>
      <View style={styles.axisRow}>
        {labels.map((l, i) => (
          <Text key={`${l}-${i}`} style={styles.axisText}>
            {l}
          </Text>
        ))}
      </View>
    </Card>
  );
}

const shortDate = (ymd: string) => {
  const [, m, d] = ymd.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
};

/** A smooth curve through the points (horizontal control points, so it never overshoots sideways). */
function smoothPath(pts: { x: number; y: number }[]) {
  if (!pts.length) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const mx = (a.x + b.x) / 2;
    d += ` C ${mx} ${a.y}, ${mx} ${b.y}, ${b.x} ${b.y}`;
  }
  return d;
}

function Kpi({
  icon,
  label,
  value,
  delta,
  hint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: React.ReactNode;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <View style={styles.kpi}>
      <View style={styles.rowBetween}>
        <View style={styles.kpiIcon}>
          <Ionicons name={icon} size={16} color={ACCENT} />
        </View>
        <Delta value={delta ?? null} />
      </View>
      <Text style={styles.kpiValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
        {value}
      </Text>
      <Text style={styles.muted} numberOfLines={1}>
        {hint ? `${label} · ${hint}` : label}
      </Text>
    </View>
  );
}

function SpeedCell({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <View style={styles.speedCell}>
      <Ionicons name={icon} size={18} color={ACCENT} />
      <Text style={styles.speedValue}>{value}</Text>
      <Text style={styles.muted} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Vertical bars, the tallest in the brand colour. */
function Bars({ values, labels, height = 110 }: { values: number[]; labels: string[]; height?: number }) {
  const max = Math.max(...values, 1);
  const top = Math.max(...values);
  const gap = values.length > 40 ? 1 : values.length > 14 ? 2 : 6;
  // Bars rise in a gentle wave from left to right when the numbers change.
  const grow = useGrow(values.join(','), 900);
  const n = values.length;
  return (
    <View style={styles.barsWrap}>
      <View style={[styles.bars, { height, gap }]}>
        {values.map((v, i) => (
          <View key={i} style={styles.barSlot}>
            <Animated.View
              style={[
                styles.bar,
                {
                  height: v > 0 ? Math.max(4, (v / max) * height) : 3,
                  backgroundColor: v > 0 && v === top ? ACCENT : v > 0 ? ACCENT_SOFT : C.line,
                  transform: [
                    {
                      scaleY: grow.interpolate({
                        inputRange: [(i / n) * 0.5, (i / n) * 0.5 + 0.5],
                        outputRange: [0, 1],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.axisRow}>
        {labels.map((l, i) => (
          <Text key={`${l}-${i}`} style={styles.axisText}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function DayBars({ daily }: { daily: Analytics['daily'] }) {
  const labels =
    daily.length <= 7
      ? daily.map((d) => d.weekday)
      : [0, Math.floor((daily.length - 1) / 2), daily.length - 1].map((i) => shortDate(daily[i].date));
  return <Bars values={daily.map((d) => d.orders)} labels={labels} />;
}

function HourBars({ hours }: { hours: Analytics['hours'] }) {
  const peak = hours.reduce((a, b) => (b.orders > a.orders ? b : a), hours[0]);
  return (
    <View style={styles.gap10}>
      {peak.orders > 0 && (
        <View style={styles.peak}>
          <Ionicons name="flash" size={14} color={C.warning} />
          <Text style={styles.peakText}>{`Busiest around ${peak.hour.toString().padStart(2, '0')}:00`}</Text>
        </View>
      )}
      <Bars values={hours.map((h) => h.orders)} labels={['00:00', '06:00', '12:00', '18:00', '23:00']} height={90} />
    </View>
  );
}

function DriverSplit({ own, platform }: { own: number; platform: number }) {
  const total = own + platform;
  const grow = useGrow(`${own}-${platform}`, 800);
  return (
    <View style={styles.gap10}>
      <Animated.View style={[styles.splitBar, styles.growLeft, { transform: [{ scaleX: grow }] }]}>
        {own > 0 && <View style={{ flex: own, backgroundColor: C.ink2 }} />}
        {platform > 0 && <View style={{ flex: platform, backgroundColor: ACCENT }} />}
      </Animated.View>
      <View style={styles.gap6}>
        <SplitLegend color={C.ink2} label="Your drivers" count={own} pct={Math.round((own / total) * 100)} />
        <SplitLegend color={ACCENT} label="Platform drivers" count={platform} pct={Math.round((platform / total) * 100)} />
      </View>
    </View>
  );
}

function SplitLegend({ color, label, count, pct }: { color: string; label: string; count: number; pct: number }) {
  return (
    <View style={styles.legendRow}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={[styles.legendName, styles.flexText]}>{label}</Text>
      <Text style={styles.legendPct}>{`${count} · ${pct}%`}</Text>
    </View>
  );
}

function TopItems({ items }: { items: Analytics['topItems'] }) {
  const max = Math.max(...items.map((i) => i.quantity), 1);
  const grow = useGrow(items.map((i) => `${i.name}${i.quantity}`).join(','), 900);
  return (
    <View style={styles.gap12}>
      {items.map((it, i) => (
        <View key={it.name} style={styles.gap6}>
          <View style={styles.rowBetween}>
            <View style={styles.rowGapShrink}>
              <Text style={styles.rank}>{i + 1}</Text>
              <Text style={styles.legendName} numberOfLines={1}>
                {it.name}
              </Text>
            </View>
            <Text style={styles.mutedStrong}>{`${it.quantity} sold`}</Text>
          </View>
          <View style={styles.track}>
            <Animated.View
              style={[
                styles.fill,
                styles.growLeft,
                { width: `${(it.quantity / max) * 100}%`, opacity: 1 - i * 0.15, transform: [{ scaleX: grow }] },
              ]}
            />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  mutedStrong: { ...Brand.type.captionStrong, color: C.ink2 },
  title: { ...Brand.type.bodyStrong, color: C.ink },
  flexText: { flex: 1, minWidth: 0, gap: 2 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowGapShrink: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1, minWidth: 0 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  gap6: { gap: 6 },
  gap10: { gap: 10 },
  gap12: { gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },

  // Past orders
  totalsCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  totalCell: { flex: 1, alignItems: 'center', gap: 4 },
  totalLabel: { ...Brand.type.caption, color: C.ink3 },
  totalValue: { fontSize: 20, fontWeight: '700', color: C.ink, letterSpacing: -0.3 },
  group: { gap: 8 },
  listCard: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingRight: 14 },
  sourceBar: { width: 4, alignSelf: 'stretch', borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  rowEnd: { alignItems: 'flex-end', gap: 4 },
  amount: { ...Brand.type.bodyStrong, color: C.ink, fontVariant: ['tabular-nums'] },
  details: { gap: 12, paddingHorizontal: 16, paddingBottom: 16 },
  detailBlock: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: C.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: { ...Brand.type.captionStrong, color: C.ink },
  panel: { backgroundColor: C.surfaceAlt, borderRadius: Brand.radius.md, padding: 12, gap: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemQty: { ...Brand.type.captionStrong, color: C.ink2, width: 26 },
  itemName: { ...Brand.type.caption, color: C.ink, flex: 1, minWidth: 0 },
  itemPrice: { ...Brand.type.caption, color: C.ink2, fontVariant: ['tabular-nums'] },
  timeline: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 4 },
  timelineStep: { alignItems: 'center', gap: 4, width: 76 },
  timelineDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.ink3, marginTop: 2 },
  timelineLine: { flex: 1, height: 2, backgroundColor: C.line, marginTop: 6 },
  timelineTime: { ...Brand.type.captionStrong, color: C.ink, fontVariant: ['tabular-nums'] },
  timelineLabel: { ...Brand.type.micro, color: C.ink3, letterSpacing: 0 },
  kv: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  kvLabel: { ...Brand.type.caption, color: C.ink2 },
  kvValue: { ...Brand.type.captionStrong, color: C.ink, fontVariant: ['tabular-nums'] },
  kvStrong: { ...Brand.type.bodyStrong },

  // Analytics
  loader: { marginTop: 40 },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Brand.radius.pill,
    backgroundColor: C.successSoft,
  },
  liveDotWrap: { width: 8, height: 8, alignItems: 'center', justifyContent: 'center' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
  liveHalo: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: C.success },
  liveText: { ...Brand.type.captionStrong, color: C.success },
  reveal: { overflow: 'hidden', transformOrigin: 'left' },
  growLeft: { transformOrigin: 'left' },
  activeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Brand.radius.md,
    backgroundColor: C.infoSoft,
  },
  activeText: { ...Brand.type.caption, color: C.ink, flex: 1 },
  analytics: { gap: 12 },
  heroCard: { gap: 6 },
  heroLabel: { ...Brand.type.captionStrong, color: C.ink2 },
  heroValue: { fontSize: 34, fontWeight: '700', color: C.ink, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  axisRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { ...Brand.type.micro, color: C.ink3, letterSpacing: 0 },
  delta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Brand.radius.pill,
  },
  deltaText: { fontSize: 11, fontWeight: '700' },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpi: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: C.surface,
    borderRadius: Brand.radius.lg,
    padding: 14,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
    ...Brand.shadow.card,
  },
  kpiIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: C.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiValue: { fontSize: 22, fontWeight: '700', color: C.ink, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  chartCard: { gap: 14 },
  chartHeader: { gap: 2 },
  chartTitle: { ...Brand.type.heading, color: C.ink },
  speedRow: { flexDirection: 'row', gap: 8 },
  speedCell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 12,
    borderRadius: Brand.radius.md,
    backgroundColor: C.surfaceAlt,
  },
  speedValue: { ...Brand.type.bodyStrong, color: C.ink, fontVariant: ['tabular-nums'] },
  barsWrap: { gap: 2 },
  bars: { flexDirection: 'row', alignItems: 'flex-end' },
  barSlot: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { borderRadius: 4, width: '100%', transformOrigin: 'bottom' },
  peak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Brand.radius.pill,
    backgroundColor: C.warningSoft,
  },
  peakText: { ...Brand.type.captionStrong, color: C.ink },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendName: { ...Brand.type.captionStrong, color: C.ink, flexShrink: 1 },
  legendPct: { ...Brand.type.captionStrong, color: C.ink2, fontVariant: ['tabular-nums'] },
  splitBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2 },
  rank: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: C.surfaceAlt,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 12,
    fontWeight: '700',
    color: C.ink2,
    overflow: 'hidden',
  },
  track: { height: 8, borderRadius: 4, backgroundColor: C.surfaceAlt, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4, backgroundColor: ACCENT },
});
