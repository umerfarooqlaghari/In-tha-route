import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { CreditActivityRow, creditWhen } from '@/components/CreditActivity';
import { Badge, Button, Card, Chip, Divider, EmptyState, Field, Screen, SectionLabel, Segmented, Sheet, Stat } from '@/components/ui';
import { Brand, formatGbp } from '@/constants/brand';
import { CreditKind, CreditTransaction, RestaurantPartner, useInThaRoute } from '@/context/InThaRouteContext';
import { api } from '@/services/apiClient';

const C = Brand.colors;
const shortName = (n: string) => (n ?? '').split(' - ')[0];
/** Typed amounts: digits and one decimal point. */
const cleanAmount = (v: string) => v.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1');

/** Below one delivery at its fee: the merchant can't post any order. */
export const isLowOnCredits = (r: RestaurantPartner) =>
  r.isActive !== false && (r.credits?.available ?? 0) < (r.feePerDeliveryGbp ?? 0);

/* ========================================================================== */
/* Fee                                                                         */
/* ========================================================================== */

/** Sets a merchant's own per-delivery fee, or puts them back on the standard fee. */
export function FeeSheet({ merchant, onClose }: { merchant: RestaurantPartner | null; onClose: () => void }) {
  return (
    <Sheet visible={!!merchant} onClose={onClose} title="Delivery fee">
      {merchant && <FeeForm key={merchant.id} merchant={merchant} onDone={onClose} />}
    </Sheet>
  );
}

function FeeForm({ merchant, onDone }: { merchant: RestaurantPartner; onDone: () => void }) {
  const { algorithm, updateMerchantFee } = useInThaRoute();
  const standard = algorithm.baseRestaurantChargeGbp;
  const [value, setValue] = useState(merchant.customFeeGbp != null ? String(merchant.customFeeGbp) : '');
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const n = Number(value);
  const error =
    value === '' ? undefined : !Number.isFinite(n) || n < 0 ? 'Enter an amount of £0 or more.' : n > 100 ? 'The most is £100.' : undefined;
  const credits = merchant.credits?.available ?? 0;

  const run = async (k: 'save' | 'reset', fee: number | null) => {
    setBusy(k);
    const ok = await updateMerchantFee(merchant.id, fee);
    setBusy(null);
    if (ok) onDone();
  };

  return (
    <View style={styles.gap14}>
      <Text style={styles.muted}>
        {`What ${shortName(merchant.name)} is charged per platform delivery, in credits.`}
      </Text>
      <View style={styles.summary}>
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>Standard fee (everyone)</Text>
          <Text style={styles.strong}>{formatGbp(standard)}</Text>
        </View>
        <View style={styles.rowBetween}>
          <Text style={styles.muted}>This merchant now</Text>
          <Text style={styles.strong}>
            {formatGbp(merchant.feePerDeliveryGbp ?? standard)}
            {merchant.customFeeGbp != null ? ' (custom)' : ''}
          </Text>
        </View>
      </View>
      <Field
        label="Custom fee per delivery (£)"
        keyboardType="decimal-pad"
        placeholder={standard.toFixed(2)}
        value={value}
        onChangeText={(v) => setValue(cleanAmount(v))}
        error={error}
      />
      <Text style={styles.muted}>
        {value !== '' && !error && n > 0
          ? `${Math.floor(credits / n)} deliveries with their ${credits.toFixed(2)} credits. Longer trips add the per-mile charge.`
          : 'Live orders are re-priced straight away.'}
      </Text>
      <Button
        label="Save fee"
        variant="dark"
        loading={busy === 'save'}
        disabled={!!busy || value === '' || !!error}
        onPress={() => run('save', Math.round(n * 100) / 100)}
      />
      {merchant.customFeeGbp != null && (
        <Button label="Use standard fee" variant="secondary" loading={busy === 'reset'} disabled={!!busy} onPress={() => run('reset', null)} />
      )}
    </View>
  );
}

/* ========================================================================== */
/* Adjust credits                                                              */
/* ========================================================================== */

/** Adds or removes a merchant's credits by hand. */
export function CreditAdjustSheet({ merchant, onClose }: { merchant: RestaurantPartner | null; onClose: () => void }) {
  return (
    <Sheet visible={!!merchant} onClose={onClose} title="Adjust credits">
      {merchant && <AdjustForm key={merchant.id} merchant={merchant} onDone={onClose} />}
    </Sheet>
  );
}

function AdjustForm({ merchant, onDone }: { merchant: RestaurantPartner; onDone: () => void }) {
  const { adjustMerchantCredits } = useInThaRoute();
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const n = Number(amount);
  const error =
    amount === '' ? undefined : !Number.isFinite(n) || n <= 0 ? 'Enter a number above 0.' : n > 100000 ? 'That is too many credits.' : undefined;
  const fee = merchant.feePerDeliveryGbp ?? 0;

  const save = async () => {
    if (!amount || error) return;
    setBusy(true);
    const ok = await adjustMerchantCredits(merchant.id, mode === 'add' ? n : -n, note.trim());
    setBusy(false);
    if (ok) onDone();
  };

  return (
    <View style={styles.gap14}>
      <Text style={styles.muted}>
        {`${shortName(merchant.name)} has ${(merchant.credits?.available ?? 0).toFixed(2)} credits available.`}
      </Text>
      <Segmented<'add' | 'remove'>
        value={mode}
        onChange={setMode}
        options={[
          { value: 'add', label: 'Add credits' },
          { value: 'remove', label: 'Remove credits' },
        ]}
      />
      <Field
        label="Credits"
        keyboardType="decimal-pad"
        value={amount}
        onChangeText={(v) => setAmount(cleanAmount(v))}
        error={error}
        placeholder="e.g. 50"
      />
      <Text style={styles.muted}>
        {amount && !error && fee > 0 ? `≈ ${Math.floor(n / fee)} deliveries at ${formatGbp(fee)}` : '1 credit = £1'}
      </Text>
      <Field
        label="Note (shown to the merchant)"
        value={note}
        maxLength={200}
        onChangeText={setNote}
        placeholder="e.g. Goodwill credit"
      />
      <Button
        label={`${mode === 'add' ? 'Add' : 'Remove'} ${amount && !error ? n.toFixed(2) : ''} credits`.replace('  ', ' ')}
        variant={mode === 'add' ? 'dark' : 'primary'}
        loading={busy}
        disabled={!amount || !!error || busy}
        onPress={save}
      />
    </View>
  );
}

/* ========================================================================== */
/* Credits screen                                                              */
/* ========================================================================== */

type Filter = 'all' | CreditKind;
type Sort = 'available' | 'paid' | 'used' | 'name';

/** Merchant credits: who paid, how much they bought and used, live. Same figures as the web. */
export function CreditsAdminScreen({ syncBar }: { syncBar: React.ReactNode }) {
  const { restaurants, dashboardSyncedAt } = useInThaRoute();
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('available');
  const [query, setQuery] = useState('');
  const [tx, setTx] = useState<CreditTransaction[] | null>(null);
  const [adjust, setAdjust] = useState<RestaurantPartner | null>(null);
  const [showAll, setShowAll] = useState(false);

  // Re-read the activity with every dashboard refresh (every 10 s) and when the filter changes.
  useEffect(() => {
    let cancelled = false;
    api<{ transactions: CreditTransaction[] }>('GET', `/api/admin/credits?limit=150${filter === 'all' ? '' : `&kind=${filter}`}`)
      .then((r) => !cancelled && setTx(r.transactions))
      .catch(() => !cancelled && setTx((t) => t ?? []));
    return () => {
      cancelled = true;
    };
  }, [filter, dashboardSyncedAt]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return restaurants
      .filter((r) => !q || `${r.name} ${r.postcode} ${r.ownerEmail ?? ''}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const ca = a.credits;
        const cb = b.credits;
        if (sort === 'name') return a.name.localeCompare(b.name);
        if (sort === 'paid') return (cb?.paidGbp ?? 0) - (ca?.paidGbp ?? 0);
        if (sort === 'used') return (cb?.usedCredits ?? 0) - (ca?.usedCredits ?? 0);
        return (ca?.available ?? 0) - (cb?.available ?? 0);
      });
  }, [restaurants, query, sort]);

  const sum = (f: (r: RestaurantPartner) => number) => restaurants.reduce((s, r) => s + f(r), 0);
  const paid = sum((r) => r.credits?.paidGbp ?? 0);
  const purchased = sum((r) => r.credits?.purchasedCredits ?? 0);
  const used = sum((r) => r.credits?.usedCredits ?? 0);
  const outstanding = sum((r) => Math.max(0, r.credits?.balance ?? 0));
  const low = restaurants.filter(isLowOnCredits).length;
  const activity = tx ?? [];
  const shownActivity = showAll ? activity : activity.slice(0, 25);

  return (
    <Screen>
      {syncBar}

      <Card>
        <View style={styles.statsRow}>
          <Stat label="Paid by card" value={formatGbp(paid)} tone="success" style={styles.flex1} />
          <View style={styles.vDivider} />
          <Stat label="Credits bought" value={purchased.toFixed(2)} style={styles.flex1} />
        </View>
        <Divider />
        <View style={styles.statsRow}>
          <Stat label="Credits used" value={used.toFixed(2)} style={styles.flex1} />
          <View style={styles.vDivider} />
          <Stat label="Held by merchants" value={outstanding.toFixed(2)} style={styles.flex1} />
        </View>
        {low > 0 && (
          <View style={styles.lowNote}>
            <Ionicons name="alert-circle" size={16} color={C.primary} />
            <Text style={styles.lowText}>{`${low} merchant${low === 1 ? '' : 's'} can’t post orders: not enough credits.`}</Text>
          </View>
        )}
      </Card>

      <SectionLabel>{`Merchants · ${restaurants.length}`}</SectionLabel>
      <View style={styles.search}>
        <Ionicons name="search" size={18} color={C.ink3} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search merchant"
          placeholderTextColor={C.ink3}
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {query.length > 0 && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Ionicons name="close-circle" size={18} color={C.ink3} />
          </Pressable>
        )}
      </View>
      <Segmented<Sort>
        value={sort}
        onChange={setSort}
        options={[
          { value: 'available', label: 'Lowest' },
          { value: 'paid', label: 'Paid' },
          { value: 'used', label: 'Used' },
          { value: 'name', label: 'A–Z' },
        ]}
      />
      {rows.length === 0 ? (
        <Card>
          <EmptyState icon="storefront-outline" title="No merchants found" />
        </Card>
      ) : (
        rows.map((r) => {
          const c = r.credits;
          const isLow = isLowOnCredits(r);
          return (
            <Card key={r.id} style={r.isActive === false ? styles.dimmed : undefined}>
              <View style={styles.rowBetween}>
                <View style={styles.flexText}>
                  <View style={styles.nameRow}>
                    <Text style={styles.title} numberOfLines={1}>
                      {shortName(r.name)}
                    </Text>
                    {r.isActive === false && <Badge label="Disabled" tone="primary" />}
                  </View>
                  <Text style={styles.muted} numberOfLines={1}>
                    {`${formatGbp(r.feePerDeliveryGbp ?? 0)}/delivery${r.customFeeGbp != null ? ' · custom' : ''}`}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={[styles.big, isLow && { color: C.primary }]}>{(c?.available ?? 0).toFixed(2)}</Text>
                  <Text style={styles.muted}>{c?.deliveriesLeft == null ? 'available' : `≈ ${c.deliveriesLeft} deliveries`}</Text>
                </View>
              </View>
              <View style={styles.miniRow}>
                <Mini label="Bought" value={(c?.purchasedCredits ?? 0).toFixed(2)} />
                <Mini label="Used" value={(c?.usedCredits ?? 0).toFixed(2)} />
                <Mini label="Paid" value={formatGbp(c?.paidGbp ?? 0)} green />
              </View>
              <View style={styles.rowBetween}>
                <Text style={styles.muted} numberOfLines={1}>
                  {`Last payment: ${c?.lastPurchaseAt ? creditWhen(c.lastPurchaseAt) : 'Never'}`}
                </Text>
                <Button label="Adjust" variant="secondary" compact onPress={() => setAdjust(r)} />
              </View>
            </Card>
          );
        })
      )}

      <SectionLabel>Activity</SectionLabel>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {(
          [
            ['all', 'All'],
            ['purchase', 'Payments'],
            ['delivery', 'Deliveries'],
            ['grant', 'Free'],
            ['adjustment', 'Manual'],
          ] as [Filter, string][]
        ).map(([value, label]) => (
          <Chip
            key={value}
            label={label}
            selected={filter === value}
            onPress={() => {
              setFilter(value);
              setTx(null);
              setShowAll(false);
            }}
          />
        ))}
      </ScrollView>
      <Card>
        {tx == null ? (
          <ActivityIndicator color={C.ink3} />
        ) : activity.length === 0 ? (
          <EmptyState icon="wallet-outline" title="Nothing yet" subtitle="Activity appears here as merchants buy and use credits." />
        ) : (
          shownActivity.map((t, i) => (
            <View key={t.id} style={styles.gap12}>
              {i > 0 && <Divider />}
              <CreditActivityRow t={t} admin />
            </View>
          ))
        )}
        {!showAll && activity.length > shownActivity.length && (
          <Button label={`Show all ${activity.length}`} variant="secondary" compact onPress={() => setShowAll(true)} />
        )}
      </Card>

      <CreditAdjustSheet merchant={adjust} onClose={() => setAdjust(null)} />
    </Screen>
  );
}

function Mini({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <View style={styles.mini}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={[styles.miniValue, green && { color: C.success }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  gap12: { gap: 12 },
  gap14: { gap: 14 },
  flex1: { flex: 1 },
  flexText: { flex: 1, minWidth: 0, gap: 3 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  right: { alignItems: 'flex-end', gap: 2 },
  title: { ...Brand.type.bodyStrong, color: C.ink, flexShrink: 1 },
  big: { ...Brand.type.heading, color: C.ink, fontVariant: ['tabular-nums'] },
  strong: { ...Brand.type.bodyStrong, color: C.ink },
  muted: { ...Brand.type.caption, color: C.ink3, flexShrink: 1 },
  dimmed: { opacity: 0.6 },
  summary: { gap: 6, padding: 12, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },
  statsRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  vDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: C.line },
  lowNote: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: C.primarySoft },
  lowText: { ...Brand.type.captionStrong, color: C.ink, flex: 1 },
  miniRow: { flexDirection: 'row', gap: 8 },
  mini: { flex: 1, gap: 2, padding: 10, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },
  miniLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: C.ink3, textTransform: 'uppercase' },
  miniValue: { ...Brand.type.bodyStrong, color: C.ink, fontVariant: ['tabular-nums'] },
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
  chips: { gap: 8, paddingHorizontal: 16 },
});
