/**
 * TypeScript-visible facade for the platform-specific FlightMap components.
 *
 * Metro resolves `.web.tsx` (web) and `.native.tsx` (native) at runtime,
 * ignoring this file. TypeScript resolves this file for type-checking.
 *
 * Re-exporting the web implementation keeps the types accurate; the
 * interface is identical in both platform variants.
 */
export { default } from './FlightMap.web';
