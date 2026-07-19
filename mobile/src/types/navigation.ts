// Define the navigation contract once so every screen shares the same route params.
export type RootStackParamList = {
  Home: undefined;
  Processing: { imageUri: string };
  Result: { originalImageUri: string; enhancedImageBase64: string };
};
