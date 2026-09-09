export const MAX_OCCUPANTS = 6;

export function maxPassengersForBooking(bringingPet: boolean): number {
  return MAX_OCCUPANTS - (bringingPet ? 1 : 0);
}