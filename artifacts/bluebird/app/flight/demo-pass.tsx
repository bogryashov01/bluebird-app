import React from 'react';
import { DemoSkipLineScreen } from '@/components/DemoJoinReference';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoPassScreen() {
  useJoinNavMount('flight/demo-pass');
  return <DemoSkipLineScreen />;
}
