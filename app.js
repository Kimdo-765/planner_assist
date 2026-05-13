'use strict';

/* ============================================================
 *  해외 출장 플래너 — 클라이언트 단일 페이지 앱
 *  - 로컬 저장소에 출장 계획을 저장/조회/삭제
 *  - 사용자 입력으로부터 권장 출/귀국 일정, 객실 수 계산
 *  - Skyscanner / Booking.com 등의 검색 딥링크를 생성하여 결과 페이지로 이동
 * ============================================================ */

// ============== 저장소 ==============
const STORAGE_KEY = 'planner_assist_trips_v1';
const MAX_DEPARTURES = 5;

function migrateTrip(trip) {
  if (!trip) return trip;

  // (1) 출발지: trip.departure (단일) → trip.departures (배열)
  if (!Array.isArray(trip.departures)) {
    if (trip.departure && trip.departure.code) {
      trip.departures = [trip.departure];
    } else {
      trip.departures = [];
    }
  }
  delete trip.departure;

  // (2) 도착지: airport-shape ({code,city,...}) → place-shape ({query,displayName,lat,lng,...})
  const dst = trip.destination;
  if (dst && dst.code && dst.lat == null && !dst.displayName) {
    const a = (window.AIRPORTS || []).find((x) => x.code === dst.code);
    if (a) {
      trip.destination = {
        query: a.label,
        displayName: `${a.label}, ${a.country}`,
        lat: a.lat,
        lng: a.lng,
        countryCode: '',
        city: a.city
      };
      if (!Array.isArray(trip.arrivalAirports) || trip.arrivalAirports.length === 0) {
        trip.arrivalAirports = [a.code];
      }
    }
  }
  if (!Array.isArray(trip.arrivalAirports)) trip.arrivalAirports = [];

  // (3) 환승 최소 대기 시간 기본값
  if (trip.minLayoverMinutes == null) trip.minLayoverMinutes = DEFAULT_MIN_LAYOVER_MINUTES;

  // (4) 객실 배정: 구버전 roomMode → roomAllocation {r1,r2,r3,r4}
  if (!trip.roomAllocation || typeof trip.roomAllocation !== 'object') {
    const people = Math.max(1, Number(trip.people) || 1);
    if (trip.roomMode === 'double') {
      trip.roomAllocation = {
        r1: people % 2,
        r2: Math.floor(people / 2),
        r3: 0,
        r4: 0
      };
    } else {
      trip.roomAllocation = { r1: people, r2: 0, r3: 0, r4: 0 };
    }
  } else {
    trip.roomAllocation = normalizeRoomAllocation(trip.roomAllocation);
  }
  delete trip.roomMode;
  return trip;
}

function normalizeRoomAllocation(alloc) {
  const a = alloc || {};
  return {
    r1: Math.max(0, Number(a.r1) || 0),
    r2: Math.max(0, Number(a.r2) || 0),
    r3: Math.max(0, Number(a.r3) || 0),
    r4: Math.max(0, Number(a.r4) || 0)
  };
}
function roomAllocPeople(alloc) {
  const a = normalizeRoomAllocation(alloc);
  return a.r1 * 1 + a.r2 * 2 + a.r3 * 3 + a.r4 * 4;
}
function roomAllocCount(alloc) {
  const a = normalizeRoomAllocation(alloc);
  return a.r1 + a.r2 + a.r3 + a.r4;
}
function roomAllocSummary(alloc) {
  const a = normalizeRoomAllocation(alloc);
  const parts = [];
  if (a.r1) parts.push(`1인 1실 ${a.r1}개`);
  if (a.r2) parts.push(`2인 1실 ${a.r2}개`);
  if (a.r3) parts.push(`3인 1실 ${a.r3}개`);
  if (a.r4) parts.push(`4인 1실 ${a.r4}개`);
  return parts.length ? parts.join(' + ') : '미지정';
}
function loadTrips() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return list.map(migrateTrip);
  } catch (_) {
    return [];
  }
}
function saveTrips(trips) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trips));
}
function getTrip(id) {
  return loadTrips().find((t) => t.id === id) || null;
}
function upsertTrip(trip) {
  const trips = loadTrips();
  const idx = trips.findIndex((t) => t.id === trip.id);
  trip.updatedAt = new Date().toISOString();
  if (idx >= 0) trips[idx] = trip;
  else {
    trip.createdAt = trip.createdAt || trip.updatedAt;
    trips.unshift(trip);
  }
  saveTrips(trips);
  return trip;
}
function deleteTrip(id) {
  saveTrips(loadTrips().filter((t) => t.id !== id));
}

// ============== 유틸 ==============
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
function pad(n) { return String(n).padStart(2, '0'); }
function airportByCode(code) {
  if (!code) return null;
  return window.AIRPORTS.find((a) => a.code === code) || null;
}
function safeText(s) { return (s == null ? '' : s).toString(); }

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 3600 * 1000);
}
function dateOnly(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
function shortDate(date) {
  const yy = String(date.getFullYear()).slice(-2);
  return `${yy}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}
function fmtDateTime(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function fmtDateKor(date) {
  const w = '일월화수목금토'[date.getDay()];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${w})`;
}
function fmtDateTimeKor(date) {
  return `${fmtDateKor(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function dayDiff(aDateStr, bDateStr) {
  const a = new Date(aDateStr + 'T00:00:00');
  const b = new Date(bDateStr + 'T00:00:00');
  return Math.max(1, Math.round((b.getTime() - a.getTime()) / (24 * 3600 * 1000)));
}
function nowLocalForInput(d = new Date(), addDays = 0, hour = null, minute = 0) {
  const date = new Date(d.getTime() + addDays * 86400000);
  if (hour !== null) date.setHours(hour, minute, 0, 0);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// ============== 거리 / 인근 공항 ==============
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function nearestAirports(lat, lng, n = 5) {
  if (lat == null || lng == null) return [];
  return window.AIRPORTS
    .filter((a) => typeof a.lat === 'number' && typeof a.lng === 'number')
    .map((a) => Object.assign({}, a, { distance: haversineKm(lat, lng, a.lat, a.lng) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

// ============== 일정 계산 ==============
// 도착편 항공기 지연 buffer (시간) — 항공편이 정시보다 N시간 늦게 도착해도 휴식 시간이 보장되도록
const ARRIVAL_DELAY_BUFFER_HOURS = 2;

function calculatePlan(trip) {
  const workStart = new Date(trip.workStart);
  const workEnd = new Date(trip.workEnd);
  const restHours = Number(trip.restHours || 12);
  const postHours = Number(trip.postHours || 4);

  // arrivalBy: 항공편 정시 도착 권장 시각.
  // 업무 시작 - 휴식 시간 - 도착편 지연 버퍼.
  // 항공편이 2시간 늦어도, 휴식 시간이 그대로 확보됨.
  const arrivalBy = addHours(workStart, -(restHours + ARRIVAL_DELAY_BUFFER_HOURS));
  const departAfter = addHours(workEnd, postHours);

  const checkInDate = new Date(arrivalBy);
  let checkOutDate = new Date(departAfter);
  // 같은 날 도착·출국이면 최소 1박은 보장
  if (dateOnly(checkOutDate) <= dateOnly(checkInDate)) {
    checkOutDate = new Date(checkInDate.getTime() + 24 * 3600 * 1000);
  }

  const checkIn = dateOnly(checkInDate);
  const checkOut = dateOnly(checkOutDate);
  const nights = dayDiff(checkIn, checkOut);

  const outboundDate = dateOnly(arrivalBy);
  const returnDate = dateOnly(departAfter);

  const people = Math.max(1, Number(trip.people) || 1);
  const allocation = normalizeRoomAllocation(trip.roomAllocation);
  // 배정 합이 0이면 기본값 (1인 1실 × people)
  let rooms = roomAllocCount(allocation);
  if (rooms === 0) {
    allocation.r1 = people;
    rooms = people;
  }

  return {
    workStart, workEnd,
    arrivalBy, departAfter,
    outboundDate, returnDate,
    checkIn, checkOut, nights,
    people, rooms,
    roomAllocation: allocation,
    restHours, postHours,
    arrivalDelayBuffer: ARRIVAL_DELAY_BUFFER_HOURS
  };
}

// ============== 검색 URL 빌더 ==============
// 환승 최소 대기 시간 (분) — 사용자 선택값. 미지정 시 120분 (2시간) 기본
const DEFAULT_MIN_LAYOVER_MINUTES = 120;
function tripMinLayover(trip) {
  const v = Number(trip && trip.minLayoverMinutes);
  return Number.isFinite(v) && v >= 60 ? v : DEFAULT_MIN_LAYOVER_MINUTES;
}

function buildSkyscannerUrl(trip, plan, origin, arrivalCode) {
  const from = ((origin && origin.code) || '').toLowerCase();
  const to = (arrivalCode || '').toLowerCase();
  const out = shortDate(plan.arrivalBy);
  const ret = shortDate(plan.departAfter);
  const minLay = tripMinLayover(trip);
  const params = new URLSearchParams({
    adultsv2: String(plan.people),
    cabinclass: trip.cabinClass || 'economy',
    childrenv2: '',
    rtn: '1',
    preferdirects: trip.preferDirect ? 'true' : 'false',
    inboundaltsenabled: 'false',
    outboundaltsenabled: 'false',
    // 환승 시 재수속 + 지연 대비 — 사용자가 선택한 최소 layover 적용
    outboundstopdurationmin: String(minLay),
    inboundstopdurationmin: String(minLay)
  });
  return `https://www.skyscanner.co.kr/transport/flights/${from}/${to}/${out}/${ret}/?${params.toString()}`;
}
function buildSkyscannerOriginAlt(trip, plan, origin, arrivalCode) {
  const u = new URL(buildSkyscannerUrl(trip, plan, origin, arrivalCode));
  u.searchParams.set('inboundaltsenabled', 'true');
  u.searchParams.set('outboundaltsenabled', 'true');
  return u.toString();
}
function buildGoogleFlightsUrl(trip, plan, origin, arrivalAirport) {
  const from = (origin && (origin.cityEn || origin.city)) || '';
  const to = (arrivalAirport && (arrivalAirport.cityEn || arrivalAirport.city)) || trip.destination.city || '';
  const q = `Flights from ${from} to ${to} on ${plan.outboundDate} returning ${plan.returnDate}`;
  return `https://www.google.com/travel/flights?hl=ko&curr=KRW&q=${encodeURIComponent(q)}`;
}

function destSearchString(dest) {
  return (dest && (dest.displayName || dest.query || dest.city)) || '';
}

function buildBookingUrl(trip, plan, opts) {
  opts = opts || {};
  const dest = trip.destination || {};
  const params = new URLSearchParams({
    ss: destSearchString(dest),
    checkin: plan.checkIn,
    checkout: plan.checkOut,
    group_adults: String(plan.people),
    no_rooms: String(plan.rooms),
    group_children: '0',
    selected_currency: 'KRW',
    sb_travel_purpose: 'business'
  });
  // 좌표 기반 검색 + 거리순 정렬
  if (typeof dest.lat === 'number' && typeof dest.lng === 'number') {
    params.set('latitude', dest.lat.toFixed(6));
    params.set('longitude', dest.lng.toFixed(6));
    params.set('order', opts.order || 'distance_from_search');
  } else if (opts.order) {
    params.set('order', opts.order);
  }
  return `https://www.booking.com/searchresults.ko.html?${params.toString()}`;
}
function buildHotelsComUrl(trip, plan) {
  const dest = trip.destination || {};
  const params = new URLSearchParams({
    destination: destSearchString(dest),
    startDate: plan.checkIn,
    endDate: plan.checkOut,
    adults: String(plan.people),
    rooms: String(plan.rooms),
    sort: 'DISTANCE'
  });
  if (typeof dest.lat === 'number' && typeof dest.lng === 'number') {
    params.set('latLong', `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`);
  }
  return `https://www.hotels.com/Hotel-Search?${params.toString()}`;
}
function buildAgodaUrl(trip, plan) {
  const dest = trip.destination || {};
  const params = new URLSearchParams({
    city: destSearchString(dest),
    checkIn: plan.checkIn,
    checkOut: plan.checkOut,
    adults: String(plan.people),
    rooms: String(plan.rooms)
  });
  return `https://www.agoda.com/search?${params.toString()}`;
}
function buildGoogleMapsHotelsUrl(trip, plan) {
  const dest = trip.destination || {};
  if (typeof dest.lat !== 'number' || typeof dest.lng !== 'number') {
    return `https://www.google.com/maps/search/hotels+near+${encodeURIComponent(destSearchString(dest))}`;
  }
  return `https://www.google.com/maps/search/hotels/@${dest.lat.toFixed(6)},${dest.lng.toFixed(6)},14z`;
}

// ============== 화면 라우팅 ==============
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const views = {
  list: $('#view-list'),
  form: $('#view-form'),
  detail: $('#view-detail')
};
let currentView = 'list';
let currentTripId = null;

function setHeader(title, showBack = false) {
  $('#header-title').textContent = title;
  $('#back-btn').hidden = !showBack;
}
function showView(name, opts = {}) {
  Object.values(views).forEach((v) => v.classList.remove('active'));
  views[name].classList.add('active');
  const previous = currentView;
  currentView = name;
  if (name === 'list') {
    setHeader('해외 출장 플래너', false);
    $('#fab').style.display = 'flex';
    renderList();
  } else if (name === 'form') {
    setHeader(opts.editing ? '출장 일정 편집' : '새 출장 만들기', true);
    $('#fab').style.display = 'none';
  } else if (name === 'detail') {
    setHeader('출장 상세', true);
    $('#fab').style.display = 'none';
  }
  if (!opts.fromHistory && previous !== name) {
    history.pushState({ view: name, tripId: currentTripId }, '');
  }
  window.scrollTo(0, 0);
}

function goBack() {
  if (currentView === 'form' || currentView === 'detail') {
    history.back();
  }
}

// ============== 토스트 ==============
let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ============== 트립 목록 ==============
function renderList() {
  const trips = loadTrips();
  const wrap = $('#trip-list');
  const empty = $('#empty-state');

  if (trips.length === 0) {
    wrap.innerHTML = '';
    empty.style.display = '';
    return;
  }
  empty.style.display = 'none';

  wrap.innerHTML = trips.map((trip) => {
    let plan;
    try { plan = calculatePlan(trip); }
    catch (_) { plan = null; }
    const departures = Array.isArray(trip.departures) ? trip.departures : [];
    const dest = trip.destination || {};
    const arrivalCodes = Array.isArray(trip.arrivalAirports) ? trip.arrivalAirports : [];
    const subtitle = plan
      ? `${plan.outboundDate} → ${plan.returnDate} · ${plan.nights}박 · ${plan.people}명`
      : '일정 정보 누락';
    const firstDep = departures[0];
    const titleFirst = (firstDep && firstDep.city) || '?';
    const titleExtra = departures.length > 1 ? ` 외 ${departures.length - 1}` : '';
    const destCity = dest.city || (dest.displayName || '').split(',')[0] || '?';
    const title = (trip.name && trip.name.trim())
      || `${titleFirst}${titleExtra} → ${destCity}`;
    const depCodesHtml = departures.length === 0
      ? `<span class="iata">?</span>`
      : departures.map((d) => `<span class="iata">${escapeHtml(d.code || '?')}</span>`).join(`<span class="comma">,</span>`);
    const arrCodesHtml = arrivalCodes.length === 0
      ? `<span class="iata">?</span>`
      : arrivalCodes.map((c) => `<span class="iata">${escapeHtml(c)}</span>`).join(`<span class="comma">,</span>`);
    const destLabel = dest.displayName || dest.query || dest.city || '-';
    const badgeRooms = plan ? plan.rooms : roomAllocCount(trip.roomAllocation);
    return `
      <article class="trip-card" data-id="${trip.id}" tabindex="0" role="button">
        <div class="trip-card-row">
          <div class="trip-card-title">${escapeHtml(title)}</div>
          <span class="trip-card-badge">객실 ${badgeRooms}개</span>
        </div>
        <div class="trip-card-route">
          ${depCodesHtml}
          <span class="arrow">→</span>
          ${arrCodesHtml}
        </div>
        <div class="trip-card-cities">${escapeHtml(destLabel)}</div>
        <div class="trip-card-sub">${subtitle}</div>
      </article>`;
  }).join('');

  $$('.trip-card', wrap).forEach((card) => {
    card.addEventListener('click', () => openDetail(card.dataset.id));
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDetail(card.dataset.id);
      }
    });
  });
}

// ============== 폼 상태 ==============
const departureAC = setupAutocomplete($('#departure'), $('#departure-list'), $('#departure-hint'), {
  multi: true,
  max: MAX_DEPARTURES,
  chipsEl: $('#departure-chips')
});

// 도착지(장소)와 도착 공항 상태
let selectedDestination = null;            // { query, displayName, lat, lng, city, countryCode, ... }
let selectedArrivalCodes = [];             // string[] (IATA)
let arrivalAirportCandidates = [];         // 후보(거리 포함) — 인근 공항
const MAX_ARRIVAL = 4;

const destinationGeo = setupGeocodeAutocomplete(
  $('#destination'),
  $('#destination-list'),
  $('#destination-hint'),
  (place) => {
    selectedDestination = place;
    recomputeArrivalAirports({ resetSelection: true });
  }
);

function recomputeArrivalAirports(opts) {
  opts = opts || {};
  if (!selectedDestination || selectedDestination.lat == null) {
    arrivalAirportCandidates = [];
    selectedArrivalCodes = [];
    renderArrivalAirports();
    return;
  }
  arrivalAirportCandidates = nearestAirports(selectedDestination.lat, selectedDestination.lng, 6);
  if (opts.resetSelection || selectedArrivalCodes.length === 0) {
    // 가장 가까운 공항 자동 선택
    selectedArrivalCodes = arrivalAirportCandidates.length ? [arrivalAirportCandidates[0].code] : [];
  } else {
    // 후보 목록에 없는 코드는 제거
    const allowed = new Set(arrivalAirportCandidates.map((a) => a.code));
    selectedArrivalCodes = selectedArrivalCodes.filter((c) => allowed.has(c));
    if (selectedArrivalCodes.length === 0 && arrivalAirportCandidates.length) {
      selectedArrivalCodes = [arrivalAirportCandidates[0].code];
    }
  }
  renderArrivalAirports();
}

function renderArrivalAirports() {
  const wrap = $('#arrival-airports');
  const group = $('#arrival-airports-group');
  const hint = $('#arrival-airports-hint');
  if (!arrivalAirportCandidates.length) {
    group.hidden = true;
    wrap.innerHTML = '';
    return;
  }
  group.hidden = false;
  const sel = new Set(selectedArrivalCodes);
  wrap.innerHTML = arrivalAirportCandidates.map((a) => {
    const isSel = sel.has(a.code);
    const dist = a.distance < 10 ? a.distance.toFixed(1) : Math.round(a.distance);
    return `
      <button type="button" class="airport-pick ${isSel ? 'selected' : ''}" data-code="${escapeHtml(a.code)}" aria-pressed="${isSel}">
        <span class="ap-iata">${escapeHtml(a.code)}</span>
        <span class="ap-city">${escapeHtml(a.city)}</span>
        <span class="ap-dist">${dist}km</span>
      </button>
    `;
  }).join('');
  if (hint) {
    hint.textContent = selectedArrivalCodes.length === 0
      ? '도착 공항을 한 곳 이상 선택하세요.'
      : `${selectedArrivalCodes.length}개 공항 선택됨 (도착지에서 거리순). 출발지 × 도착공항 조합별로 검색 링크가 생성됩니다.`;
  }
}

// 도착 공항 토글 (이벤트 위임)
$('#arrival-airports').addEventListener('click', (e) => {
  const btn = e.target.closest('.airport-pick');
  if (!btn) return;
  const code = btn.dataset.code;
  const idx = selectedArrivalCodes.indexOf(code);
  if (idx >= 0) {
    if (selectedArrivalCodes.length === 1) {
      toast('최소 한 곳의 도착 공항이 필요합니다.');
      return;
    }
    selectedArrivalCodes.splice(idx, 1);
  } else {
    if (selectedArrivalCodes.length >= MAX_ARRIVAL) {
      toast(`도착 공항은 최대 ${MAX_ARRIVAL}곳까지 선택할 수 있습니다.`);
      return;
    }
    selectedArrivalCodes.push(code);
  }
  renderArrivalAirports();
});

// ============== Nominatim 지오코딩 자동완성 ==============
function normalizeNominatim(r) {
  const main = r.name || (r.display_name || '').split(',')[0] || '';
  const addr = r.address || {};
  const cc = (addr.country_code || '').toUpperCase();
  const city = addr.city || addr.town || addr.village || addr.hamlet || addr.county || addr.state || main;
  return {
    query: r.display_name || main,
    displayName: r.display_name || main,
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    countryCode: cc,
    city: city,
    osmType: r.osm_type,
    osmId: r.osm_id,
    type: r.type
  };
}

function setupGeocodeAutocomplete(inputEl, listEl, hintEl, onSelect) {
  let debounceTimer = null;
  let abortCtrl = null;
  let lastResults = [];
  let pickedNow = false;

  function setHint(msg) { if (hintEl) hintEl.textContent = msg || ''; }

  function renderResults(results) {
    if (!results || results.length === 0) {
      listEl.innerHTML = '<div class="ac-empty">검색 결과 없음. 다른 키워드(예: 영문 도시명+주)로 시도해 보세요.</div>';
    } else {
      listEl.innerHTML = results.map((r, i) => {
        const main = r.name || (r.display_name || '').split(',')[0];
        const sub = r.display_name || '';
        return `
          <div class="ac-item" role="option" data-idx="${i}">
            <div class="ac-main">📍 ${escapeHtml(main)}</div>
            <div class="ac-sub">${escapeHtml(sub)}</div>
          </div>
        `;
      }).join('');
    }
    listEl.classList.add('open');
  }

  function search(query) {
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = new AbortController();
    setHint('검색 중…');
    listEl.innerHTML = '<div class="ac-empty">검색 중…</div>';
    listEl.classList.add('open');

    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&limit=8&accept-language=ko,en`;
    fetch(url, { signal: abortCtrl.signal, headers: { 'Accept': 'application/json' } })
      .then((r) => r.json())
      .then((results) => {
        lastResults = results || [];
        renderResults(lastResults);
        if (lastResults.length === 0) setHint('결과 없음 — 키워드를 바꿔 보세요.');
        else setHint('결과를 탭하여 선택하세요.');
      })
      .catch((e) => {
        if (e.name === 'AbortError') return;
        listEl.innerHTML = '<div class="ac-empty">검색 실패. 잠시 후 다시 시도해 주세요.</div>';
        setHint('검색 요청 실패.');
      });
  }

  inputEl.addEventListener('input', () => {
    pickedNow = false;
    const q = inputEl.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (q.length < 2) {
      listEl.classList.remove('open');
      setHint('정확한 주소·도시·랜드마크를 입력하세요.');
      return;
    }
    debounceTimer = setTimeout(() => search(q), 450);
  });

  inputEl.addEventListener('blur', () => {
    setTimeout(() => listEl.classList.remove('open'), 200);
  });

  listEl.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.ac-item');
    if (!item) return;
    e.preventDefault();
    const idx = Number(item.dataset.idx);
    const r = lastResults[idx];
    if (!r) return;
    const place = normalizeNominatim(r);
    pickedNow = true;
    inputEl.value = place.displayName;
    listEl.classList.remove('open');
    setHint(`선택됨: ${place.displayName}`);
    if (onSelect) onSelect(place);
  });

  return {
    set(place) {
      if (place && place.displayName) {
        inputEl.value = place.displayName;
        setHint(`선택됨: ${place.displayName}`);
      } else {
        inputEl.value = '';
        setHint('');
      }
    },
    clear() {
      inputEl.value = '';
      setHint('');
      lastResults = [];
      pickedNow = false;
    },
    isPickedNow() { return pickedNow; }
  };
}

function setupAutocomplete(inputEl, listEl, hintEl, opts) {
  opts = opts || {};
  const multi = !!opts.multi;
  const max = opts.max || 5;
  const chipsEl = opts.chipsEl || null;

  // 단일: airport | null,  멀티: airport[]
  let selected = multi ? [] : null;

  function isPicked(code) {
    if (multi) return selected.some((a) => a.code === code);
    return selected && selected.code === code;
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = selected.map((a) => `
      <span class="chip" data-code="${escapeHtml(a.code)}">
        <span class="chip-code">${escapeHtml(a.code)}</span>
        <span class="chip-city">${escapeHtml(a.city)}</span>
        <button type="button" class="chip-remove" data-code="${escapeHtml(a.code)}" aria-label="${escapeHtml(a.code)} 삭제">×</button>
      </span>
    `).join('');
  }

  function setHint(message) {
    if (!hintEl) return;
    if (multi) {
      const remain = max - selected.length;
      const baseMsg = '선택한 출발지별로 항공편 검색 링크가 생성됩니다';
      if (selected.length === 0) hintEl.textContent = `${baseMsg} (최대 ${max}곳).`;
      else if (remain > 0) hintEl.textContent = `${selected.length}곳 선택됨 · ${remain}곳 더 추가 가능`;
      else hintEl.textContent = `최대 ${max}곳 모두 선택되었습니다.`;
    } else {
      hintEl.textContent = message || '';
    }
  }

  function renderList(query) {
    const q = (query || '').toLowerCase().trim();
    let results;
    if (!q) {
      results = window.AIRPORTS.slice(0, 12);
    } else {
      results = window.AIRPORTS.filter((a) => {
        const hay = `${a.code} ${a.city} ${a.cityEn} ${a.country} ${a.label} ${a.alt || ''}`.toLowerCase();
        return hay.includes(q);
      }).slice(0, 14);
    }
    if (results.length === 0) {
      listEl.innerHTML = '<div class="ac-empty">검색 결과 없음. IATA 3자리 코드를 직접 입력해도 됩니다.</div>';
    } else {
      listEl.innerHTML = results.map((a) => {
        const picked = isPicked(a.code);
        return `
          <div class="ac-item ${picked ? 'is-picked' : ''}" role="option" data-code="${a.code}">
            <div class="ac-main">${escapeHtml(a.label)}${picked ? ' <span class="ac-tag">선택됨</span>' : ''}</div>
            <div class="ac-sub">${escapeHtml(a.country)} · ${escapeHtml(a.cityEn)}</div>
          </div>
        `;
      }).join('');
    }
    listEl.classList.add('open');
  }

  function add(airport) {
    if (!airport) return false;
    if (multi) {
      if (isPicked(airport.code)) return false;
      if (selected.length >= max) {
        toast(`출발지는 최대 ${max}곳까지 선택할 수 있습니다.`);
        return false;
      }
      selected.push(airport);
      renderChips();
      setHint();
      inputEl.value = '';
      return true;
    } else {
      selected = airport;
      inputEl.value = airport.label;
      setHint(`선택됨: ${airport.label} · ${airport.country}`);
      return true;
    }
  }

  function removeByCode(code) {
    if (multi) {
      selected = selected.filter((a) => a.code !== code);
      renderChips();
      setHint();
    } else {
      selected = null;
      inputEl.value = '';
      setHint('');
    }
  }

  inputEl.addEventListener('focus', () => renderList(inputEl.value));
  inputEl.addEventListener('input', () => {
    if (!multi) {
      selected = null;
      setHint('');
    }
    renderList(inputEl.value);
  });
  inputEl.addEventListener('keydown', (e) => {
    // 멀티 모드: 빈 입력에서 백스페이스 → 마지막 칩 제거
    if (multi && e.key === 'Backspace' && inputEl.value === '' && selected.length > 0) {
      selected.pop();
      renderChips();
      setHint();
      renderList('');
    }
    // Enter: IATA 직접 입력 매칭
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = inputEl.value.trim().toUpperCase();
      if (/^[A-Z]{3}$/.test(v)) {
        const a = airportByCode(v);
        if (a) { add(a); renderList(''); }
      }
    }
  });
  inputEl.addEventListener('blur', () => {
    setTimeout(() => listEl.classList.remove('open'), 180);
    // IATA 직접 입력 매칭 (단일/멀티 공통)
    const v = inputEl.value.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(v)) {
      const a = airportByCode(v);
      if (a && !isPicked(v)) {
        add(a);
      } else if (!multi && a) {
        // 단일 모드: 라벨 정규화
        selected = a;
        inputEl.value = a.label;
        setHint(`선택됨: ${a.label} · ${a.country}`);
      }
    }
  });

  // pointerdown — 항목 선택 (mouse/touch 통일)
  listEl.addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.ac-item');
    if (!item) return;
    e.preventDefault();
    const a = airportByCode(item.dataset.code);
    if (!a) return;
    if (multi && isPicked(a.code)) {
      removeByCode(a.code); // 다시 탭하면 해제
      renderList(inputEl.value);
    } else {
      add(a);
      renderList(multi ? '' : inputEl.value);
      if (!multi) listEl.classList.remove('open');
      else inputEl.focus();
    }
  });

  // 칩 X 버튼
  if (chipsEl) {
    chipsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-remove');
      if (!btn) return;
      removeByCode(btn.dataset.code);
    });
  }

  return {
    get value() { return multi ? selected.slice() : selected; },
    set(input) {
      if (multi) {
        const arr = Array.isArray(input) ? input : (input ? [input] : []);
        selected = arr.slice(0, max).map((a) => airportByCode(a.code) || a);
        renderChips();
        setHint();
        inputEl.value = '';
      } else {
        selected = input || null;
        inputEl.value = input ? input.label : '';
        setHint(input ? `선택됨: ${input.label} · ${input.country}` : '');
      }
    },
    clear() {
      if (multi) { selected = []; renderChips(); }
      else { selected = null; }
      inputEl.value = '';
      setHint('');
    }
  };
}

function resetForm() {
  $('#trip-form').reset();
  $('#trip-id').value = '';
  departureAC.clear();
  destinationGeo.clear();
  selectedDestination = null;
  selectedArrivalCodes = [];
  arrivalAirportCandidates = [];
  renderArrivalAirports();
  // 합리적 기본 일정: 모레 09:00 ~ 다다음날 18:00
  const tStart = nowLocalForInput(new Date(), 2, 9, 0);
  const tEnd = nowLocalForInput(new Date(), 3, 18, 0);
  $('#work-start').value = tStart;
  $('#work-end').value = tEnd;
  $('#people').value = 1;
  $('#cabin-class').value = 'economy';
  $('#rest-hours').value = '12';
  $('#post-hours').value = '4';
  $('#allow-transfer').checked = true;
  $('#prefer-direct').checked = false;
  $('#min-layover').value = String(DEFAULT_MIN_LAYOVER_MINUTES);
  setRoomAllocationInputs({ r1: 1, r2: 0, r3: 0, r4: 0 });
  updateRoomAllocHint();
}

function loadFormFromTrip(trip) {
  resetForm();
  $('#trip-id').value = trip.id;
  $('#trip-name').value = trip.name || '';
  const departures = Array.isArray(trip.departures)
    ? trip.departures
    : (trip.departure ? [trip.departure] : []);
  departureAC.set(departures.map((d) => airportByCode(d.code) || d));

  // 도착지(장소) 복원
  if (trip.destination && (trip.destination.lat != null || trip.destination.displayName)) {
    selectedDestination = Object.assign({}, trip.destination);
    destinationGeo.set(selectedDestination);
  }
  // 도착 공항 복원 (저장된 코드 우선, 없으면 가장 가까운 공항)
  if (selectedDestination && selectedDestination.lat != null) {
    arrivalAirportCandidates = nearestAirports(selectedDestination.lat, selectedDestination.lng, 6);
    const stored = Array.isArray(trip.arrivalAirports) ? trip.arrivalAirports : [];
    selectedArrivalCodes = stored.length ? stored.slice() : (arrivalAirportCandidates[0] ? [arrivalAirportCandidates[0].code] : []);
    // 후보에 없는 저장 코드도 살리기 위해 후보 리스트에 강제 포함
    selectedArrivalCodes.forEach((code) => {
      if (!arrivalAirportCandidates.some((a) => a.code === code)) {
        const a = airportByCode(code);
        if (a && a.lat != null) {
          arrivalAirportCandidates.push(Object.assign({}, a, {
            distance: haversineKm(selectedDestination.lat, selectedDestination.lng, a.lat, a.lng)
          }));
        }
      }
    });
    arrivalAirportCandidates.sort((x, y) => x.distance - y.distance);
    renderArrivalAirports();
  }

  $('#work-start').value = trip.workStart || '';
  $('#work-end').value = trip.workEnd || '';
  $('#people').value = trip.people || 1;
  $('#cabin-class').value = trip.cabinClass || 'economy';
  $('#rest-hours').value = String(trip.restHours != null ? trip.restHours : 12);
  $('#post-hours').value = String(trip.postHours != null ? trip.postHours : 4);
  $('#allow-transfer').checked = trip.allowTransfer !== false;
  $('#prefer-direct').checked = !!trip.preferDirect;
  $('#min-layover').value = String(trip.minLayoverMinutes != null ? trip.minLayoverMinutes : DEFAULT_MIN_LAYOVER_MINUTES);
  setRoomAllocationInputs(trip.roomAllocation || { r1: trip.people || 1, r2: 0, r3: 0, r4: 0 });
  updateRoomAllocHint();
}

function readRoomAllocationInputs() {
  return normalizeRoomAllocation({
    r1: $('#rooms-1').value,
    r2: $('#rooms-2').value,
    r3: $('#rooms-3').value,
    r4: $('#rooms-4').value
  });
}
function setRoomAllocationInputs(alloc) {
  const a = normalizeRoomAllocation(alloc);
  $('#rooms-1').value = String(a.r1);
  $('#rooms-2').value = String(a.r2);
  $('#rooms-3').value = String(a.r3);
  $('#rooms-4').value = String(a.r4);
}
function updateRoomAllocHint() {
  const hintEl = $('#room-alloc-hint');
  if (!hintEl) return;
  const people = Math.max(0, Number($('#people').value) || 0);
  const alloc = readRoomAllocationInputs();
  const sumPeople = roomAllocPeople(alloc);
  const totalRooms = roomAllocCount(alloc);
  hintEl.classList.remove('warn', 'ok');
  if (totalRooms === 0) {
    hintEl.textContent = '객실을 1개 이상 배정해 주세요.';
    hintEl.classList.add('warn');
    return;
  }
  if (people > 0 && sumPeople !== people) {
    const diff = sumPeople - people;
    const diffMsg = diff > 0 ? `${diff}명 초과` : `${-diff}명 부족`;
    hintEl.innerHTML = `현재 <b>객실 ${totalRooms}개 · 수용 ${sumPeople}명</b> — 인원수 ${people}명과 ${diffMsg}`;
    hintEl.classList.add('warn');
    return;
  }
  hintEl.innerHTML = `총 <b>객실 ${totalRooms}개 · ${sumPeople}명</b> 배정 (${roomAllocSummary(alloc)})`;
  hintEl.classList.add('ok');
}

function readForm() {
  const departures = departureAC.value || [];
  const workStart = $('#work-start').value;
  const workEnd = $('#work-end').value;
  const people = Number($('#people').value) || 1;
  const cabinClass = $('#cabin-class').value;
  const roomAllocation = readRoomAllocationInputs();
  const allowTransfer = $('#allow-transfer').checked;
  const preferDirect = $('#prefer-direct').checked;
  const restHours = Number($('#rest-hours').value) || 12;
  const postHours = Number($('#post-hours').value) || 4;
  const minLayoverMinutes = Number($('#min-layover').value) || DEFAULT_MIN_LAYOVER_MINUTES;
  const id = $('#trip-id').value || uid();
  const name = $('#trip-name').value.trim();

  const errors = [];
  if (!departures || departures.length === 0) errors.push('출발지를 한 곳 이상 선택해 주세요.');
  if (!selectedDestination) errors.push('도착지(주소·지역)를 검색하여 선택해 주세요.');
  if (selectedArrivalCodes.length === 0) errors.push('도착 공항을 한 곳 이상 선택해 주세요.');
  if (selectedDestination && departures.some((d) => selectedArrivalCodes.indexOf(d.code) >= 0)) {
    errors.push('출발지와 도착 공항이 같습니다.');
  }
  if (!workStart) errors.push('업무 시작 일시를 입력해 주세요.');
  if (!workEnd) errors.push('업무 종료 일시를 입력해 주세요.');
  if (workStart && workEnd && new Date(workStart) >= new Date(workEnd)) {
    errors.push('업무 종료 시각은 시작 시각보다 뒤여야 합니다.');
  }
  if (people < 1) errors.push('인원수는 최소 1명입니다.');

  const totalRooms = roomAllocCount(roomAllocation);
  const sumPeople = roomAllocPeople(roomAllocation);
  if (totalRooms === 0) {
    errors.push('객실을 1개 이상 배정해 주세요.');
  } else if (sumPeople !== people) {
    const diff = sumPeople - people;
    errors.push(diff > 0
      ? `객실 수용 인원(${sumPeople}명)이 인원수(${people}명)보다 ${diff}명 많습니다.`
      : `객실 수용 인원(${sumPeople}명)이 인원수(${people}명)보다 ${-diff}명 부족합니다.`);
  }

  const destination = selectedDestination ? {
    query: selectedDestination.query,
    displayName: selectedDestination.displayName,
    lat: selectedDestination.lat,
    lng: selectedDestination.lng,
    countryCode: selectedDestination.countryCode || '',
    city: selectedDestination.city || ''
  } : null;

  return {
    errors,
    trip: {
      id, name,
      departures: departures.map((d) => ({ code: d.code, city: d.city, cityEn: d.cityEn, country: d.country, label: d.label })),
      destination,
      arrivalAirports: selectedArrivalCodes.slice(),
      workStart, workEnd, people, cabinClass, roomAllocation, allowTransfer, preferDirect, restHours, postHours, minLayoverMinutes
    }
  };
}

// ============== 상세 화면 ==============
function openDetail(id) {
  const trip = getTrip(id);
  if (!trip) { toast('출장 계획을 찾을 수 없습니다.'); return; }
  currentTripId = id;
  renderDetail(trip);
  showView('detail');
}

function renderDetail(trip) {
  let plan;
  try { plan = calculatePlan(trip); }
  catch (e) {
    $('#trip-detail-content').innerHTML = `<p class="error">계획 계산 중 오류가 발생했습니다.</p>`;
    return;
  }

  const departures = Array.isArray(trip.departures) ? trip.departures : [];
  const dest = trip.destination || {};
  const arrCodes = Array.isArray(trip.arrivalAirports) ? trip.arrivalAirports : [];
  const arrAirports = arrCodes
    .map((c) => airportByCode(c))
    .filter(Boolean)
    .map((a) => Object.assign({}, a, {
      distance: (typeof dest.lat === 'number' && typeof a.lat === 'number')
        ? haversineKm(dest.lat, dest.lng, a.lat, a.lng) : null
    }));

  const bookingDistanceUrl = buildBookingUrl(trip, plan, { order: 'distance_from_search' });
  const bookingPriceUrl = buildBookingUrl(trip, plan, { order: 'price' });
  const hotelsUrl = buildHotelsComUrl(trip, plan);
  const agodaUrl = buildAgodaUrl(trip, plan);
  const mapsUrl = buildGoogleMapsHotelsUrl(trip, plan);

  const minLay = tripMinLayover(trip);
  const minLayLabel = (minLay % 60 === 0)
    ? `${minLay / 60}시간`
    : `${Math.floor(minLay / 60)}시간 ${minLay % 60}분`;
  const transferNote = trip.allowTransfer
    ? `<b>환승 최소 ${minLayLabel} 자동 적용</b> — 재수속 + 항공편 지연 대비. Skyscanner URL에 <code>stopduration=${minLay}min</code> 필터가 포함됩니다.`
    : '직항만 검색합니다.';
  const directNote = trip.preferDirect ? ' 직항 우선 옵션이 활성화되어 있습니다.' : '';

  const roomsLine = `<b>${plan.rooms}개 객실 · ${roomAllocPeople(plan.roomAllocation)}명 수용</b> (${roomAllocSummary(plan.roomAllocation)})`;

  const firstDep = departures[0];
  const titleFirst = (firstDep && firstDep.city) || '?';
  const titleExtra = departures.length > 1 ? ` 외 ${departures.length - 1}` : '';
  const destCity = dest.city || (dest.displayName || '').split(',')[0] || '?';
  const fallbackTitle = `${titleFirst}${titleExtra} → ${destCity}`;
  const detailTitle = (trip.name && trip.name.trim()) || fallbackTitle;

  const depCodesHtml = departures.length === 0
    ? `<span class="iata">?</span>`
    : departures.map((d) => `<span class="iata">${escapeHtml(d.code)}</span>`).join(`<span class="comma">,</span>`);
  const arrCodesHtml = arrAirports.length === 0
    ? `<span class="iata">?</span>`
    : arrAirports.map((a) => `<span class="iata">${escapeHtml(a.code)}</span>`).join(`<span class="comma">,</span>`);

  // 도착 공항 정보 — 거리/도시
  const arrivalDetailHtml = arrAirports.length === 0
    ? '-'
    : arrAirports.map((a) => {
        const dist = a.distance != null
          ? ` <span class="muted small">${a.distance < 10 ? a.distance.toFixed(1) : Math.round(a.distance)}km</span>`
          : '';
        return `<span class="airport-pill"><span class="ap-iata">${escapeHtml(a.code)}</span> ${escapeHtml(a.city)}${dist}</span>`;
      }).join(' ');

  // 출발지 × 도착공항 → 항공 검색 카드 매트릭스
  let flightsHtml;
  if (departures.length === 0 || arrAirports.length === 0) {
    flightsHtml = `<p class="muted">출발지/도착공항이 선택되지 않았습니다. 편집에서 추가해 주세요.</p>`;
  } else {
    flightsHtml = departures.map((origin) => {
      const innerCards = arrAirports.map((arr) => {
        const skyUrl = buildSkyscannerUrl(trip, plan, origin, arr.code);
        const skyAltUrl = buildSkyscannerOriginAlt(trip, plan, origin, arr.code);
        const googleUrl = buildGoogleFlightsUrl(trip, plan, origin, arr);
        const distLabel = arr.distance != null
          ? `${arr.distance < 10 ? arr.distance.toFixed(1) : Math.round(arr.distance)}km`
          : '';
        return `
          <div class="route-row">
            <div class="route-info">
              <span class="iata">${escapeHtml(origin.code)}</span>
              <span class="arrow">→</span>
              <span class="iata">${escapeHtml(arr.code)}</span>
              <span class="route-meta">${escapeHtml(arr.city)} ${distLabel ? `· ${distLabel}` : ''}</span>
            </div>
            <div class="cta-row">
              <a class="primary-btn" href="${skyUrl}" target="_blank" rel="noopener">Skyscanner</a>
              <a class="ghost-btn" href="${skyAltUrl}" target="_blank" rel="noopener">±일자</a>
              <a class="ghost-btn" href="${googleUrl}" target="_blank" rel="noopener">Google Flights</a>
            </div>
          </div>
        `;
      }).join('');
      return `
        <div class="origin-block">
          <div class="origin-head">
            <span class="iata">${escapeHtml(origin.code)}</span>
            <span class="origin-city">${escapeHtml(origin.city)} (${escapeHtml(origin.country)}) 출발</span>
          </div>
          ${innerCards}
        </div>
      `;
    }).join('');
  }

  const paramsRows = (departures.length === 0 || arrAirports.length === 0)
    ? `<div><dt>Skyscanner</dt><dd>조합 미완성</dd></div>`
    : departures.flatMap((origin) =>
        arrAirports.map((arr) => `
          <div><dt>${escapeHtml(origin.code)} → ${escapeHtml(arr.code)}</dt>
            <dd>${shortDate(plan.arrivalBy)} → ${shortDate(plan.departAfter)} · 왕복 · 성인 ${plan.people}</dd>
          </div>
        `)
      ).join('');

  const destLat = (typeof dest.lat === 'number') ? dest.lat.toFixed(4) : '-';
  const destLng = (typeof dest.lng === 'number') ? dest.lng.toFixed(4) : '-';

  $('#trip-detail-content').innerHTML = `
    <div class="detail-card">
      <div class="detail-head">
        <div>
          <div class="detail-title">${escapeHtml(detailTitle)}</div>
          <div class="detail-route">
            ${depCodesHtml}
            <span class="arrow">→</span>
            ${arrCodesHtml}
          </div>
        </div>
        <div class="detail-actions">
          <button class="ghost-btn" id="edit-btn">편집</button>
          <button class="danger-btn" id="delete-btn">삭제</button>
        </div>
      </div>

      <dl class="kv">
        <div><dt>업무 시작</dt><dd>${fmtDateTimeKor(plan.workStart)}</dd></div>
        <div><dt>업무 종료</dt><dd>${fmtDateTimeKor(plan.workEnd)}</dd></div>
        <div><dt>인원</dt><dd>${plan.people}명 · ${escapeHtml(trip.cabinClass || 'economy')}</dd></div>
        <div><dt>객실</dt><dd>${roomsLine}</dd></div>
      </dl>
    </div>

    <div class="detail-card">
      <h2 class="card-h">📍 도착지</h2>
      <dl class="kv">
        <div><dt>주소</dt><dd>${escapeHtml(dest.displayName || dest.query || '-')}</dd></div>
        <div><dt>좌표</dt><dd class="mono small">${destLat}, ${destLng}</dd></div>
        <div><dt>도착 공항</dt><dd class="airport-pills">${arrivalDetailHtml}</dd></div>
        <div><dt>출발지</dt><dd>${departures.map((d) => escapeHtml(d.label)).join(', ') || '-'}</dd></div>
      </dl>
      <div class="cta-row">
        <a class="ghost-btn" href="https://www.google.com/maps/?q=${encodeURIComponent(dest.displayName || (dest.lat + ',' + dest.lng))}" target="_blank" rel="noopener">Google Maps에서 보기</a>
      </div>
    </div>

    <div class="detail-card">
      <h2 class="card-h">✈️ 추천 항공 일정</h2>
      <div class="callout">
        <div class="callout-title">도착 시각 자동 산출</div>
        <ul class="calc-list">
          <li>업무 시작 — <b>${fmtDateTimeKor(plan.workStart)}</b></li>
          <li>− 휴식 시간 <b>${plan.restHours}h</b></li>
          <li>− 도착편 지연 buffer <b>${plan.arrivalDelayBuffer}h</b> <span class="muted">(항공편이 늦게 도착해도 휴식 보장)</span></li>
          <li class="calc-result">= 권장 정시 도착 <b>${fmtDateTimeKor(plan.arrivalBy)}</b> 이전</li>
        </ul>
      </div>
      <dl class="kv">
        <div><dt>출국일 (출발지 → 도착)</dt><dd>${fmtDateKor(plan.arrivalBy)}</dd></div>
        <div><dt>귀국일 (도착 → 출발지)</dt><dd>${fmtDateKor(plan.departAfter)}</dd></div>
        <div><dt>현지 출국 가능 시각</dt><dd>${fmtDateTimeKor(plan.departAfter)} 이후 <span class="muted small">(업무종료 + ${plan.postHours}h)</span></dd></div>
      </dl>
      <p class="muted small">${transferNote}${directNote}</p>
      ${trip.allowTransfer ? `<div class="callout warn">
        <div class="callout-title">⚠ Skyscanner 결과 페이지 안내</div>
        <p class="small">URL에 환승 최소 <b>${minLayLabel}</b> 필터를 포함했지만, Skyscanner UI가 자동 적용하지 못할 수 있습니다.
        결과 페이지 좌측 <b>"환승 시간"</b> 필터에서 <b>최소 ${minLayLabel}</b>으로 직접 설정해 주세요.</p>
      </div>` : ''}
      ${(departures.length * arrAirports.length) > 1 ? `<p class="muted small"><b>${departures.length}개 출발지 × ${arrAirports.length}개 도착공항 = ${departures.length * arrAirports.length}개 조합</b> — 가격을 비교해 보세요.</p>` : ''}
      <div class="origins-list">${flightsHtml}</div>
    </div>

    <div class="detail-card">
      <h2 class="card-h">🏨 추천 숙소 — 도착지 가까운 순</h2>
      <dl class="kv">
        <div><dt>체크인</dt><dd>${fmtDateKor(new Date(plan.checkIn))}</dd></div>
        <div><dt>체크아웃</dt><dd>${fmtDateKor(new Date(plan.checkOut))}</dd></div>
        <div><dt>박수</dt><dd>${plan.nights}박</dd></div>
        <div><dt>객실 수</dt><dd>${roomsLine}</dd></div>
        <div><dt>검색 기준점</dt><dd>${escapeHtml(dest.displayName || '-')}</dd></div>
      </dl>
      <p class="muted small">Booking.com 검색 시 도착지 좌표 기반 <b>거리순 정렬</b>이 자동 적용됩니다. 가격순 검색은 별도 버튼을 사용하세요. 1인당 가격은 결과 페이지에서 <b>총액 ÷ ${plan.people}명</b> 입니다.</p>
      <div class="cta-row">
        <a class="primary-btn" href="${bookingDistanceUrl}" target="_blank" rel="noopener">Booking.com — 가까운 순</a>
        <a class="ghost-btn" href="${bookingPriceUrl}" target="_blank" rel="noopener">Booking.com — 저가순</a>
      </div>
      <div class="cta-row">
        <a class="ghost-btn" href="${hotelsUrl}" target="_blank" rel="noopener">Hotels.com</a>
        <a class="ghost-btn" href="${agodaUrl}" target="_blank" rel="noopener">Agoda</a>
        <a class="ghost-btn" href="${mapsUrl}" target="_blank" rel="noopener">Google Maps 호텔</a>
      </div>
    </div>

    <div class="detail-card subtle">
      <h2 class="card-h">📋 검색 파라미터</h2>
      <dl class="kv mono">
        ${paramsRows}
        <div><dt>체크인 / 체크아웃</dt><dd>${plan.checkIn} → ${plan.checkOut} (${plan.nights}박)</dd></div>
      </dl>
      <p class="muted small">실시간 가격은 외부 사이트에서 표시됩니다. 본 앱은 검색 조건을 자동 구성하는 역할입니다.</p>
    </div>
  `;

  $('#edit-btn').addEventListener('click', () => {
    loadFormFromTrip(trip);
    showView('form', { editing: true });
  });
  $('#delete-btn').addEventListener('click', () => {
    if (confirm('이 출장 계획을 삭제하시겠습니까?')) {
      deleteTrip(trip.id);
      toast('삭제되었습니다.');
      showView('list');
    }
  });
}

// ============== HTML 이스케이프 ==============
function escapeHtml(s) {
  return safeText(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// ============== 이벤트 바인딩 ==============
function bindEvents() {
  $('#fab').addEventListener('click', () => {
    resetForm();
    showView('form', { editing: false });
  });
  $('#back-btn').addEventListener('click', goBack);
  $('#cancel-btn').addEventListener('click', () => showView('list'));

  $('#trip-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const { errors, trip } = readForm();
    if (errors.length) { toast(errors[0]); return; }
    upsertTrip(trip);
    toast('저장되었습니다.');
    openDetail(trip.id);
  });

  // 객실 배정 실시간 안내 + 인원수 변경 시 자동 분배
  ['#rooms-1', '#rooms-2', '#rooms-3', '#rooms-4'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('input', updateRoomAllocHint);
  });
  const peopleEl = $('#people');
  if (peopleEl) {
    peopleEl.addEventListener('input', () => {
      const people = Math.max(0, Number(peopleEl.value) || 0);
      const alloc = readRoomAllocationInputs();
      // 사용자가 손대지 않은 기본 상태(=다른 모든 칸 0)면 r1을 사람 수에 맞춰 자동 추적
      if (alloc.r2 === 0 && alloc.r3 === 0 && alloc.r4 === 0) {
        setRoomAllocationInputs({ r1: people, r2: 0, r3: 0, r4: 0 });
      }
      updateRoomAllocHint();
    });
  }
  const autoBtn = $('#rooms-auto-btn');
  if (autoBtn) {
    autoBtn.addEventListener('click', () => {
      const people = Math.max(0, Number($('#people').value) || 0);
      setRoomAllocationInputs({ r1: people, r2: 0, r3: 0, r4: 0 });
      updateRoomAllocHint();
    });
  }

  // 안드로이드 뒤로가기 처리: history API 활용
  window.addEventListener('popstate', (e) => {
    const state = e.state || { view: 'list' };
    if (state.view === 'detail' && state.tripId) {
      const trip = getTrip(state.tripId);
      if (trip) {
        currentTripId = state.tripId;
        renderDetail(trip);
        showView('detail', { fromHistory: true });
        return;
      }
    }
    showView(state.view || 'list', { fromHistory: true });
  });
}

// ============== 초기화 ==============
function init() {
  bindEvents();
  resetForm();
  // 초기 history state 등록 — popstate에서 정상 복원하기 위함
  history.replaceState({ view: 'list' }, '');
  showView('list', { fromHistory: true });
}

init();
