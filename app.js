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
  userPosition: null, userMarker: null, route: null, routeLine: null, routeCasing: null,
  selectedStationId: null, locating: false
};

const $ = (selector) => document.querySelector(selector);
const stationList = $('#stationList');
const count = $('#stationCount');
const routeFilter = $('#routeFilter');
const distanceRange = $('#distanceRange');
const routeSummary = $('#routeSummary');
const statusBox = $('#mapStatus');
const selectionCard = $('#selectionCard');
const citySuggestionCache = new Map();

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

// A business profile is distinct from a name/address search fallback.
function mapsLabel(station) {
  return station.google_maps_type === 'fiche' ? 'Fiche Google Maps ↗' : 'Rechercher sur Google Maps ↗';
}
function stationMapsUrl(station) {
  return station.google_maps_url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(station.nom + ' ' + station.adresse)}`;
}
function stationLinks(station) {
  return `<div class="station-links"><a href="${escapeHtml(stationMapsUrl(station))}" target="_blank" rel="noopener noreferrer">${mapsLabel(station)}</a><a href="${escapeHtml(station.sources[0])}" target="_blank" rel="noopener noreferrer">Source du sans-contact ↗</a></div><small class="position-note">${escapeHtml(station.precision_position || '')}${station.note ? ' ' + escapeHtml(station.note) : ''}</small>`;
}

function popupHtml(station) {
  const km = stationDistance(station);
  const meta = Number.isFinite(km) ? `<strong>${routeFilter.checked ? 'À ' : ''}${distanceLabel(km)}${routeFilter.checked ? ' du trajet' : ''}</strong>` : '<strong>100 % sans contact</strong>';
  return `<span class="popup-tag">Robot haute pression</span><h3 class="popup-title">${escapeHtml(station.nom)}</h3><p class="popup-address">${escapeHtml(station.adresse)}</p>${stationLinks(station)}<div class="popup-meta">${meta}<button class="directions-trigger" type="button" data-route-station="${station.id}">Itinéraire →</button></div>`;
}

function openDirections(station) {
  if (!station) return;
  const destination = `${station.latitude},${station.longitude}`;
  $('#directionsStationName').textContent = station.nom;
  $('#googleMapsLink').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(station.nom + ' ' + station.adresse)}&travelmode=driving${station.google_place_id ? '&destination_place_id=' + encodeURIComponent(station.google_place_id) : ''}`;
  $('#wazeLink').href = `https://www.waze.com/ul?ll=${encodeURIComponent(destination)}&navigate=yes`;
  $('#appleMapsLink').href = `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`;
  const dialog = $('#directionsDialog');
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeDirections() {
  const dialog = $('#directionsDialog');
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
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
  const stationCountLabel = `${stations.length} station${stations.length > 1 ? 's' : ''}`;
  $('#mobileCount').textContent = stationCountLabel;
  $('#mobileSheetCount').textContent = `${stationCountLabel} documentée${stations.length > 1 ? 's' : ''}`;
  stationList.innerHTML = stations.length ? stations.map((station) => `
    <button class="station-item" type="button" data-id="${station.id}">
      <span class="station-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 17h16M6 17l1-7h10l1 7M8 10l1-3h6l1 3M7 14h.01M17 14h.01"/></svg></span>
      <span class="station-copy"><strong>${escapeHtml(station.nom)}</strong><small>${escapeHtml(station.adresse)}</small></span>
      <span class="station-distance">${Number.isFinite(station.distance) ? distanceLabel(station.distance) : ''}</span>
    </button>`).join('') : '<div class="empty-state">Aucune station dans ce corridor.<br>Élargissez la distance maximale.</div>';

  stationList.querySelectorAll('.station-item').forEach((item) => item.addEventListener('click', () => focusStation(Number(item.dataset.id))));
  if (state.selectedStationId && stations.some((station) => station.id === state.selectedStationId)) {
    selectStation(state.selectedStationId, false);
  } else if (state.selectedStationId) {
    clearStationSelection();
  }
  updateRouteNearbySummary();
}

function updateRouteNearbySummary() {
  const nearby = $('#routeNearby');
  if (!nearby) return;
  if (!routeFilter.checked) {
    nearby.textContent = 'Filtre de proximité désactivé';
    return;
  }
  const total = state.visibleStations.length;
  nearby.textContent = `${total} station${total > 1 ? 's' : ''} à moins de ${distanceRange.value} km du tracé`;
}

function setRouteDistance(value) {
  distanceRange.value = String(value);
  $('#distanceOutput').textContent = `${value} km`;
  document.querySelectorAll('.distance-presets button').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.distance) === Number(value));
  });
  renderStations();
}

function selectStation(id, scrollToItem = true) {
  const station = state.stations.find((item) => item.id === id);
  if (!station) return;
  state.selectedStationId = id;
  for (const [markerId, marker] of state.markers) {
    marker.getElement()?.classList.toggle('is-selected', markerId === id);
  }
  document.querySelectorAll('.station-item').forEach((item) => item.classList.toggle('active', Number(item.dataset.id) === id));
  const selectedItem = stationList.querySelector(`[data-id="${id}"]`);
  if (scrollToItem && selectedItem) selectedItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const distance = stationDistance(station);
  $('#selectionName').textContent = station.nom;
  $('#selectionAddress').textContent = station.adresse;
  $('#selectionLinks').innerHTML = stationLinks(station);
  $('#selectionDistance').textContent = Number.isFinite(distance)
    ? `${distanceLabel(distance)}${routeFilter.checked ? ' du trajet' : ''}`
    : '100 % sans contact';
  $('#selectionDirections').dataset.stationId = station.id;
  selectionCard.hidden = false;
}

function clearStationSelection() {
  state.selectedStationId = null;
  for (const marker of state.markers.values()) marker.getElement()?.classList.remove('is-selected');
  document.querySelectorAll('.station-item').forEach((item) => item.classList.remove('active'));
  selectionCard.hidden = true;
  map.closePopup();
}

function focusStation(id) {
  const station = state.stations.find((item) => item.id === id);
  const marker = state.markers.get(id);
  if (!station || !marker) return;
  selectStation(id);
  map.flyTo([station.latitude, station.longitude], Math.max(map.getZoom(), 14), { duration: .8 });
  marker.setPopupContent(popupHtml(station)).openPopup();
  if (window.innerWidth <= 820) closeMobilePanel();
}

async function loadStations() {
  try {
    const response = await fetch('stations.json?v=2026-09-23-audit-1');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.stations = await response.json();
    const heroStationCount = document.querySelector('#heroStationCount');
    if (heroStationCount) heroStationCount.textContent = state.stations.length;
    state.stations.forEach((station) => {
      const marker = L.marker([station.latitude, station.longitude], { icon: markerIcon }).bindPopup(() => popupHtml(station));
      marker.on('click', () => selectStation(station.id));
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

function applyUserPosition(coords, cached = false) {
  state.userPosition = [coords.latitude, coords.longitude];
  if (state.userMarker) state.userMarker.remove();
  state.userMarker = L.marker(state.userPosition, { icon: userIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindPopup(cached ? 'Votre dernière position connue' : 'Votre position');
  map.setView(state.userPosition, 11);
  renderStations();
  if (window.innerWidth <= 820) closeMobilePanel();
  showStatus(cached ? 'Dernière position affichée · actualisation…' : 'Position trouvée');
}

function setLocationBusy(busy) {
  state.locating = busy;
  [$('#locateButton'), $('#locatePrimary')].forEach((button) => {
    button.disabled = busy;
    button.setAttribute('aria-busy', String(busy));
  });
}

function locateUser() {
  if (!navigator.geolocation) return showStatus('La géolocalisation n’est pas disponible.');
  if (state.locating) return;

  let cachedPosition = null;
  try {
    const saved = JSON.parse(localStorage.getItem('sans-contact-position'));
    if (saved && Date.now() - saved.timestamp < 600000) {
      cachedPosition = saved;
      applyUserPosition(saved, true);
    }
  } catch { localStorage.removeItem('sans-contact-position'); }

  if (!cachedPosition) showStatus('Localisation rapide…', 0);
  setLocationBusy(true);

  navigator.geolocation.getCurrentPosition(({ coords }) => {
    const position = {
      latitude: coords.latitude,
      longitude: coords.longitude,
      accuracy: coords.accuracy,
      timestamp: Date.now()
    };
    localStorage.setItem('sans-contact-position', JSON.stringify(position));
    applyUserPosition(position);
    setLocationBusy(false);
  }, (error) => {
    setLocationBusy(false);
    if (cachedPosition) return showStatus('Dernière position utilisée');
    const message = error.code === 1
      ? 'Autorisez la localisation pour afficher les stations proches.'
      : 'Position indisponible. Réessayez près d’une fenêtre.';
    showStatus(message, 4200);
  }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 });
}

async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=fr&limit=1&q=${encodeURIComponent(query)}`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Service de recherche indisponible');
  const results = await response.json();
  if (!results.length) throw new Error(`Adresse introuvable : ${query}`);
  return { lat: Number(results[0].lat), lon: Number(results[0].lon), label: results[0].display_name };
}

function selectedPlace(input) {
  const lat = Number(input.dataset.lat);
  const lon = Number(input.dataset.lon);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { lat, lon, label: input.dataset.label || input.value };
  }
  return null;
}

async function resolvePlace(input) {
  return selectedPlace(input) || geocode(input.value.trim());
}

async function searchCities(query, signal) {
  const key = query.trim().toLocaleLowerCase('fr');
  if (citySuggestionCache.has(key)) return citySuggestionCache.get(key);
  const url = `https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(query)}&limit=7&type=municipality&autocomplete=1`;
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Suggestions indisponibles');
  const data = await response.json();
  const cities = (data.features || []).map((feature) => {
    const properties = feature.properties || {};
    const [lon, lat] = feature.geometry?.coordinates || [];
    return {
      name: properties.city || properties.name || properties.label,
      label: properties.label || properties.city || properties.name,
      context: [properties.postcode, properties.context].filter(Boolean).join(' · '),
      lat: Number(lat),
      lon: Number(lon)
    };
  }).filter((city) => city.name && Number.isFinite(city.lat) && Number.isFinite(city.lon));
  citySuggestionCache.set(key, cities);
  return cities;
}

function setupCityAutocomplete(input, list) {
  let suggestions = [];
  let activeIndex = -1;
  let debounceTimer;
  let controller;

  const close = () => {
    list.hidden = true;
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    activeIndex = -1;
  };

  const setActive = (index) => {
    const items = [...list.querySelectorAll('.suggestion-item')];
    if (!items.length) return;
    activeIndex = (index + items.length) % items.length;
    items.forEach((item, itemIndex) => item.classList.toggle('active', itemIndex === activeIndex));
    input.setAttribute('aria-activedescendant', items[activeIndex].id);
    items[activeIndex].scrollIntoView({ block: 'nearest' });
  };

  const choose = (index) => {
    const city = suggestions[index];
    if (!city) return;
    input.value = city.name;
    input.dataset.lat = city.lat;
    input.dataset.lon = city.lon;
    input.dataset.label = city.label;
    close();
    input.focus();
  };

  const render = (cities) => {
    suggestions = cities;
    activeIndex = -1;
    if (!cities.length) {
      list.innerHTML = '<div class="suggestion-message">Aucune ville trouvée</div>';
    } else {
      list.innerHTML = cities.map((city, index) => `
        <button class="suggestion-item" id="${list.id}-option-${index}" type="button" role="option" data-index="${index}">
          <span class="suggestion-pin" aria-hidden="true">⌖</span>
          <span class="suggestion-copy"><strong>${escapeHtml(city.name)}</strong><small>${escapeHtml(city.context || 'France')}</small></span>
        </button>`).join('');
      list.querySelectorAll('.suggestion-item').forEach((item) => {
        item.addEventListener('pointerdown', (event) => event.preventDefault());
        item.addEventListener('click', () => choose(Number(item.dataset.index)));
      });
    }
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    delete input.dataset.lat;
    delete input.dataset.lon;
    delete input.dataset.label;
    clearTimeout(debounceTimer);
    controller?.abort();
    const query = input.value.trim();
    if (query.length < 2) return close();
    debounceTimer = setTimeout(async () => {
      controller = new AbortController();
      try {
        render(await searchCities(query, controller.signal));
      } catch (error) {
        if (error.name !== 'AbortError') close();
      }
    }, 280);
  });

  input.addEventListener('keydown', (event) => {
    if (list.hidden) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(activeIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(activeIndex - 1); }
    else if (event.key === 'Enter' && activeIndex >= 0) { event.preventDefault(); choose(activeIndex); }
    else if (event.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('focus', () => { if (suggestions.length && input.value.trim().length >= 2) render(suggestions); });
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
    // Une ville choisie dans les suggestions possède déjà ses coordonnées.
    // La saisie libre reste possible et passe alors par le géocodeur existant.
    const start = await resolvePlace($('#startInput'));
    const end = await resolvePlace($('#endInput'));
    routeSummary.textContent = 'Calcul du trajet…';
    const url = `https://router.project-osrm.org/route/v1/driving/${start.lon},${start.lat};${end.lon},${end.lat}?alternatives=false&steps=false&overview=full&geometries=geojson`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.code !== 'Ok' || !data.routes?.length) throw new Error('Aucun itinéraire routier trouvé');
    const best = data.routes[0];
    state.route = best.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
    if (state.routeLine) state.routeLine.remove();
    if (state.routeCasing) state.routeCasing.remove();
    state.routeCasing = L.polyline(state.route, {
      color: '#ffffff', weight: 10, opacity: .95, lineJoin: 'round', lineCap: 'round', interactive: false
    }).addTo(map);
    state.routeLine = L.polyline(state.route, {
      color: '#1268e8', weight: 6, opacity: 1, lineJoin: 'round', lineCap: 'round', interactive: false
    }).addTo(map);
    state.routeCasing.bringToFront();
    state.routeLine.bringToFront();
    map.fitBounds(state.routeLine.getBounds(), { padding: window.innerWidth <= 820 ? [26, 26] : [42, 42] });
    routeFilter.disabled = false;
    distanceRange.disabled = false;
    document.querySelectorAll('.distance-presets button').forEach((preset) => { preset.disabled = false; });
    routeFilter.checked = true;
    $('#clearRoute').hidden = false;
    routeSummary.innerHTML = `<span class="route-mode">Trajet le plus rapide</span><br><strong>${distanceLabel(best.distance / 1000)} · ${Math.round(best.duration / 60)} min</strong><br>${escapeHtml(startQuery)} → ${escapeHtml(endQuery)}<span class="route-nearby" id="routeNearby"></span>`;
    renderStations();
    if (window.innerWidth <= 820) {
      closeMobilePanel();
      showStatus(`${state.visibleStations.length} station${state.visibleStations.length > 1 ? 's' : ''} près du trajet`);
    }
  } catch (error) {
    routeSummary.className = 'route-summary error';
    routeSummary.textContent = error.message || 'Impossible de calculer cet itinéraire.';
  } finally { button.disabled = false; }
}

function clearRoute() {
  if (state.routeLine) state.routeLine.remove();
  if (state.routeCasing) state.routeCasing.remove();
  state.route = null; state.routeLine = null; state.routeCasing = null;
  routeFilter.checked = false; routeFilter.disabled = true; distanceRange.disabled = true;
  document.querySelectorAll('.distance-presets button').forEach((preset) => { preset.disabled = true; });
  routeSummary.textContent = ''; $('#clearRoute').hidden = true;
  renderStations();
  if (state.stations.length) map.setView(FRANCE_CENTER, 6);
}

$('#locateButton').addEventListener('click', locateUser);
$('#locatePrimary').addEventListener('click', locateUser);
$('#routeForm').addEventListener('submit', calculateRoute);
setupCityAutocomplete($('#startInput'), $('#startSuggestions'));
setupCityAutocomplete($('#endInput'), $('#endSuggestions'));
$('#clearRoute').addEventListener('click', clearRoute);
routeFilter.addEventListener('change', renderStations);
distanceRange.addEventListener('input', () => setRouteDistance(distanceRange.value));
document.querySelectorAll('.distance-presets button').forEach((button) => {
  button.addEventListener('click', () => setRouteDistance(button.dataset.distance));
});
$('.brand').addEventListener('click', (event) => { event.preventDefault(); map.setView(FRANCE_CENTER, 6); });
$('#aboutButton').addEventListener('click', () => $('#aboutDialog').showModal());
$('#closeDialog').addEventListener('click', () => $('#aboutDialog').close());
$('#selectionClose').addEventListener('click', clearStationSelection);
$('#selectionDirections').addEventListener('click', () => {
  openDirections(state.stations.find((station) => station.id === Number($('#selectionDirections').dataset.stationId)));
});
$('#closeDirectionsDialog').addEventListener('click', closeDirections);
$('#directionsDialog').addEventListener('click', (event) => { if (event.target === event.currentTarget) closeDirections(); });
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-route-station]');
  if (trigger) openDirections(state.stations.find((station) => station.id === Number(trigger.dataset.routeStation)));
});
const mobilePanel = $('.panel');
const mobilePanelButton = $('#mobilePanelButton');
const panelBackdrop = $('#panelBackdrop');
const mobilePanelClose = $('#mobilePanelClose');

function openMobilePanel() {
  mobilePanel.classList.add('open');
  panelBackdrop.classList.add('visible');
  mobilePanelButton.setAttribute('aria-expanded', 'true');
  document.body.classList.add('panel-open');
  setTimeout(() => $('#mobilePanelClose').focus(), 280);
}

function closeMobilePanel(returnFocus = false) {
  mobilePanel.classList.remove('open');
  panelBackdrop.classList.remove('visible');
  mobilePanelButton.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('panel-open');
  if (returnFocus) mobilePanelButton.focus();
}

mobilePanelButton.addEventListener('click', openMobilePanel);
// pointerup répond immédiatement au toucher sur iOS ; click reste le repli clavier/souris.
mobilePanelClose.addEventListener('pointerup', (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeMobilePanel(true);
});
mobilePanelClose.addEventListener('click', (event) => {
  event.preventDefault();
  closeMobilePanel(true);
});
panelBackdrop.addEventListener('click', () => closeMobilePanel(true));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMobilePanel(); });

loadStations();
