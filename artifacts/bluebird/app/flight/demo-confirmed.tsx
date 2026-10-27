import React from 'react';
import { DemoJoinStage } from '@/components/DemoJoinStage';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoConfirmedScreen() {
  useJoinNavMount('flight/demo-confirmed');
  return <DemoJoinStage stage="confirmed" />;
}
