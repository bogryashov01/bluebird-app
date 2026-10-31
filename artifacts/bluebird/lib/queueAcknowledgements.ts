/**
 * Reference acknowledgements shown before a production queue join.
 * They stay on the device. They are not a payment and they are not sent
 * as the queue request body.
 */
export const QUEUE_ACKNOWLEDGEMENT_ITEMS = [
  {
    id: 'cancellation-risk',
    label: 'Flights may be cancelled or changed due to operational requirements.',
  },
  {
    id: 'baggage-limit',
    label: 'Baggage restrictions apply based on aircraft type and available space.',
  },
  {
    id: 'pet-policy',
    label: 'Pet policies apply — please confirm your pet meets carrier requirements.',
  },
] as const;

export const QUEUE_PET_QUESTION = 'Are you traveling with a pet?';

/**
 * The earlier join screen treats this as a cleaning fee that can apply only
 * if the flight is awarded. This app does not charge it.
 */
export const QUEUE_PET_FEE_NOTICE =
  'A $500 pet cleaning fee may apply only if this flight is awarded. Acknowledging it does not charge a card or pay the fee.';

export const QUEUE_PET_FEE_ACKNOWLEDGEMENT =
  'I understand a $500 pet cleaning fee may apply only if this flight is awarded. This acknowledgement is not a payment.';

export const QUEUE_ACKNOWLEDGEMENT_LEGAL =
  'By continuing, you acknowledge these terms for this flight. No queue request is sent from this screen.';

export function queueAcknowledgementsComplete(input: {
  checked: readonly boolean[];
  bringingPet: boolean | null;
  petFeeAcknowledged: boolean;
}): boolean {
  const policies = input.checked.length === QUEUE_ACKNOWLEDGEMENT_ITEMS.length
    && input.checked.every((item) => item === true);
  const petReady = input.bringingPet === false
    || (input.bringingPet === true && input.petFeeAcknowledged === true);
  return policies && petReady;
}
