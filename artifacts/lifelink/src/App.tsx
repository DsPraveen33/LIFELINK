import { useEffect, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Route, Switch, Link, useLocation, Router as WouterRouter } from 'wouter';
import { io } from 'socket.io-client';
import 'leaflet/dist/leaflet.css';
import { ResponseMap } from '@/components/response-map';
import {
  Activity, Ambulance as AmbulanceIcon, ArrowDownRight, ArrowUpRight, Check, ChevronRight,
  Clock3, Crosshair, HeartPulse, Hospital as HospitalIcon, LocateFixed, LogOut, MapPin,
  Navigation, Plus, Radio, RotateCcw, ShieldAlert, Siren, Signal, Stethoscope, UserRound,
  Waves, Zap,
} from 'lucide-react';
import type { AccountUser, Ambulance, Emergency, Hospital, RouteOption, SimulationActionInputAction } from '@workspace/api-client-react';
import {
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

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 4000, refetchOnWindowFocus: true, retry: 1 } },
});

const destinations: Record<string, string> = { USER: '/user', DRIVER: '/driver', OPERATOR: '/command-center' };
const statusLabel = (s?: string | null) => (s || 'PENDING').replaceAll('_', ' ');
const asTime = (value?: string) => value ? new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const wait = (x?: number | null) => x == null ? 'Awaiting dispatch' : `${x} min`;

function useLiveRefresh() {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') {
        void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() });
        void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() });
        void client.invalidateQueries({ queryKey: getListAmbulancesQueryKey() });
        void client.invalidateQueries({ queryKey: getListHospitalsQueryKey() });
      }
    };
    const socket = io({ path: '/api/socket.io', reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 800, reconnectionDelayMax: 5000, timeout: 5000 });
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

function Brand() {
  return <Link href="/login" className="brand" data-testid="link-lifelink-home"><span className="brand-mark"><Activity size={25} strokeWidth={2.8} /></span><span>LIFE<strong>LINK</strong><small className="brand-sub">Every second matters</small></span></Link>;
}

function Topbar({ path, user, connected }: { path: string; user?: AccountUser; connected: boolean }) {
  const logout = useLogoutUser();
  const client = useQueryClient();
  const [, setLocation] = useLocation();
  const exit = () => logout.mutate(undefined, { onSuccess: () => { client.clear(); setLocation('/login'); } });
  const links = [['/user', 'Patient'], ['/driver', 'Crew'], ['/command-center', 'Command']];
  return <header className="topbar">
    <Brand />
    <nav className="navlinks" aria-label="Role views">{links.map(([href, label]) => <Link key={href} href={href} className={path === href ? 'active' : ''} data-testid={`link-role-${label.toLowerCase()}`}>{label}</Link>)}</nav>
    <div className="toolbar"><span className={`pill ${connected ? 'green' : ''}`} data-testid="status-socket-connection"><span style={{ color: connected ? '#2de0a5' : '#e5b868' }}>●</span> {connected ? 'LIVE' : 'POLLING'}</span><span className="sim-label">Simulation data</span>{user ? <button onClick={exit} className="btn btn-small btn-subtle" data-testid="button-logout"><LogOut size={13} /> Sign out</button> : <Link href="/login" className="btn btn-small" data-testid="link-sign-in">Sign in</Link>}</div>
  </header>;
}

function SiteFrame({ children }: { children: React.ReactNode }) {
  const [path] = useLocation();
  const { data: user } = useGetCurrentUser({ query: { queryKey: getGetCurrentUserQueryKey(), retry: false, refetchOnWindowFocus: true } });
  const connected = useLiveRefresh();
  return <div className="app-shell"><Topbar path={path} user={user} connected={connected} />{children}</div>;
}

function FormPage({ register }: { register: boolean }) {
  const [, setLocation] = useLocation();
  const login = useLoginUser();
  const demoLogin = useDemoLogin();
  const registration = useRegisterUser();
  const [role, setRole] = useState<'USER' | 'DRIVER'>('USER');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const complete = (u: AccountUser) => {
    void queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
    setLocation(destinations[u.role] || '/user');
  };
  const handleDemoAccess = () => {
    setError('');
    setBusy(true);
    demoLogin.mutate(undefined, {
      onSuccess: complete,
      onError: (e) => setError(e instanceof Error ? e.message : 'Demo operator access is unavailable.'),
      onSettled: () => setBusy(false),
    });
  };
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('');
    const form = new FormData(e.currentTarget);
    const email = String(form.get('email') || '');
    const password = String(form.get('password') || '');
    if (!email || !password) { setError('Enter your email and password to continue.'); return; }
    setBusy(true);
    if (register) {
      const name = String(form.get('name') || '');
      if (!name.trim()) { setBusy(false); setError('Add your name to create an account.'); return; }
      registration.mutate({ data: { name, email, password, role, phone: String(form.get('phone') || '') || null } }, {
        onSuccess: complete, onError: (e) => setError(e instanceof Error ? e.message : 'Registration could not be completed.'), onSettled: () => setBusy(false),
      });
    } else {
      login.mutate({ data: { email, password } }, {
        onSuccess: complete, onError: (e) => setError(e instanceof Error ? e.message : 'Sign in failed. Check your details and try again.'), onSettled: () => setBusy(false),
      });
    }
  };
  return <main className="auth-page">
    <section className="auth-art"><Brand /><div><div className="eyebrow">One response network · City simulation</div><h1>When seconds matter,<br /><em>everyone moves.</em></h1><p>One connected response across the person calling for help, the crew on the road, and the operators bringing care together.</p></div><div className="eyebrow">LIFELINK RESPONSE SYSTEM / PROTOTYPE 01</div></section>
    <section className="auth-form-wrap"><form className="auth-form" onSubmit={handleSubmit}>
      <span className="eyebrow">{register ? 'Create access' : 'Secure access'}</span><h2>{register ? 'Join the response.' : 'Welcome back.'}</h2><p>{register ? 'Choose the role you use in the response network.' : 'Sign in to open your LIFELINK workspace.'}</p>
      {register && <><label className="field-label" htmlFor="name">Full name</label><input id="name" name="name" className="input" autoComplete="name" data-testid="input-name" placeholder="Your name" required />
        <label className="field-label" htmlFor="phone">Phone <span className="muted">optional</span></label><input id="phone" name="phone" className="input" autoComplete="tel" data-testid="input-phone" placeholder="+1 555 014 1100" /></>}
      <label className="field-label" htmlFor="email">Email address</label><input id="email" name="email" className="input" type="email" autoComplete="email" data-testid="input-email" placeholder="you@lifelink.org" required />
      <label className="field-label" htmlFor="password">Password</label><input id="password" name="password" className="input" type="password" autoComplete={register ? 'new-password' : 'current-password'} data-testid="input-password" placeholder="At least 8 characters" required />
      {register && <><label className="field-label" htmlFor="role">Access role</label><select id="role" className="input" value={role} onChange={e => setRole(e.target.value as typeof role)} data-testid="select-role"><option value="USER">Patient / caller</option><option value="DRIVER">Ambulance crew</option></select></>}
      {error && <div className="form-error" role="alert" data-testid="status-auth-error">{error}</div>}
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 18, minHeight: 45 }} disabled={busy} data-testid="button-auth-submit">{busy ? 'Connecting…' : register ? 'Create account' : 'Sign in'} <ChevronRight size={15} /></button>
      {!register && import.meta.env.DEV && <button type="button" className="btn" style={{ width: '100%', marginTop: 9, minHeight: 40 }} disabled={busy} onClick={handleDemoAccess} data-testid="button-demo-operator">Enter local operator demo</button>}
      <div className="muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 18 }} data-testid="text-auth-switch">{register ? 'Already have access? ' : 'New to LIFELINK? '}<Link href={register ? '/login' : '/register'} style={{ color: '#4fdeb1', textDecoration: 'none' }} data-testid="link-auth-switch">{register ? 'Sign in' : 'Create an account'}</Link></div>
      <div className="sim-label" style={{ display: 'block', marginTop: 26, textAlign: 'center' }}>Prototype environment · All incident content is simulated</div>
    </form></section>
  </main>;
}

function MiniMap({ className = '', emergency, hospital, ambulances = [], hospitals = [], route, mode = 'patient' }: { className?: string; emergency?: Emergency; hospital?: Hospital; ambulances?: Ambulance[]; hospitals?: Hospital[]; route?: number[][]; mode?: 'patient'|'command' }) {
  return <ResponseMap className={className} emergency={emergency} selectedHospital={hospital} ambulances={ambulances} hospitals={hospitals} route={route} mode={mode} />;
}

function MobileNav({ active }: { active: 'user' | 'driver' | 'command' }) {
  return <nav className="bottom-nav"><Link href="/user" className={active === 'user' ? 'active' : ''} data-testid="bottomnav-patient"><HeartPulse size={17} />Response</Link><Link href="/driver" className={active === 'driver' ? 'active' : ''} data-testid="bottomnav-crew"><Navigation size={17} />Crew</Link><Link href="/command-center" className={active === 'command' ? 'active' : ''} data-testid="bottomnav-command"><Radio size={17} />Dispatch</Link></nav>;
}

function PatientView() {
  const client = useQueryClient();
  const [patientName, setPatientName] = useState('');
  const [need, setNeed] = useState('Medical');
  const [location, setLocation] = useState('MG Road, Central City');
  const [lat, setLat] = useState('12.9716');
  const [lng, setLng] = useState('77.5946');
  const create = useCreateEmergency();
  const list = useListEmergencies({ query: { queryKey: getListEmergenciesQueryKey(), refetchInterval: 7000, refetchOnWindowFocus: true } });
  const emergencies = list.data || [];
  const ambulanceList = useListAmbulances({ query: { queryKey: getListAmbulancesQueryKey(), refetchInterval: 7000 } });
  const current = emergencies.find(e => !['COMPLETED', 'CANCELLED'].includes(e.status));
  const detail = useGetEmergency(current?.id ?? 0, { query: { queryKey: getGetEmergencyQueryKey(current?.id ?? 0), enabled: !!current?.id, refetchInterval: 5000 } });
  const decision = useGetEmergencyDecision(current?.id ?? 0, { query: { queryKey: getGetEmergencyDecisionQueryKey(current?.id ?? 0), enabled: !!current?.id, refetchInterval: 8000 } });
  const hospital = useListHospitals({ query: { queryKey: getListHospitalsQueryKey(), refetchInterval: 12000 } });
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey(), refetchInterval: 20000, retry: 1 } });
  const active = detail.data || current;
  const recommendedHospital = hospital.data?.find(h => h.id === active?.selectedHospitalId) || (decision.data?.selectedHospitalId ? hospital.data?.find(h => h.id === decision.data?.selectedHospitalId) : undefined);
  const submitSOS = () => {
    const name = patientName.trim() || 'Guest caller';
    create.mutate({ data: { patientName: name, emergencyType: need, severity: need === 'Cardiac' ? 'CRITICAL' : 'HIGH', latitude: Number(lat), longitude: Number(lng), locationLabel: location, requiredCapabilities: need === 'Cardiac' ? ['CARDIAC', 'ALS'] : [need.toUpperCase()] } }, {
      onSuccess: (e) => { client.setQueryData(getGetEmergencyQueryKey(e.id), e); void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() }); void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() }); },
    });
  };
  return <SiteFrame><main className="mobile-wrap">
    <div className="mobile-top"><div><Brand /><div className="eyebrow" style={{ marginTop: 7 }}>PATIENT RESPONSE</div></div><span className="sim-label">SIM DATA</span></div>
    {!active ? <section className="panel mobile-card">
      <span className="eyebrow">Emergency request</span><h1 style={{ fontSize: 21, margin: '6px 0 3px' }}>Get the right help moving.</h1><p className="muted" style={{ fontSize: 11, margin: '0 0 14px' }}>Share what is happening. Dispatch can see your location and needs.</p>
      <label className="field-label" htmlFor="patient-name">Your name</label><input id="patient-name" className="input" value={patientName} onChange={e => setPatientName(e.target.value)} placeholder="Name for responders" data-testid="input-patient-name" />
      <label className="field-label">What kind of help?</label><div className="need-grid">{['Medical', 'Cardiac', 'Road accident', 'Breathing', 'Burn', 'Other'].map(n => <button className={`need-choice ${need === n ? 'selected' : ''}`} key={n} onClick={() => setNeed(n)} data-testid={`button-need-${n.toLowerCase().replaceAll(' ', '-')}`}>{n}</button>)}</div>
      <label className="field-label" htmlFor="patient-location">Current location</label><input id="patient-location" className="input" value={location} onChange={e => setLocation(e.target.value)} data-testid="input-patient-location" />
      <details style={{ marginTop: 8 }}><summary className="eyebrow" style={{ cursor: 'pointer', padding: '7px 0' }}>Adjust simulated coordinates</summary><div style={{ display: 'flex', gap: 8 }}><input className="input" aria-label="Latitude" value={lat} onChange={e => setLat(e.target.value)} data-testid="input-latitude" /><input className="input" aria-label="Longitude" value={lng} onChange={e => setLng(e.target.value)} data-testid="input-longitude" /></div></details>
      <button className="mobile-sos" style={{ marginTop: 16 }} onClick={submitSOS} disabled={create.isPending || !location.trim()} data-testid="button-send-sos"><Siren size={18} style={{ verticalAlign: 'middle', marginRight: 8 }} />{create.isPending ? 'SENDING REQUEST…' : 'SEND EMERGENCY REQUEST'}</button>
      {create.isError && <div className="form-error" data-testid="status-sos-error">Unable to send request. Please retry.</div>}
      <div className="eyebrow" style={{ marginTop: 12 }}>Demo data is simulated · no emergency services are contacted</div>
    </section> : <section className="panel mobile-card" data-testid={`card-active-emergency-${active.id}`}>
      <div className="status-line"><span className="pulse" /><span>Response underway</span><span className="pill green" style={{ marginLeft: 'auto' }}>{statusLabel(active.status)}</span></div>
      <h1 style={{ fontSize: 20, margin: '15px 0 5px' }}>{active.emergencyType} response</h1><div className="muted" style={{ fontSize: 11 }} data-testid={`text-emergency-location-${active.id}`}><MapPin size={13} style={{ verticalAlign: 'middle' }} /> {active.locationLabel}</div>
      <div className="timeline"><div className={`timeline-step ${['DISPATCHED','ACCEPTED','EN_ROUTE','ON_SCENE','TRANSPORTING'].includes(active.status)?'done':''}`}>Dispatched</div><div className={`timeline-step ${['ACCEPTED','EN_ROUTE','ON_SCENE','TRANSPORTING'].includes(active.status)?'done':''}`}>Crew en route</div><div className={`timeline-step ${['ON_SCENE','TRANSPORTING'].includes(active.status)?'done':''}`}>On scene</div><div className={`timeline-step ${active.status==='TRANSPORTING'?'done':''}`}>Hospital</div></div>
      <MiniMap className="tracking-map" emergency={active} hospital={recommendedHospital} ambulances={ambulanceList.data || []} hospitals={hospital.data || []} route={decision.data?.selectedRoute.points} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}><div><span className="eyebrow">Assigned unit</span><div style={{ fontSize: 13, fontWeight: 800, marginTop: 5 }}>AMB-{String(active.assignedAmbulanceId || '02').padStart(2, '0')}</div></div><div><span className="eyebrow">Estimated arrival</span><div style={{ fontSize: 13, fontWeight: 800, marginTop: 5 }} data-testid="text-patient-eta">{wait(active.etaMinutes)}</div></div></div>
      {recommendedHospital && <div style={{ borderTop: '1px solid #263644', marginTop: 14, paddingTop: 12 }}><div className="eyebrow">Receiving hospital</div><strong style={{ display: 'block', fontSize: 12, marginTop: 4 }} data-testid="text-patient-hospital">{recommendedHospital.name}</strong><span className="muted" style={{ fontSize: 10 }}>{recommendedHospital.address} · {recommendedHospital.waitMinutes} min current wait</span></div>}
      {decision.data && <div className="toast-inline" data-testid="text-patient-route-reason">{decision.data.reasons[0] || `Recommended route · ${decision.data.confidence}% confidence`}</div>}
    </section>}
    <section className="panel mobile-card"><div className="panel-head" style={{ padding: 0, border: 0 }}><h2><HospitalIcon size={15} style={{ verticalAlign: 'middle', marginRight: 7 }} />Nearby receiving hospitals</h2><span className="eyebrow">{hospital.data?.length ?? '—'} units</span></div>
      {hospital.isLoading ? <div className="loading-bar" style={{ marginTop: 14 }} /> : !hospital.data?.length ? <div className="empty-state">Hospital readiness is temporarily unavailable.</div> : hospital.data.slice(0, 3).map(h => <div className="hospital-row" key={h.id} data-testid={`row-hospital-${h.id}`}><div><div className="route-title">{h.name}</div><div className="route-meta">{h.waitMinutes} min wait · {h.traumaBeds} trauma beds</div></div><span className={`pill ${h.readinessStatus === 'READY' ? 'green' : ''}`}>{h.readinessStatus}</span></div>)}
    </section>
    <div className="eyebrow" data-testid="status-service-health">Network {health.data?.status || (health.isError ? 'connection uncertain' : 'checking')} · refreshed automatically</div>
  </main><MobileNav active="user" /></SiteFrame>;
}

function DriverView() {
  const client = useQueryClient();
  const ambulances = useListAmbulances({ query: { queryKey: getListAmbulancesQueryKey(), refetchInterval: 6000, refetchOnWindowFocus: true } });
  const emergencies = useListEmergencies({ query: { queryKey: getListEmergenciesQueryKey(), refetchInterval: 6000 } });
  const hospitals = useListHospitals({ query: { queryKey: getListHospitalsQueryKey(), refetchInterval: 14000 } });
  const accept = useAcceptEmergency(); const decline = useDeclineEmergency(); const status = useUpdateAmbulanceStatus();
  const locationUpdate = useUpdateAmbulanceLocation(); const arrived = useMarkArrivedAtScene(); const onboard = useMarkPatientOnboard(); const complete = useCompleteEmergency();
  const [notice, setNotice] = useState('');
  const ambulance = ambulances.data?.find(a => a.currentEmergencyId != null && a.status !== 'OFFLINE') || ambulances.data?.find(a => a.status !== 'OFFLINE');
  const emergency = emergencies.data?.find(e => e.id === ambulance?.currentEmergencyId) || emergencies.data?.find(e => e.status === 'NEW' || e.status === 'DISPATCHED');
  const routeDecision = useGetEmergencyDecision(emergency?.id ?? 0, { query: { queryKey: getGetEmergencyDecisionQueryKey(emergency?.id ?? 0), enabled: !!emergency?.id, refetchInterval: 10000 } });
  const hospital = hospitals.data?.find(h => h.id === emergency?.selectedHospitalId || h.id === ambulance?.destinationHospitalId);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: getListAmbulancesQueryKey() }); void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() }); void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() });
  };
  const act = (fn: (v: any, o?: any) => void, vars: any, text: string) => fn(vars, { onSuccess: () => { setNotice(text); refresh(); } });
  const acceptCall = () => ambulance && emergency && act(accept.mutate, { id: ambulance.id, data: { emergencyId: emergency.id } }, 'Dispatch accepted. Route and patient details are syncing.');
  const declineCall = () => ambulance && emergency && act(decline.mutate, { id: ambulance.id, data: { emergencyId: emergency.id } }, 'Dispatch declined. Operator has been notified.');
  const moveStatus = (s: 'EN_ROUTE'|'ON_SCENE'|'TRANSPORTING'|'AVAILABLE'|'OFFLINE') => ambulance && act(status.mutate, { id: ambulance.id, data: { status: s } }, `Unit status updated: ${statusLabel(s)}.`);
  const markAtScene = () => ambulance && emergency && act(arrived.mutate, { id: ambulance.id, data: { emergencyId: emergency.id } }, 'Arrival at scene recorded.');
  const markOnboard = () => ambulance && emergency && act(onboard.mutate, { id: ambulance.id, data: { emergencyId: emergency.id } }, 'Patient onboard. Transport status updated.');
  const completeCall = () => ambulance && emergency && act(complete.mutate, { id: ambulance.id, data: { emergencyId: emergency.id } }, 'Transport completed. Unit ready for next dispatch.');
  const sendLocation = () => ambulance && act(locationUpdate.mutate, { id: ambulance.id, data: { latitude: ambulance.latitude, longitude: ambulance.longitude, speedKph: 38, heading: 35 } }, 'Current simulated position sent.');
  return <SiteFrame><main className="mobile-wrap">
    <div className="mobile-top"><div><Brand /><div className="eyebrow" style={{ marginTop: 7 }}>AMBULANCE CREW</div></div><span className="pill green"><Signal size={11} /> ONLINE</span></div>
    {emergencies.isLoading || ambulances.isLoading ? <section className="panel mobile-card"><div className="loading-bar" /><div className="empty-state">Rehydrating dispatch assignments…</div></section> : emergency && !ambulance?.currentEmergencyId ? <section className="panel mobile-card" data-testid={`card-dispatch-${emergency.id}`}>
      <div className="eyebrow">Incoming dispatch · SIMULATED</div><h1 style={{ fontSize: 21, margin: '8px 0 5px' }}>{emergency.emergencyType}</h1><div className="muted" style={{ fontSize: 11 }}><MapPin size={13} style={{ verticalAlign: 'middle' }} /> {emergency.locationLabel}</div>
      <div style={{ display: 'flex', gap: 7, margin: '14px 0' }}><span className="pill red">{emergency.severity}</span>{emergency.requiredCapabilities.map(c => <span className="pill" key={c}>{c}</span>)}</div>
      <div style={{ display: 'flex', gap: 8 }}><button className="btn btn-primary" style={{ flex: 1 }} onClick={acceptCall} data-testid="button-accept-dispatch"><Check size={15} /> Accept call</button><button className="btn btn-danger" onClick={declineCall} data-testid="button-decline-dispatch">Decline</button></div>
    </section> : null}
    {emergency && ambulance?.currentEmergencyId ? <section className="panel mobile-card" data-testid={`card-active-assignment-${emergency.id}`}>
      <div className="status-line"><span className="pulse" /><span>{ambulance.callSign} · {statusLabel(ambulance.status)}</span><span className="pill green" style={{ marginLeft: 'auto' }}>{wait(ambulance.etaMinutes || emergency.etaMinutes)}</span></div>
      <h1 style={{ fontSize: 20, margin: '15px 0 5px' }}>{emergency.emergencyType}</h1><p className="muted" style={{ fontSize: 11, marginTop: 0 }}>{emergency.patientName} · {emergency.locationLabel}</p>
      <MiniMap className="tracking-map" emergency={emergency} hospital={hospital} ambulances={ambulance ? [ambulance] : []} hospitals={hospitals.data || []} route={routeDecision.data?.selectedRoute.points} />
      <div style={{ padding: '12px 0 2px' }}><div className="eyebrow">Route guidance</div><div style={{ fontSize: 12, marginTop: 5 }}>{hospital?.name || 'Destination assigned by dispatch'}</div><div className="route-meta">{hospital?.address || 'Follow recommended route'} · {hospital?.waitMinutes ?? '—'} min receiving wait</div></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}><button className="btn btn-primary" onClick={() => moveStatus('EN_ROUTE')} data-testid="button-start-navigation"><Navigation size={14} /> Start navigation</button><button className="btn" onClick={sendLocation} data-testid="button-send-location"><Crosshair size={14} /> Send position</button></div>
      {ambulance.status === 'EN_ROUTE' && <button className="btn btn-danger" style={{ width: '100%', marginTop: 8 }} onClick={markAtScene} data-testid="button-arrived-scene">Arrived at scene</button>}
      {ambulance.status === 'ON_SCENE' && <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={markOnboard} data-testid="button-patient-onboard">Patient onboard · begin transport</button>}
      {ambulance.status === 'TRANSPORTING' && <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={completeCall} data-testid="button-complete-emergency">Arrived at hospital · complete call</button>}
      {notice && <div className="toast-inline" data-testid="status-driver-update">{notice}</div>}
    </section> : !emergency && <section className="panel mobile-card" data-testid="empty-driver-dispatch"><div className="empty-state"><AmbulanceIcon size={26} style={{ color: '#08b986', marginBottom: 10 }} /><div className="route-title">No active dispatch</div><p>New calls appear here automatically. Your unit remains visible to city dispatch.</p><button className="btn btn-small" onClick={refresh} data-testid="button-refresh-dispatch"><RotateCcw size={12} /> Refresh dispatch</button></div></section>}
    <section className="panel mobile-card"><div className="panel-head" style={{ padding: 0, border: 0 }}><h2>Unit status</h2><span className="eyebrow">{ambulance?.callSign || 'UNIT UNASSIGNED'}</span></div>
      <div className="route-row" style={{ paddingLeft: 0, paddingRight: 0 }}><div><div className="route-title">{ambulance?.driverName || 'Crew profile'}</div><div className="route-meta">{ambulance?.vehicleNumber || 'Awaiting assigned vehicle'} · {ambulance?.equipment.join(' / ') || 'Equipment syncing'}</div></div><span className={`pill ${ambulance?.status === 'AVAILABLE' ? 'green' : ''}`}>{statusLabel(ambulance?.status)}</span></div>
      <div className="toolbar" style={{ marginTop: 10 }}><button className="btn btn-small" onClick={() => moveStatus('AVAILABLE')} data-testid="button-unit-available">Set available</button><button className="btn btn-small" onClick={() => moveStatus('OFFLINE')} data-testid="button-unit-offline">Go offline</button></div>
    </section>
    {ambulances.isError && <section className="panel mobile-card"><div className="form-error">Dispatch connection unavailable. Reconnect and refresh for current assignment.</div><button className="btn btn-small" onClick={refresh} data-testid="button-retry-ambulances">Retry connection</button></section>}
  </main><MobileNav active="driver" /></SiteFrame>;
}

function CommandCenter() {
  const client = useQueryClient();
  const summary = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey(), refetchInterval: 7000, refetchOnWindowFocus: true } });
  const emergencyQuery = useListEmergencies({ query: { queryKey: getListEmergenciesQueryKey(), refetchInterval: 6000, refetchOnWindowFocus: true } });
  const ambulanceQuery = useListAmbulances({ query: { queryKey: getListAmbulancesQueryKey(), refetchInterval: 6000 } });
  const hospitalQuery = useListHospitals({ query: { queryKey: getListHospitalsQueryKey(), refetchInterval: 11000 } });
  const eventsQuery = useListDashboardEvents({ query: { queryKey: getListDashboardEventsQueryKey(), refetchInterval: 5000 } });
  const create = useCreateEmergency(); const calculate = useCalculateRoutes(); const runAction = useRunSimulationAction();
  const fullDemo = useRunFullDemo(); const reset = useResetSimulation(); const hospitalUpdate = useUpdateHospitalStatus();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [notice, setNotice] = useState('');
  const emergencies = emergencyQuery.data || []; const ambulances = ambulanceQuery.data || []; const hospitals = hospitalQuery.data || [];
  const activeEmergencies = emergencies.filter(e => !['COMPLETED', 'CANCELLED'].includes(e.status));
  const selected = activeEmergencies.find(e => e.id === selectedId) || activeEmergencies[0];
  const decision = useGetEmergencyDecision(selected?.id ?? 0, { query: { queryKey: getGetEmergencyDecisionQueryKey(selected?.id ?? 0), enabled: !!selected?.id, refetchInterval: 9000 } });
  const load = () => { void client.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); void client.invalidateQueries({ queryKey: getListEmergenciesQueryKey() }); void client.invalidateQueries({ queryKey: getListAmbulancesQueryKey() }); void client.invalidateQueries({ queryKey: getListHospitalsQueryKey() }); void client.invalidateQueries({ queryKey: getListDashboardEventsQueryKey() }); };
  const refreshRoutes = () => selected && calculate.mutate({ data: { emergencyId: selected.id } }, { onSuccess: (result) => { setRoutes(Array.isArray(result) ? result as RouteOption[] : []); setNotice('Route analysis refreshed from live simulation.'); load(); } });
  const createDemoIncident = () => create.mutate({ data: { patientName: 'Simulation patient', emergencyType: 'Road traffic accident', severity: 'CRITICAL', latitude: 12.9716, longitude: 77.5946, locationLabel: 'MG Road, Central City', requiredCapabilities: ['TRAUMA', 'ALS'] } }, { onSuccess: e => { setSelectedId(e.id); setNotice(`Simulation incident #${e.id} created.`); load(); } });
  const simulation = (action: SimulationActionInputAction) => runAction.mutate({ data: { action, emergencyId: selected?.id ?? null } }, { onSuccess: result => { setNotice(result.message); load(); } });
  const fullRun = () => fullDemo.mutate(undefined, { onSuccess: result => { setNotice(result.message); load(); } });
  const resetDemo = () => reset.mutate(undefined, { onSuccess: result => { setNotice(result.message || 'Simulation reset to initial state.'); setSelectedId(null); setRoutes([]); load(); } });
  const toggleHospital = (hospital: Hospital) => hospitalUpdate.mutate({ id: hospital.id, data: { readinessStatus: hospital.readinessStatus === 'FULL' ? 'READY' : 'FULL', emergencyStatus: hospital.emergencyStatus === 'DIVERTING' ? 'ACCEPTING' : 'DIVERTING', traumaBeds: hospital.traumaBeds, icuBeds: hospital.icuBeds, ventilators: hospital.ventilators, waitMinutes: hospital.waitMinutes } }, { onSuccess: () => { setNotice(`${hospital.name} readiness changed.`); load(); } });
  const kpis = [
    ['Active incidents', summary.data?.activeEmergencies ?? activeEmergencies.length, 'City-wide open calls'],
    ['Units available', `${summary.data?.availableAmbulances ?? ambulances.filter(a => a.status === 'AVAILABLE').length}/${summary.data?.totalAmbulances ?? ambulances.length}`, 'Ready to respond'],
    ['Hospitals ready', `${summary.data?.readyHospitals ?? hospitals.filter(h => h.readinessStatus === 'READY').length}/${summary.data?.totalHospitals ?? hospitals.length}`, 'Receiving status'],
    ['Avg. response', summary.data ? `${summary.data.averageResponseMinutes} min` : '—', 'Simulation average'],
  ];
  const error = summary.isError || emergencyQuery.isError || ambulanceQuery.isError || hospitalQuery.isError;
  return <SiteFrame><main className="content">
    <div className="page-heading"><div><div className="eyebrow">CITY OPERATIONS / CENTRAL DISTRICT</div><h1>Emergency command center</h1><div className="muted" style={{ fontSize: 11, marginTop: 5 }} data-testid="text-command-live-status"><span style={{ color: '#12ca90' }}>●</span> Systems operational · Realtime data refreshes automatically</div></div><div className="toolbar"><span className="sim-label">All entries are simulation data</span><button className="btn btn-primary" onClick={createDemoIncident} disabled={create.isPending} data-testid="button-new-emergency"><Plus size={14} /> New incident</button></div></div>
    {error && <section className="panel" style={{ padding: 12, marginBottom: 12 }} data-testid="status-query-error"><span className="muted" style={{ fontSize: 11 }}>Live feed interrupted. Cached data remains visible; retrying automatically.</span><button className="btn btn-small" style={{ marginLeft: 10 }} onClick={load} data-testid="button-retry-live-feed">Retry feeds</button></section>}
    {(summary.isLoading || emergencyQuery.isLoading) && <div className="loading-bar" style={{ marginBottom: 12 }} />}
    <div className="stats-grid">{kpis.map(([label, value, caption], i) => <section className="panel stat" key={label} data-testid={`stat-${i}`}><div className="eyebrow">{label}</div><strong data-testid={`value-${i}`}>{value}</strong><small>{caption}</small></section>)}</div>
    <div className="command-grid">
      <section className="panel incident-panel"><div className="panel-head"><h2><Siren size={14} style={{ color: '#f25163', verticalAlign: 'middle', marginRight: 7 }} />Active emergencies</h2><span className="pill red">{activeEmergencies.length} OPEN</span></div>
        {emergencyQuery.isLoading ? <div className="loading-bar" /> : activeEmergencies.length === 0 ? <div className="empty-state">No active emergencies. Dispatch remains available.</div> : <div className="incident-list">{activeEmergencies.map(e => <button key={e.id} onClick={() => { setSelectedId(e.id); setRoutes([]); }} className={`incident ${selected?.id === e.id ? 'selected' : ''}`} data-testid={`button-select-incident-${e.id}`} style={{ color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
          <div className="incident-top"><span className="incident-title">E-{String(e.id).padStart(3, '0')} · {e.emergencyType}</span><span className={`severity ${e.severity === 'MEDIUM' || e.severity === 'LOW' ? 'medium' : ''}`}>{e.severity}</span></div><p>{e.patientName} · {e.locationLabel}</p><div className="incident-meta"><span>{statusLabel(e.status)}</span><span>{wait(e.etaMinutes)}</span></div>
        </button>)}</div>}
      </section>
      <section className="panel map-panel"><div className="panel-head"><h2><MapPin size={14} style={{ color: '#13c995', verticalAlign: 'middle', marginRight: 7 }} />Live city map</h2><span className="eyebrow">{activeEmergencies.length} incidents · {ambulances.length} units</span></div>
        <MiniMap className="command-map" emergency={selected} ambulances={ambulances} hospitals={hospitals} hospital={decision.data?.selectedHospitalId ? hospitals.find(h => h.id === decision.data?.selectedHospitalId) : undefined} route={decision.data?.selectedRoute.points} mode="command" />
      </section>
      <div className="right-stack">
        <section className="panel"><div className="panel-head"><h2><Zap size={14} style={{ color: '#f2bd5c', verticalAlign: 'middle', marginRight: 6 }} />Route reasoning</h2><button className="btn btn-small" disabled={!selected || calculate.isPending} onClick={refreshRoutes} data-testid="button-calculate-routes">{calculate.isPending ? 'Recalculating…' : 'Recalculate'}</button></div>
          {(routes.length ? routes : decision.data ? [decision.data.selectedRoute] : []).length ? (routes.length ? routes : [decision.data!.selectedRoute]).map(r => <div className="route-row" key={r.id} data-testid={`row-route-${r.id}`}><div><div className="route-title">{r.name} {r.status === 'RECOMMENDED' && <span className="pill green">SELECTED</span>}</div><div className="route-meta">{r.etaMinutes} min · {r.distanceKm} km · {r.trafficLevel} traffic · {r.riskLevel} risk</div><div className="route-meta">{r.reason}</div></div></div>) : <div className="empty-state">Select an incident to view its route decision.</div>}
          {decision.data && <div style={{ padding: '0 13px 12px' }}><div className="eyebrow">Decision confidence · {decision.data.confidence}%</div>{decision.data.warnings.map((w,i) => <div className="route-meta" key={i} style={{ color: '#e6b862' }}>{w}</div>)}</div>}
        </section>
        <section className="panel"><div className="panel-head"><h2><HospitalIcon size={14} style={{ color: '#26d3a1', verticalAlign: 'middle', marginRight: 6 }} />Hospital readiness</h2><span className="eyebrow">{hospitals.length} FACILITIES</span></div>
          {hospitalQuery.isLoading ? <div className="loading-bar" /> : hospitals.length === 0 ? <div className="empty-state">Hospital feed unavailable.</div> : hospitals.slice(0, 4).map(h => <div className="hospital-row" key={h.id} data-testid={`row-command-hospital-${h.id}`}><div><div className="route-title">{h.name}</div><div className="route-meta">{h.waitMinutes}m wait · Trauma {h.traumaBeds} · ICU {h.icuBeds}</div></div><button className={`pill ${h.readinessStatus === 'READY' ? 'green' : 'red'}`} onClick={() => toggleHospital(h)} data-testid={`button-toggle-hospital-${h.id}`}>{h.readinessStatus} · change</button></div>)}
        </section>
      </div>
    </div>
    <section className="panel" style={{ marginTop: 14 }}><div className="panel-head"><h2><Activity size={14} style={{ color: '#18c997', verticalAlign: 'middle', marginRight: 7 }} />Live event timeline</h2><span className="eyebrow">{eventsQuery.data?.length ?? 0} EVENTS · SIMULATED</span></div>
      {eventsQuery.isLoading ? <div className="loading-bar" /> : !eventsQuery.data?.length ? <div className="empty-state">No timeline events recorded yet.</div> : <div className="event-list">{eventsQuery.data.slice(0, 6).map(ev => <div className="event" key={ev.id} data-testid={`event-${ev.id}`}><span className="event-dot" /><p>{ev.message}</p><time>{asTime(ev.createdAt)}</time></div>)}</div>}
    </section>
    <section className="panel" style={{ marginTop: 14, padding: 14 }}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}><div><div className="eyebrow">Operator controls / safe simulation</div><div style={{ fontSize: 13, fontWeight: 800, marginTop: 5 }}>Change the city scenario</div><div className="muted" style={{ fontSize: 10, marginTop: 3 }}>Actions update shared dispatch state. No real services are contacted.</div></div>
      <div className="toolbar">{[['INJECT_TRAFFIC','Traffic'],['ACCIDENT_ON_ROUTE_A','Route incident'],['BLOCK_ROAD','Block road'],['HOSPITAL_B_FULL','Hospital B full'],['HOSPITAL_C_READY','Hospital C ready']].map(([action,label]) => <button className="btn btn-small" key={action} onClick={() => simulation(action as SimulationActionInputAction)} disabled={runAction.isPending} data-testid={`button-simulation-${action.toLowerCase()}`}>{label}</button>)}<button className="btn btn-small btn-primary" onClick={fullRun} disabled={fullDemo.isPending} data-testid="button-run-full-demo">{fullDemo.isPending ? 'Running…' : 'Run full demo'}</button><button className="btn btn-small btn-danger" onClick={resetDemo} disabled={reset.isPending} data-testid="button-reset-simulation"><RotateCcw size={12} /> Reset</button></div></div>
      {notice && <div className="toast-inline" data-testid="status-simulation-result">{notice}</div>}
      {runAction.isError || fullDemo.isError || reset.isError || hospitalUpdate.isError ? <div className="form-error" data-testid="status-simulation-error">The requested simulation change was not applied. Refresh and retry.</div> : null}
    </section>
    <div className="eyebrow" style={{ marginTop: 12 }}>Simulation mode · Coordinates, patients, units, hospitals and events are synthetic · Last feed update {asTime(summary.data?.updatedAt)}</div>
  </main><MobileNav active="command" /></SiteFrame>;
}

function NotFound() {
  return <SiteFrame><main className="content"><section className="panel" style={{ padding: 30, textAlign: 'center' }}><div className="eyebrow">RESPONSE ROUTE NOT FOUND</div><h1>That page is off the map.</h1><Link className="btn btn-primary" href="/login" data-testid="link-return-login">Return to LIFELINK</Link></section></main></SiteFrame>;
}

function Router() {
  return <Switch>
    <Route path="/login"><FormPage register={false} /></Route>
    <Route path="/register"><FormPage register /></Route>
    <Route path="/user"><PatientView /></Route>
    <Route path="/driver"><DriverView /></Route>
    <Route path="/command-center"><CommandCenter /></Route>
    <Route path="/"><FormPage register={false} /></Route>
    <Route component={NotFound} />
  </Switch>;
}

function App() {
  return <QueryClientProvider client={queryClient}><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter></QueryClientProvider>;
}

export default App;
