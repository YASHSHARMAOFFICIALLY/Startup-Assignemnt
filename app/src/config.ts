import { Platform } from 'react-native';

export const SERVER_URL =
  process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

/**
 * Two browser tabs of the same site share storage, so each client picks a
 * storage namespace from the URL (`?client=A` / `?client=B`) and behaves like
 * a separate physical device. On native each install is naturally a device.
 */
function resolveClientName(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const fromUrl = new URLSearchParams(window.location.search).get('client');
    if (fromUrl) return fromUrl.toUpperCase();
    return 'A';
  }
  return 'PHONE';
}

export const CLIENT_NAME = resolveClientName();
export const DEVICE_ID = `device-${CLIENT_NAME}`;
export const STORAGE_PREFIX = `alcovia:${CLIENT_NAME}:`;
export const SYNC_INTERVAL_MS = 2500;
export const BACKGROUND_GRACE_MS = 5000;
