/**
 * Website destination for membership payment management.
 *
 * This screen does not call GET /api/membership. This project has no verified
 * payment-management path on the Bluebird website. The production host
 * https://bluebirdjets.com is the official site entry. The API lives under
 * /api and is not a page to open. The opener receives only that origin:
 * no path, query, hash, credential, or Clerk token.
 */
export const MEMBERSHIP_PAYMENT_METHOD_READ_VERIFIED = false;

export const BLUEBIRD_WEBSITE_ENTRY_URL = 'https://bluebirdjets.com';

export const BLUEBIRD_WEBSITE_ACTION_LABEL = 'Open Bluebird Website';

export const MEMBERSHIP_PAYMENT_WEBSITE_OPEN_ERROR =
  'The Bluebird website could not be opened. Try again in a moment.';

export function membershipPaymentWebsiteDestination(): {
  url: typeof BLUEBIRD_WEBSITE_ENTRY_URL;
  label: typeof BLUEBIRD_WEBSITE_ACTION_LABEL;
  directPaymentPathVerified: false;
} {
  return {
    url: BLUEBIRD_WEBSITE_ENTRY_URL,
    label: BLUEBIRD_WEBSITE_ACTION_LABEL,
    directPaymentPathVerified: false,
  };
}

export function isOfficialBluebirdWebsiteEntry(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === 'https:'
    && url.hostname === 'bluebirdjets.com'
    && url.port === ''
    && url.username === ''
    && url.password === ''
    && url.pathname === '/'
    && url.search === ''
    && url.hash === '';
}

export async function openMembershipPaymentWebsite(
  open: (url: string) => Promise<unknown>,
): Promise<'opened' | 'unavailable'> {
  const { url } = membershipPaymentWebsiteDestination();
  if (!isOfficialBluebirdWebsiteEntry(url)) return 'unavailable';
  try {
    await open(url);
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
