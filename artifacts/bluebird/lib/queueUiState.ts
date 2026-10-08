/**
 * Vocabulary for a future authenticated production queue UI.
 *
 * These types describe renderable responses only. They do not define live
 * production data, endpoint behavior, or transitions between states.
 */
export type QueueUiState =
  | { status: 'not-in-queue' }
  | { status: 'joining' }
  | { status: 'joined' }
  | { status: 'position'; position: number; queueCount: number }
  | { status: 'queue-closed' }
  | { status: 'winner' }
  | { status: 'confirmation-pending' }
  | { status: 'confirmed' }
  | { status: 'declined' }
  | { status: 'api-error'; message: string; httpStatus?: number };

export type QueueAccessState =
  | 'available'
  | 'authentication-required'
  | 'membership-required'
  | 'profile-incomplete'
  | 'same-day-conflict'
  | 'international-authorization-required';

