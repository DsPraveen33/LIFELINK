import {
  CalculateRoutesResponse,
  GetEmergencyDecisionResponse,
  GetEmergencyResponse,
  ListDashboardEventsResponse,
  ListHospitalsResponse,
  RunSimulationActionBody,
  RunSimulationActionResponse,
} from "@workspace/api-zod";

type EmergencyResult = ReturnType<typeof GetEmergencyResponse.parse>;
type HospitalResult = ReturnType<typeof ListHospitalsResponse.parse>[number];
type DecisionResult = ReturnType<typeof GetEmergencyDecisionResponse.parse>;
type EventResult = ReturnType<typeof ListDashboardEventsResponse.parse>[number];

export type Emergency = Omit<EmergencyResult, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};
export type Hospital = Omit<HospitalResult, "updatedAt"> & { updatedAt: string };
export type RouteOption = ReturnType<typeof CalculateRoutesResponse.parse>[number];
export type Decision = Omit<DecisionResult, "updatedAt"> & { updatedAt: string };
export type LifelinkEvent = Omit<EventResult, "createdAt"> & { createdAt: string };
export type SimulationActionInput = ReturnType<typeof RunSimulationActionBody.parse>;
export type SimulationResult = Omit<
  ReturnType<typeof RunSimulationActionResponse.parse>,
  "events"
> & { events: LifelinkEvent[] };

export type EmergencyInput = {
  patientName: string;
  emergencyType: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  latitude: number;
  longitude: number;
  locationLabel: string;
  requiredCapabilities: string[];
};
