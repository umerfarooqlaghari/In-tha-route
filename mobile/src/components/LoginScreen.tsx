import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Field, IconButton, IconTile } from '@/components/ui';
import { Brand } from '@/constants/brand';
import { PERSONAS } from '@/constants/personas';
import { useInThaRoute, UserRole } from '@/context/InThaRouteContext';

const C = Brand.colors;
const ROLES: UserRole[] = ['restaurant', 'driver', 'admin'];

export function LoginScreen() {
  const insets = useSafeAreaInsets();
  const { loginAsRole } = useInThaRoute();
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [password, setPassword] = useState('demo-password');
  const [loading, setLoading] = useState(false);

  const persona = selected ? PERSONAS[selected] : null;

  const signIn = () => {
    if (!selected) return;
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      loginAsRole(selected);
    }, 600);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: Math.max(insets.top, 48) + 28,
            paddingBottom: Math.max(insets.bottom, 20) + 24,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        {/* Brand */}
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Ionicons name="navigate" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.brandName}>In Tha Route</Text>
        </View>

        {!persona ? (
          <>
            <View style={styles.hero}>
              <Text style={styles.title}>Welcome</Text>
              <Text style={styles.subtitle}>Choose how you’d like to sign in.</Text>
            </View>

            <View style={styles.roleList}>
              {ROLES.map((role) => {
                const p = PERSONAS[role];
                return (
                  <Pressable
                    key={role}
                    onPress={() => setSelected(role)}
                    style={({ pressed }) => [styles.roleCard, pressed && styles.pressed]}>
                    <IconTile icon={p.icon} tone="primary" size={48} />
                    <View style={styles.roleText}>
                      <Text style={styles.roleTitle} numberOfLines={1}>
                        {p.label}
                      </Text>
                      <Text style={styles.roleTagline} numberOfLines={1}>
                        {p.tagline}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color={C.ink3} />
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : (
          <>
            <View style={styles.backRow}>
              <IconButton icon="arrow-back" onPress={() => setSelected(null)} />
            </View>

            <View style={styles.hero}>
              <Text style={styles.title}>{persona.label} sign in</Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {persona.name} · {persona.org}
              </Text>
            </View>

            <View style={styles.form}>
              <Field
                label="Email"
                value={persona.email}
                editable={false}
                keyboardType="email-address"
              />
              <Field
                label="Password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <Button label="Sign in" onPress={signIn} loading={loading} style={styles.cta} />
              <Text style={styles.demoNote}>Demo account — details are pre-filled.</Text>
            </View>
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 28 },
  pressed: { opacity: 0.7 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: { ...Brand.type.heading, color: C.ink },
  hero: { gap: 6 },
  title: { ...Brand.type.display, color: C.ink },
  subtitle: { ...Brand.type.body, color: C.ink2 },
  roleList: { gap: 12 },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: Brand.radius.lg,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.line,
    ...Brand.shadow.card,
  },
  roleText: { flex: 1, minWidth: 0, gap: 2 },
  roleTitle: { ...Brand.type.heading, color: C.ink },
  roleTagline: { ...Brand.type.caption, color: C.ink3 },
  backRow: { marginBottom: -12 },
  form: { gap: 16 },
  cta: { marginTop: 8 },
  demoNote: { ...Brand.type.caption, color: C.ink3, textAlign: 'center' },
});
