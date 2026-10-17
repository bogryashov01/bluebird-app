import React from 'react';
import { useAuth } from '@/context/AuthContext';
import { ProductionAuthenticatedUnavailableNotice } from '@/components/ProductionAuthenticatedUnavailableNotice';
import FamilyMembershipScreen from '../membership/family';

export default function ContactsScreen() {
  const { authMode } = useAuth();
  if (authMode === 'clerk') {
    return (
      <ProductionAuthenticatedUnavailableNotice
        title="Connect Contacts unavailable"
        description="Contact matching is not available for this signed-in account yet. No contacts are uploaded or changed."
        testID="clerk-connect-contacts-unavailable"
      />
    );
  }
  return <FamilyMembershipScreen />;
}
