export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS lifelink_users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES lifelink_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_emergencies (
  id SERIAL PRIMARY KEY,
  patient_user_id INTEGER REFERENCES lifelink_users(id) ON DELETE SET NULL,
  patient_name TEXT NOT NULL,
  emergency_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'NEW',
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  location_label TEXT NOT NULL,
  required_capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  assigned_ambulance_id INTEGER,
  selected_hospital_id INTEGER,
  eta_minutes INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_ambulances (
  id SERIAL PRIMARY KEY,
  call_sign TEXT NOT NULL UNIQUE,
  vehicle_number TEXT NOT NULL,
  driver_name TEXT NOT NULL,
  driver_user_id INTEGER REFERENCES lifelink_users(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed_kph DOUBLE PRECISION NOT NULL DEFAULT 0,
  heading DOUBLE PRECISION NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'AVAILABLE',
  equipment TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  current_emergency_id INTEGER,
  destination_hospital_id INTEGER,
  eta_minutes INTEGER,
  last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_hospitals (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  readiness_status TEXT NOT NULL DEFAULT 'READY',
  emergency_status TEXT NOT NULL DEFAULT 'ACCEPTING',
  trauma_beds INTEGER NOT NULL DEFAULT 0,
  icu_beds INTEGER NOT NULL DEFAULT 0,
  ventilators INTEGER NOT NULL DEFAULT 0,
  capabilities TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  wait_minutes INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_routes (
  id SERIAL PRIMARY KEY,
  emergency_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  eta_minutes INTEGER NOT NULL,
  predicted_eta_minutes INTEGER NOT NULL,
  traffic_level TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  points JSONB NOT NULL DEFAULT '[]'::JSONB,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_decisions (
  id SERIAL PRIMARY KEY,
  emergency_id INTEGER NOT NULL REFERENCES lifelink_emergencies(id) ON DELETE CASCADE,
  selected_route_id INTEGER,
  selected_hospital_id INTEGER,
  confidence INTEGER NOT NULL DEFAULT 0,
  reasons TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  warnings TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_events (
  id SERIAL PRIMARY KEY,
  emergency_id INTEGER,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_road_incidents (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  road_name TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lifelink_traffic_conditions (
  id SERIAL PRIMARY KEY,
  road_segment TEXT NOT NULL,
  speed_kph INTEGER NOT NULL,
  expected_speed_kph INTEGER NOT NULL,
  congestion_level TEXT NOT NULL,
  trend TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_hospital_prealerts (
  id SERIAL PRIMARY KEY,
  emergency_id INTEGER NOT NULL REFERENCES lifelink_emergencies(id) ON DELETE CASCADE,
  ambulance_id INTEGER NOT NULL,
  hospital_id INTEGER NOT NULL REFERENCES lifelink_hospitals(id) ON DELETE CASCADE,
  severity TEXT NOT NULL,
  requirements TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  eta_minutes INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'SENT',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_ambulance_locations (
  id SERIAL PRIMARY KEY,
  ambulance_id INTEGER NOT NULL REFERENCES lifelink_ambulances(id) ON DELETE CASCADE,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  speed_kph DOUBLE PRECISION NOT NULL DEFAULT 0,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lifelink_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES lifelink_users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL DEFAULT 'SYSTEM',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  ip_address TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON lifelink_users(email);
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON lifelink_auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_patient_user_id ON lifelink_emergencies(patient_user_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_assigned_ambulance_id ON lifelink_emergencies(assigned_ambulance_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_selected_hospital_id ON lifelink_emergencies(selected_hospital_id);
CREATE INDEX IF NOT EXISTS idx_emergencies_created_at ON lifelink_emergencies(created_at);
CREATE INDEX IF NOT EXISTS idx_ambulances_driver_user_id ON lifelink_ambulances(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_routes_emergency_id ON lifelink_routes(emergency_id);
CREATE INDEX IF NOT EXISTS idx_events_emergency_id ON lifelink_events(emergency_id);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON lifelink_events(created_at);
CREATE INDEX IF NOT EXISTS idx_location_history_ambulance_id ON lifelink_ambulance_locations(ambulance_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_user_id ON lifelink_audit_logs(actor_user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON lifelink_audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON lifelink_audit_logs(action);
`;
