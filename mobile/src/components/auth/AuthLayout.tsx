import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui';
import { Brand } from '@/constants/brand';

const C = Brand.colors;

/** Shared frame for the welcome, login and signup screens. */
export function AuthLayout({
  title,
  subtitle,
  onBack,
  children,
}: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
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
        <View style={styles.brandRow}>
          <View style={styles.logo}>
            <Ionicons name="navigate" size={22} color="#FFFFFF" />
          </View>
          <Text style={styles.brandName}>In Tha Route</Text>
        </View>

        {onBack && (
          <View style={styles.backRow}>
            <IconButton icon="arrow-back" onPress={onBack} />
          </View>
        )}

        <View style={styles.hero}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>

        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Inline message for a failed request. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error}>
      <Ionicons name="alert-circle" size={18} color={C.primary} />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.surface },
  content: { flexGrow: 1, paddingHorizontal: 24, gap: 28 },
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
  backRow: { marginBottom: -12 },
  hero: { gap: 6 },
  title: { ...Brand.type.display, color: C.ink },
  subtitle: { ...Brand.type.body, color: C.ink2 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: Brand.radius.md,
    backgroundColor: C.primarySoft,
    borderWidth: 1,
    borderColor: C.primaryLine,
  },
  errorText: { ...Brand.type.caption, color: C.ink, flex: 1 },
});
