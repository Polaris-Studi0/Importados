(function (root) {
  'use strict';

  const CITY_NAMES = { medellin: 'Medellín', bello: 'Bello' };
  const validCoordinates = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng)
    && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

  function distanceMeters(lat1, lng1, lat2, lng2) {
    if (!validCoordinates(lat1, lng1) || !validCoordinates(lat2, lng2)) return NaN;
    const radians = value => value * Math.PI / 180;
    const deltaLat = radians(lat2 - lat1), deltaLng = radians(lng2 - lng1);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(Math.max(0, Math.min(1, a))));
  }

  function formatDistance(metres) {
    if (!Number.isFinite(metres) || metres < 0) return 'No disponible';
    if (metres < 100) return 'Muy cerca · menos de 100 m';
    const rounded = Math.round(metres / 100) * 100;
    if (rounded < 1000) return `${rounded} m`;
    return `${new Intl.NumberFormat('es-CO', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(rounded / 1000)} km`;
  }

  function directionsUrl(branch) {
    if (!branch) return '';
    let destination;
    if (validCoordinates(branch.lat, branch.lng)) destination = `${branch.lat},${branch.lng}`;
    else {
      if (typeof branch.address !== 'string' || !branch.address.trim()) return '';
      const parts = branch.address.split(',').map(part => part.trim()).filter(Boolean);
      const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      for (const part of [CITY_NAMES[branch.city] || branch.city, 'Antioquia', 'Colombia'].filter(Boolean)) {
        if (!parts.some(existing => normalize(existing) === normalize(part))) parts.push(part);
      }
      destination = parts.join(', ');
    }
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  }

  function positionCoordinates(position) {
    const coordinates = position?.coords || position;
    return { lat: coordinates?.latitude ?? coordinates?.lat, lng: coordinates?.longitude ?? coordinates?.lng, accuracy: coordinates?.accuracy };
  }

  function rankBranches(position, branches) {
    const { lat, lng } = positionCoordinates(position);
    if (!validCoordinates(lat, lng) || !Array.isArray(branches)) return [];
    return branches.filter(branch => branch && validCoordinates(branch.lat, branch.lng))
      .map(branch => ({ ...branch, distanceMeters: distanceMeters(lat, lng, branch.lat, branch.lng) }))
      .sort((first, second) => first.distanceMeters - second.distanceMeters);
  }

  function initFinder({
    document: doc = root.document,
    geolocation = root.navigator?.geolocation,
    isSecureContext = root.isSecureContext,
    branches = root.ImportadosBranches
  } = {}) {
    const button = doc?.getElementById('location-button');
    if (!button) return { destroy() {} };
    const label = button.querySelector('[data-location-label]');
    const result = doc.getElementById('city-result');
    const hint = doc.getElementById('location-hint');
    const cityButtons = [...doc.querySelectorAll('[data-city]')];
    const distanceLabels = [...doc.querySelectorAll('[data-distance-for]')];
    const nearestBadges = [...doc.querySelectorAll('[data-nearest-for]')];
    const locations = Array.isArray(branches) ? branches.filter(branch => branch && typeof branch.id === 'string') : [];
    const originalLabel = label?.textContent || 'Usar mi ubicación';
    const originalHint = hint?.textContent || '';
    const originallyDisabled = button.disabled;
    let alive = true, revision = 0, busy = false;
    const setText = (element, text) => { if (element) element.textContent = text; };

    function setBusy(value) {
      busy = value;
      button.disabled = value;
      button.setAttribute('aria-busy', String(value));
      setText(label, value ? 'Calculando…' : originalLabel);
    }

    function clearDistances() {
      distanceLabels.forEach(element => { element.hidden = true; element.textContent = ''; });
      nearestBadges.forEach(element => { element.hidden = true; });
    }

    function selectCity(city, nearestId = null) {
      cityButtons.forEach(element => element.setAttribute('aria-pressed', String(element.dataset.city === city)));
      locations.forEach(branch => doc.getElementById(`sede-${branch.id}`)?.classList.toggle('active-location', nearestId ? branch.id === nearestId : branch.city === city));
    }

    function manualMessage(city) {
      const choices = locations.filter(branch => branch.city === city);
      const available = choices.find(branch => branch.open === true);
      if (available) return `En ${CITY_NAMES[city] || city}, te esperamos en ${available.name}.`;
      const upcoming = choices[0], alternative = locations.find(branch => branch.open === true);
      if (upcoming) return `En ${CITY_NAMES[city] || city}, ${upcoming.name} abrirá muy pronto.${alternative ? ` Mientras tanto, te esperamos en ${alternative.name}.` : ''}`;
      return 'Elige una ciudad para consultar nuestras sedes.';
    }

    function errorMessage(error) {
      if (error?.code === 1) return 'No recibimos permiso para usar tu ubicación. Puedes elegir una ciudad o volver a intentarlo.';
      if (error?.code === 3) return 'La ubicación tardó demasiado. Intenta de nuevo o elige tu ciudad.';
      return 'No pudimos obtener tu ubicación. Intenta de nuevo o elige tu ciudad.';
    }

    function fail(message) {
      setBusy(false);
      clearDistances();
      setText(result, message);
      if (result) result.dataset.state = 'error';
      setText(hint, originalHint);
    }

    function showPosition(position) {
      const { lat, lng, accuracy } = positionCoordinates(position);
      if (!validCoordinates(lat, lng) || (accuracy !== undefined && (!Number.isFinite(accuracy) || accuracy < 0))) {
        fail('La ubicación recibida no es válida. Intenta de nuevo o elige tu ciudad.');
        return;
      }
      if (accuracy > 1000) {
        fail('Tu ubicación tiene una precisión limitada. No podemos confirmar la sede más cercana. Intenta de nuevo o elige tu ciudad.');
        setText(hint, 'El navegador reportó un margen de error superior a 1 km. No mostramos distancias para evitar una indicación imprecisa.');
        return;
      }
      const ranked = rankBranches(position, locations);
      if (!ranked.length) {
        fail('Las ubicaciones de nuestras sedes están por confirmar. Por ahora, elige tu ciudad y consulta la dirección en Google Maps.');
        return;
      }
      setBusy(false);
      clearDistances();
      if (result) result.dataset.state = ranked.length === locations.length ? 'success' : 'warning';
      for (const branch of ranked) {
        const element = distanceLabels.find(item => item.dataset.distanceFor === branch.id);
        setText(element, `${formatDistance(branch.distanceMeters)} · en línea recta`);
        if (element) element.hidden = false;
      }
      const precision = accuracy >= 100 ? ` El navegador reporta un margen de error de unos ${formatDistance(accuracy)}.` : '';
      setText(hint, `Las distancias son aproximadas y en línea recta; pueden variar del recorrido real.${precision} Usamos tu ubicación aquí, sin enviarla ni guardarla.`);
      if (ranked.length !== locations.length) {
        const pending = locations.filter(branch => !ranked.some(item => item.id === branch.id)).map(branch => branch.name).join(' y ');
        const distances = ranked.map(branch => `${branch.name}: ${formatDistance(branch.distanceMeters)} en línea recta${branch.open === true ? ' · disponible' : ' · apertura muy pronto'}`).join('. ');
        setText(result, `${distances}. La ubicación de ${pending} está por confirmar; la comparación de sedes está pendiente.`);
        return;
      }
      const nearest = ranked[0];
      selectCity(nearest.city, nearest.id);
      const badge = nearestBadges.find(item => item.dataset.nearestFor === nearest.id);
      setText(badge, nearest.approximate ? 'Referencia más cercana' : 'Más cercana a ti');
      if (badge) badge.hidden = false;
      let message = `${nearest.approximate ? 'La referencia más cercana es' : 'Tu sede más cercana es'} ${nearest.name}: ${formatDistance(nearest.distanceMeters)} en línea recta.`;
      if (nearest.open === true) message += ' Ya puedes visitarnos.';
      else {
        message += ' Apertura muy pronto.';
        const alternative = ranked.find(branch => branch.open === true);
        if (alternative) message += ` Mientras tanto, te esperamos en ${alternative.name}, disponible a ${formatDistance(alternative.distanceMeters)} en línea recta.`;
      }
      if (nearest.approximate) message += ` La entrada exacta de ${nearest.name} está por confirmar.`;
      setText(result, message);
    }

    function locate() {
      if (!alive || busy) return;
      const request = ++revision;
      clearDistances();
      if (!isSecureContext) { fail('Para usar tu ubicación, abre esta página por HTTPS. También puedes elegir tu ciudad.'); return; }
      if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') { fail('Tu navegador no permite obtener la ubicación. Puedes elegir tu ciudad para consultar nuestras sedes.'); return; }
      setBusy(true);
      setText(result, 'Buscando tu sede más cercana…');
      if (result) result.dataset.state = 'loading';
      setText(hint, 'Tu navegador puede pedir permiso. Usamos tu ubicación sólo para calcular distancias aquí; no la enviamos ni la guardamos.');
      try {
        geolocation.getCurrentPosition(
          position => { if (alive && request === revision) showPosition(position); },
          error => { if (alive && request === revision) fail(errorMessage(error)); },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      } catch (error) {
        if (alive && request === revision) fail(errorMessage(error));
      }
    }

    function chooseCity(event) {
      if (!alive) return;
      const city = event.currentTarget.dataset.city;
      revision++;
      setBusy(false);
      clearDistances();
      selectCity(city);
      setText(result, manualMessage(city));
      if (result) delete result.dataset.state;
      setText(hint, originalHint);
    }

    button.addEventListener('click', locate);
    cityButtons.forEach(element => element.addEventListener('click', chooseCity));
    return { destroy() {
      if (!alive) return;
      alive = false; revision++;
      button.removeEventListener('click', locate);
      cityButtons.forEach(element => element.removeEventListener('click', chooseCity));
      setBusy(false);
      button.disabled = originallyDisabled;
    } };
  }

  root.ImportadosLocations = { distanceMeters, formatDistance, directionsUrl, rankBranches, initFinder };
})(globalThis);
