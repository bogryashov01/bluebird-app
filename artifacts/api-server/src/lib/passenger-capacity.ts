export const MAX_OCCUPANTS = 6;

export function maxPassengersForBooking(bringingPet: boolean): number {
  return MAX_OCCUPANTS - (bringingPet ? 1 : 0);
}

export function exceedsPassengerCapacity(passengers: number, bringingPet: boolean): boolean {
  return passengers < 1 || passengers > maxPassengersForBooking(bringingPet);
}

export function passengerCapacityError(): string {
  return `A booking may include at most ${MAX_OCCUPANTS} occupants total. A pet counts as one occupant, so bookings with a pet may include at most ${MAX_OCCUPANTS - 1} passengers.`;
}