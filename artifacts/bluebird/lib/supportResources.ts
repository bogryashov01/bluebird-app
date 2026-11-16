/**
 * Official Help Center and Legal destinations confirmed on bluebirdjets.com.
 *
 * Openers receive only a listed URL. No query, hash, credential, or token
 * is added. mailto and tel open the system handlers; they do not send mail
 * or place a call by themselves.
 */
export type SupportResourceId =
  | 'faq'
  | 'support-email'
  | 'support-phone'
  | 'contact-page'
  | 'terms'
  | 'privacy'
  | 'flight-policy';

export interface SupportResource {
  id: SupportResourceId;
  label: string;
  description: string;
  url: string;
}

export const VERIFIED_SUPPORT_RESOURCES: readonly SupportResource[] = [
  {
    id: 'faq',
    label: 'Frequently Asked Questions',
    description: 'Find answers to common questions about Bluebird.',
    url: 'https://bluebirdjets.com/faq',
  },
  {
    id: 'support-email',
    label: 'Email Support',
    description: 'Get in touch with the Bluebird team.',
    url: 'mailto:hello@bluebirdjets.com',
  },
  {
    id: 'support-phone',
    label: 'Call Support',
    description: '(380) 249-9582',
    url: 'tel:+13802499582',
  },
  {
    id: 'contact-page',
    label: 'Contact Us',
    description: 'Visit the Bluebird contact page.',
    url: 'https://bluebirdjets.com/contact',
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    description: '',
    url: 'https://bluebirdjets.com/terms',
  },
  {
    id: 'privacy',
    label: 'Privacy Policy',
    description: '',
    url: 'https://bluebirdjets.com/privacy',
  },
  {
    id: 'flight-policy',
    label: 'Flight Policy',
    description: '',
    url: 'https://bluebirdjets.com/flight-policy',
  },
];

export const EXTERNAL_RESOURCE_OPEN_ERROR =
  'This link couldn’t be opened. Try again in a moment.';

export function verifiedSupportResource(id: SupportResourceId): SupportResource | null {
  return VERIFIED_SUPPORT_RESOURCES.find((resource) => resource.id === id) ?? null;
}

export function isSafeExternalDestination(url: string): boolean {
  if (url === 'mailto:hello@bluebirdjets.com' || url === 'tel:+13802499582') return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.port) return false;
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'bluebirdjets.com') return false;
  if (parsed.pathname === '/' || parsed.pathname === '/api' || parsed.pathname.startsWith('/api/')) return false;
  return true;
}

export async function openVerifiedSupportResource(
  resource: SupportResource | null,
  open: (url: string) => Promise<unknown>,
  catalog: readonly SupportResource[] = VERIFIED_SUPPORT_RESOURCES,
): Promise<'opened' | 'unavailable'> {
  if (!resource) return 'unavailable';
  const listed = catalog.some((item) =>
    item.id === resource.id
    && item.label === resource.label
    && item.description === resource.description
    && item.url === resource.url);
  if (!listed || !isSafeExternalDestination(resource.url)) return 'unavailable';
  try {
    await open(resource.url);
    return 'opened';
  } catch {
    return 'unavailable';
  }
}
