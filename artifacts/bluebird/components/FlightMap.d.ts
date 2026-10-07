/**
 * TypeScript-only declaration for the platform-specific FlightMap components.
 *
 * This file intentionally has no runtime implementation. Metro must resolve
 * FlightMap.native.tsx on iOS/Android and FlightMap.web.tsx on web before it
 * considers a generic source file. Keeping this as a declaration preserves
 * type-checking for the extensionless imports used by the route screens.
 */
import type { ComponentType } from 'react';
import type { AirportRecord, FlightView } from '@/lib/productionFlights';

interface FlightMapProps {
  flights: FlightView[];
  airports: AirportRecord[];
}

declare const FlightMap: ComponentType<FlightMapProps>;

export default FlightMap;