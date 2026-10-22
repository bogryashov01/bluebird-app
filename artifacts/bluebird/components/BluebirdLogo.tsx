import React from 'react';
import { Image, type ImageStyle, type StyleProp } from 'react-native';

export type BluebirdLogoVariant = 'full' | 'symbol' | 'app-icon';
export type BluebirdLogoSize = 'small' | 'medium' | 'large';

interface BluebirdLogoProps {
  variant: BluebirdLogoVariant;
  size: BluebirdLogoSize;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  testID?: string;
}

const ASSETS = {
  full: require('@/assets/images/bluebird-logo-white.png'),
  symbol: require('@/assets/images/bluebird-bird-mark.png'),
  'app-icon': require('@/assets/images/icon.png'),
} as const;

const SIZE_STYLES: Record<BluebirdLogoVariant, Record<BluebirdLogoSize, ImageStyle>> = {
  full: {
    small: { width: 112, height: 25 },
    medium: { width: 180, height: 40 },
    large: { width: 280, height: 63 },
  },
  symbol: {
    small: { width: 24, height: 19 },
    medium: { width: 44, height: 34 },
    large: { width: 88, height: 69 },
  },
  'app-icon': {
    small: { width: 24, height: 24 },
    medium: { width: 44, height: 44 },
    large: { width: 88, height: 88 },
  },
};

const DEFAULT_LABELS: Record<BluebirdLogoVariant, string> = {
  full: 'Bluebird',
  symbol: 'Bluebird bird mark',
  'app-icon': 'Bluebird app icon',
};

export function BluebirdLogo({
  variant,
  size,
  style,
  accessibilityLabel,
  testID,
}: BluebirdLogoProps) {
  return (
    <Image
      source={ASSETS[variant]}
      style={[SIZE_STYLES[variant][size], style]}
      resizeMode="contain"
      accessibilityLabel={accessibilityLabel ?? DEFAULT_LABELS[variant]}
      testID={testID}
    />
  );
}
