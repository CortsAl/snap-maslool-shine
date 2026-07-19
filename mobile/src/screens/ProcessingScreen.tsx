import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import axios from 'axios';
import type { StackScreenProps } from '@react-navigation/stack';

import { API_BASE_URL } from '../constants/api';
import type { RootStackParamList } from '../types/navigation';

type Props = StackScreenProps<RootStackParamList, 'Processing'>;
type EnhanceResponse = { image: string };

export function ProcessingScreen({ navigation, route }: Props) {
  const { imageUri } = route.params;
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [attemptCount, setAttemptCount] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    // Upload the original image as multipart form data and move to the result view on success.
    const enhanceImage = async () => {
      setErrorMessage(null);

      try {
        const formData = new FormData();
        formData.append(
          'file',
          {
            uri: imageUri,
            name: 'product-photo.jpg',
            type: 'image/jpeg',
          } as never,
        );

        const response = await axios.post<EnhanceResponse>(`${API_BASE_URL}/enhance`, formData, {
          headers: {
            Accept: 'application/json',
            'Content-Type': 'multipart/form-data',
          },
          signal: controller.signal,
          timeout: 120000,
        });

        navigation.replace('Result', {
          originalImageUri: imageUri,
          enhancedImageBase64: response.data.image,
        });
      } catch (error) {
        if (axios.isAxiosError(error) && error.code === 'ERR_CANCELED') {
          return;
        }

        if (axios.isAxiosError(error)) {
          setErrorMessage(
            typeof error.response?.data?.detail === 'string'
              ? error.response.data.detail
              : 'We could not enhance your photo right now. Please try again.',
          );
          return;
        }

        setErrorMessage(error instanceof Error ? error.message : 'Please try again in a moment.');
      }
    };

    enhanceImage();

    // Cancel the request if the user leaves this screen before the upload finishes.
    return () => {
      controller.abort();
    };
  }, [attemptCount, imageUri, navigation]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.previewCard}>
          <Text style={styles.cardLabel}>Original Photo</Text>
          <Image source={{ uri: imageUri }} style={styles.previewImage} />
        </View>

        {errorMessage ? (
          <View style={styles.statusCard}>
            <Text style={styles.errorTitle}>Something went wrong</Text>
            <Text style={styles.errorMessage}>{errorMessage}</Text>
            <Pressable style={styles.primaryButton} onPress={() => setAttemptCount((count) => count + 1)}>
              <Text style={styles.primaryButtonText}>Retry</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => navigation.goBack()}>
              <Text style={styles.secondaryButtonText}>Choose Another Photo</Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.statusCard}>
            <ActivityIndicator color="#f4c542" size="large" />
            <Text style={styles.loadingTitle}>Enhancing your product photo...</Text>
            <Text style={styles.loadingSubtitle}>
              We are removing the background, refining the lighting, and creating a clean studio finish.
            </Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0f0f12',
  },
  container: {
    flex: 1,
    padding: 24,
    gap: 20,
  },
  previewCard: {
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
  previewImage: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 18,
    backgroundColor: '#101014',
  },
  statusCard: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#18181d',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2f2f37',
    padding: 24,
    gap: 16,
  },
  loadingTitle: {
    color: '#f7f0d8',
    fontSize: 22,
    fontWeight: '800',
    textAlign: 'center',
  },
  loadingSubtitle: {
    color: '#d6d1c4',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  errorTitle: {
    color: '#f7f0d8',
    fontSize: 24,
    fontWeight: '800',
  },
  errorMessage: {
    color: '#d6d1c4',
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#f4c542',
    borderRadius: 18,
    paddingVertical: 16,
    paddingHorizontal: 32,
    minWidth: '100%',
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#18181d',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#f4c542',
    paddingVertical: 16,
    paddingHorizontal: 24,
    minWidth: '100%',
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#f4c542',
    fontSize: 16,
    fontWeight: '700',
  },
});
