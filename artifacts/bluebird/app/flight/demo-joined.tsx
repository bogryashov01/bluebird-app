import React from 'react';
import { DemoQueueJoinedScreen } from '@/components/DemoJoinReference';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoJoinedScreen() {
  useJoinNavMount('flight/demo-joined');
  return <DemoQueueJoinedScreen />;
}
