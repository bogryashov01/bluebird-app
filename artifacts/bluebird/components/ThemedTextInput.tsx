import React from 'react';
import { TextInput, type TextInputProps } from 'react-native';
import { useColors } from '@/hooks/useColors';

/**
 * Text field that follows the active Bluebird palette.
 * A plain TextInput keeps the system light fill and keyboard.
 */
export const ThemedTextInput = React.forwardRef<TextInput, TextInputProps>(
  function ThemedTextInput(
    {
      style,
      placeholderTextColor,
      keyboardAppearance,
      selectionColor,
      ...props
    },
    ref,
  ) {
    const colors = useColors();
    return (
      <TextInput
        ref={ref}
        keyboardAppearance={keyboardAppearance ?? colors.scheme}
        placeholderTextColor={placeholderTextColor ?? colors.mutedForeground}
        selectionColor={selectionColor ?? colors.primary}
        {...props}
        style={[{ color: colors.foreground, backgroundColor: 'transparent' }, style]}
      />
    );
  },
);
