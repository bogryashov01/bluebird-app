import React from 'react';
import { DemoJoinStage } from '@/components/DemoJoinStage';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoWinnerScreen() {
  useJoinNavMount('flight/demo-winner');
  return <DemoJoinStage stage="winner" />;
}
