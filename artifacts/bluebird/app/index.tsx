import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import { useAuth } from '@/context/AuthContext';

export default function Index() {
  const { token, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A1128', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color="#1259F2" size="large" />
      </View>
    );
  }

  if (token) {
    return <Redirect href="/(tabs)/discover" />;
  }

  return <Redirect href="/(auth)/splash" />;
}
