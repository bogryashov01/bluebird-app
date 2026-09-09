import {
  prefillPrimaryPassenger,
  splitDisplayName,
} from "./.passenger-name-prefill.test.mjs";

let failures = 0;
const check = (name, condition, detail = "") => condition
  ? console.log(`  ✓ ${name}`)
  : (failures++, console.error(`  ✗ ${name} ${detail}`));

const emptyManifest = [
  { passengerOrder: 1, firstName: "", lastName: "", dateOfBirth: "" },
  { passengerOrder: 2, firstName: "", lastName: "", dateOfBirth: "" },
];

const fullName = splitDisplayName("  Ava Marie Sterling  ");
check(
  "full account names split into first name and remaining last name",
  fullName.firstName === "Ava" && fullName.lastName === "Marie Sterling",
  JSON.stringify(fullName),
);

const singleName = splitDisplayName("Cher");
check(
  "single-word account names do not invent a last name",
  singleName.firstName === "Cher" && singleName.lastName === "",
  JSON.stringify(singleName),
);

const blankName = splitDisplayName("  ");
check(
  "empty account names leave both passenger fields empty",
  blankName.firstName === "" && blankName.lastName === "",
  JSON.stringify(blankName),
);

const ownerDraft = prefillPrimaryPassenger(emptyManifest, "Ava Sterling");
check(
  "a new manifest prefills only Traveler 1",
  ownerDraft[0].firstName === "Ava" &&
    ownerDraft[0].lastName === "Sterling" &&
    ownerDraft[1].firstName === "" &&
    ownerDraft[1].lastName === "",
  JSON.stringify(ownerDraft),
);

const editedDraft = prefillPrimaryPassenger([
  { ...emptyManifest[0], firstName: "Custom", lastName: "" },
  emptyManifest[1],
], "Ava Sterling");
check(
  "a member edit is never overwritten",
  editedDraft[0].firstName === "Custom" && editedDraft[0].lastName === "",
  JSON.stringify(editedDraft),
);

const savedDraft = prefillPrimaryPassenger([
  { ...emptyManifest[0], firstName: "Saved", lastName: "Traveler", dateOfBirth: "1980-01-01" },
], "Ava Sterling");
check(
  "saved passenger details remain unchanged",
  savedDraft[0].firstName === "Saved" &&
    savedDraft[0].lastName === "Traveler" &&
    savedDraft[0].dateOfBirth === "1980-01-01",
  JSON.stringify(savedDraft),
);

const otherMemberDraft = prefillPrimaryPassenger(emptyManifest, "Marcus Chen");
check(
  "a different account receives its own name",
  otherMemberDraft[0].firstName === "Marcus" && otherMemberDraft[0].lastName === "Chen" &&
    ownerDraft[0].firstName === "Ava" && ownerDraft[0].lastName === "Sterling",
  JSON.stringify({ ownerDraft, otherMemberDraft }),
);

if (failures) process.exit(1);
console.log("\nAll passenger-name prefill checks passed.");