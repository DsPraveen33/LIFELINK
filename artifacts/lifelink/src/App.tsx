import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import { io } from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import { ResponseMap } from '@/components/response-map';
import {
  Activity, Ambulance as AmbulanceIcon, ArrowRight, Check, ChevronRight,
  Clock3, Crosshair, HeartPulse, Hospital as HospitalIcon, LocateFixed, LogOut, MapPin,
  Navigation, Plus, Radio, RotateCcw, ShieldAlert, ShieldCheck, Siren, Signal,
  Stethoscope, UserRound, Users, Waves, Zap, Eye, AlertTriangle, KeyRound
} from 'lucide-react';
import type { AccountUser, Ambulance, Emergency, Hospital, RouteOption, SimulationActionInputAction } from '@workspace/api-client-react';
import {
  setAuthTokenGetter,
  getGetCurrentUserQueryKey, getGetDashboardSummaryQueryKey, getGetEmergencyDecisionQueryKey,
  getGetEmergencyQueryKey, getHealthCheckQueryKey, getListAmbulancesQueryKey,
  getListDashboardEventsQueryKey, getListEmergenciesQueryKey, getListHospitalsQueryKey,
  useAcceptEmergency, useCalculateRoutes, useCompleteEmergency, useCreateEmergency,
  useDeclineEmergency, useGetCurrentUser, useGetDashboardSummary, useGetEmergency,
  useGetEmergencyDecision, useHealthCheck, useListAmbulances, useListDashboardEvents,
  useListEmergencies, useListHospitals, useLoginUser, useLogoutUser, useDemoLogin, useMarkArrivedAtScene,
  useMarkPatientOnboard, useRegisterUser, useResetSimulation, useRunFullDemo,
  useRunSimulationAction, useUpdateAmbulanceLocation, useUpdateAmbulanceStatus,
  useUpdateHospitalStatus,
} from '@workspace/api-client-react';
import { securityApi, type UserProfileData, type DriverProfileData, type OperatorProfileData, type AuditLogItem, type AdminUserItem } from '@/lib/api-security';
import { simulationConfig, DEMO_LOCATION_CITY } from '@/simulation/config';

// Wire Bearer token to API client
setAuthTokenGetter(() => (typeof window !== 'undefined' ? localStorage.getItem('lifelink_token') : null));

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 4000, refetchOnWindowFocus: true, retry: 1 } },
});

const destinations: Record<string, string> = {
  USER: '/user',
  DRIVER: '/driver',
  OPERATOR: '/command-center',
  ADMIN: '/admin',
};

const statusLabel = (s?: string | null) => (s || 'PENDING').replaceAll('_', ' ');
const asTime = (value?: string) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const wait = (x?: number | null) => x == null ? 'Awaiting dispatch' : `${x} min`;

function useLiveRefresh() {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('lifelink_token') : null;
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() });
        void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() });
        void client.invalidateQueries({ queryKey: getListAmbulancesQueryKey() });
        void client.invalidateQueries({ queryKey: getListHospitalsQueryKey() });
      }
    };
    const socket = io({
      path: '/api/socket.io',
      auth: { token },
      query: { token: token || '' },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 5000,
    });
    const onConnect = () => { setConnected(true); refresh(); };
    const onDisconnect = () => setConnected(false);
    const events = ['emergency:created', 'emergency:updated', 'ambulance:updated', 'hospital:updated', 'dashboard:updated', 'lifelink:event', 'simulation:updated'];
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onDisconnect);
    events.forEach(event => socket.on(event, refresh));
    window.addEventListener('online', refresh);
    window.addEventListener('lifelink:reconnected', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      socket.off('connect', onConnect); socket.off('disconnect', onDisconnect); socket.off('connect_error', onDisconnect);
      events.forEach(event => socket.off(event, refresh)); socket.disconnect();
      window.removeEventListener('online', refresh); window.removeEventListener('lifelink:reconnected', refresh); document.removeEventListener('visibilitychange', refresh);
    };
  }, [client]);
  return connected;
}

function RoleBadge({ role }: { role?: string }) {
  if (!role) return null;
  const kind = role.toLowerCase();
  return <span className={`role-badge ${kind}`} data-testid={`badge-role-${kind}`}>{role}</span>;
}

function LocationBadge({ mode, status }: { mode: 'LIVE' | 'MANUAL' | 'DEMO'; status?: string }) {
  const kind = mode.toLowerCase();
  return (
    <span className={`location-badge ${kind}`} data-testid={`badge-location-${kind}`}>
      {mode === 'LIVE' ? '🟢 LIVE GPS' : mode === 'MANUAL' ? '🟡 MANUAL LOCATION' : '🔵 DEMO: TIRUPATI'}
      {status === 'ALLOWED' && ' · GRANTED'}
    </span>
  );
}

function Brand() {
  return (
    <Link href="/login" className="brand" data-testid="link-lifelink-home">
      <span className="brand-mark"><Activity size={25} strokeWidth={2.8} /></span>
      <span>LIFE<strong>LINK</strong><small className="brand-sub">Tirupati Emergency Grid</small></span>
    </Link>
  );
}

function Topbar({ path, user, connected }: { path: string; user?: AccountUser; connected: boolean }) {
  const logout = useLogoutUser();
  const client = useQueryClient();
  const [, setLocation] = useLocation();

  const exit = () => {
    localStorage.removeItem('lifelink_token');
    logout.mutate(undefined, {
      onSuccess: () => { client.clear(); setLocation('/login'); },
      onError: () => { client.clear(); setLocation('/login'); },
    });
  };

  // Role-based Navigation Links (Section 29)
  const links: Array<[string, string]> = [];
  if (user?.role === 'USER') {
    links.push(['/user', 'Emergency SOS'], ['/user/profile', 'My Profile & Location']);
  } else if (user?.role === 'DRIVER') {
    links.push(['/driver', 'Crew Transport'], ['/driver/profile', 'Crew Profile']);
  } else if (user?.role === 'OPERATOR') {
    links.push(['/command-center', 'Command Center'], ['/operator/profile', 'Operator Profile']);
  } else if (user?.role === 'ADMIN') {
    links.push(['/admin', 'Admin Audit & Users'], ['/command-center', 'Command Center']);
  }

  return (
    <header className="topbar">
      <Brand />
      <nav className="navlinks" aria-label="Role views">
        {links.map(([href, label]) => (
          <Link key={href} href={href} className={path === href ? 'active' : ''} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="toolbar">
        {user && <RoleBadge role={user.role} />}
        <span className={`pill ${connected ? 'green' : ''}`} data-testid="status-socket-connection">
          <span style={{ color: connected ? '#2de0a5' : '#e5b868' }}>●</span> {connected ? 'LIVE' : 'POLLING'}
        </span>
        <span className="sim-label">{DEMO_LOCATION_CITY} Grid</span>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="muted" style={{ fontSize: 11, fontWeight: 700 }}>{user.name}</span>
            <button onClick={exit} className="btn btn-small btn-subtle" data-testid="button-logout">
              <LogOut size={13} /> Sign out
            </button>
          </div>
        ) : (
          <Link href="/login" className="btn btn-small" data-testid="link-sign-in">Sign in</Link>
        )}
      </div>
    </header>
  );
}

function SiteFrame({ children }: { children: React.ReactNode }) {
  const [path] = useLocation();
  const { data: user } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false, refetchOnWindowFocus: true },
  });
  const connected = useLiveRefresh();
  return (
    <div className="app-shell">
      <Topbar path={path} user={user} connected={connected} />
      {children}
    </div>
  );
}

// 403 Forbidden Access Screen (Section 28)
function PermissionDenied({ requiredRole, userRole }: { requiredRole: string; userRole?: string }) {
  const [, setLocation] = useLocation();
  const targetDashboard = destinations[userRole || 'USER'] || '/login';
  return (
    <SiteFrame>
      <main className="content">
        <section className="panel" style={{ padding: 40, textAlign: 'center', maxWidth: 600, margin: '60px auto' }}>
          <div style={{ display: 'inline-flex', padding: 14, background: 'rgba(235,61,80,0.12)', borderRadius: '50%', color: '#ff8290', marginBottom: 16 }}>
            <ShieldAlert size={36} />
          </div>
          <div className="eyebrow" style={{ color: '#ff8290' }}>403 FORBIDDEN · ACCESS DENIED</div>
          <h1 style={{ fontSize: 24, margin: '10px 0' }}>You don't have permission to access this information.</h1>
          <p className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 24 }}>
            Backend security authorization prevented access. Your current account has the role <strong>{userRole || 'ANONYMOUS'}</strong>, but this page requires <strong>{requiredRole}</strong> authorization.
          </p>
          <button className="btn btn-primary" onClick={() => setLocation(targetDashboard)} data-testid="button-return-authorized-dashboard">
            Return to Authorized Dashboard
          </button>
        </section>
      </main>
    </SiteFrame>
  );
}

function RoleGuard({ allowedRoles, children }: { allowedRoles: string[]; children: React.ReactNode }) {
  const { data: user, isLoading } = useGetCurrentUser({
    query: { queryKey: getGetCurrentUserQueryKey(), retry: false },
  });
  if (isLoading) {
    return <SiteFrame><div className="loading-bar" style={{ margin: '40px auto', maxWidth: 600 }} /></SiteFrame>;
  }
  if (!user) {
    return <FormPage register={false} />;
  }
  if (!allowedRoles.includes(user.role)) {
    return <PermissionDenied requiredRole={allowedRoles.join(' / ')} userRole={user.role} />;
  }
  return <>{children}</>;
}

function MiniMap({
  className = '', emergency, hospital, ambulances = [], hospitals = [], route, mode = 'patient',
}: {
  className?: string; emergency?: Emergency; hospital?: Hospital; ambulances?: Ambulance[]; hospitals?: Hospital[]; route?: number[][]; mode?: 'patient'|'command';
}) {
  return (
    <ResponseMap
      className={className}
      emergency={emergency}
      selectedHospital={hospital}
      ambulances={ambulances}
      hospitals={hospitals}
      route={route}
      mode={mode}
    />
  );
}

function MobileNav({ active, role }: { active: 'user' | 'driver' | 'command' | 'admin'; role?: string }) {
  return (
    <nav className="bottom-nav">
      {role === 'USER' && (
        <>
          <Link href="/user" className={active === 'user' ? 'active' : ''} data-testid="bottomnav-patient">
            <HeartPulse size={17} /> SOS
          </Link>
          <Link href="/user/profile" data-testid="bottomnav-profile">
            <UserRound size={17} /> Profile
          </Link>
        </>
      )}
      {role === 'DRIVER' && (
        <>
          <Link href="/driver" className={active === 'driver' ? 'active' : ''} data-testid="bottomnav-crew">
            <Navigation size={17} /> Crew
          </Link>
          <Link href="/driver/profile" data-testid="bottomnav-crew-profile">
            <UserRound size={17} /> Profile
          </Link>
        </>
      )}
      {(role === 'OPERATOR' || role === 'ADMIN') && (
        <Link href="/command-center" className={active === 'command' ? 'active' : ''} data-testid="bottomnav-command">
          <Radio size={17} /> Command
        </Link>
      )}
      {role === 'ADMIN' && (
        <Link href="/admin" className={active === 'admin' ? 'active' : ''} data-testid="bottomnav-admin">
          <KeyRound size={17} /> Admin
        </Link>
      )}
    </nav>
  );
}

// -------------------------------------------------------------
// FormPage (Login & Registration)
// -------------------------------------------------------------
function FormPage({ register }: { register: boolean }) {
  const [, setLocation] = useLocation();
  const login = useLoginUser();
  const demoLogin = useDemoLogin();
  const registration = useRegisterUser();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const complete = (u: AccountUser & { token?: string }) => {
    if (u.token) {
      localStorage.setItem('lifelink_token', u.token);
    }
    void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    setLocation(destinations[u.role] || '/user');
  };

  const handleQuickDemo = (email: string) => {
    setError('');
    setBusy(true);
    demoLogin.mutate({ data: { email } }, {
      onSuccess: (data: any) => complete(data),
      onError: (e) => setError(e instanceof Error ? e.message : 'Demo access is unavailable.'),
      onSettled: () => setBusy(false),
    });
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') || '').trim();
    const password = String(form.get('password') || '');
    if (!email || !password) {
      setError('Enter your email and password to continue.');
      return;
    }
    setBusy(true);
    if (register) {
      const name = String(form.get('name') || '').trim();
      if (!name) {
        setBusy(false);
        setError('Add your name to create an account.');
        return;
      }
      // Section 8: Public registration forces USER role only
      registration.mutate({
        data: {
          name,
          email,
          password,
          role: 'USER',
          phone: String(form.get('phone') || '') || null,
        },
      }, {
        onSuccess: (data: any) => complete(data),
        onError: (e) => setError(e instanceof Error ? e.message : 'Registration failed.'),
        onSettled: () => setBusy(false),
      });
    } else {
      login.mutate({ data: { email, password } }, {
        onSuccess: (data: any) => complete(data),
        onError: (e) => setError(e instanceof Error ? e.message : 'Sign in failed. Check your details.'),
        onSettled: () => setBusy(false),
      });
    }
  };

  return (
    <main className="auth-page">
      <section className="auth-art">
        <Brand />
        <div>
          <div className="eyebrow">Tirupati Emergency Corridor · Simulation & Live Ops</div>
          <h1>When seconds matter,<br /><em>everyone moves.</em></h1>
          <p>
            Role-isolated emergency command connecting patients in Tirupati, responding ambulance crews, hospital ERs, and command center operators.
          </p>
        </div>
        <div className="eyebrow">LIFELINK TIRUPATI DEPLOYMENT · ZERO IDOR DATA ISOLATION</div>
      </section>

      <section className="auth-form-wrap">
        <form className="auth-form" onSubmit={handleSubmit}>
          <span className="eyebrow">{register ? 'Caller Access' : 'Verified Access'}</span>
          <h2>{register ? 'Create patient account.' : 'Sign in to LIFELINK.'}</h2>
          <p>{register ? 'Public registration is restricted to caller accounts. Crew and Operator accounts are provisioned by dispatch administration.' : 'Sign in to access your role-authorized workspace.'}</p>

          {register && (
            <>
              <label className="field-label" htmlFor="name">Full name</label>
              <input id="name" name="name" className="input" autoComplete="name" data-testid="input-name" placeholder="Asha Verma" required />
              <label className="field-label" htmlFor="phone">Phone <span className="muted">optional</span></label>
              <input id="phone" name="phone" className="input" autoComplete="tel" data-testid="input-phone" placeholder="+91 98480 12345" />
            </>
          )}

          <label className="field-label" htmlFor="email">Email address</label>
          <input id="email" name="email" className="input" type="email" autoComplete="email" data-testid="input-email" placeholder="caller@lifelink.demo" required />

          <label className="field-label" htmlFor="password">Password</label>
          <input id="password" name="password" className="input" type="password" autoComplete={register ? 'new-password' : 'current-password'} data-testid="input-password" placeholder="Password" required />

          {error && <div className="form-error" role="alert" data-testid="status-auth-error">{error}</div>}

          <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, minHeight: 45 }} disabled={busy} data-testid="button-auth-submit">
            {busy ? 'Verifying credentials…' : register ? 'Create account' : 'Sign in'} <ChevronRight size={15} />
          </button>

          {!register && (
            <div style={{ marginTop: 24 }}>
              <div className="eyebrow" style={{ textAlign: 'center', marginBottom: 8 }}>Quick Test Accounts (Tirupati Matrix)</div>
              <div className="demo-role-grid">
                <div className="demo-role-card" onClick={() => handleQuickDemo('patient@lifelink.demo')} data-testid="card-demo-patient">
                  <div className="role-title">👤 Patient / Caller</div>
                  <div className="role-desc">patient@lifelink.demo (Own emergencies only)</div>
                </div>
                <div className="demo-role-card" onClick={() => handleQuickDemo('driver@lifelink.demo')} data-testid="card-demo-driver1">
                  <div className="role-title">🚑 Crew AMB-01</div>
                  <div className="role-desc">driver@lifelink.demo (Unit AMB-01 assigned)</div>
                </div>
                <div className="demo-role-card" onClick={() => handleQuickDemo('driver2@lifelink.demo')} data-testid="card-demo-driver2">
                  <div className="role-title">🚑 Crew AMB-02</div>
                  <div className="role-desc">driver2@lifelink.demo (Unit AMB-02 assigned)</div>
                </div>
                <div className="demo-role-card" onClick={() => handleQuickDemo('operator@lifelink.demo')} data-testid="card-demo-operator">
                  <div className="role-title">🖥️ Command Operator</div>
                  <div className="role-desc">operator@lifelink.demo (Operational dispatch)</div>
                </div>
                <div className="demo-role-card" style={{ gridColumn: '1 / -1' }} onClick={() => handleQuickDemo('admin@lifelink.demo')} data-testid="card-demo-admin">
                  <div className="role-title">🛡️ System Administrator</div>
                  <div className="role-desc">admin@lifelink.demo (Full audit logs & user management)</div>
                </div>
              </div>
            </div>
          )}

          <div className="muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 18 }} data-testid="text-auth-switch">
            {register ? 'Already have an account? ' : 'New caller? '}
            <Link href={register ? '/login' : '/register'} style={{ color: '#4fdeb1', textDecoration: 'none' }} data-testid="link-auth-switch">
              {register ? 'Sign in' : 'Register here'}
            </Link>
          </div>
          <div className="sim-label" style={{ display: 'block', marginTop: 20, textAlign: 'center' }}>
            All operations authorized via backend RBAC & Object Isolation
          </div>
        </form>
      </section>
    </main>
  );
}

// -------------------------------------------------------------
// PatientView (USER Role - Section 2, 15, 16, 17, 18, 38)
// -------------------------------------------------------------
function PatientView() {
  const client = useQueryClient();
  const { data: user } = useGetCurrentUser();
  const [patientName, setPatientName] = useState(user?.name || '');
  const [need, setNeed] = useState('Cardiac');
  const [locationLabel, setLocationLabel] = useState('Alipiri Transit, Tirupati');
  const [lat, setLat] = useState('13.6390');
  const [lng, setLng] = useState('79.4035');
  const [locationMode, setLocationMode] = useState<'LIVE' | 'MANUAL' | 'DEMO'>('DEMO');
  const [showLocationBanner, setShowLocationBanner] = useState(false);
  const [locationStatus, setLocationStatus] = useState<string>('ALLOWED');

  const create = useCreateEmergency();
  const list = useListEmergencies({ query: { queryKey: getListEmergenciesQueryKey(), refetchInterval: 5000 } });
  const emergencies = list.data || [];
  // Section 2: User sees only own emergencies
  const active = emergencies.find(e => !['COMPLETED', 'CANCELLED'].includes(e.status));
  const detail = useGetEmergency(active?.id ?? 0, { query: { queryKey: getGetEmergencyQueryKey(active?.id ?? 0), enabled: !!active?.id, refetchInterval: 4000 } });
  const decision = useGetEmergencyDecision(active?.id ?? 0, { query: { queryKey: getGetEmergencyDecisionQueryKey(active?.id ?? 0), enabled: !!active?.id, refetchInterval: 6000 } });
  const hospitals = useListHospitals({ query: { queryKey: getListHospitalsQueryKey(), refetchInterval: 12000 } });
  const ambulances = useListAmbulances({ query: { queryKey: getListAmbulancesQueryKey(), refetchInterval: 5000 } });

  const currentEmergency = detail.data || active;
  const assignedAmbulance = ambulances.data?.find(a => a.id === currentEmergency?.assignedAmbulanceId);
  const recommendedHospital = hospitals.data?.find(h => h.id === currentEmergency?.selectedHospitalId) ||
    (decision.data?.selectedHospitalId ? hospitals.data?.find(h => h.id === decision.data?.selectedHospitalId) : undefined);

  // Request explicit GPS location (Section 15, 17)
  const requestGpsLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocationLabel(`GPS Location (Accurate to ${Math.round(pos.coords.accuracy)}m)`);
        setLocationMode('LIVE');
        setLocationStatus('ALLOWED');
        setShowLocationBanner(false);
        void securityApi.updateLocationPermission('ALLOWED', 'LIVE');
      },
      (err) => {
        setLocationStatus('DENIED');
        alert(`Location permission denied: ${err.message}. Switched to manual mode.`);
        setLocationMode('MANUAL');
        setShowLocationBanner(false);
        void securityApi.updateLocationPermission('DENIED', 'MANUAL');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const useTirupatiDemo = () => {
    setLat('13.6390');
    setLng('79.4035');
    setLocationLabel('Alipiri Transit Corridor, Tirupati');
    setLocationMode('DEMO');
    setShowLocationBanner(false);
    void securityApi.updateLocationPermission('ALLOWED', 'DEMO');
  };

  const stopLocationSharing = () => {
    setLocationMode('MANUAL');
    setLocationStatus('DENIED');
    void securityApi.updateLocationPermission('DENIED', 'MANUAL');
  };

  const submitSOS = () => {
    const name = patientName.trim() || user?.name || 'Caller';
    create.mutate({
      data: {
        patientName: name,
        emergencyType: need,
        severity: need === 'Cardiac' || need === 'Road accident' ? 'CRITICAL' : 'HIGH',
        latitude: Number(lat),
        longitude: Number(lng),
        locationLabel,
        requiredCapabilities: need === 'Cardiac' ? ['CARDIAC', 'ALS'] : ['TRAUMA', 'ALS'],
      },
    }, {
      onSuccess: (e) => {
        client.setQueryData(getGetEmergencyQueryKey(e.id), e);
        void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() });
        void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() });
      },
    });
  };

  return (
    <SiteFrame>
      <main className="mobile-wrap">
        <div className="mobile-top">
          <div>
            <Brand />
            <div className="eyebrow" style={{ marginTop: 7 }}>CALLER / PATIENT CONSOLE</div>
          </div>
          <LocationBadge mode={locationMode} status={locationStatus} />
        </div>

        {/* Location Banner (Section 15, 18) */}
        {showLocationBanner && (
          <div className="location-banner" data-testid="banner-location-permission">
            <h3>📍 Location Permission Request</h3>
            <p>
              LIFELINK needs your location to find the nearest ambulance in Tirupati and compute optimal emergency hospital routing.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-small" onClick={requestGpsLocation} data-testid="button-allow-gps">
                <LocateFixed size={12} /> Allow GPS Location
              </button>
              <button className="btn btn-small" onClick={() => { setLocationMode('MANUAL'); setShowLocationBanner(false); }} data-testid="button-enter-manual-loc">
                Enter Manually
              </button>
              <button className="btn btn-small" onClick={useTirupatiDemo} data-testid="button-use-tirupati-demo">
                Use Tirupati Demo
              </button>
            </div>
          </div>
        )}

        {!currentEmergency ? (
          <section className="panel mobile-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="eyebrow">Emergency dispatch request</span>
              <button className="btn btn-subtle btn-small" onClick={() => setShowLocationBanner(true)} data-testid="button-location-settings-toggle">
                📍 Location Options
              </button>
            </div>
            <h1 style={{ fontSize: 21, margin: '6px 0 3px' }}>Need emergency care?</h1>
            <p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>
              Your emergency request alerts the nearest Tirupati ambulance and prepares the hospital ER.
            </p>

            <label className="field-label" htmlFor="patient-name">Patient Name</label>
            <input id="patient-name" className="input" value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Patient name" data-testid="input-patient-name" />

            <label className="field-label">Emergency Category</label>
            <div className="need-grid">
              {['Cardiac', 'Road accident', 'Breathing', 'Trauma', 'Burn', 'Stroke'].map(n => (
                <button className={`need-choice ${need === n ? 'selected' : ''}`} key={n} onClick={() => setNeed(n)} data-testid={`button-need-${n.toLowerCase().replaceAll(' ', '-')}`}>
                  {n}
                </button>
              ))}
            </div>

            <label className="field-label" htmlFor="patient-location">Current Incident Location</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input id="patient-location" className="input" value={locationLabel} onChange={e => setLocationLabel(e.target.value)} data-testid="input-patient-location" />
              <button type="button" className="btn btn-small" onClick={requestGpsLocation} title="Fetch browser GPS" data-testid="button-use-my-location">
                <LocateFixed size={14} />
              </button>
            </div>

            <details style={{ marginTop: 10 }}>
              <summary className="eyebrow" style={{ cursor: 'pointer', padding: '6px 0' }}>Adjust Tirupati Coordinates ({locationMode})</summary>
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <input className="input" aria-label="Latitude" value={lat} onChange={e => { setLat(e.target.value); setLocationMode('MANUAL'); }} data-testid="input-latitude" />
                <input className="input" aria-label="Longitude" value={lng} onChange={e => { setLng(e.target.value); setLocationMode('MANUAL'); }} data-testid="input-longitude" />
              </div>
            </details>

            <button className="mobile-sos" style={{ marginTop: 16 }} onClick={submitSOS} disabled={create.isPending} data-testid="button-send-sos">
              <Siren size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              {create.isPending ? 'TRANSMITTING SOS…' : 'TRANSMIT EMERGENCY SOS'}
            </button>
            <div className="eyebrow" style={{ marginTop: 12, textAlign: 'center' }}>
              Connected to Tirupati AI Dispatch Grid
            </div>
          </section>
        ) : (
          <section className="panel mobile-card" data-testid={`card-active-emergency-${currentEmergency.id}`}>
            <div className="status-line">
              <span className="pulse" />
              <span>Response Underway</span>
              <span className="pill green" style={{ marginLeft: 'auto' }}>{statusLabel(currentEmergency.status)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
              <h1 style={{ fontSize: 19, margin: 0 }}>{currentEmergency.emergencyType} Emergency</h1>
              <span className="location-badge live">📍 LIVE TRACKING ACTIVE</span>
            </div>
            <div className="muted" style={{ fontSize: 11, marginTop: 4 }} data-testid={`text-emergency-location-${currentEmergency.id}`}>
              <MapPin size={13} style={{ verticalAlign: 'middle' }} /> {currentEmergency.locationLabel}
            </div>

            <div className="timeline">
              <div className={`timeline-step ${['DISPATCHED','ACCEPTED','EN_ROUTE','ON_SCENE','TRANSPORTING'].includes(currentEmergency.status)?'done':''}`}>Dispatched</div>
              <div className={`timeline-step ${['ACCEPTED','EN_ROUTE','ON_SCENE','TRANSPORTING'].includes(currentEmergency.status)?'done':''}`}>Crew En Route</div>
              <div className={`timeline-step ${['ON_SCENE','TRANSPORTING'].includes(currentEmergency.status)?'done':''}`}>On Scene</div>
              <div className={`timeline-step ${currentEmergency.status === 'TRANSPORTING'?'done':''}`}>Hospital</div>
            </div>

            {/* Map isolated to own emergency and assigned ambulance only (Section 2, 20) */}
            <MiniMap
              className="tracking-map"
              emergency={currentEmergency}
              hospital={recommendedHospital}
              ambulances={assignedAmbulance ? [assignedAmbulance] : []}
              hospitals={recommendedHospital ? [recommendedHospital] : []}
              route={decision.data?.selectedRoute.points}
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <div className="profile-item">
                <span className="profile-label">Assigned Ambulance</span>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#42d9a8' }}>
                  {assignedAmbulance ? assignedAmbulance.callSign : `AMB-${String(currentEmergency.assignedAmbulanceId || '01').padStart(2, '0')}`}
                </div>
              </div>
              <div className="profile-item">
                <span className="profile-label">Estimated Arrival</span>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#eff7f8' }} data-testid="text-patient-eta">
                  {wait(currentEmergency.etaMinutes)}
                </div>
              </div>
            </div>

            {recommendedHospital && (
              <div style={{ borderTop: '1px solid #263644', marginTop: 14, paddingTop: 12 }}>
                <div className="eyebrow">Assigned Hospital in Tirupati</div>
                <strong style={{ display: 'block', fontSize: 12, marginTop: 4 }} data-testid="text-patient-hospital">
                  {recommendedHospital.name}
                </strong>
                <span className="muted" style={{ fontSize: 10 }}>
                  {recommendedHospital.address} · {recommendedHospital.waitMinutes} min ER wait · {recommendedHospital.traumaBeds} trauma beds
                </span>
              </div>
            )}

            {decision.data && (
              <div className="toast-inline" data-testid="text-patient-route-reason">
                {decision.data.reasons[0] || `Optimal Route · ${decision.data.confidence}% confidence`}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="btn btn-small" onClick={() => setShowLocationBanner(true)} data-testid="button-change-location">
                Change Location
              </button>
              <button className="btn btn-small btn-subtle" onClick={stopLocationSharing} data-testid="button-stop-location">
                Stop Location Sharing
              </button>
            </div>
          </section>
        )}

        {/* Nearby Tirupati Hospitals info (Section 22) */}
        <section className="panel mobile-card">
          <div className="panel-head" style={{ padding: 0, border: 0 }}>
            <h2><HospitalIcon size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Tirupati Emergency Facilities</h2>
            <span className="eyebrow">{hospitals.data?.length ?? '—'} facilities</span>
          </div>
          {hospitals.isLoading ? (
            <div className="loading-bar" style={{ marginTop: 14 }} />
          ) : (
            hospitals.data?.slice(0, 3).map(h => (
              <div className="hospital-row" key={h.id} data-testid={`row-hospital-${h.id}`}>
                <div>
                  <div className="route-title">{h.name}</div>
                  <div className="route-meta">{h.waitMinutes} min wait · {h.traumaBeds} trauma beds</div>
                </div>
                <span className={`pill ${h.readinessStatus === 'READY' ? 'green' : ''}`}>{h.readinessStatus}</span>
              </div>
            ))
          )}
        </section>
      </main>
      <MobileNav active="user" role="USER" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// DriverView (DRIVER Role - Section 3, 13, 19, 20)
// -------------------------------------------------------------
function DriverView() {
  const client = useQueryClient();
  const ambulances = useListAmbulances({ query: { queryKey: getListAmbulancesQueryKey(), refetchInterval: 5000 } });
  const emergencies = useListEmergencies({ query: { queryKey: getListEmergenciesQueryKey(), refetchInterval: 5000 } });
  const hospitals = useListHospitals({ query: { queryKey: getListHospitalsQueryKey(), refetchInterval: 12000 } });

  const accept = useAcceptEmergency();
  const decline = useDeclineEmergency();
  const status = useUpdateAmbulanceStatus();
  const locationUpdate = useUpdateAmbulanceLocation();
  const arrived = useMarkArrivedAtScene();
  const onboard = useMarkPatientOnboard();
  const complete = useCompleteEmergency();

  const [notice, setNotice] = useState('');

  // Section 13: Driver sees only own assigned ambulance and emergency
  const ambulance = ambulances.data?.[0]; // Backend scopes GET /ambulances to driver's own ambulance
  const assignedEmergency = emergencies.data?.find(e => e.id === ambulance?.currentEmergencyId) || emergencies.data?.[0];
  const routeDecision = useGetEmergencyDecision(assignedEmergency?.id ?? 0, {
    query: { queryKey: getGetEmergencyDecisionQueryKey(assignedEmergency?.id ?? 0), enabled: !!assignedEmergency?.id, refetchInterval: 8000 },
  });
  const hospital = hospitals.data?.find(h => h.id === assignedEmergency?.selectedHospitalId || h.id === ambulance?.destinationHospitalId);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListAmbulancesQueryKey() });
    void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() });
    void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() });
  };

  const act = (fn: (v: any, o?: any) => void, vars: any, text: string) => fn(vars, {
    onSuccess: () => { setNotice(text); refresh(); },
    onError: (e: any) => setNotice(`Action failed: ${e?.message || 'Unauthorized'}`),
  });

  const acceptCall = () => ambulance && assignedEmergency && act(accept.mutate, { id: ambulance.id, data: { emergencyId: assignedEmergency.id } }, 'Dispatch accepted. Route and patient details synced.');
  const declineCall = () => ambulance && assignedEmergency && act(decline.mutate, { id: ambulance.id, data: { emergencyId: assignedEmergency.id } }, 'Dispatch declined. Operator notified.');
  const moveStatus = (s: 'EN_ROUTE' | 'ON_SCENE' | 'TRANSPORTING' | 'AVAILABLE' | 'OFFLINE') => ambulance && act(status.mutate, { id: ambulance.id, data: { status: s } }, `Status updated: ${statusLabel(s)}.`);
  const markAtScene = () => ambulance && assignedEmergency && act(arrived.mutate, { id: ambulance.id, data: { emergencyId: assignedEmergency.id } }, 'Arrival at scene recorded.');
  const markOnboard = () => ambulance && assignedEmergency && act(onboard.mutate, { id: ambulance.id, data: { emergencyId: assignedEmergency.id } }, 'Patient onboard. En route to hospital.');
  const completeCall = () => ambulance && assignedEmergency && act(complete.mutate, { id: ambulance.id, data: { emergencyId: assignedEmergency.id } }, 'Transport completed. Unit ready for next dispatch.');
  const sendLocation = () => ambulance && act(locationUpdate.mutate, { id: ambulance.id, data: { latitude: ambulance.latitude, longitude: ambulance.longitude, speedKph: 42, heading: 90 } }, 'Live GPS telemetry transmitted.');

  return (
    <SiteFrame>
      <main className="mobile-wrap">
        <div className="mobile-top">
          <div>
            <Brand />
            <div className="eyebrow" style={{ marginTop: 7 }}>CREW NAVIGATION & DISPATCH</div>
          </div>
          <span className="pill green"><Signal size={11} /> UNIT ONLINE</span>
        </div>

        {/* Section 19: Driver location notice */}
        <div className="location-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Navigation size={14} style={{ color: '#60baff' }} />
            <strong style={{ fontSize: 12 }}>GPS Navigation Active</strong>
          </div>
          <p style={{ margin: 0, fontSize: 10 }}>
            Location is required while you are online so LIFELINK can provide live dispatch and hospital navigation in Tirupati.
          </p>
        </div>

        {assignedEmergency && !ambulance?.currentEmergencyId ? (
          <section className="panel mobile-card" data-testid={`card-dispatch-${assignedEmergency.id}`}>
            <div className="eyebrow">Incoming Dispatch · Tirupati Grid</div>
            <h1 style={{ fontSize: 21, margin: '8px 0 5px' }}>{assignedEmergency.emergencyType}</h1>
            <div className="muted" style={{ fontSize: 11 }}>
              <MapPin size={13} style={{ verticalAlign: 'middle' }} /> {assignedEmergency.locationLabel}
            </div>
            <div style={{ display: 'flex', gap: 7, margin: '14px 0' }}>
              <span className="pill red">{assignedEmergency.severity}</span>
              {assignedEmergency.requiredCapabilities.map(c => <span className="pill" key={c}>{c}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptCall} data-testid="button-accept-dispatch">
                <Check size={15} /> Accept Dispatch
              </button>
              <button className="btn btn-danger" onClick={declineCall} data-testid="button-decline-dispatch">
                Decline
              </button>
            </div>
          </section>
        ) : null}

        {assignedEmergency && ambulance?.currentEmergencyId ? (
          <section className="panel mobile-card" data-testid={`card-active-assignment-${assignedEmergency.id}`}>
            <div className="status-line">
              <span className="pulse" />
              <span>{ambulance.callSign} · {statusLabel(ambulance.status)}</span>
              <span className="pill green" style={{ marginLeft: 'auto' }}>{wait(ambulance.etaMinutes || assignedEmergency.etaMinutes)}</span>
            </div>
            <h1 style={{ fontSize: 20, margin: '15px 0 5px' }}>{assignedEmergency.emergencyType}</h1>
            <p className="muted" style={{ fontSize: 11, marginTop: 0 }}>
              {assignedEmergency.patientName} · {assignedEmergency.locationLabel}
            </p>

            <MiniMap
              className="tracking-map"
              emergency={assignedEmergency}
              hospital={hospital}
              ambulances={ambulance ? [ambulance] : []}
              hospitals={hospital ? [hospital] : []}
              route={routeDecision.data?.selectedRoute.points}
            />

            <div style={{ padding: '12px 0 2px' }}>
              <div className="eyebrow">Receiving Hospital Target</div>
              <div style={{ fontSize: 12, marginTop: 5, fontWeight: 700 }}>{hospital?.name || 'Assigned by dispatch'}</div>
              <div className="route-meta">{hospital?.address || 'Follow route navigation'} · {hospital?.waitMinutes ?? '—'} min receiving wait</div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={() => moveStatus('EN_ROUTE')} data-testid="button-start-navigation">
                <Navigation size={14} /> Start Navigation
              </button>
              <button className="btn" onClick={sendLocation} data-testid="button-send-location">
                <Crosshair size={14} /> Send Telemetry
              </button>
            </div>

            {ambulance.status === 'EN_ROUTE' && (
              <button className="btn btn-danger" style={{ width: '100%', marginTop: 8 }} onClick={markAtScene} data-testid="button-arrived-scene">
                Mark Arrived at Scene
              </button>
            )}
            {ambulance.status === 'ON_SCENE' && (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={markOnboard} data-testid="button-patient-onboard">
                Patient Onboard · Begin Transport
              </button>
            )}
            {ambulance.status === 'TRANSPORTING' && (
              <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={completeCall} data-testid="button-complete-emergency">
                Arrived at Hospital · Complete Mission
              </button>
            )}
            {notice && <div className="toast-inline" data-testid="status-driver-update">{notice}</div>}
          </section>
        ) : !assignedEmergency ? (
          <section className="panel mobile-card" data-testid="empty-driver-dispatch">
            <div className="empty-state">
              <AmbulanceIcon size={26} style={{ color: '#08b986', marginBottom: 10 }} />
              <div className="route-title">Standby · Awaiting Next Emergency</div>
              <p>Your ambulance is broadcasting availability to the Tirupati dispatch grid.</p>
              <button className="btn btn-small" onClick={refresh} data-testid="button-refresh-dispatch">
                <RotateCcw size={12} /> Refresh Standby
              </button>
            </div>
          </section>
        ) : null}

        <section className="panel mobile-card">
          <div className="panel-head" style={{ padding: 0, border: 0 }}>
            <h2>Assigned Unit Telemetry</h2>
            <span className="eyebrow">{ambulance?.callSign || 'UNIT 01'}</span>
          </div>
          <div className="route-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
            <div>
              <div className="route-title">{ambulance?.driverName || 'Driver Crew'}</div>
              <div className="route-meta">{ambulance?.vehicleNumber || 'AP 03 TX 1088'} · {ambulance?.equipment.join(' / ') || 'ALS / Oxygen'}</div>
            </div>
            <span className={`pill ${ambulance?.status === 'AVAILABLE' ? 'green' : ''}`}>{statusLabel(ambulance?.status)}</span>
          </div>
          <div className="toolbar" style={{ marginTop: 10 }}>
            <button className="btn btn-small" onClick={() => moveStatus('AVAILABLE')} data-testid="button-unit-available">Set Available</button>
            <button className="btn btn-small" onClick={() => moveStatus('OFFLINE')} data-testid="button-unit-offline">Go Offline</button>
          </div>
        </section>
      </main>
      <MobileNav active="driver" role="DRIVER" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// CommandCenter (OPERATOR & ADMIN - Section 4, 21, 22)
// -------------------------------------------------------------
function CommandCenter() {
  const client = useQueryClient();
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 6000 } });
  const emergencyQuery = useListEmergencies({ query: { queryKey: getListEmergenciesQueryKey(), refetchInterval: 5000 } });
  const ambulanceQuery = useListAmbulances({ query: { queryKey: getListAmbulancesQueryKey(), refetchInterval: 5000 } });
  const hospitalQuery = useListHospitals({ query: { queryKey: getListHospitalsQueryKey(), refetchInterval: 10000 } });
  const eventsQuery = useListDashboardEvents({ query: { queryKey: getListDashboardEventsQueryKey(), refetchInterval: 4000 } });

  const create = useCreateEmergency();
  const calculate = useCalculateRoutes();
  const runAction = useRunSimulationAction();
  const fullDemo = useRunFullDemo();
  const reset = useResetSimulation();
  const hospitalUpdate = useUpdateHospitalStatus();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [notice, setNotice] = useState('');

  const emergencies = emergencyQuery.data || [];
  const ambulances = ambulanceQuery.data || [];
  const hospitals = hospitalQuery.data || [];
  const activeEmergencies = emergencies.filter(e => !['COMPLETED', 'CANCELLED'].includes(e.status));
  const selected = activeEmergencies.find(e => e.id === selectedId) || activeEmergencies[0];
  const decision = useGetEmergencyDecision(selected?.id ?? 0, {
    query: { queryKey: getGetEmergencyDecisionQueryKey(selected?.id ?? 0), enabled: !!selected?.id, refetchInterval: 8000 },
  });

  const load = () => {
    void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
    void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() });
    void client.invalidateQueries({ queryKey: getListAmbulancesQueryKey() });
    void client.invalidateQueries({ queryKey: getListHospitalsQueryKey() });
    void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() });
  };

  const refreshRoutes = () => selected && calculate.mutate({ data: { emergencyId: selected.id } }, {
    onSuccess: (result) => { setRoutes(Array.isArray(result) ? result as RouteOption[] : []); setNotice('Route analysis recalculated.'); load(); },
  });

  const createDemoIncident = () => create.mutate({
    data: {
      patientName: 'K. Sridevi',
      emergencyType: 'Cardiac Arrest',
      severity: 'CRITICAL',
      latitude: 13.6390,
      longitude: 79.4035,
      locationLabel: 'Alipiri Road Corridor, Tirupati',
      requiredCapabilities: ['CARDIAC', 'ALS'],
    },
  }, {
    onSuccess: e => { setSelectedId(e.id); setNotice(`Tirupati incident #${e.id} dispatched.`); load(); },
  });

  const simulation = (action: SimulationActionInputAction) => runAction.mutate({
    data: { action, emergencyId: selected?.id ?? null },
  }, {
    onSuccess: result => { setNotice(result.message); load(); },
  });

  const toggleHospital = (h: Hospital) => hospitalUpdate.mutate({
    id: h.id,
    data: {
      readinessStatus: h.readinessStatus === 'FULL' ? 'READY' : 'FULL',
      emergencyStatus: h.emergencyStatus === 'DIVERTING' ? 'ACCEPTING' : 'DIVERTING',
      traumaBeds: h.traumaBeds,
      icuBeds: h.icuBeds,
      ventilators: h.ventilators,
      waitMinutes: h.waitMinutes,
    },
  }, {
    onSuccess: () => { setNotice(`${h.name} readiness toggled.`); load(); },
  });

  const kpis = [
    ['Active Incidents', summary.data?.activeEmergencies ?? activeEmergencies.length, 'Tirupati open calls'],
    ['Ambulance Units', `${summary.data?.availableAmbulances ?? ambulances.filter(a => a.status === 'AVAILABLE').length}/${summary.data?.totalAmbulances ?? ambulances.length}`, 'Active in corridor'],
    ['Receiving ERs', `${summary.data?.readyHospitals ?? hospitals.filter(h => h.readinessStatus === 'READY').length}/${summary.data?.totalHospitals ?? hospitals.length}`, 'Hospitals ready'],
    ['Response Time', summary.data ? `${summary.data.averageResponseMinutes} min` : '4.2 min', 'Average dispatch ETA'],
  ];

  return (
    <SiteFrame>
      <main className="content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">TIRUPATI REGIONAL DISPATCH / SVIMS CORRIDOR</div>
            <h1>Emergency Command Center</h1>
            <div className="muted" style={{ fontSize: 11, marginTop: 5 }} data-testid="text-command-live-status">
              <span style={{ color: '#12ca90' }}>●</span> Operational grid online · Role-authorized data minimization enforced
            </div>
          </div>
          <div className="toolbar">
            <span className="sim-label">Tirupati Grid Active</span>
            <button className="btn btn-primary" onClick={createDemoIncident} disabled={create.isPending} data-testid="button-new-emergency">
              <Plus size={14} /> New Tirupati Incident
            </button>
          </div>
        </div>

        <div className="stats-grid">
          {kpis.map(([label, value, caption], i) => (
            <section className="panel stat" key={label} data-testid={`stat-${i}`}>
              <div className="eyebrow">{label}</div>
              <strong data-testid={`value-${i}`}>{value}</strong>
              <small>{caption}</small>
            </section>
          ))}
        </div>

        <div className="command-grid">
          <section className="panel incident-panel">
            <div className="panel-head">
              <h2><Siren size={14} style={{ color: '#f25163', verticalAlign: 'middle', marginRight: 7 }} />Active Emergencies</h2>
              <span className="pill red">{activeEmergencies.length} ACTIVE</span>
            </div>
            {emergencyQuery.isLoading ? (
              <div className="loading-bar" />
            ) : activeEmergencies.length === 0 ? (
              <div className="empty-state">No open emergencies in Tirupati corridor.</div>
            ) : (
              <div className="incident-list">
                {activeEmergencies.map(e => (
                  <button
                    key={e.id}
                    onClick={() => { setSelectedId(e.id); setRoutes([]); }}
                    className={`incident ${selected?.id === e.id ? 'selected' : ''}`}
                    data-testid={`button-select-incident-${e.id}`}
                    style={{ color: 'inherit', textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="incident-top">
                      <span className="incident-title">E-{String(e.id).padStart(3, '0')} · {e.emergencyType}</span>
                      <span className={`severity ${e.severity === 'MEDIUM' || e.severity === 'LOW' ? 'medium' : ''}`}>{e.severity}</span>
                    </div>
                    <p>{e.patientName} · {e.locationLabel}</p>
                    <div className="incident-meta">
                      <span>{statusLabel(e.status)}</span>
                      <span>{wait(e.etaMinutes)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="panel map-panel">
            <div className="panel-head">
              <h2><MapPin size={14} style={{ color: '#13c995', verticalAlign: 'middle', marginRight: 7 }} />Tirupati Response Map</h2>
              <span className="eyebrow">{activeEmergencies.length} calls · {ambulances.length} units</span>
            </div>
            <MiniMap
              className="command-map"
              emergency={selected}
              ambulances={ambulances}
              hospitals={hospitals}
              hospital={decision.data?.selectedHospitalId ? hospitals.find(h => h.id === decision.data?.selectedHospitalId) : undefined}
              route={decision.data?.selectedRoute.points}
              mode="command"
            />
          </section>

          <div className="right-stack">
            <section className="panel">
              <div className="panel-head">
                <h2><Zap size={14} style={{ color: '#f2bd5c', verticalAlign: 'middle', marginRight: 6 }} />Dynamic Routing Reasoning</h2>
                <button className="btn btn-small" disabled={!selected || calculate.isPending} onClick={refreshRoutes} data-testid="button-calculate-routes">
                  {calculate.isPending ? 'Computing…' : 'Recalculate'}
                </button>
              </div>
              {(routes.length ? routes : decision.data ? [decision.data.selectedRoute] : []).map(r => (
                <div className="route-row" key={r.id} data-testid={`row-route-${r.id}`}>
                  <div>
                    <div className="route-title">{r.name} {r.status === 'RECOMMENDED' && <span className="pill green">RECOMMENDED</span>}</div>
                    <div className="route-meta">{r.etaMinutes} min · {r.distanceKm} km · {r.trafficLevel} traffic · {r.riskLevel} risk</div>
                    <div className="route-meta">{r.reason}</div>
                  </div>
                </div>
              ))}
              {decision.data && (
                <div style={{ padding: '0 13px 12px' }}>
                  <div className="eyebrow">Confidence: {decision.data.confidence}%</div>
                  {decision.data.warnings.map((w, i) => (
                    <div className="route-meta" key={i} style={{ color: '#e6b862' }}>{w}</div>
                  ))}
                </div>
              )}
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2><HospitalIcon size={14} style={{ color: '#26d3a1', verticalAlign: 'middle', marginRight: 6 }} />Hospital Readiness</h2>
                <span className="eyebrow">{hospitals.length} FACILITIES</span>
              </div>
              {hospitals.map(h => (
                <div className="hospital-row" key={h.id} data-testid={`row-command-hospital-${h.id}`}>
                  <div>
                    <div className="route-title">{h.name}</div>
                    <div className="route-meta">{h.waitMinutes}m wait · Trauma {h.traumaBeds} · ICU {h.icuBeds}</div>
                  </div>
                  <button className={`pill ${h.readinessStatus === 'READY' ? 'green' : 'red'}`} onClick={() => toggleHospital(h)} data-testid={`button-toggle-hospital-${h.id}`}>
                    {h.readinessStatus} · Toggle
                  </button>
                </div>
              ))}
            </section>
          </div>
        </div>

        {/* Timeline Events */}
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-head">
            <h2><Activity size={14} style={{ color: '#18c997', verticalAlign: 'middle', marginRight: 7 }} />Real-time Dispatch Timeline</h2>
            <span className="eyebrow">{eventsQuery.data?.length ?? 0} EVENTS</span>
          </div>
          <div className="event-list">
            {eventsQuery.data?.slice(0, 6).map(ev => (
              <div className="event" key={ev.id} data-testid={`event-${ev.id}`}>
                <span className="event-dot" />
                <p>{ev.message}</p>
                <time>{asTime(ev.createdAt)}</time>
              </div>
            ))}
          </div>
        </section>

        {/* Operator Controls / Scenario Simulation */}
        <section className="panel" style={{ marginTop: 14, padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div className="eyebrow">Corridor Simulation Triggers</div>
              <div style={{ fontSize: 13, fontWeight: 800, marginTop: 4 }}>Inject Realtime Incidents into Tirupati Corridor</div>
            </div>
            <div className="toolbar">
              {[
                ['INJECT_TRAFFIC', 'Traffic Surge'],
                ['ACCIDENT_ON_ROUTE_A', 'Alipiri Road Block'],
                ['BLOCK_ROAD', 'Corridor Detour'],
                ['HOSPITAL_B_FULL', 'Ruia Hospital Full'],
                ['HOSPITAL_C_READY', 'Apollo ER Ready'],
              ].map(([action, label]) => (
                <button className="btn btn-small" key={action} onClick={() => simulation(action as SimulationActionInputAction)} disabled={runAction.isPending} data-testid={`button-simulation-${action.toLowerCase()}`}>
                  {label}
                </button>
              ))}
              <button className="btn btn-small btn-primary" onClick={() => fullDemo.mutate(undefined, { onSuccess: r => { setNotice(r.message); load(); } })} disabled={fullDemo.isPending} data-testid="button-run-full-demo">
                Run Full Demo
              </button>
              <button className="btn btn-small btn-danger" onClick={() => reset.mutate(undefined, { onSuccess: r => { setNotice(r.message); load(); } })} disabled={reset.isPending} data-testid="button-reset-simulation">
                <RotateCcw size={12} /> Reset
              </button>
            </div>
          </div>
          {notice && <div className="toast-inline" data-testid="status-simulation-result">{notice}</div>}
        </section>
      </main>
      <MobileNav active="command" role="OPERATOR" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// AdminView (ADMIN Role - Section 5, 27)
// -------------------------------------------------------------
function AdminView() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [filter, setFilter] = useState<string>('ALL');
  const [loading, setLoading] = useState(true);
  const [newRole, setNewRole] = useState<'DRIVER' | 'OPERATOR'>('DRIVER');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('LifelinkDemo2026!');
  const [msg, setMsg] = useState('');

  const fetchAdminData = async () => {
    setLoading(true);
    try {
      const [logsData, usersData] = await Promise.all([
        securityApi.getAuditLogs(100),
        securityApi.getAdminUsers(),
      ]);
      setLogs(logsData);
      setUsers(usersData);
    } catch (e: any) {
      setMsg(`Error loading admin data: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchAdminData();
  }, []);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    try {
      await securityApi.createAdminUser({
        name: newName,
        email: newEmail,
        password: newPassword,
        role: newRole,
      });
      setMsg(`Account created successfully for ${newName} (${newRole})`);
      setNewName('');
      setNewEmail('');
      void fetchAdminData();
    } catch (err: any) {
      setMsg(`Failed to create account: ${err.message}`);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (filter === 'ALL') return true;
    if (filter === 'DENIED') return log.action === 'PERMISSION_DENIED';
    if (filter === 'AUTH') return ['LOGIN', 'LOGOUT', 'FAILED_LOGIN'].includes(log.action);
    if (filter === 'EMERGENCY') return ['EMERGENCY_CREATED', 'EMERGENCY_VIEWED', 'AMBULANCE_ASSIGNED'].includes(log.action);
    return true;
  });

  return (
    <SiteFrame>
      <main className="content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">SECURITY GOVERNANCE & ACCESS AUDITING</div>
            <h1>System Administration & Audit Logs</h1>
            <div className="muted" style={{ fontSize: 11, marginTop: 5 }}>
              Least-privilege administrative management · Immutable audit trails
            </div>
          </div>
          <button className="btn btn-small" onClick={fetchAdminData} data-testid="button-refresh-audit-logs">
            <RotateCcw size={13} /> Refresh Logs
          </button>
        </div>

        {msg && <div className="toast-inline" style={{ marginBottom: 12 }} data-testid="status-admin-msg">{msg}</div>}

        {/* Section 8: Provision Driver & Operator Accounts */}
        <section className="panel profile-card" style={{ marginBottom: 20 }}>
          <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 12 }}>
            <h2><Users size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Provision Privileged Account (Driver / Operator)</h2>
            <span className="eyebrow">Admin Controlled Workflow</span>
          </div>
          <p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>
            Public users can only register as USER. Use this panel to authorize ambulance crews and command center operators.
          </p>
          <form onSubmit={handleCreateUser} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, alignItems: 'end' }}>
            <div>
              <label className="field-label" style={{ margin: '0 0 4px' }}>Name</label>
              <input className="input" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Crew / Operator name" required />
            </div>
            <div>
              <label className="field-label" style={{ margin: '0 0 4px' }}>Email</label>
              <input className="input" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="crew@lifelink.demo" required />
            </div>
            <div>
              <label className="field-label" style={{ margin: '0 0 4px' }}>Initial Password</label>
              <input className="input" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required />
            </div>
            <div>
              <label className="field-label" style={{ margin: '0 0 4px' }}>Role</label>
              <select className="input" value={newRole} onChange={e => setNewRole(e.target.value as any)}>
                <option value="DRIVER">Ambulance Crew (DRIVER)</option>
                <option value="OPERATOR">Command Operator (OPERATOR)</option>
              </select>
            </div>
            <button className="btn btn-primary" type="submit" style={{ minHeight: 40 }} data-testid="button-create-privileged-account">
              Create Account
            </button>
          </form>
        </section>

        {/* Audit Logs Table (Section 27) */}
        <section className="panel profile-card">
          <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 12 }}>
            <h2><ShieldCheck size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Security & Access Audit Trail</h2>
            <div className="toolbar">
              {['ALL', 'DENIED', 'AUTH', 'EMERGENCY'].map(f => (
                <button
                  key={f}
                  className={`btn btn-small ${filter === f ? 'btn-primary' : 'btn-subtle'}`}
                  onClick={() => setFilter(f)}
                  data-testid={`button-filter-log-${f.toLowerCase()}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="loading-bar" />
          ) : (
            <div className="audit-table-wrap">
              <table className="audit-table" data-testid="table-audit-logs">
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Actor</th>
                    <th>Role</th>
                    <th>Action</th>
                    <th>Resource</th>
                    <th>Target ID</th>
                    <th>IP Address</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(log => {
                    const actionKind = log.action.includes('DENIED') ? 'denied' : log.action.includes('LOGIN') ? 'login' : log.action.includes('EMERGENCY') ? 'emergency' : log.action.includes('AMBULANCE') ? 'ambulance' : 'general';
                    return (
                      <tr key={log.id} data-testid={`row-audit-log-${log.id}`}>
                        <td className="mono" style={{ color: '#8fa1af' }}>{asTime(log.createdAt)}</td>
                        <td className="mono">U-{log.actorUserId ?? 'ANON'}</td>
                        <td><RoleBadge role={log.actorRole || 'UNKNOWN'} /></td>
                        <td><span className={`audit-action ${actionKind}`}>{log.action}</span></td>
                        <td className="mono" style={{ color: '#a0b3c2' }}>{log.resourceType}</td>
                        <td className="mono">{log.resourceId ? `#${log.resourceId}` : '—'}</td>
                        <td className="mono" style={{ color: '#778a99' }}>{log.ipAddress || '127.0.0.1'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* User Accounts Overview */}
        <section className="panel profile-card" style={{ marginTop: 20 }}>
          <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 12 }}>
            <h2><Users size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Registered Directory ({users.length} accounts)</h2>
          </div>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Phone</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="mono">U-{String(u.id).padStart(3, '0')}</td>
                    <td style={{ fontWeight: 700 }}>{u.name}</td>
                    <td className="mono">{u.email}</td>
                    <td><RoleBadge role={u.role} /></td>
                    <td className="mono">{u.phone || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>
      <MobileNav active="admin" role="ADMIN" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// User Profile Screen (Section 33, 36)
// -------------------------------------------------------------
function UserProfileView() {
  const { data: user } = useGetCurrentUser();
  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    securityApi.getUserProfile()
      .then(setProfile)
      .catch(e => setNotice(`Failed to load profile: ${e.message}`))
      .finally(() => setLoading(false));
  }, []);

  const setLocationMode = async (status: 'ALLOWED' | 'DENIED', mode: 'LIVE' | 'MANUAL' | 'DEMO') => {
    try {
      await securityApi.updateLocationPermission(status, mode);
      setNotice(`Location settings updated: ${mode} mode.`);
      const updated = await securityApi.getUserProfile();
      setProfile(updated);
    } catch (e: any) {
      setNotice(`Failed to update location: ${e.message}`);
    }
  };

  return (
    <SiteFrame>
      <main className="mobile-wrap">
        <div className="mobile-top">
          <div>
            <Brand />
            <div className="eyebrow" style={{ marginTop: 7 }}>USER PROFILE & PRIVACY</div>
          </div>
          <RoleBadge role={user?.role} />
        </div>

        <section className="panel profile-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#132838', display: 'grid', placeItems: 'center', color: '#2de0a5' }}>
              <UserRound size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>{profile?.name || user?.name}</h2>
              <div className="muted" style={{ fontSize: 11 }}>{profile?.email || user?.email}</div>
            </div>
          </div>

          <div className="profile-grid">
            <div className="profile-item">
              <div className="profile-label">Phone Number</div>
              <div className="profile-value">{profile?.phone || 'Not configured'}</div>
            </div>
            <div className="profile-item">
              <div className="profile-label">Access Role</div>
              <div className="profile-value"><RoleBadge role={profile?.role || user?.role} /></div>
            </div>
            <div className="profile-item">
              <div className="profile-label">GPS Permission</div>
              <div className="profile-value">{profile?.locationPermission || 'NOT_REQUESTED'}</div>
            </div>
            <div className="profile-item">
              <div className="profile-label">Location Mode</div>
              <div className="profile-value"><LocationBadge mode={(profile?.locationMode as any) || 'DEMO'} /></div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #233444', paddingTop: 14, marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 8 }}>Location Privacy Controls (Section 36)</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-small" onClick={() => setLocationMode('ALLOWED', 'LIVE')} data-testid="button-profile-gps">
                <LocateFixed size={12} /> Use GPS
              </button>
              <button className="btn btn-small" onClick={() => setLocationMode('ALLOWED', 'MANUAL')} data-testid="button-profile-manual">
                Enter Manually
              </button>
              <button className="btn btn-small btn-subtle" onClick={() => setLocationMode('DENIED', 'MANUAL')} data-testid="button-profile-stop-loc">
                Stop Location Sharing
              </button>
            </div>
          </div>

          {notice && <div className="toast-inline" data-testid="status-profile-update">{notice}</div>}
        </section>

        {/* Section 2: Own Emergency History Only */}
        <section className="panel profile-card">
          <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 10 }}>
            <h2>My Emergency History</h2>
            <span className="eyebrow">{profile?.emergencies.length ?? 0} Requests</span>
          </div>
          {!profile?.emergencies.length ? (
            <div className="empty-state">No past emergency calls.</div>
          ) : (
            profile.emergencies.map(e => (
              <div className="route-row" key={e.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div>
                  <div className="route-title">E-{String(e.id).padStart(3, '0')} · {e.emergencyType}</div>
                  <div className="route-meta">{e.locationLabel} · {asTime(e.createdAt)}</div>
                </div>
                <span className="pill green">{statusLabel(e.status)}</span>
              </div>
            ))
          )}
        </section>
      </main>
      <MobileNav active="user" role="USER" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// Driver Profile Screen (Section 34, 36)
// -------------------------------------------------------------
function DriverProfileView() {
  const [profile, setProfile] = useState<DriverProfileData | null>(null);
  const [notice, setNotice] = useState('');

  const load = () => {
    securityApi.getDriverProfile()
      .then(setProfile)
      .catch(e => setNotice(`Failed to load driver profile: ${e.message}`));
  };

  useEffect(() => { load(); }, []);

  const toggleAvailability = async () => {
    if (!profile) return;
    try {
      await securityApi.updateDriverAvailability(!profile.isOnline);
      setNotice(`Unit availability set to ${!profile.isOnline ? 'ONLINE' : 'OFFLINE'}.`);
      load();
    } catch (e: any) {
      setNotice(`Failed to update status: ${e.message}`);
    }
  };

  return (
    <SiteFrame>
      <main className="mobile-wrap">
        <div className="mobile-top">
          <div>
            <Brand />
            <div className="eyebrow" style={{ marginTop: 7 }}>CREW PROFILE & TELEMETRY</div>
          </div>
          <span className={`pill ${profile?.isOnline ? 'green' : ''}`}>
            {profile?.isOnline ? '● ONLINE' : '○ OFFLINE'}
          </span>
        </div>

        <section className="panel profile-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#132838', display: 'grid', placeItems: 'center', color: '#60baff' }}>
              <Navigation size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>{profile?.driverName}</h2>
              <div className="muted" style={{ fontSize: 11 }}>Driver ID: #{profile?.driverId} · {profile?.email}</div>
            </div>
          </div>

          <div className="profile-grid">
            <div className="profile-item">
              <div className="profile-label">Assigned Vehicle</div>
              <div className="profile-value" style={{ color: '#42d9a8' }}>
                {profile?.assignedAmbulance?.callSign || 'AMB-01'}
              </div>
            </div>
            <div className="profile-item">
              <div className="profile-label">Registration</div>
              <div className="profile-value">
                {profile?.assignedAmbulance?.vehicleNumber || 'AP 03 TX 1088'}
              </div>
            </div>
            <div className="profile-item">
              <div className="profile-label">Corridor Telemetry</div>
              <div className="profile-value">
                {profile?.assignedAmbulance?.latitude.toFixed(4)}, {profile?.assignedAmbulance?.longitude.toFixed(4)}
              </div>
            </div>
            <div className="profile-item">
              <div className="profile-label">Equipment Suite</div>
              <div className="profile-value" style={{ fontSize: 11 }}>
                {profile?.assignedAmbulance?.equipment.join(', ') || 'ALS / Oxygen'}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid #233444', paddingTop: 14, marginTop: 14 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Crew Operational Status (Section 36)</div>
            <p className="muted" style={{ fontSize: 10, margin: '0 0 10px' }}>
              Location tracking is required while you are online so LIFELINK can dispatch assignments in Tirupati.
            </p>
            <button className={`btn btn-small ${profile?.isOnline ? 'btn-danger' : 'btn-primary'}`} onClick={toggleAvailability} data-testid="button-driver-toggle-online">
              {profile?.isOnline ? 'Go Offline' : 'Go Online'}
            </button>
          </div>

          {notice && <div className="toast-inline" data-testid="status-driver-profile-msg">{notice}</div>}
        </section>

        {/* Assigned Emergency History Only */}
        <section className="panel profile-card">
          <div className="panel-head" style={{ padding: 0, border: 0, marginBottom: 10 }}>
            <h2>Crew Assigned Missions</h2>
            <span className="eyebrow">{profile?.assignedEmergencies.length ?? 0} Missions</span>
          </div>
          {!profile?.assignedEmergencies.length ? (
            <div className="empty-state">No missions currently recorded for this crew.</div>
          ) : (
            profile.assignedEmergencies.map(e => (
              <div className="route-row" key={e.id} style={{ paddingLeft: 0, paddingRight: 0 }}>
                <div>
                  <div className="route-title">E-{String(e.id).padStart(3, '0')} · {e.emergencyType}</div>
                  <div className="route-meta">{e.patientName} · {e.locationLabel}</div>
                </div>
                <span className="pill green">{statusLabel(e.status)}</span>
              </div>
            ))
          )}
        </section>
      </main>
      <MobileNav active="driver" role="DRIVER" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// Operator Profile Screen (Section 35)
// -------------------------------------------------------------
function OperatorProfileView() {
  const [profile, setProfile] = useState<OperatorProfileData | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    securityApi.getOperatorProfile()
      .then(setProfile)
      .catch(e => setNotice(`Failed to load operator profile: ${e.message}`));
  }, []);

  return (
    <SiteFrame>
      <main className="mobile-wrap">
        <div className="mobile-top">
          <div>
            <Brand />
            <div className="eyebrow" style={{ marginTop: 7 }}>OPERATOR COMMAND PROFILE</div>
          </div>
          <RoleBadge role="OPERATOR" />
        </div>

        <section className="panel profile-card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#132838', display: 'grid', placeItems: 'center', color: '#eeb866' }}>
              <Radio size={22} />
            </div>
            <div>
              <h2 style={{ margin: 0, fontSize: 17 }}>{profile?.name}</h2>
              <div className="muted" style={{ fontSize: 11 }}>Operator ID: #{profile?.id} · {profile?.email}</div>
            </div>
          </div>

          <div className="profile-grid">
            <div className="profile-item">
              <div className="profile-label">Shift Status</div>
              <div className="profile-value" style={{ color: '#42d9a8' }}>{profile?.shiftStatus}</div>
            </div>
            <div className="profile-item">
              <div className="profile-label">Station Role</div>
              <div className="profile-value"><RoleBadge role="OPERATOR" /></div>
            </div>
            <div className="profile-item" style={{ gridColumn: '1 / -1' }}>
              <div className="profile-label">Data Minimization Active</div>
              <div className="muted" style={{ fontSize: 10, marginTop: 3 }}>
                Passphrase hashes, unassigned patient files, and private user credentials are withheld from operator terminal.
              </div>
            </div>
          </div>

          {notice && <div className="toast-inline">{notice}</div>}
        </section>
      </main>
      <MobileNav active="command" role="OPERATOR" />
    </SiteFrame>
  );
}

// -------------------------------------------------------------
// Router & App
// -------------------------------------------------------------
function NotFound() {
  return (
    <SiteFrame>
      <main className="content">
        <section className="panel" style={{ padding: 30, textAlign: 'center', maxWidth: 500, margin: '60px auto' }}>
          <div className="eyebrow">404 NOT FOUND</div>
          <h1>That route is off the emergency grid.</h1>
          <Link className="btn btn-primary" href="/login" data-testid="link-return-login">
            Return to LIFELINK
          </Link>
        </section>
      </main>
    </SiteFrame>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login"><FormPage register={false} /></Route>
      <Route path="/register"><FormPage register /></Route>
      <Route path="/user">
        <RoleGuard allowedRoles={['USER', 'ADMIN']}><PatientView /></RoleGuard>
      </Route>
      <Route path="/user/profile">
        <RoleGuard allowedRoles={['USER', 'ADMIN']}><UserProfileView /></RoleGuard>
      </Route>
      <Route path="/driver">
        <RoleGuard allowedRoles={['DRIVER', 'ADMIN']}><DriverView /></RoleGuard>
      </Route>
      <Route path="/driver/profile">
        <RoleGuard allowedRoles={['DRIVER', 'ADMIN']}><DriverProfileView /></RoleGuard>
      </Route>
      <Route path="/command-center">
        <RoleGuard allowedRoles={['OPERATOR', 'ADMIN']}><CommandCenter /></RoleGuard>
      </Route>
      <Route path="/operator/profile">
        <RoleGuard allowedRoles={['OPERATOR', 'ADMIN']}><OperatorProfileView /></RoleGuard>
      </Route>
      <Route path="/admin">
        <RoleGuard allowedRoles={['ADMIN']}><AdminView /></RoleGuard>
      </Route>
      <Route path="/"><FormPage register={false} /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
