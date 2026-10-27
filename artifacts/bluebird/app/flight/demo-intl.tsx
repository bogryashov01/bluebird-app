import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DemoInternationalScreen } from '@/components/DemoJoinReference';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoInternationalRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  useJoinNavMount('flight/demo-intl');
  return <DemoInternationalScreen params={params} />;
}
