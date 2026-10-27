import React from 'react';
import { DemoQueueStatusScreen } from '@/components/DemoJoinReference';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoStatusScreen() {
  useJoinNavMount('flight/demo-status');
  return <DemoQueueStatusScreen />;
}
