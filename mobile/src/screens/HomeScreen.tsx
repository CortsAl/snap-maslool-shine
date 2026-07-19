import React from 'react';
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { StackScreenProps } from '@react-navigation/stack';

import type { RootStackParamList } from '../types/navigation';

type Props = StackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  // Ask for the correct permission, open the picker, and send the selected image to processing.
  const handleImageSelection = async (source: 'camera' | 'gallery') => {
    try {
      const permissionResponse =
        source === 'camera'
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permissionResponse.granted) {
        Alert.alert(
          'Permission needed',
          source === 'camera'
            ? 'Camera access is required to take a product photo.'
            : 'Gallery access is required to choose a product photo.',
        );
        return;
      }

      const pickerResult =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              allowsEditing: false,
              quality: 1,
            });

      if (!pickerResult.canceled) {
        navigation.navigate('Processing', { imageUri: pickerResult.assets[0].uri });
      }
    } catch (error) {
      Alert.alert(
        'Unable to open photos',
        error instanceof Error ? error.message : 'Please try again in a moment.',
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Maslool Snap & Shine</Text>
          <Text style={styles.title}>Snap & Shine</Text>
          <Text style={styles.subtitle}>
            Turn raw product photos into premium studio-style shots with a clean white backdrop.
          </Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => handleImageSelection('camera')}>
          <Text style={styles.primaryButtonText}>Take Photo</Text>
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => handleImageSelection('gallery')}>
          <Text style={styles.secondaryButtonText}>Pick from Gallery</Text>
        </Pressable>
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
    justifyContent: 'center',
    padding: 24,
    gap: 16,
  },
  heroCard: {
    backgroundColor: '#18181d',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#2f2f37',
    padding: 24,
    marginBottom: 16,
  },
  eyebrow: {
    color: '#f4c542',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#f7f0d8',
    fontSize: 34,
    fontWeight: '800',
    marginBottom: 12,
  },
  subtitle: {
    color: '#d6d1c4',
    fontSize: 16,
    lineHeight: 24,
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
});
