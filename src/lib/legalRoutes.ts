export const PRIVACY_POLICY_PATH = '/privacy-policy' as const;
export const TERMS_AND_CONDITIONS_PATH = '/terms-and-conditions' as const;

export type AppRoute = 'home' | 'privacy-policy' | 'terms-and-conditions';

/**
 * Normalizes a browser pathname and maps it to a known HimRudra page route.
 * Handles trailing slashes and case differences so direct URL opens and
 * browser refreshes resolve reliably.
 */
export function resolveAppRoute(pathname: string): AppRoute {
  const normalized = pathname.trim().toLowerCase().replace(/\/+$/, '') || '/';
  if (normalized === PRIVACY_POLICY_PATH) {
    return 'privacy-policy';
  }
  if (normalized === TERMS_AND_CONDITIONS_PATH) {
    return 'terms-and-conditions';
  }
  return 'home';
}

export function getRouteMeta(
  route: AppRoute,
  fallbackTitle: string,
  fallbackDescription: string
): { title: string; description: string } {
  if (route === 'privacy-policy') {
    return {
      title: 'Privacy Policy | HimRudra — Pure by Himalayas',
      description:
        'Learn how HimRudra collects, uses, stores, and protects customer information, Google Sign-In accounts, orders, payments, and cookies.',
    };
  }
  if (route === 'terms-and-conditions') {
    return {
      title: 'Terms & Conditions | HimRudra — Pure by Himalayas',
      description:
        'Terms and conditions governing website use, orders, payments, shipping, and Himalayan Shilajit Resin purchases on HimRudra.',
    };
  }
  return {
    title: fallbackTitle,
    description: fallbackDescription,
  };
}
