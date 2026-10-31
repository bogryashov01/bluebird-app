import { useLocalSearchParams } from 'expo-router';
import { MemberMessageThread } from '@/components/MemberMessageThread';

function conversationIdFromParam(value: string | string[] | undefined): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || !/^[1-9]\d*$/.test(text)) return null;
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export default function MemberMessageRoute() {
  const params = useLocalSearchParams<{ conversationId?: string | string[] }>();
  return <MemberMessageThread conversationId={conversationIdFromParam(params.conversationId)} />;
}
