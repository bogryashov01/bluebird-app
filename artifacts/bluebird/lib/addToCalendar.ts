import { Platform, Alert } from 'react-native';

export interface FlightCalendarInfo {
  from?: string;
  to?: string;
  fromCity?: string;
  toCity?: string;
  departureDate?: string; // YYYY-MM-DD
  departureTime?: string; // HH:MM
  duration?: string;      // e.g. "2h 30m"
  aircraftType?: string;
}

function parseDurationMins(duration?: string): number {
  if (!duration) return 120; // sensible default block
  const hours = duration.match(/(\d+)\s*h/);
  const mins = duration.match(/(\d+)\s*m/);
  const total = (hours ? parseInt(hours[1], 10) * 60 : 0) + (mins ? parseInt(mins[1], 10) : 0);
  return total > 0 ? total : 120;
}

function buildDates(info: FlightCalendarInfo): { start: Date; end: Date } | null {
  if (!info.departureDate) return null;
  const [y, m, d] = info.departureDate.split('-').map(Number);
  if (!y || !m || !d) return null;
  let hh = 9, mm = 0;
  if (info.departureTime) {
    const [h, min] = info.departureTime.split(':').map(Number);
    if (Number.isFinite(h)) { hh = h; mm = Number.isFinite(min) ? min : 0; }
  }
  const start = new Date(y, m - 1, d, hh, mm);
  if (isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + parseDurationMins(info.duration) * 60_000);
  return { start, end };
}

function eventTitle(info: FlightCalendarInfo): string {
  const route = [info.from, info.to].filter(Boolean).join(' → ');
  return route ? `Bluebird Flight ${route}` : 'Bluebird Flight';
}

function eventNotes(info: FlightCalendarInfo): string {
  const cityRoute = [info.fromCity ?? info.from, info.toCity ?? info.to].filter(Boolean).join(' → ');
  return [cityRoute, info.aircraftType, 'Arrive 30 minutes before departure.']
    .filter(Boolean)
    .join('\n');
}

// ── Web: download an .ics file ────────────────────────────────────────────────
function toIcsStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}T${p(date.getHours())}${p(date.getMinutes())}00`;
}

function downloadIcs(info: FlightCalendarInfo, start: Date, end: Date) {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bluebird//Flight//EN',
    'BEGIN:VEVENT',
    `UID:bluebird-${start.getTime()}@bluebird`,
    `DTSTAMP:${toIcsStamp(new Date(Date.now()))}`,
    `DTSTART:${toIcsStamp(start)}`,
    `DTEND:${toIcsStamp(end)}`,
    `SUMMARY:${escape(eventTitle(info))}`,
    `DESCRIPTION:${escape(eventNotes(info))}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bluebird-flight-${info.from ?? 'trip'}-${info.to ?? ''}.ics`.replace(/-\.ics$/, '.ics');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Native: create a device calendar event via expo-calendar ─────────────────
async function addNativeEvent(info: FlightCalendarInfo, start: Date, end: Date): Promise<boolean> {
  const Calendar = await import('expo-calendar');
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') {
    Alert.alert(
      'Calendar access needed',
      'Allow calendar access in Settings to add your flight to your calendar.',
    );
    return false;
  }

  let calendarId: string | undefined;
  if (Platform.OS === 'ios') {
    const defaultCal = await Calendar.getDefaultCalendarAsync();
    calendarId = defaultCal?.id;
  } else {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.filter((c) => c.allowsModifications);
    calendarId = (writable.find((c) => (c as { isPrimary?: boolean }).isPrimary) ?? writable[0])?.id;
  }
  if (!calendarId) {
    Alert.alert('No calendar found', 'Could not find a writable calendar on this device.');
    return false;
  }

  await Calendar.createEventAsync(calendarId, {
    title: eventTitle(info),
    notes: eventNotes(info),
    startDate: start,
    endDate: end,
  });
  return true;
}

/**
 * Add a confirmed flight to the user's calendar.
 * Web: downloads an .ics file. Native: creates a device calendar event.
 */
export async function addFlightToCalendar(info: FlightCalendarInfo): Promise<void> {
  const dates = buildDates(info);
  if (!dates) {
    if (Platform.OS === 'web') {
      window.alert('Flight date is unavailable, so this flight can’t be added to your calendar.');
    } else {
      Alert.alert('Missing flight date', 'This flight can’t be added to your calendar because its date is unavailable.');
    }
    return;
  }

  if (Platform.OS === 'web') {
    downloadIcs(info, dates.start, dates.end);
    return;
  }

  try {
    const added = await addNativeEvent(info, dates.start, dates.end);
    if (added) Alert.alert('Added to calendar', 'Your flight is on your calendar.');
  } catch {
    Alert.alert('Couldn’t add event', 'Something went wrong while adding the flight to your calendar.');
  }
}
