import React from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useListNetworkingMessages, useSendNetworkingMessage, useBlockNetworkingConnection } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';

export default function NetworkingThreadScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const [content, setContent] = React.useState('');
  const [error, setError] = React.useState('');
  const { data, isLoading, isError, refetch } = useListNetworkingMessages(id!, { query: { enabled: !!id, refetchInterval: 10000 } });
  const send = useSendNetworkingMessage();
  const block = useBlockNetworkingConnection();
  useFocusEffect(React.useCallback(() => { refetch(); }, [refetch]));
  const submit = () => {
    const value = content.trim();
    if (!value || send.isPending) return;
    setError('');
    send.mutate({ id: id!, data: { content: value, clientMessageId: `${Date.now()}-${Math.random()}` } }, {
      onSuccess: () => {
        setContent('');
        queryClient.invalidateQueries({ queryKey: ['/api/networking/connections', id, 'messages'] });
      },
      onError: (err: any) => setError(err?.data?.error ?? err?.message ?? 'Message failed. Try again.'),
    });
  };
  const messages = data ?? [];
  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: colors.offWhite }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.subhead, { borderBottomColor: colors.separator }]}>
        <Text style={[styles.name, { color: colors.textOnSurface }]}>{name ?? 'Connection'}</Text>
        <TouchableOpacity onPress={() => block.mutate({ id })} disabled={block.isPending}><Text style={[styles.block, { color: colors.destructive }]}>Block</Text></TouchableOpacity>
      </View>
      {isLoading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : isError ? <View style={styles.center}><Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Could not load this conversation.</Text><TouchableOpacity onPress={() => refetch()}><Text style={[styles.link, { color: colors.primary }]}>Try again</Text></TouchableOpacity></View> : (
        <ScrollView contentContainerStyle={styles.messages}>
          {messages.length === 0 ? <Text style={[styles.body, { color: colors.mutedForegroundLight }]}>Start the conversation with a thoughtful introduction.</Text> : messages.map((message) => {
            const mine = message.senderId === user?.id;
            return <View key={message.id} style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.surface, alignSelf: mine ? 'flex-end' : 'flex-start' }]}><Text style={[styles.bubbleText, { color: mine ? colors.primaryForeground : colors.textOnSurface }]}>{message.content}</Text></View>;
          })}
        </ScrollView>
      )}
      <View style={[styles.composer, { borderTopColor: colors.separator, backgroundColor: colors.surface }]}>
        <TextInput value={content} onChangeText={setContent} placeholder="Write a message" placeholderTextColor={colors.mutedForegroundLight} style={[styles.input, { color: colors.textOnSurface, backgroundColor: colors.muted }]} maxLength={1000} multiline />
        <TouchableOpacity onPress={submit} disabled={!content.trim() || send.isPending} style={[styles.send, { backgroundColor: colors.primary, opacity: !content.trim() || send.isPending ? 0.5 : 1 }]}><Text style={[styles.sendText, { color: colors.primaryForeground }]}>Send</Text></TouchableOpacity>
      </View>
      {error ? <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  subhead: { paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  block: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  messages: { padding: 16, gap: 10, flexGrow: 1, justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 18, paddingHorizontal: 14, paddingVertical: 11 },
  bubbleText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  composer: { padding: 10, flexDirection: 'row', gap: 8, alignItems: 'flex-end', borderTopWidth: 1 },
  input: { flex: 1, minHeight: 42, maxHeight: 110, borderRadius: 16, paddingHorizontal: 13, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 14 },
  send: { borderRadius: 999, paddingHorizontal: 15, paddingVertical: 12 },
  sendText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  error: { paddingHorizontal: 16, paddingBottom: 8, fontFamily: 'Inter_400Regular', fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 24 },
  body: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  link: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});