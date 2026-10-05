import { MapContainer, TileLayer, Marker, CircleMarker, Polyline, Popup, ZoomControl } from 'react-leaflet';
import { divIcon, type LatLngExpression } from 'leaflet';
import type { Ambulance, Emergency, Hospital } from '@workspace/api-client-react';
import { simulationConfig } from '@/simulation/config';

interface ResponseMapProps {
  className?: string;
  emergency?: Emergency;
  ambulances?: Ambulance[];
  hospitals?: Hospital[];
  selectedHospital?: Hospital;
  route?: number[][];
  mode?: 'patient' | 'command';
}

const iconFor = (kind: 'emergency' | 'ambulance' | 'hospital', label: string) => divIcon({
  className: `ll-map-marker ll-map-${kind}`,
  html: `<span class="ll-map-pin">${kind === 'emergency' ? '!' : kind === 'ambulance' ? 'A' : 'H'}</span><span class="ll-map-label">${label.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char)}</span>`,
  iconSize: [88, 28], iconAnchor: [11, 14],
});

export function ResponseMap({ className = '', emergency, ambulances = [], hospitals = [], selectedHospital, route, mode = 'command' }: ResponseMapProps) {
  const center: LatLngExpression = emergency ? [emergency.latitude, emergency.longitude] : [simulationConfig.centerLatitude, simulationConfig.centerLongitude];
  const relevantAmbulances = mode === 'patient' ? ambulances.slice(0, 1) : ambulances;
  const routePoints: LatLngExpression[] = route?.filter(p => p.length >= 2).map(p => Math.abs(p[0]) > 90 ? [p[1], p[0]] as LatLngExpression : [p[0], p[1]] as LatLngExpression) || [];
  if (emergency && !routePoints.length) routePoints.push([emergency.latitude, emergency.longitude]);
  return <div className={`response-map ${className}`} data-testid="map-live-response">
    <MapContainer center={center} zoom={mode === 'patient' ? 14 : 12} zoomControl={false} scrollWheelZoom={false} className="leaflet-surface">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ZoomControl position="topright" />
      {emergency && <Marker position={[emergency.latitude, emergency.longitude]} icon={iconFor('emergency', `E-${String(emergency.id).padStart(3, '0')}`)}><Popup><strong>Simulation incident</strong><br />{emergency.emergencyType}<br />{emergency.locationLabel}</Popup></Marker>}
      {relevantAmbulances.map(a => <Marker key={`amb-${a.id}`} position={[a.latitude, a.longitude]} icon={iconFor('ambulance', a.callSign)}><Popup><strong>{a.callSign}</strong><br />{a.driverName} · {a.status.replaceAll('_', ' ')}</Popup></Marker>)}
      {hospitals.map(h => <CircleMarker key={`hospital-${h.id}`} center={[h.latitude, h.longitude]} radius={selectedHospital?.id === h.id ? 8 : 6} pathOptions={{ color: selectedHospital?.id === h.id ? '#35e0ae' : '#65b6d4', fillColor: '#102a38', fillOpacity: .95, weight: 2 }}><Popup><strong>{h.name}</strong><br />{h.readinessStatus} · {h.waitMinutes} min wait</Popup></CircleMarker>)}
      {selectedHospital && <Marker position={[selectedHospital.latitude, selectedHospital.longitude]} icon={iconFor('hospital', 'DESTINATION')}><Popup>{selectedHospital.name}</Popup></Marker>}
      {routePoints.length > 1 && <Polyline positions={routePoints} pathOptions={{ color: '#09d69b', weight: 4, opacity: .9, dashArray: '8 7' }} />}
    </MapContainer>
    <div className="map-data-stamp">OPENSTREETMAP · SIMULATED RESPONSE DATA</div>
  </div>;
}
