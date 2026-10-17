export const QUEUE_PREVIEW_STATES = [
  'eligible-flight',
  'join-loading',
  'confirmation',
  'waiting',
  'unavailable',
  'selected',
  'winner',
] as const;

export type QueuePreviewState = (typeof QUEUE_PREVIEW_STATES)[number];

export function isQueueDevelopmentPreviewEnabled(isDev: boolean): boolean {
  return isDev;
}

export function parseQueuePreviewState(value: unknown): QueuePreviewState {
  return typeof value === 'string' && QUEUE_PREVIEW_STATES.includes(value as QueuePreviewState)
    ? value as QueuePreviewState
    : 'eligible-flight';
}
