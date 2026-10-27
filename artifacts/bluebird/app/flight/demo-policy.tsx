import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { DemoPolicyScreen } from '@/components/DemoJoinReference';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoPolicyRoute() {
  const params = useLocalSearchParams<Record<string, string | string[]>>();
  useJoinNavMount('flight/demo-policy');
  return <DemoPolicyScreen params={params} />;
}
