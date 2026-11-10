import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';

export interface PickedImage {
  base64: string;
  mimeType: string;
}

const OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  quality: 0.6, // plenty for reading text, and keeps uploads small
  base64: true,
  exif: false,
};

/**
 * Takes a photo or picks one from the library.
 * Resolves to null if the user cancels or refuses camera access.
 */
export async function pickImage(source: 'camera' | 'library'): Promise<PickedImage | null> {
  try {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.', [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
        return null;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(OPTIONS)
        : await ImagePicker.launchImageLibraryAsync(OPTIONS);
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset?.base64) {
      Alert.alert('Photo not available', 'That photo could not be read. Please try another one.');
      return null;
    }
    // With `base64: true` the picker always returns JPEG data.
    return { base64: asset.base64, mimeType: 'image/jpeg' };
  } catch {
    Alert.alert(
      source === 'camera' ? 'Camera not available' : 'Photos not available',
      source === 'camera'
        ? 'The camera could not be opened on this device. You can upload a photo instead.'
        : 'Your photo library could not be opened.'
    );
    return null;
  }
}

/** Asks "Take photo" or "Choose from library", then picks. */
export function chooseImage(title: string): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      undefined,
      [
        { text: 'Take photo', onPress: () => pickImage('camera').then(resolve) },
        { text: 'Choose from library', onPress: () => pickImage('library').then(resolve) },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}
