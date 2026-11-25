import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

/** HTTPS profile image only. Empty, invalid, and non-HTTPS values become the placeholder. */
export function memberAvatarImageUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > 2000) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return text;
  } catch {
    return null;
  }
}

export function MemberAvatar({
  imageUrl,
  size = 48,
  accessibilityLabel = 'Member',
}: {
  imageUrl?: string | null;
  size?: number;
  accessibilityLabel?: string;
}) {
  const colors = useColors();
  const safeUrl = memberAvatarImageUrl(imageUrl);
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null);
  const showPhoto = safeUrl !== null && failedUrl !== safeUrl;
  const iconSize = Math.max(14, Math.round(size * 0.46));
  return (
    <View
      accessibilityLabel={showPhoto ? accessibilityLabel : `${accessibilityLabel}, no profile photo`}
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.secondary,
        },
      ]}
    >
      {showPhoto ? (
        <Image
          key={safeUrl}
          source={{ uri: safeUrl }}
          style={{ width: size, height: size }}
          resizeMode="cover"
          onError={() => setFailedUrl(safeUrl)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Feather name="user" size={iconSize} color={colors.mutedForegroundLight} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
