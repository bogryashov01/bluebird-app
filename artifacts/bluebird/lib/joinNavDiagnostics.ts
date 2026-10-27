import { useEffect, useRef } from 'react';

const PREFIX = '[bluebird-join-nav]';

export const JOIN_NAV_BUILD_MARKER = 'join-nav-bundle-2026-10-27-r2';

export function logJoinNav(
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  if (typeof __DEV__ === 'undefined' || __DEV__ !== true) return;
  const entry: Record<string, string | number | boolean | null> = {
    marker: JOIN_NAV_BUILD_MARKER,
    event,
  };
  const parts = [`event=${event}`, `marker=${JOIN_NAV_BUILD_MARKER}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || key === 'event' || key === 'marker') continue;
    const text = String(value).replace(/[\r\n]/g, ' ').slice(0, 160);
    entry[key] = typeof value === 'string' ? text : value;
    parts.push(`${key}=${text}`);
  }
  console.info(PREFIX, entry);
  console.log(`${PREFIX} ${parts.join(' ')}`);
}

logJoinNav('bundle-loaded', { phase: 'module' });

export function useJoinNavMount(route: string): void {
  useEffect(() => {
    logJoinNav('mount', { route });
    return () => logJoinNav('unmount', { route });
  }, [route]);
}

export function useJoinNavDecision(
  event: string,
  signature: string,
  fields: Record<string, string | number | boolean | null | undefined>,
): void {
  const previous = useRef('');
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;
  useEffect(() => {
    if (previous.current === signature) return;
    previous.current = signature;
    logJoinNav(event, fieldsRef.current);
  }, [event, signature]);
}
