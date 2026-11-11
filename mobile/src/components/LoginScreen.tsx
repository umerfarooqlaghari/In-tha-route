import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AuthLayout, FormError } from '@/components/auth/AuthLayout';
import { SignupScreen } from '@/components/auth/SignupScreen';
import { SignupRole, WelcomeScreen } from '@/components/auth/WelcomeScreen';
import { Button, Field } from '@/components/ui';
import { useInThaRoute } from '@/context/InThaRouteContext';
import { ApiError, loginRequest } from '@/services/authApi';

type Step = { name: 'welcome' } | { name: 'login' } | { name: 'signup'; role: SignupRole };

/** Signed-out flow: welcome → sign up (restaurant or driver) or log in (every role). */
export function LoginScreen() {
  const [step, setStep] = useState<Step>({ name: 'welcome' });
  const toWelcome = () => setStep({ name: 'welcome' });
  const toLogin = () => setStep({ name: 'login' });

  if (step.name === 'signup') {
    return <SignupScreen key={step.role} role={step.role} onBack={toWelcome} onLogin={toLogin} />;
  }
  if (step.name === 'login') return <LoginForm onBack={toWelcome} />;
  return <WelcomeScreen onSignup={(role) => setStep({ name: 'signup', role })} onLogin={toLogin} />;
}

/** One sign-in form for restaurants, drivers and admins; the server decides the role. */
function LoginForm({ onBack }: { onBack: () => void }) {
  const { signIn } = useInThaRoute();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const local: Record<string, string> = {};
    if (!email.trim()) local.email = 'Email is required.';
    if (!password) local.password = 'Password is required.';
    setErrors(local);
    setFormError(null);
    if (Object.keys(local).length) return;

    setLoading(true);
    try {
      signIn(await loginRequest(email.trim(), password));
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError && Object.keys(err.fields).length) setErrors(err.fields);
      else setFormError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    }
  };

  return (
    <AuthLayout title="Log in" subtitle="Use the email and password for your account." onBack={onBack}>
      <View style={styles.form}>
        <Field
          label="Email"
          testID="login-email"
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
          label="Password"
          testID="login-password"
          value={password}
          onChangeText={setPassword}
          error={errors.password}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="current-password"
          textContentType="password"
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <FormError message={formError} />
        <Button label="Log in" onPress={submit} loading={loading} style={styles.cta} />
      </View>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  cta: { marginTop: 8 },
});
