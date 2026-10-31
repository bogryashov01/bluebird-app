import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ConnectionsPreviewMember } from '@/components/ConnectionsPreviewMember';

export default function ConnectionsPreviewMemberRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ConnectionsPreviewMember memberId={typeof id === 'string' ? id : ''} />;
}
