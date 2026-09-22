export const LEGAL_PATH = '/support/legal';

export type LegalTab = 'terms' | 'privacy';

export function parseLegalTab(value: string | string[] | undefined | null): LegalTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'privacy' ? 'privacy' : 'terms';
}

export function legalScreenHref(tab: LegalTab): {
  pathname: typeof LEGAL_PATH;
  params: { tab: LegalTab };
} {
  return {
    pathname: LEGAL_PATH,
    params: { tab },
  };
}

/** Root stack screen, not inside the signed-in tab navigator. */
export function legalScreenRequiresAuth(): boolean {
  return false;
}
