import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ConnectionsPreviewChat } from '@/components/ConnectionsPreviewChat';

export default function ConnectionsPreviewChatRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return <ConnectionsPreviewChat conversationId={typeof id === 'string' ? id : ''} />;
}