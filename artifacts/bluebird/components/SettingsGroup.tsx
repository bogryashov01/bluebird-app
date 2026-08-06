import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useColors } from '@/hooks/useColors';

export interface SettingsRow {
  label: string;
  hint?: string;
  onPress?: () => void;
  right?: React.ReactNode;
  disabled?: boolean;
}

interface SettingsGroupProps {
  title?: string;
  rows: SettingsRow[];
}

export function SettingsGroup({ title, rows }: SettingsGroupProps) {
  const colors = useColors();
  return (
    <View style={styles.wrap}>
      {title ? (
        <Text style={[styles.title, { color: colors.mutedForegroundLight }]}>{title}</Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: '#fff' }]}>
        {rows.map((row, i) => (
          <React.Fragment key={row.label}>
            {i > 0 && <View style={styles.sep} />}
            <TouchableOpacity
              style={styles.row}
              onPress={row.onPress}
              activeOpacity={row.onPress ? 0.6 : 1}
              disabled={!row.onPress}
            >
              <Text style={[styles.label, { color: colors.backgroundMid }]}>{row.label}</Text>
              {row.hint ? <Text style={[styles.hint, { color: colors.mutedForegroundLight }]}>{row.hint}</Text> : null}
              {row.right !== undefined ? row.right : (
                row.onPress ? <Text style={[styles.chevron, { color: colors.mutedForegroundLight }]}>›</Text> : null
              )}
            </TouchableOpacity>
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 4 },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    borderRadius: 18,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 20,
    shadowOpacity: 0.05,
    elevation: 3,
    overflow: 'hidden',
  },
  sep: {
    height: 1,
    backgroundColor: 'rgba(10,17,40,0.06)',
    marginLeft: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  label: {
    flex: 1,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    marginRight: 6,
  },
  chevron: {
    fontSize: 20,
    lineHeight: 22,
  },
});
