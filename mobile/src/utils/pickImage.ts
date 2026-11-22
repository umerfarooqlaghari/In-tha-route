import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
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

const LOGO_MAX_BYTES = 2 * 1024 * 1024;

/** A square logo from the camera or the photo library (the user crops it). */
async function pickLogo(source: 'camera' | 'library'): Promise<PickedImage | null> {
  try {
    if (source === 'camera' && !(await ImagePicker.requestCameraPermissionsAsync()).granted) {
      Alert.alert('Camera access needed', 'Allow camera access in Settings to take a photo.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return null;
    }
    const options: ImagePicker.ImagePickerOptions = { ...OPTIONS, quality: 0.7, allowsEditing: true, aspect: [1, 1] };
    const result =
      source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return null;
    const asset = result.assets[0];
    if (!asset?.base64) {
      Alert.alert('Photo not available', 'That photo could not be read. Please try another one.');
      return null;
    }
    if (asset.base64.length * 0.75 > LOGO_MAX_BYTES) {
      Alert.alert('Logo too large', 'Please choose a smaller image (under 2 MB).');
      return null;
    }
    return { base64: asset.base64, mimeType: 'image/jpeg' };
  } catch {
    Alert.alert('Photos not available', 'The image could not be opened. Please try another one.');
    return null;
  }
}

/** Asks "Take photo" or "Choose from library" for the merchant's logo. */
export function chooseLogo(): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    Alert.alert(
      'Your logo',
      undefined,
      [
        { text: 'Take photo', onPress: () => pickLogo('camera').then(resolve) },
        { text: 'Choose from library', onPress: () => pickLogo('library').then(resolve) },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

export const PDF = 'application/pdf';
export const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Driver documents: the server takes up to 8 MB for a PDF or .docx file.
const MAX_DOCUMENT_BYTES = 8 * 1024 * 1024;

/** Picks a PDF or .docx file from the phone (Files, iCloud Drive, Google Drive...). */
export async function pickDocumentFile(): Promise<PickedImage | null> {
  try {
    const result = await DocumentPicker.getDocumentAsync({ type: [PDF, DOCX], copyToCacheDirectory: true });
    if (result.canceled) return null;
    const asset = result.assets[0];
    const name = asset.name.toLowerCase();
    const mimeType = name.endsWith('.pdf') ? PDF : name.endsWith('.docx') ? DOCX : asset.mimeType;
    if (mimeType !== PDF && mimeType !== DOCX) {
      Alert.alert('File not supported', 'Please choose a PDF or a .docx file.');
      return null;
    }
    if (asset.size && asset.size > MAX_DOCUMENT_BYTES) {
      Alert.alert('File too large', 'Please choose a file under 8 MB.');
      return null;
    }
    return { base64: await new File(asset.uri).base64(), mimeType };
  } catch {
    Alert.alert('File not available', 'That file could not be opened. Please try another one.');
    return null;
  }
}

/** For driver documents: a photo, a PDF or a .docx file. */
export function chooseDocument(title: string): Promise<PickedImage | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      'Upload a photo, a PDF or a .docx file.',
      [
        { text: 'Take photo', onPress: () => pickImage('camera').then(resolve) },
        { text: 'Choose photo', onPress: () => pickImage('library').then(resolve) },
        { text: 'Choose PDF or .docx', onPress: () => pickDocumentFile().then(resolve) },
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}
