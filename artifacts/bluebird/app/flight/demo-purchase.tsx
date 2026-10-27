import React from 'react';
import { DemoPurchaseScreen } from '@/components/DemoJoinReference';
import { useJoinNavMount } from '@/lib/joinNavDiagnostics';

export default function DemoPurchaseRoute() {
  useJoinNavMount('flight/demo-purchase');
  return <DemoPurchaseScreen />;
}
