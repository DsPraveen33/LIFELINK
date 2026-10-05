export const DEMO_LOCATION_CITY = "Tirupati";

export interface DemoConfig {
  city: string;
  centerLatitude: number;
  centerLongitude: number;
  zoom: number;
  demoHospitals: Array<{
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    readinessStatus: "READY" | "FULL" | "BUSY";
    emergencyStatus: "ACCEPTING" | "DIVERTING" | "LIMITED";
    traumaBeds: number;
    icuBeds: number;
    ventilators: number;
    capabilities: string[];
    waitMinutes: number;
  }>;
  demoAmbulances: Array<{
    callSign: string;
    vehicleNumber: string;
    driverName: string;
    latitude: number;
    longitude: number;
    equipment: string[];
  }>;
  demoEmergencies: Array<{
    patientName: string;
    emergencyType: string;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    latitude: number;
    longitude: number;
    locationLabel: string;
    requiredCapabilities: string[];
  }>;
  demoRoadIncidents: Array<{
    title: string;
    severity: "CRITICAL" | "MAJOR" | "MODERATE";
    latitude: number;
    longitude: number;
    description: string;
    delayMinutes: number;
  }>;
}

export const simulationConfig: DemoConfig = {
  city: DEMO_LOCATION_CITY,
  centerLatitude: 13.6288,
  centerLongitude: 79.4192,
  zoom: 14,
  demoHospitals: [
    {
      name: "SVIMS Super Specialty Hospital",
      address: "Alipiri Road, Tirupati",
      latitude: 13.6373,
      longitude: 79.4042,
      readinessStatus: "READY",
      emergencyStatus: "ACCEPTING",
      traumaBeds: 8,
      icuBeds: 6,
      ventilators: 5,
      capabilities: ["TRAUMA", "ICU", "CARDIAC", "NEURO", "STROKE"],
      waitMinutes: 6,
    },
    {
      name: "SVRR Government General Hospital (Ruia)",
      address: "Alipiri Bypass Road, Bhavani Nagar, Tirupati",
      latitude: 13.6338,
      longitude: 79.4087,
      readinessStatus: "READY",
      emergencyStatus: "ACCEPTING",
      traumaBeds: 10,
      icuBeds: 8,
      ventilators: 6,
      capabilities: ["TRAUMA", "ICU", "BURN", "PEDIATRIC", "SURGERY"],
      waitMinutes: 8,
    },
    {
      name: "BIRRD Orthopedic Hospital",
      address: "Alipiri Road, Tirupati",
      latitude: 13.638,
      longitude: 79.4015,
      readinessStatus: "READY",
      emergencyStatus: "ACCEPTING",
      traumaBeds: 5,
      icuBeds: 4,
      ventilators: 3,
      capabilities: ["TRAUMA", "ORTHOPEDIC", "SURGERY", "ICU"],
      waitMinutes: 12,
    },
    {
      name: "Apollo Hospital Tirupati",
      address: "Maruthi Nagar, Renigunta Road, Tirupati",
      latitude: 13.6265,
      longitude: 79.4285,
      readinessStatus: "BUSY",
      emergencyStatus: "LIMITED",
      traumaBeds: 3,
      icuBeds: 2,
      ventilators: 2,
      capabilities: ["TRAUMA", "ICU", "CARDIAC", "STROKE"],
      waitMinutes: 18,
    },
    {
      name: "Amara Hospital Tirupati",
      address: "Karakambadi Road, Mangalam, Tirupati",
      latitude: 13.6521,
      longitude: 79.4485,
      readinessStatus: "READY",
      emergencyStatus: "ACCEPTING",
      traumaBeds: 4,
      icuBeds: 3,
      ventilators: 2,
      capabilities: ["TRAUMA", "ICU", "CARDIAC", "EMERGENCY"],
      waitMinutes: 10,
    },
  ],
  demoAmbulances: [
    {
      callSign: "AMB-01",
      vehicleNumber: "AP-03-TE-1081",
      driverName: "Aarav Mehta",
      latitude: 13.6288,
      longitude: 79.4192,
      equipment: ["VENTILATOR", "DEFIBRILLATOR", "OXYGEN", "TRAUMA_KIT"],
    },
    {
      callSign: "AMB-02",
      vehicleNumber: "AP-03-TE-1082",
      driverName: "Ramesh Naidu",
      latitude: 13.6395,
      longitude: 79.401,
      equipment: ["VENTILATOR", "DEFIBRILLATOR", "ECG", "SUCTION"],
    },
    {
      callSign: "AMB-03",
      vehicleNumber: "AP-03-TE-1083",
      driverName: "Suresh Babu",
      latitude: 13.632,
      longitude: 79.411,
      equipment: ["OXYGEN", "FIRST_AID", "STRETCHER"],
    },
    {
      callSign: "AMB-04",
      vehicleNumber: "AP-03-TE-1084",
      driverName: "Kalyan Kumar",
      latitude: 13.645,
      longitude: 79.438,
      equipment: ["VENTILATOR", "DEFIBRILLATOR", "OXYGEN"],
    },
    {
      callSign: "AMB-05",
      vehicleNumber: "AP-03-TE-1085",
      driverName: "Venkatesh Rao",
      latitude: 13.618,
      longitude: 79.415,
      equipment: ["OXYGEN", "FIRST_AID", "STRETCHER"],
    },
  ],
  demoEmergencies: [
    {
      patientName: "Asha Verma",
      emergencyType: "CARDIAC_ARREST",
      severity: "CRITICAL",
      latitude: 13.639,
      longitude: 79.4035,
      locationLabel: "Alipiri Pilgrim Transit Center, Tirupati",
      requiredCapabilities: ["CARDIAC", "ICU", "VENTILATOR"],
    },
    {
      patientName: "Subramanyam Reddy",
      emergencyType: "TRAUMA_ACCIDENT",
      severity: "CRITICAL",
      latitude: 13.648,
      longitude: 79.442,
      locationLabel: "Karakambadi Road Flyover Junction, Tirupati",
      requiredCapabilities: ["TRAUMA", "SURGERY", "ICU"],
    },
    {
      patientName: "Lakshmi Devi",
      emergencyType: "ACUTE_RESPIRATORY_DISTRESS",
      severity: "HIGH",
      latitude: 13.628,
      longitude: 79.4195,
      locationLabel: "Tirupati Central Railway Station Platform 1",
      requiredCapabilities: ["VENTILATOR", "ICU"],
    },
  ],
  demoRoadIncidents: [
    {
      title: "Road repair work on Alipiri Link Road",
      severity: "MODERATE",
      latitude: 13.635,
      longitude: 79.406,
      description: "Lane constriction due to drainage pipe laying. Expect 5-8 min delay.",
      delayMinutes: 6,
    },
    {
      title: "Pilgrim congestion near Kapilatheertham Circle",
      severity: "MAJOR",
      latitude: 13.642,
      longitude: 79.418,
      description: "Heavy vehicular and pedestrian movement towards hills. 12 min delay.",
      delayMinutes: 12,
    },
  ],
};
