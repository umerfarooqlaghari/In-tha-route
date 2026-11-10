import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { AuthLayout, FormError } from '@/components/auth/AuthLayout';
import type { SignupRole } from '@/components/auth/WelcomeScreen';
import { Button, Chip, Field, SectionLabel } from '@/components/ui';
import { Brand } from '@/constants/brand';
import { useInThaRoute } from '@/context/InThaRouteContext';
import { ApiError, SignupInput, signupRequest, Vehicle } from '@/services/authApi';

const C = Brand.colors;

const VEHICLES: { value: Vehicle; label: string }[] = [
  { value: 'Motorcycle / Scooter', label: 'Scooter' },
  { value: 'Car', label: 'Car' },
  { value: 'E-Bike', label: 'E-Bike' },
];

type Errors = Record<string, string>;

export function SignupScreen({
  role,
  onBack,
  onLogin,
}: {
  role: SignupRole;
  onBack: () => void;
  onLogin: () => void;
}) {
  const { signIn } = useInThaRoute();
  const isRestaurant = role === 'restaurant';

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [restaurantName, setRestaurantName] = useState('');
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [pickupSafetyNote, setPickupSafetyNote] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('Motorcycle / Scooter');
  const [plateNumber, setPlateNumber] = useState('');

  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const needsPlate = vehicle !== 'E-Bike';

  // Catches empty fields before a round trip; the server stays the source of truth for the rest.
  const missing = (): Errors => {
    const e: Errors = {};
    const need = (key: string, value: string, label: string) => {
      if (!value.trim()) e[key] = `${label} is required.`;
    };
    need('fullName', fullName, 'Full name');
    need('email', email, 'Email');
    need('phone', phone, 'Phone');
    if (!password) e.password = 'Password is required.';
    if (isRestaurant) {
      need('restaurantName', restaurantName, 'Restaurant name');
      need('address', address, 'Address');
      need('postcode', postcode, 'Postcode');
    } else if (needsPlate) {
      need('plateNumber', plateNumber, 'Plate number');
    }
    return e;
  };

  const submit = async () => {
    const local = missing();
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    const base = { email: email.trim(), password, fullName: fullName.trim(), phone: phone.trim() };
    const input: SignupInput = isRestaurant
      ? {
          ...base,
          role: 'restaurant',
          restaurantName: restaurantName.trim(),
          address: address.trim(),
          postcode: postcode.trim(),
          pickupSafetyNote: pickupSafetyNote.trim() || undefined,
        }
      : {
          ...base,
          role: 'driver',
          vehicle,
          plateNumber: needsPlate ? plateNumber.trim() : undefined,
        };

    setLoading(true);
    try {
      signIn(await signupRequest(input));
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        setErrors(err.fields);
        if (err.code === 'EMAIL_TAKEN') setErrors({ email: err.message });
        else if (!Object.keys(err.fields).length) setFormError(err.message);
        else setFormError('Please fix the highlighted fields.');
      } else {
        setFormError('Something went wrong. Please try again.');
      }
    }
  };

  return (
    <AuthLayout
      title={isRestaurant ? 'Restaurant sign up' : 'Driver sign up'}
      subtitle={
        isRestaurant
          ? 'Post delivery orders straight from your receipts.'
          : 'Deliver with In Tha Route. Your documents are reviewed before you start.'
      }
      onBack={onBack}>
      <View style={styles.form}>
        <SectionLabel>Your details</SectionLabel>
        <Field
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          error={errors.fullName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
        />
        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          error={errors.email}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
        />
        <Field
          label="Phone"
          value={phone}
          onChangeText={setPhone}
          error={errors.phone}
          keyboardType="phone-pad"
          placeholder="07…"
          autoComplete="tel"
          textContentType="telephoneNumber"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
        />
        {!errors.password && (
          <Text style={styles.help}>At least 8 characters, with a letter and a number.</Text>
        )}

        {isRestaurant ? (
          <>
            <SectionLabel>Your restaurant</SectionLabel>
            <Field
              label="Restaurant name"
              value={restaurantName}
              onChangeText={setRestaurantName}
              error={errors.restaurantName}
              autoCapitalize="words"
            />
            <Field
              label="Address"
              value={address}
              onChangeText={setAddress}
              error={errors.address}
              autoCapitalize="words"
              textContentType="fullStreetAddress"
            />
            <Field
              label="Postcode"
              value={postcode}
              onChangeText={setPostcode}
              error={errors.postcode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="TW9 1DT"
              textContentType="postalCode"
            />
            <Field
              label="Pickup note for drivers (optional)"
              value={pickupSafetyNote}
              onChangeText={setPickupSafetyNote}
              error={errors.pickupSafetyNote}
              placeholder="e.g. Collect from the side counter"
            />
          </>
        ) : (
          <>
            <SectionLabel>Your vehicle</SectionLabel>
            <View style={styles.chips}>
              {VEHICLES.map((v) => (
                <Chip
                  key={v.value}
                  label={v.label}
                  selected={v.value === vehicle}
                  onPress={() => setVehicle(v.value)}
                />
              ))}
            </View>
            {!!errors.vehicle && <Text style={styles.errorText}>{errors.vehicle}</Text>}
            {needsPlate && (
              <Field
                label="Plate number"
                value={plateNumber}
                onChangeText={setPlateNumber}
                error={errors.plateNumber}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="LR23 KXM"
              />
            )}
          </>
        )}

        <FormError message={formError} />
        <Button label="Create account" onPress={submit} loading={loading} style={styles.cta} />
        <Button label="I already have an account" variant="ghost" onPress={onLogin} />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  help: { ...Brand.type.caption, color: C.ink3, marginTop: -8 },
  errorText: { ...Brand.type.caption, color: C.primary },
  cta: { marginTop: 8 },
});
