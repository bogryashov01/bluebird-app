import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

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
  return (
    <View style={styles.wrap}>
      {title ? (
        <Text style={styles.title}>{title}</Text>
      ) : null}
      <View style={styles.card}>
        {rows.map((row, i) => (
          <React.Fragment key={row.label}>
            {i > 0 && <View style={styles.sep} />}
            <TouchableOpacity
              style={styles.row}
              onPress={row.onPress}
              activeOpacity={row.onPress ? 0.6 : 1}
              disabled={!row.onPress}
            >
              <Text style={styles.label}>{row.label}</Text>
              {row.hint ? <Text style={styles.hint}>{row.hint}</Text> : null}
              {row.right !== undefined ? row.right : (
                row.onPress ? <Text style={styles.chevron}>›</Text> : null
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
    color: 'rgba(10,17,40,0.4)',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  card: {
    backgroundColor: '#fff',
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
    color: '#0A1128',
  },
  hint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12.5,
    color: 'rgba(10,17,40,0.35)',
    marginRight: 6,
  },
  chevron: {
    fontSize: 20,
    color: 'rgba(10,17,40,0.3)',
    lineHeight: 22,
  },
});
