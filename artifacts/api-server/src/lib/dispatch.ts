import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  ambulancesTable,
  emergenciesTable,
  hospitalsTable,
  type EmergencyRecord,
} from "@workspace/db";
import type { EmergencyInput } from "./api-types";
import { distanceKm, recalculateDecision } from "./decision-engine";
import { recordEvent } from "./domain-events";

export async function createEmergencyAndDispatch(
  input: EmergencyInput,
  patientUserId: number | null,
  preferredCallSign?: string,
): Promise<EmergencyRecord> {
  const available = await db
    .select()
    .from(ambulancesTable)
    .where(and(eq(ambulancesTable.status, "AVAILABLE"), isNull(ambulancesTable.currentEmergencyId)));
  const preferred = preferredCallSign
    ? available.find((ambulance) => ambulance.callSign === preferredCallSign)
    : undefined;
  const selectedAmbulance =
    preferred ??
    available
      .map((ambulance) => {
        const compatible = input.requiredCapabilities.every((capability) =>
          ambulance.equipment.includes(capability),
        );
        return {
          ambulance,
          score:
            distanceKm(ambulance, { latitude: input.latitude, longitude: input.longitude }) +
            (compatible ? 0 : 1000),
        };
      })
      .sort((left, right) => left.score - right.score)[0]?.ambulance;
  const hospitals = await db.select().from(hospitalsTable);
  const availableHospitals = hospitals.filter(
    (hospital) => hospital.readinessStatus !== "FULL" && hospital.emergencyStatus !== "DIVERTING",
  );
  const nearestHospital = availableHospitals.sort(
    (a, b) =>
      distanceKm(input, a) - distanceKm(input, b),
  )[0];

  const [emergency] = await db
    .insert(emergenciesTable)
    .values({
      patientUserId,
      patientName: input.patientName,
      emergencyType: input.emergencyType,
      severity: input.severity,
      status: selectedAmbulance ? "DISPATCHED" : "NEW",
      latitude: input.latitude,
      longitude: input.longitude,
      locationLabel: input.locationLabel,
      requiredCapabilities: input.requiredCapabilities,
      assignedAmbulanceId: selectedAmbulance?.id ?? null,
      selectedHospitalId: nearestHospital?.id ?? null,
      etaMinutes: null,
    })
    .returning();
  if (!emergency) throw new Error("Emergency could not be created.");

  if (selectedAmbulance) {
    await db
      .update(ambulancesTable)
      .set({
        currentEmergencyId: emergency.id,
        destinationHospitalId: nearestHospital?.id ?? null,
        etaMinutes: null,
        lastUpdated: new Date(),
      })
      .where(eq(ambulancesTable.id, selectedAmbulance.id));
  }
  await recordEvent("SOS_RECEIVED", `${input.severity} ${input.emergencyType} SOS received.`, emergency.id);
  if (selectedAmbulance) {
    await recordEvent(
      "AMBULANCE_ASSIGNED",
      `${selectedAmbulance.callSign} assigned. Driver acceptance is pending.`,
      emergency.id,
    );
  } else {
    await recordEvent(
      "DISPATCH_WARNING",
      "No compatible ambulance is currently free; the command center has been alerted.",
      emergency.id,
    );
  }

  if (selectedAmbulance) {
    await recalculateDecision(emergency.id, { emitEvent: true });
  }
  const [updated] = await db
    .select()
    .from(emergenciesTable)
    .where(eq(emergenciesTable.id, emergency.id))
    .limit(1);
  return updated ?? emergency;
}
