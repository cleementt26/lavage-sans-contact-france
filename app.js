/* global L */
const FRANCE_CENTER = [46.603354, 1.888334];
const map = L.map('map', { zoomControl: false }).setView(FRANCE_CENTER, 6);
L.control.zoom({ position: 'bottomright' }).addTo(map);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const state = {
  stations: [], visibleStations: [], markers: new Map(),
  userPosition: null, userMarker: null, route: null, routeLine: null
};

const $ = (selector) => document.querySelector(selector);
const stationList = $('#stationList');
const count = $('#stationCount');
const routeFilter = $('#routeFilter');
const distanceRange = $('#distanceRange');
const routeSummary = $('#routeSummary');
const statusBox = $('#mapStatus');

const markerIcon = L.divIcon({ className: '', html: '<div class="station-marker"></div>', iconSize: [34, 34], iconAnchor: [10, 32], popupAnchor: [7, -29] });
const userIcon = L.divIcon({ className: '', html: '<div class="user-marker"></div>', iconSize: [17, 17], iconAnchor: [8, 8] });

function showStatus(message, duration = 2200) {
  statusBox.textContent = message;
  statusBox.classList.add('visible');
  clearTimeout(showStatus.timer);
  if (duration) showStatus.timer = setTimeout(() => statusBox.classList.remove('visible'), duration);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLon = (b[1] - a[1]) * rad;
  const lat1 = a[0] * rad;
  const lat2 = b[0] * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// Distance station-segment en projection équirectangulaire locale, suffisante à l'échelle d'un corridor routier.
function pointSegmentDistanceKm(point, start, end) {
  const lat0 = point[0] * Math.PI / 180;
  const project = ([lat, lon]) => [lon * 111.32 * Math.cos(lat0), lat * 110.574];
  const p = project(point), a = project(start), b = project(end);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  if (!length2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function distanceToRoute(station, route) {
  const point = [station.latitude, station.longitude];
  let best = Infinity;
  for (let i = 1; i < route.length; i += 1) best = Math.min(best, pointSegmentDistanceKm(point, route[i - 1], route[i]));
  return best;
}

function distanceLabel(km) {
  if (!Number.isFinite(km)) return '';
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}

function stationDistance(station) {
  if (state.route && routeFilter.checked) return distanceToRoute(station, state.route);
  if (state.userPosition) return haversine(state.userPosition, [station.latitude, station.longitude]);
  return Infinity;
}

function popupHtml(station) {
  const km = stationDistance(station);
  const meta = Number.isFinite(km) ? `<strong>${routeFilter.checked ? 'À ' : ''}${distanceLabel(km)}${routeFilter.checked ? ' du trajet' : ''}</strong>` : '<strong>100 % sans contact</strong>';
  const osmUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=;${station.latitude},${station.longitude}`;
  return `<span class="popup-tag">Robot haute pression</span><h3 class="popup-title">${escapeHtml(station.nom)}</h3><p class="popup-address">${escapeHtml(station.adresse)}</p><div class="popup-meta">${meta}<a href="${osmUrl}" target="_blank" rel="noopener">Y aller →</a></div>`;
}

function renderStations() {
  const maxDistance = Number(distanceRange.value);
  let stations = state.stations.map((station) => ({ ...station, distance: stationDistance(station) }));
  if (state.route && routeFilter.checked) stations = stations.filter((station) => station.distance <= maxDistance);
  if (state.userPosition || (state.route && routeFilter.checked)) stations.sort((a, b) => a.distance - b.distance);
  else stations.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
  state.visibleStations = stations;

  for (const [id, marker] of state.markers) {
    const visible = stations.some((station) => station.id === id);
    if (visible && !map.hasLayer(marker)) marker.addTo(map);
    if (!visible && map.hasLayer(marker)) marker.removeFrom(map);
  }

  count.textContent = stations.length;
  $('#mobileCount').textContent = `${stations.length} station${stations.length > 1 ? 's' : ''}`;
  stationList.innerHTML = stations.length ? stations.map((station) => `
    <button class="station-item" type="button" data-id="${station.id}">
      <span class="station-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h16M6 17l1-7h10l1 7M8 10l1-3h6l1 3M7 14h.01M17 14h.01"/></svg></span>
      <span class="station-copy"><strong>${escapeHtml(station.nom)}</strong><small>${escapeHtml(station.adresse)}</small></span>
      <span class="station-distance">${Number.isFinite(station.distance) ? distanceLabel(station.distance) : ''}</span>
    </button>`).join('') : '<div class="empty-state">Aucune station dans ce corridor.<br>Élargissez la distance maximale.</div>';

  stationList.querySelectorAll('.station-item').forEach((item) => item.addEventListener('click', () => focusStation(Number(item.dataset.id))));
}

function focusStation(id) {
  const station = state.stations.find((item) => item.id === id);
  const marker = state.markers.get(id);
  if (!station || !marker) return;
  document.querySelectorAll('.station-item').forEach((item) => item.classList.toggle('active', Number(item.dataset.id) === id));
  map.flyTo([station.latitude, station.longitude], Math.max(map.getZoom(), 14), { duration: .8 });
  marker.setPopupContent(popupHtml(station)).openPopup();
  if (window.innerWidth <= 820) $('.panel').classList.remove('open');
}

async function loadStations() {
  try {
    const response = await fetch('stations.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.stations = await response.json();
    state.stations.forEach((station) => {
      const marker = L.marker([station.latitude, station.longitude], { icon: markerIcon }).bindPopup(() => popupHtml(station));
      marker.on('click', () => document.querySelectorAll('.station-item').forEach((item) => item.classList.toggle('active', Number(item.dataset.id) === station.id)));
      marker.addTo(map);
      state.markers.set(station.id, marker);
    });
    renderStations();
    statusBox.classList.remove('visible');
  } catch (error) {
    showStatus('Impossible de charger stations.json. Lancez le site via un serveur local.', 0);
    stationList.innerHTML = '<div class="empty-state">Erreur de chargement de la base.</div>';
  }
}

function locateUser() {
  if (!navigator.geolocation) return showStatus('La géolocalisation n’est pas disponible.');
  showStatus('Recherche de votre position…', 0);
  navigator.geolocation.getCurrentPosition(({ coords }) => {
    state.userPosition = [coords.latitude, coords.longitude];
    if (state.userMarker) state.userMarker.remove();
    state.userMarker = L.marker(state.userPosition, { icon: userIcon, zIndexOffset: 1000 }).addTo(map).bindPopup('Votre position');
    map.setView(state.userPosition, 11);
    renderStations();
    showStatus('Position trouvée');
  }, () => showStatus('Position refusée ou indisponible.'), { enableHighAccuracy: true, timeout: 10000, maximumAge: 120000 });
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=fr&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Service de recherche indisponible');
  const results = await response.json();
  if (!results.length) throw new Error(`Adresse introuvable : ${query}`);
  return { lat: Number(results[0].lat), lon: Number(results[0].lon), label: results[0].display_name };
}

async function calculateRoute(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const startQuery = $('#startInput').value.trim();
  const endQuery = $('#endInput').value.trim();
  routeSummary.className = 'route-summary';
  routeSummary.textContent = 'Recherche des adresses…';
  button.disabled = true;
  try {
    // Requêtes séquentielles par courtoisie envers le géocodeur public.
    const start = await geocode(startQuery);
    const end = await geocode(endQuery);
    routeSummary.textContent = 'Calcul du trajet…';
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Aucun itinéraire routier trouvé');
    const best = data.routes[0];
    state.route = best.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (state.routeLine) state.routeLine.remove();
    state.routeLine = L.polyline(state.route, { color: '#1167e8', weight: 5, opacity: .85, lineJoin: 'round' }).addTo(map);
    map.fitBounds(state.routeLine.getBounds(), { padding: [35, 35] });
    routeFilter.disabled = false;
    distanceRange.disabled = false;
    routeFilter.checked = true;
    $('#clearRoute').hidden = false;
    routeSummary.innerHTML = `<strong>${distanceLabel(best.distance / 1000)}</strong> · ${Math.round(best.duration / 60)} min<br>${escapeHtml(startQuery)} → ${escapeHtml(endQuery)}`;
    renderStations();
  } catch (error) {
    routeSummary.className = 'route-summary error';
    routeSummary.textContent = error.message || 'Impossible de calculer cet itinéraire.';
  } finally { button.disabled = false; }
}

function clearRoute() {
  if (state.routeLine) state.routeLine.remove();
  state.route = null; state.routeLine = null;
  routeFilter.checked = false; routeFilter.disabled = true; distanceRange.disabled = true;
  routeSummary.textContent = ''; $('#clearRoute').hidden = true;
  renderStations();
  if (state.stations.length) map.setView(FRANCE_CENTER, 6);
}

$('#locateButton').addEventListener('click', locateUser);
$('#locatePrimary').addEventListener('click', locateUser);
$('#routeForm').addEventListener('submit', calculateRoute);
$('#clearRoute').addEventListener('click', clearRoute);
routeFilter.addEventListener('change', renderStations);
distanceRange.addEventListener('input', () => { $('#distanceOutput').textContent = `${distanceRange.value} km`; renderStations(); });
$('.brand').addEventListener('click', (event) => { event.preventDefault(); map.setView(FRANCE_CENTER, 6); });
$('#aboutButton').addEventListener('click', () => $('#aboutDialog').showModal());
$('#closeDialog').addEventListener('click', () => $('#aboutDialog').close());
$('#mobilePanelButton').addEventListener('click', () => $('.panel').classList.add('open'));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') $('.panel').classList.remove('open'); });

loadStations();
