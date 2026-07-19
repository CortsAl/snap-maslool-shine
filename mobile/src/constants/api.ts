import { Platform } from 'react-native';

// Use emulator-friendly localhost defaults during development; replace this with your deployed backend URL when needed.
const LOCAL_API_HOST = Platform.OS === 'android' ? '10.0.2.2' : 'localhost';

export const API_BASE_URL = `http://${LOCAL_API_HOST}:8000`;
