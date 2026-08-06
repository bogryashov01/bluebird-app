import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export interface FlightData {
  id: string;
  fromAirport: string;
  fromCity: string;
  toAirport: string;
  toCity: string;
  aircraftType: string;
  aircraftCapacity: number;
  departureDate: string;
  departureTime: string;
  duration: string;
  seatsAvailable: number;
  status: string;
}

interface FlightCardProps {
  flight: FlightData;
  onPress?: () => void;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' });
}

function statusColor(status: string, primary: string, success: string, muted: string): string {
  switch (status) {
    case 'available': return success;
    case 'boarding': return primary;
    case 'departed': return muted;
    case 'cancelled': return '#EF4444';
    default: return muted;
  }
}

export default function FlightCard({ flight, onPress }: FlightCardProps) {
  const colors = useColors();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {/* Route row */}
      <View style={styles.routeRow}>
        <View style={styles.airportBlock}>
          <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {flight.fromAirport}
          </Text>
          <Text style={[styles.cityName, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {flight.fromCity}
          </Text>
        </View>

        <View style={styles.routeMiddle}>
          <View style={[styles.dot, { backgroundColor: colors.primary }]} />
          <View style={[styles.line, { backgroundColor: colors.border }]} />
          <Feather name="send" size={14} color={colors.primary} style={{ transform: [{ rotate: '-45deg' }] }} />
        </View>

        <View style={[styles.airportBlock, styles.rightBlock]}>
          <Text style={[styles.airportCode, { color: colors.foreground, fontFamily: 'Inter_700Bold' }]}>
            {flight.toAirport}
          </Text>
          <Text style={[styles.cityName, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {flight.toCity}
          </Text>
        </View>
      </View>

      {/* Details row */}
      <View style={[styles.detailsRow, { borderTopColor: colors.border }]}>
        <View style={styles.detailItem}>
          <Feather name="calendar" size={12} color={colors.mutedForeground} />
          <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {formatDate(flight.departureDate)} · {flight.departureTime}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {flight.duration}
          </Text>
        </View>
        <View style={styles.detailItem}>
          <Feather name="users" size={12} color={colors.mutedForeground} />
          <Text style={[styles.detailText, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
            {flight.seatsAvailable} seats
          </Text>
        </View>
      </View>

      {/* Bottom row */}
      <View style={styles.bottomRow}>
        <Text style={[styles.aircraftType, { color: colors.mutedForeground, fontFamily: 'Inter_400Regular' }]}>
          {flight.aircraftType}
        </Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor(flight.status, colors.primary, colors.success, colors.mutedForeground) + '20' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor(flight.status, colors.primary, colors.success, colors.mutedForeground) }]} />
          <Text style={[styles.statusText, { color: statusColor(flight.status, colors.primary, colors.success, colors.mutedForeground), fontFamily: 'Inter_500Medium' }]}>
            {flight.status.charAt(0).toUpperCase() + flight.status.slice(1)}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 16,
    marginBottom: 12,
    overflow: 'hidden',
    paddingTop: 16,
    paddingHorizontal: 16,
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  airportBlock: {
    flex: 1,
  },
  rightBlock: {
    alignItems: 'flex-end',
  },
  airportCode: {
    fontSize: 22,
    letterSpacing: 1,
  },
  cityName: {
    fontSize: 12,
    marginTop: 2,
  },
  routeMiddle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  line: {
    flex: 1,
    height: 1,
    marginHorizontal: 4,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    paddingTop: 12,
    paddingBottom: 12,
    gap: 4,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  detailText: {
    fontSize: 11,
  },
  bottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 14,
  },
  aircraftType: {
    fontSize: 12,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 20,
  },
  statusDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 11,
  },
});
