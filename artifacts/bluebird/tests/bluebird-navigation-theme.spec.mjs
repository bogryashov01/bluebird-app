import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  bluebirdStackScreenOptions,
  bluebirdThemePalette,
  discoverScreenBackground,
  resolvedColorScheme,
} from '../scripts/.bluebird-navigation-theme.test.mjs';

test('dark chrome uses the navy palette', () => {
  const palette = bluebirdThemePalette('dark');
  const options = bluebirdStackScreenOptions('dark');
  assert.equal(palette.background, '#060B1F');
  assert.equal(palette.headerBackground, '#0A1128');
  assert.equal(palette.foreground, '#FFFFFF');
  assert.equal(palette.border, '#1E2D4F');
  assert.equal(palette.primary, '#1259F2');
  assert.equal(palette.surface, '#0D1636');
  assert.equal(options.contentStyle.backgroundColor, '#060B1F');
  assert.equal(options.headerStyle.backgroundColor, '#0A1128');
  assert.notEqual(palette.background, '#FFFFFF');
  assert.notEqual(palette.surface, '#FFFFFF');
});

test('light chrome uses the light palette', () => {
  const palette = bluebirdThemePalette('light');
  const options = bluebirdStackScreenOptions('light');
  assert.equal(palette.background, '#F2F5FB');
  assert.equal(palette.headerBackground, '#FFFFFF');
  assert.equal(palette.foreground, '#0A1128');
  assert.equal(palette.border, '#DFE6F3');
  assert.equal(palette.surface, '#FFFFFF');
  assert.equal(options.contentStyle.backgroundColor, '#F2F5FB');
  assert.equal(options.headerTintColor, '#0A1128');
});

test('discover uses the same screen background as the other tabs', () => {
  const light = bluebirdThemePalette('light');
  const dark = bluebirdThemePalette('dark');

  assert.equal(light.discoverBackground, light.background);
  assert.equal(light.discoverBackground, '#F2F5FB');
  assert.equal(light.discoverCard, light.card);
  assert.equal(light.discoverForeground, light.foreground);
  assert.equal(light.discoverMuted, light.muted);
  assert.equal(light.discoverMutedForeground, light.mutedForeground);
  assert.equal(light.discoverBorder, light.border);
  assert.notEqual(light.discoverBackground, '#060B1F');

  assert.equal(dark.discoverBackground, dark.background);
  assert.equal(dark.discoverBackground, '#060B1F');
  assert.equal(dark.discoverCard, dark.card);
  assert.equal(dark.discoverForeground, '#FFFFFF');

  assert.equal(light.backgroundMid, '#0A1128');
  assert.equal(dark.backgroundMid, '#0A1128');
  assert.equal(light.discoverHeroOverlayBottom, 'rgba(6,11,31,0.92)');
  assert.equal(dark.discoverHeroOverlayBottom, 'rgba(6,11,31,0.92)');
});

test('system mode gives Discover the device appearance', () => {
  assert.equal(resolvedColorScheme('light', 'dark'), 'light');
  assert.equal(discoverScreenBackground(resolvedColorScheme('light', 'dark')), '#F2F5FB');
  assert.equal(resolvedColorScheme('dark', 'light'), 'dark');
  assert.equal(discoverScreenBackground(resolvedColorScheme('dark', 'light')), '#060B1F');
  assert.equal(resolvedColorScheme('system', 'light'), 'light');
  assert.equal(discoverScreenBackground(resolvedColorScheme('system', 'light')), '#F2F5FB');
  assert.equal(resolvedColorScheme('system', 'dark'), 'dark');
  assert.equal(discoverScreenBackground(resolvedColorScheme('system', 'dark')), '#060B1F');
  assert.equal(resolvedColorScheme('system', null), 'dark');
  assert.equal(resolvedColorScheme('system', undefined), 'dark');
  assert.equal(resolvedColorScheme('system', 'unspecified'), 'dark');
});

test('the Discover screen no longer substitutes a separate navy palette', () => {
  const source = readFileSync(new URL('../app/(tabs)/discover/index.tsx', import.meta.url), 'utf8');
  assert.equal(source.includes('discoverBackground'), false);
  assert.match(source, /const colors = useColors\(\);/);
  assert.match(source, /backgroundColor: colors\.background/);
  assert.match(source, /progressBackgroundColor=\{colors\.surface\}/);
  assert.match(source, /backgroundColor: colors\.backgroundMid/);
  assert.match(source, /colors\.discoverHeroOverlayBottom/);
});
