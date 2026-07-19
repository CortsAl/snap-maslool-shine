import React, { useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as MediaLibrary from 'expo-media-library';
import * as Sharing from 'expo-sharing';
import type { StackScreenProps } from '@react-navigation/stack';

import type { RootStackParamList } from '../types/navigation';

type Props = StackScreenProps<RootStackParamList, 'Result'>;

export function ResultScreen({ navigation, route }: Props) {
  const { originalImageUri, enhancedImageBase64 } = route.params;
  const [busyAction, setBusyAction] = useState<'save' | 'share' | null>(null);

  // Convert the returned base64 payload into an image URI that React Native can preview.
  const enhancedPreviewUri = useMemo(
    () => `data:image/png;base64,${enhancedImageBase64}`,
    [enhancedImageBase64],
  );

  // Write the base64 image to a temporary file so save/share APIs can access it.
  const writeEnhancedImageToCache = async () => {
    if (!FileSystem.cacheDirectory) {
      throw new Error('A cache directory is not available on this device.');
    }

    const targetFile = `${FileSystem.cacheDirectory}snap-shine-enhanced-${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(targetFile, enhancedImageBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return targetFile;
  };

  const handleSave = async () => {
    setBusyAction('save');

    try {
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Photo library access is required to save the enhanced image.');
      }

      const fileUri = await writeEnhancedImageToCache();
      await MediaLibrary.createAssetAsync(fileUri);
      Alert.alert('Saved', 'Your enhanced product photo has been added to the gallery.');
    } catch (error) {
      Alert.alert('Unable to save image', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  const handleShare = async () => {
    setBusyAction('share');

    try {
      const sharingAvailable = await Sharing.isAvailableAsync();
      if (!sharingAvailable) {
        throw new Error('Sharing is not available on this device.');
      }

      const fileUri = await writeEnhancedImageToCache();
      await Sharing.shareAsync(fileUri, {
        mimeType: 'image/png',
        dialogTitle: 'Share your enhanced product photo',
      });
    } catch (error) {
      Alert.alert('Unable to share image', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.title}>Studio-quality result</Text>
        <Text style={styles.subtitle}>
          Compare your original photo with the enhanced studio-ready version below.
        </Text>

        <View style={styles.comparisonCard}>
          <Text style={styles.cardLabel}>Before</Text>
          <Image source={{ uri: originalImageUri }} style={styles.image} />
        </View>

        <View style={styles.comparisonCard}>
          <Text style={styles.cardLabel}>After</Text>
          <Image source={{ uri: enhancedPreviewUri }} style={styles.image} />
        </View>

        <Pressable style={styles.primaryButton} onPress={handleSave} disabled={busyAction !== null}>
          <Text style={styles.primaryButtonText}>
            {busyAction === 'save' ? 'Saving...' : '💾 Save to Gallery'}
          </Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={handleShare} disabled={busyAction !== null}>
          <Text style={styles.secondaryButtonText}>{busyAction === 'share' ? 'Sharing...' : '📤 Share'}</Text>
        </Pressable>

        <Pressable style={styles.tertiaryButton} onPress={() => navigation.popToTop()}>
          <Text style={styles.tertiaryButtonText}>✨ Enhance Another</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f12',
  },
  container: {
    padding: 24,
    gap: 16,
  },
  title: {
    color: '#f7f0d8',
    fontSize: 30,
    fontWeight: '800',
  },
  subtitle: {
    color: '#d6d1c4',
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 8,
  },
  comparisonCard: {
    backgroundColor: '#18181d',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2f2f37',
    padding: 16,
  },
  cardLabel: {
    color: '#f4c542',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  image: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#101014',
  },
  primaryButton: {
    backgroundColor: '#f4c542',
    borderRadius: 18,
    paddingVertical: 18,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#18181d',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    backgroundColor: '#18181d',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f4c542',
    paddingVertical: 18,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#f4c542',
    fontSize: 16,
    fontWeight: '700',
  },
  tertiaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  tertiaryButtonText: {
    color: '#f7f0d8',
    fontSize: 16,
    fontWeight: '700',
  },
});
