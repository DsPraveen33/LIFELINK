export interface UserProfileData {
  id: number;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  locationPermission: string;
  locationMode: string;
  emergencies: Array<{
    id: number;
    patientName: string;
    emergencyType: string;
    severity: string;
    locationLabel: string;
    status: string;
    etaMinutes: number | null;
    createdAt: string;
  }>;
}

export interface DriverProfileData {
  id: number;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  driverId: number;
  driverName: string;
  isOnline: boolean;
  locationPermission: string;
  assignedAmbulance: {
    id: number;
    callSign: string;
    vehicleNumber: string;
    status: string;
    latitude: number;
    longitude: number;
    equipment: string[];
  } | null;
  assignedEmergencies: Array<{
    id: number;
    patientName: string;
    emergencyType: string;
    severity: string;
    locationLabel: string;
    status: string;
    createdAt: string;
  }>;
}

export interface OperatorProfileData {
  id: number;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  shiftStatus: string;
  sessionStartedAt: string;
}

export interface AuditLogItem {
  id: number;
  actorUserId: number | null;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceId: string | number | null;
  ipAddress: string | null;
  metadata: Record<string, any> | null;
  createdAt: string;
}

export interface AdminUserItem {
  id: number;
  name: string;
  email: string;
  role: string;
  phone: string | null;
  createdAt: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('lifelink_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!res.ok) {
    const errorText = await res.text();
    let errorMessage = `Request failed (${res.status})`;
    try {
      const parsed = JSON.parse(errorText);
      errorMessage = parsed.error || parsed.message || errorMessage;
    } catch {
      // ignore
    }
    throw new Error(errorMessage);
  }

  return res.json();
}

export const securityApi = {
  getUserProfile: () => apiFetch<UserProfileData>('/users/me/profile'),
  updateLocationPermission: (status: 'ALLOWED' | 'DENIED', mode: 'LIVE' | 'MANUAL' | 'DEMO') =>
    apiFetch<{ success: boolean; status: string; mode: string }>('/users/me/location-permission', {
      method: 'POST',
      body: JSON.stringify({ status, mode }),
    }),
  getDriverProfile: () => apiFetch<DriverProfileData>('/driver/me/profile'),
  updateDriverAvailability: (isOnline: boolean) =>
    apiFetch<{ isOnline: boolean; status: string }>('/driver/me/availability', {
      method: 'POST',
      body: JSON.stringify({ isOnline }),
    }),
  getOperatorProfile: () => apiFetch<OperatorProfileData>('/operator/me/profile'),
  getAuditLogs: (limit = 100, action?: string) =>
    apiFetch<AuditLogItem[]>(`/admin/audit-logs?limit=${limit}${action ? `&action=${action}` : ''}`),
  getAdminUsers: () => apiFetch<AdminUserItem[]>('/admin/users'),
  createAdminUser: (data: { name: string; email: string; password: string; role: 'DRIVER' | 'OPERATOR'; phone?: string }) =>
    apiFetch<AdminUserItem>('/admin/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteAdminUser: (id: number) =>
    apiFetch<{ success: boolean }>(`/admin/users/${id}`, {
      method: 'DELETE',
    }),
};
