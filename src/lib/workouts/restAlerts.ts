'use client';

export type RestAlertPermissionState =
  | 'allowed'
  | 'blocked'
  | 'prompt'
  | 'unsupported';

export interface RestAlertSupportInfo {
  status: RestAlertPermissionState;
  isIos: boolean;
  isStandalone: boolean;
  supportsVibration: boolean;
  supportsServiceWorker: boolean;
}

export interface RestAlertResult {
  vibrated: boolean;
  notified: boolean;
  method: 'service-worker' | 'window-notification' | 'none';
  reason?: string;
}

function detectIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS reports MacIntel with touch points
  if (
    navigator.platform === 'MacIntel' &&
    typeof navigator.maxTouchPoints === 'number' &&
    navigator.maxTouchPoints > 1
  ) {
    return true;
  }
  return false;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone =
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);
  return mediaStandalone || iosStandalone;
}

export function getRestAlertSupportInfo(): RestAlertSupportInfo {
  if (typeof window === 'undefined') {
    return {
      status: 'unsupported',
      isIos: false,
      isStandalone: false,
      supportsVibration: false,
      supportsServiceWorker: false,
    };
  }

  const isIos = detectIos();
  const isStandalone = detectStandalone();
  const supportsVibration =
    !isIos &&
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function';
  const supportsServiceWorker =
    typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

  // On iOS Safari outside Home Screen standalone mode, Web Notifications are not supported.
  // Also non-secure contexts (other than localhost) do not support Notification API.
  const hasNotificationApi =
    typeof Notification !== 'undefined' && window.isSecureContext !== false;

  if (!hasNotificationApi || (isIos && !isStandalone)) {
    return {
      status: 'unsupported',
      isIos,
      isStandalone,
      supportsVibration,
      supportsServiceWorker,
    };
  }

  const perm = Notification.permission;
  const status: RestAlertPermissionState =
    perm === 'granted'
      ? 'allowed'
      : perm === 'denied'
        ? 'blocked'
        : 'prompt';

  return {
    status,
    isIos,
    isStandalone,
    supportsVibration,
    supportsServiceWorker,
  };
}

let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null =
  null;

/**
 * Registers the minimal notification-only service worker (which caches nothing)
 * so mobile browsers / iOS Home Screen PWAs can display notifications.
 */
export async function ensureAlertServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = (async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration('/');
        if (existing) return existing;
        return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch {
        return null;
      }
    })();
  }
  return swRegistrationPromise;
}

export async function requestRestAlertPermission(): Promise<RestAlertSupportInfo> {
  const info = getRestAlertSupportInfo();
  if (info.status === 'unsupported') {
    return info;
  }

  await ensureAlertServiceWorker();

  try {
    await Notification.requestPermission();
  } catch {
    // Ignore browser rejection/unsupported signature
  }

  return getRestAlertSupportInfo();
}

async function getReadySwWithTimeout(
  timeoutMs = 1200,
): Promise<ServiceWorkerRegistration | null> {
  const reg = await ensureAlertServiceWorker();
  if (!reg) return null;
  if (reg.active) return reg;

  try {
    const ready = await Promise.race<ServiceWorkerRegistration | null>([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), timeoutMs),
      ),
    ]);
    return ready ?? reg;
  } catch {
    return reg;
  }
}

/**
 * Shared rest-alert trigger used by both the live rest clock and Settings "Send test alert".
 */
export async function fireRestAlert(options?: {
  title?: string;
  body?: string;
  tag?: string;
}): Promise<RestAlertResult> {
  const title = options?.title ?? 'Rest done';
  const body = options?.body ?? 'Ready for next set';
  const tag = options?.tag ?? 'liftitup-rest-done';

  let vibrated = false;
  if (
    typeof navigator !== 'undefined' &&
    typeof navigator.vibrate === 'function' &&
    !detectIos()
  ) {
    try {
      vibrated = Boolean(navigator.vibrate([180, 90, 180]));
    } catch {
      vibrated = false;
    }
  }

  const info = getRestAlertSupportInfo();
  if (info.status !== 'allowed') {
    return {
      vibrated,
      notified: false,
      method: 'none',
      reason:
        info.status === 'unsupported'
          ? 'not supported on this device'
          : info.status === 'blocked'
            ? 'permission blocked'
            : 'permission not granted',
    };
  }

  if (info.supportsServiceWorker) {
    try {
      const reg = await getReadySwWithTimeout();
      if (reg && typeof reg.showNotification === 'function') {
        await reg.showNotification(title, {
          body,
          tag,
          icon: '/icons/icon.svg',
          badge: '/icons/icon.svg',
        });
        return { vibrated, notified: true, method: 'service-worker' };
      }
    } catch {
      // Fall through to window Notification constructor
    }
  }

  try {
    new Notification(title, {
      body,
      tag,
      icon: '/icons/icon.svg',
    });
    return { vibrated, notified: true, method: 'window-notification' };
  } catch {
    return {
      vibrated,
      notified: false,
      method: 'none',
      reason: 'notification display failed',
    };
  }
}
