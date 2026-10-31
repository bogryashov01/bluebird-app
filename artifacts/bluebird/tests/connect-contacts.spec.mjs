import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const {
  addSelectedContact,
  applyContactPick,
  beginSmsInvitation,
  contactInviteMessage,
  contactPhoneLines,
  contactSmsInviteMessage,
  finishShareSheet,
  finishSmsComposer,
  interpretShareResult,
  pickDeviceContact,
  planSmsInvitation,
  searchSelectedContacts,
  selectedContactFromPicker,
  shareInvitationPayload,
} = await import(resolve(root, "scripts/.connect-contacts.test.mjs"));

const phone = "+15555550199";
const email = "ada@example.test";

test("picker normalization keeps the chosen phone number on device and drops email addresses", () => {
  const contact = selectedContactFromPicker({
    id: "ios-contact-1",
    firstName: "Ada",
    lastName: "Lovelace",
    phoneNumbers: [{ number: phone, label: "mobile" }],
    emails: [{ email, label: "home" }],
  });
  assert.deepEqual(contact, {
    id: "ios-contact-1",
    displayName: "Ada Lovelace",
    phoneNumbers: [{ id: "phone-0", label: "Mobile", number: phone }],
    hasEmail: true,
  });
  const serialized = JSON.stringify(contact);
  assert.equal(serialized.includes(email), false);
  assert.equal(serialized.includes("home"), false);
});

test("a contact without a name is ignored and a missing identifier is generated without the name", () => {
  assert.equal(selectedContactFromPicker({ name: "   ", phoneNumbers: [{ number: phone }] }), null);
  const contact = selectedContactFromPicker({
    firstName: "Grace",
    phoneNumbers: [{ number: phone }],
  });
  assert.equal(contact.displayName, "Grace");
  assert.equal(contact.phoneNumbers.length, 1);
  assert.equal(contact.hasEmail, false);
  assert.equal(contact.id.includes("Grace"), false);
  assert.equal(contact.id.includes(phone), false);
  assert.equal(JSON.stringify(contact).includes(phone), true);
});

test("selection and search stay on the supplied list", () => {
  const ada = {
    id: "ada",
    displayName: "Ada Lovelace",
    phoneNumbers: [{ id: "phone-0", label: "Mobile", number: phone }],
    hasEmail: false,
  };
  const grace = { id: "grace", displayName: "Grace Hopper", phoneNumbers: [], hasEmail: false };
  const selected = addSelectedContact(addSelectedContact([], ada), ada);
  assert.deepEqual(selected, [ada]);
  const withGrace = addSelectedContact(selected, grace);
  assert.deepEqual(searchSelectedContacts(withGrace, " hop"), [grace]);
  assert.deepEqual(searchSelectedContacts(withGrace, "   "), withGrace);
  assert.deepEqual(contactPhoneLines(ada), [`Mobile · ${phone}`]);
  assert.deepEqual(contactPhoneLines(grace), []);
});

test("the iOS picker keeps only the selected contact and never reads the address book itself", async () => {
  assert.deepEqual(await pickDeviceContact(), { status: "unavailable" });
  assert.deepEqual(await pickDeviceContact({ platform: "android", presentPicker: async () => {
    throw new Error("picker should not run");
  } }), { status: "unavailable" });
  let calls = 0;
  const selected = await pickDeviceContact({
    platform: "ios",
    presentPicker: async () => {
      calls += 1;
      return {
        id: "ios-contact-2",
        firstName: "Ada",
        lastName: "Lovelace",
        phoneNumbers: [{ number: phone }],
        emails: [{ email }],
      };
    },
  });
  assert.equal(calls, 1);
  assert.equal(selected.status, "selected");
  if (selected.status === "selected") {
    assert.equal(JSON.stringify(selected.contact).includes(email), false);
    assert.equal(selected.contact.phoneNumbers[0].number, phone);
    assert.deepEqual(selected.contact, {
      id: "ios-contact-2",
      displayName: "Ada Lovelace",
      phoneNumbers: [{ id: "phone-0", label: null, number: phone }],
      hasEmail: true,
    });
  }
  assert.deepEqual(await pickDeviceContact({
    platform: "ios",
    presentPicker: async () => null,
  }), { status: "cancelled" });
  assert.deepEqual(await pickDeviceContact({
    platform: "ios",
    presentPicker: async () => { throw new Error("native module missing"); },
  }), { status: "unavailable" });
  const result = applyContactPick(
    [{ id: "ada", displayName: "Ada", phoneNumbers: [], hasEmail: false }],
    { status: "unavailable" },
  );
  assert.equal(result.contacts.length, 1);
  assert.match(result.notice, /cannot open the iPhone contact picker/);
  assert.deepEqual(
    applyContactPick([], { status: "cancelled" }),
    { contacts: [], notice: null },
  );
});

test("an invitation uses only the verified referral URL and does not claim delivery", () => {
  const url = "https://bluebird.co/join/BB-EXAMPLE";
  const message = contactInviteMessage(url);
  assert.equal(message.endsWith(url), true);
  assert.equal(message.includes(phone), false);
  assert.equal(message.includes(email), false);
  assert.equal(interpretShareResult("sharedAction"), "completed");
  assert.equal(interpretShareResult("dismissedAction"), "dismissed");
  assert.equal(interpretShareResult(undefined), "unavailable");
});

test("one phone number opens the composer with that number and the verified link", async () => {
  const url = "https://bluebird.co/join/BB-EXAMPLE";
  const contact = {
    id: "ada",
    displayName: "Ada Lovelace",
    phoneNumbers: [{ id: "phone-0", label: "Mobile", number: phone }],
    hasEmail: false,
  };
  const calls = [];
  const outcome = await beginSmsInvitation({
    contact,
    inviteUrl: url,
    chooseNumber: async () => {
      throw new Error("a single number does not need a chooser");
    },
    sendSms: async (phoneNumber, message) => {
      calls.push({ phoneNumber, message });
      return "cancelled";
    },
  });
  assert.deepEqual(outcome, { status: "composer", result: "cancelled" });
  assert.deepEqual(calls, [{
    phoneNumber: phone,
    message: `Hey! I'd love to invite you to Bluebird Jets ✈️ Join using my link: ${url}`,
  }]);
  assert.equal(calls[0].message.includes(phone), false);
  assert.equal(contactSmsInviteMessage(url), calls[0].message);
});

test("several phone numbers wait for an explicit choice", async () => {
  const url = "https://www.bluebirdjets.com/join/BB-EXAMPLE";
  const mobile = "+15555550101";
  const work = "+15555550102";
  const contact = selectedContactFromPicker({
    firstName: "Ada",
    phoneNumbers: [
      { number: mobile, label: "mobile" },
      { digits: work, label: "work" },
      { number: mobile, label: "home" },
      { number: "   ", label: "other" },
    ],
  });
  assert.deepEqual(contact.phoneNumbers, [
    { id: "phone-0", label: "Mobile", number: mobile },
    { id: "phone-1", label: "Work", number: work },
  ]);
  const plan = planSmsInvitation(contact, url);
  assert.equal(plan.status, "choose");
  assert.equal("phoneNumber" in plan, false);
  let sent = 0;
  const cancelled = await beginSmsInvitation({
    contact,
    inviteUrl: url,
    chooseNumber: async () => null,
    sendSms: async () => {
      sent += 1;
      return "sent";
    },
  });
  assert.deepEqual(cancelled, { status: "cancelled" });
  assert.equal(sent, 0);
  const calls = [];
  const chosen = await beginSmsInvitation({
    contact,
    inviteUrl: url,
    chooseNumber: async (numbers) => numbers[1].number,
    sendSms: async (phoneNumber, message) => {
      calls.push({ phoneNumber, message });
      return "sent";
    },
  });
  assert.deepEqual(chosen, { status: "composer", result: "sent" });
  assert.deepEqual(calls, [{ phoneNumber: work, message: contactSmsInviteMessage(url) }]);
  const rejected = await beginSmsInvitation({
    contact,
    inviteUrl: url,
    chooseNumber: async () => "+15555550999",
    sendSms: async () => {
      sent += 1;
      return "sent";
    },
  });
  assert.deepEqual(rejected, { status: "cancelled" });
  assert.equal(sent, 0);
});

test("a contact without a phone number does not open the composer", async () => {
  const contact = { id: "grace", displayName: "Grace Hopper", phoneNumbers: [], hasEmail: true };
  let called = false;
  const outcome = await beginSmsInvitation({
    contact,
    inviteUrl: "https://bluebird.co/join/BB-EXAMPLE",
    chooseNumber: async () => phone,
    sendSms: async () => {
      called = true;
      return "sent";
    },
  });
  assert.deepEqual(outcome, { status: "needs-phone" });
  assert.equal(called, false);
  assert.deepEqual(contactPhoneLines(contact), []);
});

test("a missing referral link disables SMS and the share sheet", async () => {
  const contact = {
    id: "ada",
    displayName: "Ada Lovelace",
    phoneNumbers: [{ id: "phone-0", label: null, number: phone }],
    hasEmail: false,
  };
  for (const inviteUrl of [null, "", "  ", "http://example.test/BB-EXAMPLE"]) {
    let called = false;
    const outcome = await beginSmsInvitation({
      contact,
      inviteUrl,
      chooseNumber: async () => phone,
      sendSms: async () => {
        called = true;
        return "sent";
      },
    });
    assert.deepEqual(outcome, { status: "needs-link" });
    assert.equal(called, false);
    assert.equal(shareInvitationPayload(inviteUrl), null);
  }
});

test("dismissing the composer keeps the contact and does not claim delivery", () => {
  const contacts = [{
    id: "ada",
    displayName: "Ada Lovelace",
    phoneNumbers: [{ id: "phone-0", label: "Mobile", number: phone }],
    hasEmail: false,
  }];
  for (const result of ["cancelled", "sent", "unknown"]) {
    const finished = finishSmsComposer(contacts, result);
    assert.deepEqual(finished.contacts, contacts);
    assert.equal(finished.notice, null);
    assert.equal(finished.claimedDelivery, false);
  }
  const unavailable = finishSmsComposer(contacts, "unavailable");
  assert.deepEqual(unavailable.contacts, contacts);
  assert.match(unavailable.notice, /share the invitation another way/);
  assert.equal(unavailable.claimedDelivery, false);
  assert.doesNotMatch(unavailable.notice, /delivered/i);
});

test("Share Another Way uses the verified link and does not address a contact", () => {
  const url = "https://bluebird.co/join/BB-EXAMPLE";
  const payload = shareInvitationPayload(url);
  assert.deepEqual(payload, { message: contactInviteMessage(url), url });
  assert.equal(payload.message.includes(phone), false);
  assert.notEqual(payload.message, contactSmsInviteMessage(url));
  assert.deepEqual(finishShareSheet("sharedAction"), { notice: null, claimedDelivery: false });
  assert.deepEqual(finishShareSheet("dismissedAction"), { notice: null, claimedDelivery: false });
  assert.equal(finishShareSheet(undefined).claimedDelivery, false);
  assert.match(finishShareSheet(undefined).notice, /could not be opened/);
});

test("Connect Contacts keeps the legacy family screen and does not upload contacts", () => {
  const screen = readFileSync(resolve(root, "app/account/contacts.tsx"), "utf8");
  const library = readFileSync(resolve(root, "lib/connectContacts.ts"), "utf8");
  const profile = readFileSync(resolve(root, "app/(tabs)/profile/index.tsx"), "utf8");
  assert.match(profile, /label: 'Connect Contacts',\s*hint: 'Invite friends'/);
  assert.match(profile, /router\.push\('\/account\/contacts'/);
  for (const required of [
    "pickDeviceContact",
    "Share.share",
    "useReferralProgram",
    "FamilyMembershipScreen",
    "beginSmsInvitation",
    "Share Another Way",
    "ActionSheetIOS",
    "expo-sms",
    "sendSMSAsync",
    "isAvailableAsync",
  ]) {
    assert.match(screen, new RegExp(required.replace(".", "\\.")));
  }
  assert.match(screen, /Selected contacts stay on this iPhone and are not uploaded/);
  assert.match(screen, /expo-contacts\/legacy/);
  assert.match(screen, /presentContactPickerAsync/);
  assert.match(screen, /SMS invitations need a phone number/);
  assert.doesNotMatch(screen, /from 'expo-contacts'|getContactsAsync|requestPermissionsAsync|fetch\(|XMLHttpRequest|sms:|mailto:|updateProfile|\/\(tabs\)\/discover|console\.(log|info|debug|warn)/);
  const guard = readFileSync(resolve(root, "lib/clerkAuthSession.ts"), "utf8");
  assert.match(guard, /route === 'contacts' && segments\.length === 2/);
  assert.doesNotMatch(library, /fetch\(|XMLHttpRequest|expo-contacts|console\.(log|info|debug|warn)/);
});
