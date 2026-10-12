export interface ProductionMeAccount {
  isAdmin?: boolean;
  isConcierge?: boolean;
  isMember?: boolean;
  memberTier?: string | null;
  isProfileComplete?: boolean;
  needsPlanDecision?: boolean;
  needsSignupPhone?: boolean;
}

export type ProviderAuthState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in' };

export type BackendAuthFailureReason =
  | 'token'
  | 'network'
  | 'timeout'
  | 'http'
  | 'invalid_response';

export type BackendAuthState =
  | { status: 'backend_verifying' }
  | { status: 'authenticated'; account: ProductionMeAccount }
  | { status: 'backend_signed_out' }
  | {
      status: 'network_error';
      reason: BackendAuthFailureReason;
      httpStatus?: number;
    }
  | { status: 'session_expired' };

export interface ProductionAuthStateModel {
  provider: ProviderAuthState;
  backend: BackendAuthState;
}
