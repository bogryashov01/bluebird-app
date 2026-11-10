import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  hydrateWinnerCelebrations,
  setWinnerCelebrationStorage,
} from '@/lib/winnerOfferPresentation';

/**
 * Wires AsyncStorage for winner celebration acknowledgement only.
 * Kept out of ClerkPushCoordinator so push token registration never touches storage.
 */
export function WinnerCelebrationPersistence() {
  useEffect(() => {
    setWinnerCelebrationStorage(AsyncStorage);
    void hydrateWinnerCelebrations();
  }, []);
  return null;
}
