export interface ContactPhoneNumber {
  id: string;
  label: string | null;
  number: string;
}

export interface SelectedContact {
  id: string;
  displayName: string;
  phoneNumbers: ContactPhoneNumber[];
  hasEmail: boolean;
}

export type ContactPickOutcome =
  | { status: 'selected'; contact: SelectedContact }
  | { status: 'cancelled' }
  | { status: 'unavailable' };

export type DeviceContactPickerResult = {
  id?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumbers?: readonly unknown[] | null;
  emails?: readonly unknown[] | null;
} | null;

const INVITE_MESSAGE_PREFIX = 'Give $500, earn $1,000 with Bluebird. Your friend receives a $500 membership discount, and you earn $1,000 in referral credit after their qualifying membership activation: ';
const SMS_INVITE_MESSAGE_PREFIX = "Hey! I'd love to invite you to Bluebird Jets ✈️ Join using my link: ";

const PHONE_LABELS: Readonly<Record<string, string>> = {
  mobile: 'Mobile',
  cell: 'Mobile',
  iphone: 'iPhone',
  home: 'Home',
  work: 'Work',
  main: 'Main',
  other: 'Other',
  school: 'School',
  pager: 'Pager',
};

/**
 * Opens the iOS system contact picker when the caller supplies it.
 * A missing picker or a non-iOS platform stays unavailable and does not request address-book permission.
 */
export async function pickDeviceContact(input?: {
  platform?: string;
  presentPicker?: () => Promise<DeviceContactPickerResult>;
}): Promise<ContactPickOutcome> {
  if (input?.platform !== 'ios' || !input.presentPicker) return { status: 'unavailable' };
  try {
    const contact = await input.presentPicker();
    if (!contact) return { status: 'cancelled' };
    const selected = selectedContactFromPicker(contact);
    return selected ? { status: 'selected', contact: selected } : { status: 'cancelled' };
  } catch {
    return { status: 'unavailable' };
  }
}

export function selectedContactFromPicker(raw: {
  id?: string | null;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phoneNumbers?: readonly unknown[] | null;
  emails?: readonly unknown[] | null;
}): SelectedContact | null {
  const parts = [raw.firstName, raw.lastName]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .map((part) => part.trim());
  const displayName = parts.join(' ')
    || (typeof raw.name === 'string' ? raw.name.trim() : '');
  if (!displayName) return null;
  const providedId = typeof raw.id === 'string' ? raw.id.trim() : '';
  const generatedId = globalThis.crypto?.randomUUID?.() ?? `selected-${Date.now()}`;
  return {
    id: providedId || generatedId,
    displayName,
    phoneNumbers: phoneNumbersFromPicker(raw.phoneNumbers),
    hasEmail: Array.isArray(raw.emails) && raw.emails.length > 0,
  };
}

/**
 * Keeps the numbers the system picker returned for this person so the SMS composer can be addressed.
 * Email addresses are discarded. Nothing here is uploaded.
 */
function phoneNumbersFromPicker(value: readonly unknown[] | null | undefined): ContactPhoneNumber[] {
  if (!Array.isArray(value)) return [];
  const numbers: ContactPhoneNumber[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const phone = phoneNumberFromUnknown(entry, numbers.length);
    if (!phone || seen.has(phone.number)) continue;
    seen.add(phone.number);
    numbers.push(phone);
  }
  return numbers;
}

function phoneNumberFromUnknown(entry: unknown, index: number): ContactPhoneNumber | null {
  if (typeof entry !== 'object' || entry === null) return null;
  const record = entry as Record<string, unknown>;
  const formatted = typeof record.number === 'string' ? record.number.trim() : '';
  const digits = typeof record.digits === 'string' ? record.digits.trim() : '';
  const number = formatted || digits;
  if (!number) return null;
  return {
    id: `phone-${index}`,
    label: normalizedPhoneLabel(typeof record.label === 'string' ? record.label : ''),
    number,
  };
}

function normalizedPhoneLabel(value: string): string | null {
  const compact = value.trim().replace(/[_$!<>]/g, '').trim();
  if (!compact) return null;
  return PHONE_LABELS[compact.toLowerCase()] ?? compact;
}

export function addSelectedContact(
  current: readonly SelectedContact[],
  contact: SelectedContact,
): SelectedContact[] {
  if (current.some((item) => item.id === contact.id)) return [...current];
  return [...current, contact];
}

export function applyContactPick(
  current: readonly SelectedContact[],
  outcome: ContactPickOutcome,
): { contacts: SelectedContact[]; notice: string | null } {
  if (outcome.status === 'cancelled') return { contacts: [...current], notice: null };
  if (outcome.status === 'unavailable') {
    return {
      contacts: [...current],
      notice: 'The installed Bluebird app cannot open the iPhone contact picker yet. Your address book stays on this iPhone.',
    };
  }
  const alreadySelected = current.some((item) => item.id === outcome.contact.id);
  return {
    contacts: addSelectedContact(current, outcome.contact),
    notice: alreadySelected ? 'That contact is already selected.' : null,
  };
}

export function searchSelectedContacts(
  contacts: readonly SelectedContact[],
  query: string,
): SelectedContact[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...contacts];
  return contacts.filter((contact) => {
    const haystack = [
      contact.displayName,
      ...contact.phoneNumbers.flatMap((phone) => [phone.number, phone.label ?? '']),
    ].join('\n').toLowerCase();
    return haystack.includes(needle);
  });
}

export function contactPhoneLines(contact: SelectedContact): string[] {
  return contact.phoneNumbers.map((phone) => (
    phone.label ? `${phone.label} · ${phone.number}` : phone.number
  ));
}

export function contactInviteMessage(inviteUrl: string): string {
  return `${INVITE_MESSAGE_PREFIX}${inviteUrl}`;
}

export function contactSmsInviteMessage(inviteUrl: string): string {
  return `${SMS_INVITE_MESSAGE_PREFIX}${inviteUrl}`;
}

export function usableInviteUrl(inviteUrl: string | null | undefined): string | null {
  if (typeof inviteUrl !== 'string') return null;
  const trimmed = inviteUrl.trim();
  if (!trimmed.startsWith('https://')) return null;
  return trimmed;
}

export type SmsInvitationPlan =
  | { status: 'compose'; phoneNumber: string; message: string }
  | { status: 'choose'; numbers: ContactPhoneNumber[]; message: string }
  | { status: 'needs-phone' }
  | { status: 'needs-link' };

/**
 * One number can open the composer. Several numbers stay unresolved until the user picks one.
 */
export function planSmsInvitation(
  contact: SelectedContact,
  inviteUrl: string | null | undefined,
): SmsInvitationPlan {
  const url = usableInviteUrl(inviteUrl);
  if (!url) return { status: 'needs-link' };
  const message = contactSmsInviteMessage(url);
  if (contact.phoneNumbers.length === 0) return { status: 'needs-phone' };
  const [only] = contact.phoneNumbers;
  if (contact.phoneNumbers.length === 1 && only) {
    return { status: 'compose', phoneNumber: only.number, message };
  }
  return { status: 'choose', numbers: contact.phoneNumbers, message };
}

export type SmsInvitationStart =
  | { status: 'needs-link' }
  | { status: 'needs-phone' }
  | { status: 'cancelled' }
  | { status: 'composer'; result: string | null | undefined };

export async function beginSmsInvitation(input: {
  contact: SelectedContact;
  inviteUrl: string | null | undefined;
  chooseNumber: (numbers: readonly ContactPhoneNumber[]) => Promise<string | null>;
  sendSms: (phoneNumber: string, message: string) => Promise<string | null | undefined>;
}): Promise<SmsInvitationStart> {
  const plan = planSmsInvitation(input.contact, input.inviteUrl);
  if (plan.status === 'needs-link' || plan.status === 'needs-phone') return plan;
  const phoneNumber = plan.status === 'compose'
    ? plan.phoneNumber
    : await chosenPhoneNumber(plan.numbers, input.chooseNumber);
  if (!phoneNumber) return { status: 'cancelled' };
  const result = await input.sendSms(phoneNumber, plan.message);
  return { status: 'composer', result };
}

async function chosenPhoneNumber(
  numbers: readonly ContactPhoneNumber[],
  chooseNumber: (numbers: readonly ContactPhoneNumber[]) => Promise<string | null>,
): Promise<string | null> {
  const chosen = (await chooseNumber(numbers))?.trim() ?? '';
  return numbers.some((phone) => phone.number === chosen) ? chosen : null;
}

export function finishSmsComposer(
  contacts: readonly SelectedContact[],
  result: string | null | undefined,
): { contacts: SelectedContact[]; notice: string | null; claimedDelivery: false } {
  return {
    contacts: [...contacts],
    notice: smsComposerNotice(result),
    claimedDelivery: false,
  };
}

function smsComposerNotice(result: string | null | undefined): string | null {
  if (result === 'cancelled' || result === 'sent' || result === 'unknown') return null;
  if (result === 'unavailable') {
    return 'Text messages are not available on this iPhone. You can share the invitation another way.';
  }
  return 'The message composer couldn’t be opened. You can share the invitation another way.';
}

export function shareInvitationPayload(
  inviteUrl: string | null | undefined,
): { message: string; url: string } | null {
  const url = usableInviteUrl(inviteUrl);
  if (!url) return null;
  return { message: contactInviteMessage(url), url };
}

export function finishShareSheet(
  action: string | null | undefined,
): { notice: string | null; claimedDelivery: false } {
  if (interpretShareResult(action) === 'unavailable') {
    return { notice: 'The share sheet couldn’t be opened.', claimedDelivery: false };
  }
  return { notice: null, claimedDelivery: false };
}

export function interpretShareResult(
  action: string | null | undefined,
): 'completed' | 'dismissed' | 'unavailable' {
  if (action === 'sharedAction') return 'completed';
  if (action === 'dismissedAction') return 'dismissed';
  return 'unavailable';
}
