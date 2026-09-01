import { pool } from "@workspace/db";
import jwt from "jsonwebtoken";

const BASE = process.env.API_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}/api`;
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  owner: `manifest-owner-${suffix}`,
  other: `manifest-other-${suffix}`,
  domestic: `manifest-domestic-${suffix}`,
  international: `manifest-international-${suffix}`,
  waiting: `manifest-waiting-${suffix}`,
  trip: `manifest-trip-${suffix}`,
  intlTrip: `manifest-intl-trip-${suffix}`,
};
const token = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET || "bluebird-dev-only-secret", { expiresIn: "1h" });
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
      [ids.owner, `+1888${Math.floor(Math.random()*1e7).toString().padStart(7,"0")}`, `${ids.owner}@test.invalid`,
       ids.other, `+1877${Math.floor(Math.random()*1e7).toString().padStart(7,"0")}`, `${ids.other}@test.invalid`]);
    await pool.query(`INSERT INTO flights
      (id,from_airport,from_city,to_airport,to_city,aircraft_type,aircraft_capacity,departure_date,departure_time,duration,seats_available,international,status)
      VALUES ($1,'DAL','Dallas','AUS','Austin','Citation',6,'2099-06-01','09:00','1h',6,false,'available'),
             ($2,'JFK','New York','NAS','Nassau','Citation',6,'2099-06-02','09:00','3h',6,true,'available')`,
      [ids.domestic, ids.international]);
    await pool.query(`INSERT INTO queue_entries (id,user_id,flight_id,position,status,passengers)
      VALUES ($1,$2,$3,1,'confirmed',2),($4,$2,$5,1,'confirmed',1),($6,$2,$3,2,'waiting',1)`,
      [`qe-dom-${suffix}`, ids.owner, ids.domestic, `qe-intl-${suffix}`, ids.international, ids.waiting]);
    await pool.query(`INSERT INTO trips (id,user_id,flight_id,status) VALUES
      ($1,$2,$3,'upcoming'),($4,$2,$5,'upcoming')`,
      [ids.trip, ids.owner, ids.domestic, ids.intlTrip, ids.international]);

    const ownerToken = token(ids.owner);
    const otherToken = token(ids.other);
    const get = await api("GET", `/trips/${ids.trip}/manifest`, ownerToken);
    check("confirmed owner receives booked passenger slots", get.status === 200 && get.json.requiredCount === 2 && get.json.passengers.length === 2, JSON.stringify(get.json));
    check("another member cannot access the manifest", (await api("GET", `/trips/${ids.trip}/manifest`, otherToken)).status === 404);
    const wrongCount = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, { passengers: [get.json.passengers[0]] });
    check("booked count is enforced", wrongCount.status === 400, JSON.stringify(wrongCount.json));
    const fractionalOrder = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, {
      passengers: [
        { passengerOrder: 1.5, firstName: "Bad", lastName: "Slot", weightKg: 60 },
        { passengerOrder: 2, firstName: "Good", lastName: "Slot", weightKg: 60 },
      ],
    });
    check("fractional passenger slots are rejected", fractionalOrder.status === 400, JSON.stringify(fractionalOrder.json));

    const domestic = [
      { passengerOrder: 1, firstName: "Ada", lastName: "Lovelace", weightKg: 61 },
      { passengerOrder: 2, firstName: "Grace", lastName: "Hopper", weightKg: 64 },
    ];
    const saved = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, { passengers: domestic });
    check("complete domestic manifest persists", saved.status === 200 && saved.json.completedCount === 2);
    const submit1 = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    const submit2 = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    check("unchanged submission is idempotent", submit1.json.version === 1 && submit2.json.version === 1);
    const [{ count: firstUpdates }] = (await pool.query(`SELECT count(*)::int count FROM manifest_operational_updates WHERE trip_id=$1`, [ids.trip])).rows;
    check("only one operational update is recorded", firstUpdates === 1);

    domestic[1].weightKg = 65;
    const changed = await api("PUT", `/trips/${ids.trip}/manifest`, ownerToken, { passengers: domestic });
    check("changed manifest becomes ready for resubmission", changed.status === 200 && !changed.json.submittedAt && changed.json.version === 1);
    const resubmitted = await api("POST", `/trips/${ids.trip}/manifest/submit`, ownerToken);
    check("updated manifest creates next version", resubmitted.json.version === 2 && resubmitted.json.operationsNotified === true);

    const intlIncomplete = await api("PUT", `/trips/${ids.intlTrip}/manifest`, ownerToken, {
      passengers: [{ passengerOrder: 1, firstName: "Amelia", lastName: "Earhart", weightKg: 58 }],
    });
    check("international traveler without passport stays incomplete", intlIncomplete.status === 200 && intlIncomplete.json.isComplete === false);
    check("incomplete international manifest cannot submit", (await api("POST", `/trips/${ids.intlTrip}/manifest/submit`, ownerToken)).status === 400);
    const invalidCalendar = await api("PUT", `/trips/${ids.intlTrip}/manifest`, ownerToken, {
      passengers: [{ passengerOrder: 1, firstName: "Amelia", lastName: "Earhart", weightKg: 58,
        passportNumber: "P12345", issuingCountry: "United States", nationality: "American", passportExpirationDate: "2098-02-30" }],
    });
    check("nonexistent passport expiration date stays incomplete", invalidCalendar.json.isComplete === false);
    const invalidStatus = await api("GET", `/flights/${ids.international}/my-status`, ownerToken);
    check("flight detail progress also rejects nonexistent expiration dates",
      invalidStatus.json?.manifest?.isComplete === false, JSON.stringify(invalidStatus.json));
    const intlComplete = await api("PUT", `/trips/${ids.intlTrip}/manifest`, ownerToken, {
      passengers: [{ passengerOrder: 1, firstName: "Amelia", lastName: "Earhart", weightKg: 58,
        passportNumber: "P12345", issuingCountry: "United States", nationality: "American", passportExpirationDate: "2098-01-01" }],
    });
    check("international passport fields satisfy validation", intlComplete.json.isComplete === true);
  } finally {
    await pool.query(`DELETE FROM manifest_operational_updates WHERE trip_id IN ($1,$2)`, [ids.trip, ids.intlTrip]).catch(() => {});
    await pool.query(`DELETE FROM trip_passengers WHERE trip_id IN ($1,$2)`, [ids.trip, ids.intlTrip]).catch(() => {});
    await pool.query(`DELETE FROM trips WHERE id IN ($1,$2)`, [ids.trip, ids.intlTrip]).catch(() => {});
    await pool.query(`DELETE FROM queue_entries WHERE id LIKE $1`, [`%${suffix}`]).catch(() => {});
    await pool.query(`DELETE FROM flights WHERE id IN ($1,$2)`, [ids.domestic, ids.international]).catch(() => {});
    await pool.query(`DELETE FROM users WHERE id IN ($1,$2)`, [ids.owner, ids.other]).catch(() => {});
    await pool.end();
  }
  if (failures) process.exit(1);
  console.log("\nAll manifest-flow checks passed.");
}
main().catch((error) => { console.error(error); process.exit(1); });