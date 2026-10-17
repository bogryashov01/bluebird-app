export const QUEUE_PREVIEW_STATES = [
  'eligible-flight',
  'join-loading',
  'confirmation',
  'waiting',
  'unavailable',
  'selected',
  'winner',
  'pass-no-pass',
  'pass-unavailable',
  'pass-available',
  'pass-loading',
  'pass-success',
  'pass-failure',
] as const;

export type QueuePreviewState = (typeof QUEUE_PREVIEW_STATES)[number];
export type PassPreviewState = Extract<QueuePreviewState, `pass-${string}`>;

export function isQueueDevelopmentPreviewEnabled(isDev: boolean): boolean {
  return isDev;
}

export function parseQueuePreviewState(value: unknown): QueuePreviewState {
  return typeof value === 'string' && QUEUE_PREVIEW_STATES.includes(value as QueuePreviewState)
    ? value as QueuePreviewState
    : 'eligible-flight';
}

export function isPassPreviewState(state: QueuePreviewState): state is PassPreviewState {
  return state.startsWith('pass-');
}
