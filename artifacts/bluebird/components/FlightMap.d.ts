import type { JSX } from 'react';
import type { Flight } from '@workspace/api-client-react';

/**
 * Types-only facade. Metro resolves FlightMap.native.tsx / FlightMap.web.tsx
 * at bundle time; a FlightMap.ts file would win over those platform files.
 */
export default function FlightMap(props: { flights: Flight[] }): JSX.Element;
