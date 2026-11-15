import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/ui';
import { API_URL } from '@/constants/api';
import { Brand } from '@/constants/brand';
import type { KycDocument } from '@/context/InThaRouteContext';
import { getAccessToken } from '@/services/apiClient';
import { DOCX, PDF } from '@/utils/pickImage';

const C = Brand.colors;

/**
 * A driver document as uploaded: a photo is shown here; a PDF or .docx file opens in the
 * phone's own viewer (Quick Look on iPhone, the installed viewer app on Android).
 * `path` is the API path of the file, e.g. /api/driver/documents/:id/file.
 */
export function UploadedFile({ doc, path }: { doc: KycDocument; path: string }) {
  if (doc.fileType === 'pdf' || doc.fileType === 'word') return <DocumentFile doc={doc} path={path} />;
  return <PhotoFile doc={doc} path={path} />;
}

function PhotoFile({ doc, path }: { doc: KycDocument; path: string }) {
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
          source={{ uri: `${API_URL}${path}`, headers: { Authorization: `Bearer ${token}` } }}
        />
      ) : (
        <ActivityIndicator color={C.primary} />
      )}
    </View>
  );
}

function DocumentFile({ doc, path }: { doc: KycDocument; path: string }) {
  const [opening, setOpening] = useState(false);
  const isPdf = doc.fileType === 'pdf';

  const open = async () => {
    setOpening(true);
    try {
      const token = await getAccessToken();
      // Kept in the cache only while it is being looked at; downloaded fresh each time.
      const target = new File(Paths.cache, `document-${doc.id}.${isPdf ? 'pdf' : 'docx'}`);
      const file = await File.downloadFileAsync(`${API_URL}${path}`, target, {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      });
      await File.preview(file, { title: doc.title, mimeType: isPdf ? PDF : DOCX });
    } catch {
      Alert.alert(
        'Couldn’t open the file',
        isPdf ? 'Please try again.' : 'Please try again. Opening .docx files may need a document app on this phone.'
      );
    } finally {
      setOpening(false);
    }
  };

  return (
    <View style={styles.docWrap}>
      <View style={[styles.docIcon, { backgroundColor: isPdf ? C.primarySoft : C.infoSoft }]}>
        <Ionicons name={isPdf ? 'document-text' : 'document'} size={30} color={isPdf ? C.primary : C.info} />
        <Text style={[styles.docBadge, { color: isPdf ? C.primary : C.info }]}>{isPdf ? 'PDF' : 'DOCX'}</Text>
      </View>
      <Text style={styles.docTitle}>{isPdf ? 'PDF uploaded' : '.docx file uploaded'}</Text>
      <Button
        label={isPdf ? 'Open PDF' : 'Open document'}
        icon="open-outline"
        variant="secondary"
        loading={opening}
        disabled={opening}
        onPress={open}
        style={styles.stretch}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  muted: { ...Brand.type.caption, color: C.ink3 },
  stretch: { alignSelf: 'stretch' },
  photoWrap: { alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 200 },
  photo: { width: '100%', height: 360, borderRadius: Brand.radius.md, backgroundColor: C.surfaceAlt },
  docWrap: {
    alignItems: 'center',
    gap: 10,
    padding: 20,
    borderRadius: Brand.radius.lg,
    backgroundColor: C.surfaceAlt,
  },
  docIcon: { width: 72, height: 72, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  docBadge: { fontSize: 10, fontWeight: '800', letterSpacing: 0.6, marginTop: -2 },
  docTitle: { ...Brand.type.bodyStrong, color: C.ink },
});
