import { pool } from "@workspace/db";
import jwt from "jsonwebtoken";

const BASE = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  owner: `manifest-owner-${suffix}`,
  other: `manifest-other-${suffix}`,
  domestic: `manifest-domestic-${suffix}`,
  petFlight: `manifest-pet-${suffix}`,
  maxHumanFlight: `manifest-max-human-${suffix}`,
  maxPetFlight: `manifest-max-pet-${suffix}`,
  overCapacityFlight: `manifest-over-capacity-${suffix}`,
  waiting: `manifest-waiting-${suffix}`,
  trip: `manifest-trip-${suffix}`,
  petTrip: `manifest-pet-trip-${suffix}`,
  maxHumanTrip: `manifest-max-human-trip-${suffix}`,
  maxPetTrip: `manifest-max-pet-trip-${suffix}`,
  overCapacityTrip: `manifest-over-capacity-trip-${suffix}`,
};
const token = (userId) => jwt.sign(
  { userId },
  process.env.JWT_SECRET || process.env.SESSION_SECRET || "bluebird-dev-only-secret",
  { expiresIn: "1h" },
);
let failures = 0;
const check = (name, condition, detail = "") => condition
  ? console.log(`  ✓ ${name}`)
  : (failures++, console.error(`  ✗ ${name} ${detail}`));

async function api(method, path, auth, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${auth}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

async function main() {
  try {
    await pool.query(`INSERT INTO users (id,name,phone,email,membership_tier,referral_code) VALUES
      ($1,'Manifest Owner',$2,$3,'plus','MOWNER'),($4,'Other Member',$5,$6,'plus','MOTHER')`,
      [ids.owner, `+1888${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`, `${ids.owner}@test.invalid`,
       ids.other, `+1877${Math.floor(Math.random() * 1e7).toString().padStart(7, "0")}`, `${ids.other}@test.invalid`]);
    await pool.query(`INSERT INTO flights
      (id,from_airport,from_city,to_airport,to_city,aircraft_type,aircraft_capacity,departure_date,departure_time,duration,seats_available,international,status)
       VALUES ($1,'DAL','Dallas','AUS','Austin','Citation',6,'2099-06-01','09:00','1h',6,false,'available'),
             ($2,'JFK','New York','NAS','Nassau','Citation',6,'2099-06-02','09:00','3h',6,true,'available'),
             ($3,'LAX','Los Angeles','SFO','San Francisco','Citation',6,'2099-06-03','09:00','1h','6',false,'available'),
              ($4,'LAX','Los Angeles','SEA','Seattle','Citation',6,'2099-06-04','09:00','3h',6,true,'available'),
              ($5,'DAL','Dallas','HOU','Houston','Citation',6,'2099-06-05','09:00','1h',1,false,'available')`,
       [ids.domestic, ids.petFlight, ids.maxHumanFlight, ids.maxPetFlight, ids.overCapacityFlight]);
    await pool.query(`INSERT INTO queue_entries
      (id,user_id,flight_id,position,status,passengers,bringing_pet,pet_fee_acknowledged)
      VALUES ($1,$2,$3,1,'confirmed',2,false,false),
             ($4,$2,$5,1,'confirmed',1,true,true),
              ($6,$2,$3,2,'waiting',1,false,false),
              ($7,$2,$8,1,'confirmed',6,false,false),
               ($9,$2,$10,1,'confirmed',5,true,true),
               ($11,$2,$12,1,'confirmed',2,false,false)`,
       [`qe-dom-${suffix}`, ids.owner, ids.domestic, `qe-pet-${suffix}`, ids.petFlight, ids.waiting,
         `qe-max-human-${suffix}`, ids.maxHumanFlight, `qe-max-pet-${suffix}`, ids.maxPetFlight,
         `qe-over-capacity-${suffix}`, ids.overCapacityFlight]);
    await pool.query(`INSERT INTO trips (id,user_id,flight_id,status,cleaning_fee_usd) VALUES
      ($1,$2,$3,'upcoming',0),($4,$2,$5,'upcoming',500),
      ($6,$2,$7,'upcoming',0),($8,$2,$9,'upcoming',500),
      ($10,$2,$11,'upcoming',0)`,
      [ids.trip, ids.owner, ids.domestic, ids.petTrip, ids.petFlight,
       ids.maxHumanTrip, ids.maxHumanFlight, ids.maxPetTrip, ids.maxPetFlight,
       ids.overCapacityTrip, ids.overCapacityFlight]);

    const ownerToken = token(ids.owner);
    const otherToken = token(ids.other);
    const initiallyEmpty = await api("GET", "/passengers", ownerToken);
    check("saved passenger library starts empty", initiallyEmpty.status === 200 && initiallyEmpty.json.length === 0);
    const invalidSaved = await api("POST", "/passengers", ownerToken, {
      firstName: "Saved", lastName: "Traveler", weightKg: 0,
    });
    check("saved passenger weight is validated", invalidSaved.status === 400);
    const createdSaved = await api("POST", "/passengers", ownerToken, {
      firstName: "  Saved ", lastName: " Traveler ", phone: "(555) 010-0200",
      email: "SAVED@example.com", weightKg: 72,
    });
    check("member can create a saved passenger",
      createdSaved.status === 201 && createdSaved.json.firstName === "Saved" &&
      createdSaved.json.email === "saved@example.com");
    const duplicateSaved = await api("POST", "/passengers", ownerToken, {
      firstName: "saved", lastName: "traveler", phone: "+1 555 010 0200", weightKg: 74,
    });
    const ownerSavedList = await api("GET", "/passengers", ownerToken);
    check("same saved identity updates instead of duplicating",
      duplicateSaved.status === 200 && ownerSavedList.json.length === 1 && ownerSavedList.json[0].weightKg === 74);
    check("another member cannot see saved passenger records",
      (await api("GET", "/passengers", otherToken)).json.length === 0);
    check("another member cannot mutate a saved passenger",
      (await api("PUT", `/passengers/${createdSaved.json.id}`, otherToken, {
        firstName: "Hijack", lastName: "Attempt", weightKg: 80,
      })).status === 404);
    const editedSaved = await api("PUT", `/passengers/${createdSaved.json.id}`, ownerToken, {
      firstName: "Edited", lastName: "Traveler", phone: null, email: null, weightKg: 75,
    });
    check("member can edit a saved passenger", editedSaved.status === 200 && editedSaved.json.firstName === "Edited");
    check("another member cannot delete a saved passenger",
      (await api("DELETE", `/passengers/${createdSaved.json.id}`, otherToken)).status === 404);
    const deletedSaved = await api("DELETE", `/passengers/${createdSaved.json.id}`, ownerToken);
    check("member can delete a saved passenger", deletedSaved.status === 200 &&
      (await api("GET", "/passengers", ownerToken)).json.length === 0);

    const get = await api("GET", `/trips/${ids.trip}/manifest`, ownerToken);
    check(
      "confirmed owner starts with a primary traveler and reserved-seat limit",
      get.status === 200 && get.json.requiredCount === 2 && get.json.passengers.length === 1,
      JSON.stringify(get.json),
    );
    check("another member cannot access the manifest", (await api("GET", `/trips/${ids.trip}/manifest`, otherToken)).status === 404);
    check("another member cannot save the manifest", (await api("PUT", `/trips/${ids.trip}/manifest`, otherToken, {
      passengers: [{ passengerOrder: 1, firstName: "Other", lastName: "Member", dateOfBirth: "1980-01-01", weightKg: 70 }],
    })).status === 404);
    check("another member cannot submit the manifest", (await api("POST", `/trips/${ids.trip}/manifest/submit`, otherToken)).status === 404);

    const tooMany = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1, firstName: "One", lastName: "Traveler", dateOfBirth: "1980-01-01", weightKg: 70 },
        { passengerOrder: 2, firstName: "Two", lastName: "Traveler", dateOfBirth: "1981-01-01", weightKg: 71 },
        { passengerOrder: 3, firstName: "Three", lastName: "Traveler", dateOfBirth: "1982-01-01", weightKg: 72 },
      ],
    });
    check("roster cannot exceed reserved seats", tooMany.status === 400, JSON.stringify(tooMany.json));

    const overFlightCapacity = await api("PUT", `/trips/${ids.overCapacityTrip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1, firstName: "One", lastName: "Traveler", dateOfBirth: "1980-01-01", weightKg: 70 },
        { passengerOrder: 2, firstName: "Two", lastName: "Traveler", dateOfBirth: "1981-01-01", weightKg: 71 },
      ],
    });
    check("manifest validates baseline flight capacity after confirmation",
      overFlightCapacity.status === 400 && /capacity/i.test(overFlightCapacity.json?.error ?? ""),
      JSON.stringify(overFlightCapacity.json));

    const invalidCalendar = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1980-02-30", weightKg: 70 },
        { passengerOrder: 2, firstName: "Grace", lastName: "Hopper", dateOfBirth: "1975-12-09", weightKg: 65 },
      ],
    });
    check("nonexistent birth date remains incomplete", invalidCalendar.status === 200 && invalidCalendar.json.isComplete === false);
    const futureBirth = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "2098-01-01", weightKg: 70 },
        { passengerOrder: 2, firstName: "Grace", lastName: "Hopper", dateOfBirth: "1975-12-09", weightKg: 65 },
      ],
    });
    check("future birth date remains incomplete", futureBirth.status === 200 && futureBirth.json.isComplete === false);
    check("invalid birth date cannot submit", (await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken)).status === 400);

    const missingWeight = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1980-12-10" },
        { passengerOrder: 2, firstName: "Grace", lastName: "Hopper", dateOfBirth: "1975-12-09", weightKg: 65 },
      ],
    });
    check("missing passenger weight remains incomplete",
      missingWeight.status === 200 && missingWeight.json.completedCount === 1 && !missingWeight.json.isComplete);
    const invalidWeight = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1, firstName: "Ada", lastName: "Lovelace", dateOfBirth: "1980-12-10", weightKg: 0 },
        { passengerOrder: 2, firstName: "Grace", lastName: "Hopper", dateOfBirth: "1975-12-09", weightKg: 501 },
      ],
    });
    check("out-of-range passenger weights are rejected", invalidWeight.status === 400);

    const domestic = [
      {
        passengerOrder: 1,
        firstName: "Ada",
        lastName: "Lovelace",
        phone: "+1 555 111 2222",
        email: "ada@example.com",
        dateOfBirth: "1980-12-10",
        weightKg: 70,
        passportNumber: "MUST-NOT-PERSIST",
        nationality: "MUST-NOT-PERSIST",
      },
      { passengerOrder: 2, firstName: "Grace", lastName: "Hopper", dateOfBirth: "1975-12-09", weightKg: 65 },
    ];
    const saved = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, { passengers: domestic });
    check("complete traveler roster persists", saved.status === 200 && saved.json.completedCount === 2 && saved.json.isComplete);
    const restored = await api("GET", `/trips/${ids.trip}/manifest`, ownerToken);
    check("saved names, birth dates, and weights are restored",
      restored.json.passengers[1].lastName === "Hopper" &&
      restored.json.passengers[0].dateOfBirth === "1980-12-10" &&
      restored.json.passengers[0].weightKg === 70 &&
      restored.json.passengers[0].phone === "+1 555 111 2222" &&
      restored.json.passengers[0].email === "ada@example.com");
    check("passport attributes are excluded from manifest responses", !/passport|nationality|issuingCountry/i.test(JSON.stringify(restored.json)), JSON.stringify(restored.json));

    const submit1 = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    const submit2 = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    check("unchanged submission is idempotent", submit1.json.version === 1 && submit2.json.version === 1);
    const updates = (await pool.query(
      `SELECT body FROM manifest_operational_updates WHERE trip_id=$1 ORDER BY version`,
      [ids.trip],
    )).rows;
    check("only one operational update is recorded", updates.length === 1);
    check("operations output includes names, birth dates, weights, and contact details",
      /Ada Lovelace; Date of birth 1980-12-10; Weight 70 kg; Phone \+1 555 111 2222; Email ada@example.com/.test(updates[0].body));
    check("operations output excludes passport attributes", !/passport|nationality|issuing country|MUST-NOT-PERSIST/i.test(updates[0].body), updates[0].body);

    const weightEdit = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [{ ...domestic[0], weightKg: 71 }, domestic[1]],
    });
    check("weight-only edits make a submitted manifest eligible for resubmission",
      weightEdit.status === 200 && weightEdit.json.version === 1 && !weightEdit.json.submittedAt);
    const weightResubmitted = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    check("weight-only edit creates the next submission version",
      weightResubmitted.json.version === 2 && weightResubmitted.json.operationsNotified === true);

    const shortened = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [domestic[0]],
    });
    check("an editable roster may remove an additional traveler without becoming complete",
      shortened.status === 200 && shortened.json.passengers.length === 1 && !shortened.json.isComplete);
    check("changed incomplete manifest becomes unsubmitted", !shortened.json.submittedAt && shortened.json.version === 2);
    check("a shortened roster cannot be submitted", (await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken)).status === 400);
    const revised = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [domestic[0], { ...domestic[1], firstName: "Amazing" }],
    });
    const resubmitted = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    check("updated roster creates the next submission version", resubmitted.json.version === 3 && resubmitted.json.operationsNotified === true);

    const petIncomplete = await api("PUT", `/trips/${ids.petTrip}/manifest`, ownerToken, {
      passengers: [{ passengerOrder: 1, firstName: "Amelia", lastName: "Earhart", dateOfBirth: "1977-07-24", weightKg: 55 }],
      pet: { weightLb: 42, crateLengthIn: 36 },
    });
    check("partial pet details persist but remain incomplete", petIncomplete.status === 200 && !petIncomplete.json.isComplete && petIncomplete.json.pet.weightLb === 42);
    const petRestored = await api("GET", `/trips/${ids.petTrip}/manifest`, ownerToken);
    check("pet summary availability is tied to the booking", petRestored.json.bringingPet === true && petRestored.json.pet.crateLengthIn === 36);
    const petComplete = await api("PUT", `/trips/${ids.petTrip}/manifest`, ownerToken, {
      passengers: [{ passengerOrder: 1, firstName: "Amelia", lastName: "Earhart", dateOfBirth: "1977-07-24", weightKg: 55 }],
      pet: { weightLb: 42, crateLengthIn: 36, crateWidthIn: 24, crateHeightIn: 26 },
    });
    check("valid pet weight and crate dimensions complete the manifest", petComplete.status === 200 && petComplete.json.isComplete);
    await api("POST", `/trips/${ids.petTrip}/manifest/submit`, ownerToken);
    const [{ body: petOutput }] = (await pool.query(
      `SELECT body FROM manifest_operational_updates WHERE trip_id=$1`,
      [ids.petTrip],
    )).rows;
    check("operations output includes the pet summary", /Pet: 42 lb; Crate 36 × 24 × 26 in/.test(petOutput), petOutput);

    const sixHumans = Array.from({ length: 6 }, (_, index) => ({
      passengerOrder: index + 1,
      firstName: `Human${index + 1}`,
      lastName: "Limit",
      dateOfBirth: `198${index}-01-01`,
      weightKg: 60 + index,
    }));
    const maxHuman = await api("PUT", `/trips/${ids.maxHumanTrip}/manifest`, ownerToken, {
      passengers: sixHumans,
    });
    check("six human passengers are allowed without a pet",
      maxHuman.status === 200 && maxHuman.json.passengers.length === 6 && maxHuman.json.isComplete,
      JSON.stringify(maxHuman.json));
    const maxHumanRestored = await api("GET", `/trips/${ids.maxHumanTrip}/manifest`, ownerToken);
    check("six-human roster persists all passenger names",
      maxHumanRestored.json.passengers[5]?.firstName === "Human6",
      JSON.stringify(maxHumanRestored.json));

    const fiveHumans = sixHumans.slice(0, 5);
    const maxPet = await api("PUT", `/trips/${ids.maxPetTrip}/manifest`, ownerToken, {
      passengers: fiveHumans,
      pet: { weightLb: 42, crateLengthIn: 36, crateWidthIn: 24, crateHeightIn: 26 },
    });
    check("five human passengers plus a pet are allowed",
      maxPet.status === 200 && maxPet.json.passengers.length === 5 && maxPet.json.isComplete,
      JSON.stringify(maxPet.json));

    const sixWithPet = await api("PUT", `/trips/${ids.maxPetTrip}/manifest`, ownerToken, {
      passengers: sixHumans,
      pet: { weightLb: 42, crateLengthIn: 36, crateWidthIn: 24, crateHeightIn: 26 },
    });
    check("six human passengers plus a pet are rejected",
      sixWithPet.status === 400 && /6 occupants|5 passengers/i.test(sixWithPet.json?.error ?? ""),
      JSON.stringify(sixWithPet.json));

    const sevenHumans = [...sixHumans, {
      passengerOrder: 7,
      firstName: "Human7",
      lastName: "Limit",
      dateOfBirth: "1987-01-01",
      weightKg: 67,
    }];
    const sevenPassengerManifest = await api("PUT", `/trips/${ids.maxHumanTrip}/manifest`, ownerToken, {
      passengers: sevenHumans,
    });
    check("a seventh passenger is rejected",
      sevenPassengerManifest.status === 400 && /6 occupants/i.test(sevenPassengerManifest.json?.error ?? ""),
      JSON.stringify(sevenPassengerManifest.json));
  } finally {
    await pool.query(`DELETE FROM manifest_operational_updates WHERE trip_id IN ($1,$2,$3,$4,$5)`, [ids.trip, ids.petTrip, ids.maxHumanTrip, ids.maxPetTrip, ids.overCapacityTrip]).catch(() => {});
    await pool.query(`DELETE FROM trip_passengers WHERE trip_id IN ($1,$2,$3,$4,$5)`, [ids.trip, ids.petTrip, ids.maxHumanTrip, ids.maxPetTrip, ids.overCapacityTrip]).catch(() => {});
    await pool.query(`DELETE FROM saved_passengers WHERE user_id IN ($1,$2)`, [ids.owner, ids.other]).catch(() => {});
    await pool.query(`DELETE FROM trips WHERE id IN ($1,$2,$3,$4,$5)`, [ids.trip, ids.petTrip, ids.maxHumanTrip, ids.maxPetTrip, ids.overCapacityTrip]).catch(() => {});
    await pool.query(`DELETE FROM queue_entries WHERE id LIKE $1`, [`%${suffix}`]).catch(() => {});
    await pool.query(`DELETE FROM flights WHERE id IN ($1,$2,$3,$4,$5)`, [ids.domestic, ids.petFlight, ids.maxHumanFlight, ids.maxPetFlight, ids.overCapacityFlight]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.owner, ids.other]).catch(() => {});
    await pool.end();
  }
  if (failures) process.exit(1);
  console.log("\nAll manifest-flow checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});