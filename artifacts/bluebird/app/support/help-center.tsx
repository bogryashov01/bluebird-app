import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { SupportPage } from '@/components/SupportPage';
import {
  EXTERNAL_RESOURCE_OPEN_ERROR,
  openVerifiedSupportResource,
  verifiedSupportResource,
  type SupportResource,
  type SupportResourceId,
} from '@/lib/supportResources';

const SECTION_IDS: SupportResourceId[] = ['faq', 'support-email', 'support-phone', 'contact-page'];

function actionIcon(url: string): 'external-link' | 'mail' | 'phone' {
  if (url.startsWith('mailto:')) return 'mail';
  if (url.startsWith('tel:')) return 'phone';
  return 'external-link';
}

export default function HelpCenterScreen() {
  const colors = useColors();
  const [openError, setOpenError] = useState(false);
  const [openingId, setOpeningId] = useState<SupportResourceId | null>(null);

  const openResource = async (resource: SupportResource) => {
    if (openingId) return;
    setOpeningId(resource.id);
    setOpenError(false);
    const result = await openVerifiedSupportResource(resource, (url) => Linking.openURL(url));
    setOpeningId(null);
    if (result === 'unavailable') setOpenError(true);
  };

  return (
    <SupportPage title="Help Center" testID="help-center-screen" backTestID="help-center-back">
      <Text style={[styles.introTitle, { color: colors.textOnSurface }]}>How can we help?</Text>
      <Text style={[styles.introBody, { color: colors.mutedForegroundLight }]}>
        Find answers to common questions or get in touch with the Bluebird team.
      </Text>
      <View
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        testID="help-center-resources"
      >
        {SECTION_IDS.map((id, index) => {
          const resource = verifiedSupportResource(id);
          const divider = index > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.separator } : null;
          if (!resource) {
            return (
              <View key={id} style={[styles.row, divider]} testID={`help-center-${id}`}>
                <Text style={[styles.rowTitle, { color: colors.textOnSurface }]}>Unavailable</Text>
              </View>
            );
          }
          return (
            <TouchableOpacity
              key={id}
              onPress={() => { void openResource(resource); }}
              disabled={openingId !== null}
              accessibilityRole="link"
              accessibilityLabel={resource.label}
              testID={`help-center-${id}`}
              style={[styles.row, styles.linkRow, divider, { opacity: openingId === resource.id ? 0.7 : 1 }]}
            >
              <View style={styles.copy}>
                <Text style={[styles.rowTitle, { color: colors.textOnSurface }]}>{resource.label}</Text>
                {resource.description ? (
                  <Text style={[styles.rowBody, { color: colors.mutedForegroundLight }]}>{resource.description}</Text>
                ) : null}
              </View>
              <Feather name={actionIcon(resource.url)} size={16} color={colors.primary} />
            </TouchableOpacity>
          );
        })}
        {openError ? (
          <Text
            accessibilityRole="alert"
            style={[styles.error, { color: colors.mutedForegroundLight }]}
            testID="help-center-open-error"
          >
            {EXTERNAL_RESOURCE_OPEN_ERROR}
          </Text>
        ) : null}
      </View>
    </SupportPage>
  );
}

const styles = StyleSheet.create({
  introTitle: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
  },
  introBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    lineHeight: 21,
    marginTop: 8,
    marginBottom: 18,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 18,
    overflow: 'hidden',
  },
  row: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    gap: 4,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  rowTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    lineHeight: 21,
  },
  rowBody: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 18,
    paddingBottom: 16,
  },
});
