export const QUEUE_PREVIEW_STATES = [
  'not-joined',
  'waiting',
  'unavailable',
  'pass-non-member',
  'pass-no-pass',
  'pass-unavailable',
  'pass-available',
] as const;

export type QueuePreviewState = (typeof QUEUE_PREVIEW_STATES)[number];
export type PassPreviewState = Extract<QueuePreviewState, `pass-${string}`>;

export function isQueueDevelopmentPreviewEnabled(isDev: boolean): boolean {
  return isDev;
}

export function parseQueuePreviewState(value: unknown): QueuePreviewState {
  if (value === 'eligible-flight') return 'not-joined';
  return typeof value === 'string' && QUEUE_PREVIEW_STATES.includes(value as QueuePreviewState)
    ? value as QueuePreviewState
    : 'not-joined';
}

export function isPassPreviewState(state: QueuePreviewState): state is PassPreviewState {
  return state.startsWith('pass-');
}
