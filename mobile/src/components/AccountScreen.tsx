import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, Image, StyleSheet, Text, View } from 'react-native';

import { Avatar, Button, Card, Field, Hint, Screen, SectionLabel, Sheet } from '@/components/ui';
import { API_URL } from '@/constants/api';
import { Brand } from '@/constants/brand';
import { useInThaRoute } from '@/context/InThaRouteContext';
import { api } from '@/services/apiClient';
import { ApiError, AuthSession, AuthUser } from '@/services/authApi';
import { chooseLogo } from '@/utils/pickImage';

const C = Brand.colors;

type Errors = Record<string, string>;
const fieldsOf = (err: unknown): Errors => (err instanceof ApiError ? err.fields : {});
const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');

/** Full address of a merchant's logo (the API gives a path). */
export const logoUri = (logoUrl?: string | null) => (logoUrl ? `${API_URL}${logoUrl}` : undefined);

/** Your own account, for every role: name, email, password and deleting the account. */
export function AccountScreen() {
  const { user, role } = useInThaRoute();
  if (!user) return null;
  return (
    <Screen>
      {role === 'restaurant' && user.restaurant && <BusinessCard user={user} />}
      <DetailsCard user={user} />
      <PasswordCard />
      <DeleteCard />
    </Screen>
  );
}

function BusinessCard({ user }: { user: AuthUser }) {
  const { updateUser, refreshDashboard } = useInThaRoute();
  const restaurant = user.restaurant!;
  const [name, setName] = useState(restaurant.name);
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);

  const done = (next: AuthUser) => {
    updateUser(next);
    refreshDashboard();
  };

  const saveName = async () => {
    setSaving(true);
    setErrors({});
    try {
      done((await api<{ user: AuthUser }>('PATCH', '/api/restaurant/profile', { name })).user);
      Alert.alert('Saved', 'Your merchant name has been updated.');
    } catch (err) {
      const f = fieldsOf(err);
      if (Object.keys(f).length) setErrors(f);
      else Alert.alert('Couldn’t save', messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  const changeLogo = async () => {
    const picked = await chooseLogo();
    if (!picked) return;
    setLogoBusy(true);
    try {
      done(
        (await api<{ user: AuthUser }>('PUT', '/api/restaurant/logo', {
          imageBase64: picked.base64,
          mimeType: picked.mimeType,
        })).user
      );
    } catch (err) {
      Alert.alert('Couldn’t upload the logo', messageOf(err));
    } finally {
      setLogoBusy(false);
    }
  };

  const removeLogo = () =>
    Alert.alert('Remove your logo?', 'Your initials will show instead.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setLogoBusy(true);
          try {
            done((await api<{ user: AuthUser }>('DELETE', '/api/restaurant/logo')).user);
          } catch (err) {
            Alert.alert('Couldn’t remove the logo', messageOf(err));
          } finally {
            setLogoBusy(false);
          }
        },
      },
    ]);

  const logo = logoUri(restaurant.logoUrl);
  const trimmed = name.trim();
  return (
    <>
      <SectionLabel>Business</SectionLabel>
      <Card>
        <View style={styles.logoRow}>
          {logo ? (
            <Image source={{ uri: logo }} style={styles.logo} accessibilityLabel="Your logo" />
          ) : (
            <Avatar name={restaurant.name} tone="primary" size={72} />
          )}
          <View style={styles.logoActions}>
            <Button
              label={logo ? 'Change logo' : 'Add logo'}
              icon="image-outline"
              variant="secondary"
              compact
              loading={logoBusy}
              onPress={changeLogo}
            />
            {logo && !logoBusy && (
              <Button label="Remove" icon="trash-outline" variant="ghost" compact onPress={removeLogo} />
            )}
          </View>
        </View>
        <Text style={styles.muted}>A square JPEG or PNG works best. It shows at the top of your app and dashboard.</Text>
        <Field
          label="Merchant name"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          error={errors.name}
          testID="account-business-name"
        />
        <Button
          label="Save name"
          icon="checkmark"
          onPress={saveName}
          loading={saving}
          disabled={trimmed.length < 2 || trimmed === restaurant.name}
        />
      </Card>
    </>
  );
}

function DetailsCard({ user }: { user: AuthUser }) {
  const { updateUser } = useInThaRoute();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email);
  const [currentPassword, setCurrentPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const cleanEmail = email.trim().toLowerCase();
  const emailChanged = cleanEmail !== user.email;
  const nameChanged = fullName.trim() !== user.fullName;

  const save = async () => {
    setSaving(true);
    setErrors({});
    try {
      const body = {
        ...(nameChanged && { fullName: fullName.trim() }),
        ...(emailChanged && { email: cleanEmail, currentPassword }),
      };
      const next = (await api<{ user: AuthUser }>('PATCH', '/api/auth/account', body)).user;
      updateUser(next);
      setEmail(next.email);
      setFullName(next.fullName);
      setCurrentPassword('');
      Alert.alert('Saved', emailChanged ? `From now on, log in with ${next.email}.` : 'Your details have been updated.');
    } catch (err) {
      const f = fieldsOf(err);
      if (err instanceof ApiError && err.code === 'EMAIL_TAKEN') setErrors({ email: err.message });
      else if (Object.keys(f).length) setErrors(f);
      else Alert.alert('Couldn’t save', messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionLabel>Your details</SectionLabel>
      <Card>
        <Field
          label="Your name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          textContentType="name"
          error={errors.fullName}
          testID="account-name"
        />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          error={errors.email}
          testID="account-email"
        />
        {emailChanged && (
          <Field
            label="Current password"
            value={currentPassword}
            onChangeText={setCurrentPassword}
            placeholder="Needed to change your email"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            error={errors.currentPassword}
            testID="account-email-password"
          />
        )}
        <Button
          label="Save changes"
          icon="checkmark"
          onPress={save}
          loading={saving}
          disabled={(!nameChanged && !emailChanged) || fullName.trim().length < 2 || (emailChanged && !currentPassword)}
        />
      </Card>
    </>
  );
}

function PasswordCard() {
  const { signIn } = useInThaRoute();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!/[A-Z]/.test(newPassword)) {
      setErrors({ newPassword: 'Password must contain at least one capital letter.' });
      return;
    }
    setSaving(true);
    setErrors({});
    try {
      // The server signs out your other devices and gives this one a fresh session.
      signIn(await api<AuthSession>('PUT', '/api/auth/account/password', { currentPassword, newPassword }));
      setCurrent('');
      setNew('');
      setConfirm('');
      Alert.alert('Password changed', 'You stay signed in here. Other phones and browsers will need the new password.');
    } catch (err) {
      const f = fieldsOf(err);
      if (Object.keys(f).length) setErrors(f);
      else Alert.alert('Couldn’t change the password', messageOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <SectionLabel>Password</SectionLabel>
      <Card>
        <Field
          label="Current password"
          value={currentPassword}
          onChangeText={setCurrent}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          error={errors.currentPassword}
          testID="account-current-password"
        />
        <Field
          label="New password"
          value={newPassword}
          onChangeText={setNew}
          placeholder="8+ characters, a capital and a number"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          error={errors.newPassword}
          testID="account-new-password"
        />
        <Field
          label="Confirm new password"
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          error={confirm && confirm !== newPassword ? 'Passwords do not match.' : undefined}
          success={newPassword && confirm === newPassword ? 'Passwords match' : undefined}
          testID="account-confirm-password"
        />
        <Button
          label="Change password"
          icon="lock-closed-outline"
          onPress={save}
          loading={saving}
          disabled={!currentPassword || !newPassword || confirm !== newPassword}
        />
      </Card>
    </>
  );
}

function DeleteCard() {
  const { role, accountDeleted } = useInThaRoute();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [deleting, setDeleting] = useState(false);

  const what =
    role === 'restaurant'
      ? 'Your login, name, email, phone and logo are removed. Past orders and credit purchases stay in the records as “Deleted merchant”. Your own drivers can no longer sign in. Unused credits are lost.'
      : role === 'driver'
        ? 'Your login, name, email, phone, plate and uploaded documents are removed. Past deliveries and earnings stay in the records as “Deleted account”.'
        : 'Your admin login, name and email are removed. Another admin keeps running the platform.';

  const remove = async () => {
    setDeleting(true);
    setError(undefined);
    try {
      await api('DELETE', '/api/auth/account', { password });
      setOpen(false);
      accountDeleted();
      Alert.alert('Account deleted', 'Your account has been closed.');
    } catch (err) {
      const f = fieldsOf(err);
      if (f.password) setError(f.password);
      else Alert.alert('Couldn’t delete the account', messageOf(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <SectionLabel>Delete account</SectionLabel>
      <Card>
        <View style={styles.dangerRow}>
          <Ionicons name="warning-outline" size={20} color={C.primary} />
          <Text style={styles.dangerText}>This closes your account for good. It can’t be undone.</Text>
        </View>
        <Text style={styles.muted}>{what}</Text>
        <Button
          label="Delete my account"
          icon="trash-outline"
          variant="ghost"
          onPress={() => {
            setPassword('');
            setError(undefined);
            setOpen(true);
          }}
          testID="account-delete"
        />
      </Card>
      <Sheet visible={open} onClose={() => !deleting && setOpen(false)} title="Delete your account?">
        <Hint icon="warning-outline">This can’t be undone. Enter your password to confirm.</Hint>
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          error={error}
          testID="account-delete-password"
        />
        <Button
          label="Delete for good"
          icon="trash"
          onPress={remove}
          loading={deleting}
          disabled={!password}
          testID="account-delete-confirm"
        />
        <Button label="Keep my account" variant="ghost" onPress={() => setOpen(false)} disabled={deleting} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  logo: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.surfaceAlt },
  logoActions: { flex: 1, gap: 8, alignItems: 'flex-start' },
  muted: { ...Brand.type.caption, color: C.ink3 },
  dangerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dangerText: { ...Brand.type.bodyStrong, color: C.ink, flex: 1 },
});
