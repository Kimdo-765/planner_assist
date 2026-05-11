/* 단순 노드 테스트: 계산/URL 빌더 검증 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// browser 글로벌 더미
const window = {};
const localStorage = (() => {
  const store = {};
  return {
    getItem(k) { return store[k] || null; },
    setItem(k, v) { store[k] = String(v); },
    removeItem(k) { delete store[k]; }
  };
})();
const document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { addEventListener: () => {} }
};

const sandbox = { window, localStorage, document, console, URL, URLSearchParams, encodeURIComponent };
sandbox.window.AIRPORTS = [];
sandbox.localStorage = localStorage;

vm.createContext(sandbox);

// airports.js 로드
const airportsCode = fs.readFileSync(path.join(__dirname, '..', 'airports.js'), 'utf8');
vm.runInContext(airportsCode, sandbox);

// 함수만 추출하기 위해 app.js에서 바인딩 부분(init 호출 등)을 막을 수 없으니
// 필요한 함수들을 별도 파일에 추출하거나 여기서 다시 정의한다.
// 본 테스트는 핵심 계산만 검증한다.

function pad(n) { return String(n).padStart(2, '0'); }
function addHours(date, hours) { return new Date(date.getTime() + hours * 3600 * 1000); }
function dateOnly(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function shortDate(d) { return `${String(d.getFullYear()).slice(-2)}${pad(d.getMonth()+1)}${pad(d.getDate())}`; }
function dayDiff(a, b) {
  const A = new Date(a + 'T00:00:00');
  const B = new Date(b + 'T00:00:00');
  return Math.max(1, Math.round((B - A) / (24 * 3600 * 1000)));
}

const ARRIVAL_DELAY_BUFFER_HOURS = 2;
function calculatePlan(trip) {
  const workStart = new Date(trip.workStart);
  const workEnd = new Date(trip.workEnd);
  const restHours = Number(trip.restHours || 12);
  const postHours = Number(trip.postHours || 4);
  const arrivalBy = addHours(workStart, -(restHours + ARRIVAL_DELAY_BUFFER_HOURS));
  const departAfter = addHours(workEnd, postHours);
  const checkInDate = new Date(arrivalBy);
  let checkOutDate = new Date(departAfter);
  if (dateOnly(checkOutDate) <= dateOnly(checkInDate)) {
    checkOutDate = new Date(checkInDate.getTime() + 24 * 3600 * 1000);
  }
  const checkIn = dateOnly(checkInDate);
  const checkOut = dateOnly(checkOutDate);
  const nights = dayDiff(checkIn, checkOut);
  const outboundDate = dateOnly(arrivalBy);
  const returnDate = dateOnly(departAfter);
  const people = Math.max(1, Number(trip.people) || 1);
  const rooms = trip.roomMode === 'double' ? Math.ceil(people / 2) : people;
  let roomsBreakdown = null;
  if (trip.roomMode === 'double') {
    roomsBreakdown = { doubles: Math.floor(people/2), singles: people % 2 };
  }
  return { workStart, workEnd, arrivalBy, departAfter, outboundDate, returnDate, checkIn, checkOut, nights, people, rooms, roomsBreakdown };
}

const DEFAULT_MIN_LAYOVER = 120;
function tripMinLay(trip) {
  const v = Number(trip && trip.minLayoverMinutes);
  return Number.isFinite(v) && v >= 60 ? v : DEFAULT_MIN_LAYOVER;
}
function buildSkyscannerUrl(trip, plan, origin, arrivalCode) {
  const from = (origin && origin.code || '').toLowerCase();
  const to = (arrivalCode || '').toLowerCase();
  const out = shortDate(plan.arrivalBy);
  const ret = shortDate(plan.departAfter);
  const minLay = tripMinLay(trip);
  const params = new URLSearchParams({
    adultsv2: String(plan.people),
    cabinclass: trip.cabinClass || 'economy',
    childrenv2: '',
    rtn: '1',
    preferdirects: trip.preferDirect ? 'true' : 'false',
    outboundstopdurationmin: String(minLay),
    inboundstopdurationmin: String(minLay)
  });
  return `https://www.skyscanner.co.kr/transport/flights/${from}/${to}/${out}/${ret}/?${params}`;
}
function buildBookingUrl(trip, plan, opts) {
  opts = opts || {};
  const dest = trip.destination || {};
  const params = new URLSearchParams({
    ss: dest.displayName || dest.query || dest.city || '',
    checkin: plan.checkIn,
    checkout: plan.checkOut,
    group_adults: String(plan.people),
    no_rooms: String(plan.rooms),
    group_children: '0',
    selected_currency: 'KRW'
  });
  if (typeof dest.lat === 'number' && typeof dest.lng === 'number') {
    params.set('latitude', dest.lat.toFixed(6));
    params.set('longitude', dest.lng.toFixed(6));
    params.set('order', opts.order || 'distance_from_search');
  }
  return `https://www.booking.com/searchresults.ko.html?${params}`;
}

// ----- 거리/인근 공항 -----
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function nearestAirports(airports, lat, lng, n) {
  return airports
    .filter((a) => typeof a.lat === 'number')
    .map((a) => Object.assign({}, a, { distance: haversineKm(lat, lng, a.lat, a.lng) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, n);
}

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✓', msg); }
  else { fail++; console.error('  ✗', msg); }
}
function assertEq(a, b, msg) {
  if (a === b) { pass++; console.log('  ✓', msg, '=>', a); }
  else { fail++; console.error('  ✗', msg, '\n     expected:', b, '\n     actual:', a); }
}

console.log('\n[ 케이스 1: 서울 → 도쿄(NRT), 2박, 1명 ]');
const t1 = {
  departures: [{ code: 'ICN', city: 'Seoul', cityEn: 'Seoul' }],
  destination: { displayName: 'Tokyo, Japan', query: 'Tokyo', city: 'Tokyo', lat: 35.6762, lng: 139.6503 },
  arrivalAirports: ['NRT'],
  workStart: '2026-05-15T09:00',
  workEnd:   '2026-05-16T18:00',
  people: 1,
  roomMode: 'single',
  restHours: 12,
  postHours: 4,
  cabinClass: 'economy',
  preferDirect: false
};
const p1 = calculatePlan(t1);
console.log('  arrivalBy =', p1.arrivalBy.toISOString(), 'departAfter =', p1.departAfter.toISOString());
console.log('  outboundDate =', p1.outboundDate, 'returnDate =', p1.returnDate);
// workStart 2026-05-15 09:00, restHours 12, delay buffer 2 → arrivalBy = 2026-05-14 19:00
const expectedArrival = new Date('2026-05-15T09:00');
expectedArrival.setHours(expectedArrival.getHours() - 14);
assertEq(p1.arrivalBy.getTime(), expectedArrival.getTime(), 'arrivalBy = workStart - 14h (rest 12 + delay 2)');
assertEq(p1.outboundDate, '2026-05-14', '출국일은 업무시작 전일 (지연 buffer 반영)');
assertEq(p1.returnDate, '2026-05-16', '귀국일은 업무종료일 당일');
assertEq(p1.nights, 2, '2박');
assertEq(p1.rooms, 1, '1인 1실');
const skyUrl1 = buildSkyscannerUrl(t1, p1, t1.departures[0], t1.arrivalAirports[0]);
console.log('  Skyscanner URL:', skyUrl1);
assert(skyUrl1.includes('outboundstopdurationmin=120'), '환승 최소 2시간 (왕로) 자동 적용');
assert(skyUrl1.includes('inboundstopdurationmin=120'), '환승 최소 2시간 (귀로) 자동 적용');
const bookingUrl1 = buildBookingUrl(t1, p1);
console.log('  Booking URL:', bookingUrl1);
assert(bookingUrl1.includes('latitude=35.6762'), 'Booking URL에 lat 포함');
assert(bookingUrl1.includes('longitude=139.6503'), 'Booking URL에 lng 포함');
assert(bookingUrl1.includes('order=distance_from_search'), 'Booking URL에 거리순 정렬 포함');

console.log('\n[ 케이스 2: 서울 → 뉴욕(JFK), 3박, 4명 2인1실 ]');
const t2 = {
  departures: [{ code: 'ICN', city: 'Seoul', cityEn: 'Seoul' }],
  destination: { displayName: 'New York, USA', query: 'NYC', city: 'New York', lat: 40.7128, lng: -74.0060 },
  arrivalAirports: ['JFK'],
  workStart: '2026-06-10T10:00',
  workEnd:   '2026-06-12T17:00',
  people: 4,
  roomMode: 'double',
  restHours: 12,
  postHours: 4,
  cabinClass: 'business',
  preferDirect: true
};
const p2 = calculatePlan(t2);
assertEq(p2.rooms, 2, '4명 2인1실 = 2개 객실');
assertEq(p2.roomsBreakdown.doubles, 2, '2인실 2개');
assertEq(p2.nights, 3, '3박');
console.log('  Skyscanner URL:', buildSkyscannerUrl(t2, p2, t2.departures[0], t2.arrivalAirports[0]));

console.log('\n[ 케이스 3: 서울 → 파리(CDG), 5명 2인1실 ]');
const t3 = {
  departures: [{ code: 'ICN', city: 'Seoul', cityEn: 'Seoul' }],
  destination: { displayName: 'Paris, France', city: 'Paris', lat: 48.8566, lng: 2.3522 },
  arrivalAirports: ['CDG'],
  workStart: '2026-07-01T09:00',
  workEnd:   '2026-07-04T18:00',
  people: 5,
  roomMode: 'double',
  restHours: 18,
  postHours: 4,
  cabinClass: 'economy',
  preferDirect: false
};
const p3 = calculatePlan(t3);
console.log('  outbound =', p3.outboundDate, 'return =', p3.returnDate, 'nights =', p3.nights);
console.log('  rooms =', p3.rooms, 'breakdown =', JSON.stringify(p3.roomsBreakdown));
assertEq(p3.rooms, 3, '5명 2인1실 = 3개 객실');
assertEq(p3.roomsBreakdown.doubles, 2, '2인실 2개');
assertEq(p3.roomsBreakdown.singles, 1, '1인실 1개 (홀수 처리)');

console.log('\n[ 케이스 4: 당일치기 (업무 후 4시간 출국) ]');
const t4 = {
  departures: [{ code: 'ICN', city: 'Seoul', cityEn: 'Seoul' }],
  destination: { displayName: 'Osaka, Japan', city: 'Osaka', lat: 34.6937, lng: 135.5023 },
  arrivalAirports: ['KIX'],
  workStart: '2026-05-20T10:00',
  workEnd:   '2026-05-20T16:00',
  people: 2,
  roomMode: 'double',
  restHours: 6,
  postHours: 4,
  cabinClass: 'economy',
  preferDirect: false
};
const p4 = calculatePlan(t4);
console.log('  outbound =', p4.outboundDate, 'return =', p4.returnDate, 'nights =', p4.nights);
assert(p4.nights >= 1, '최소 1박 보장');

console.log('\n[ 케이스 5: 공항 데이터 검증 (확장 후) ]');
const a1 = sandbox.window.AIRPORTS.find(a => a.code === 'ICN');
const a2 = sandbox.window.AIRPORTS.find(a => a.code === 'NRT');
const a3 = sandbox.window.AIRPORTS.find(a => a.code === 'CDG');
const a4 = sandbox.window.AIRPORTS.find(a => a.code === 'AUS');
const a5 = sandbox.window.AIRPORTS.find(a => a.code === 'LIN');
const a6 = sandbox.window.AIRPORTS.find(a => a.code === 'YVR');
const a7 = sandbox.window.AIRPORTS.find(a => a.code === 'GRU');
const a8 = sandbox.window.AIRPORTS.find(a => a.code === 'CPT');
assert(a1 && a1.city === '서울', 'ICN = 서울');
assert(a2 && a2.cityEn === 'Tokyo', 'NRT cityEn = Tokyo');
assert(a3 && a3.country === '프랑스', 'CDG country = 프랑스');
assert(a4 && a4.city === '오스틴', '추가: 오스틴 (AUS)');
assert(a5 && a5.city === '밀라노', '추가: 밀라노 리나테 (LIN)');
assert(a6 && a6.country === '캐나다', '추가: 밴쿠버 (YVR)');
assert(a7 && a7.country === '브라질', '추가: 상파울루 (GRU)');
assert(a8 && a8.country === '남아프리카공화국', '추가: 케이프타운 (CPT)');
console.log('  total airports:', sandbox.window.AIRPORTS.length);
assert(sandbox.window.AIRPORTS.length >= 300, '300개 이상 공항 데이터');

console.log('\n[ 케이스 6: 멀티 출발지 + 멀티 도착공항 — 서울/부산 → 노포크/뉴포트뉴스 ]');
const t6 = {
  departures: [
    { code: 'ICN', city: 'Seoul', cityEn: 'Seoul' },
    { code: 'GMP', city: 'Seoul', cityEn: 'Seoul' }
  ],
  destination: {
    displayName: 'Suffolk, Virginia, United States',
    query: 'Suffolk Virginia',
    city: 'Suffolk',
    lat: 36.7282,
    lng: -76.5836,
    countryCode: 'US'
  },
  arrivalAirports: ['ORF', 'PHF'],
  workStart: '2026-08-01T09:00',
  workEnd:   '2026-08-02T18:00',
  people: 3,
  roomMode: 'double',
  restHours: 12,
  postHours: 4,
  cabinClass: 'economy',
  preferDirect: false
};
const p6 = calculatePlan(t6);
assertEq(p6.rooms, 2, '3명 2인1실 = 2개 객실');
const combos = [];
t6.departures.forEach(o => t6.arrivalAirports.forEach(a => combos.push([o.code, a])));
const skyUrls = combos.map(([o, a]) => buildSkyscannerUrl(t6, p6, t6.departures.find(d => d.code === o), a));
console.log('  생성된 항공 검색 URL:', skyUrls.length);
combos.forEach(([o,a], i) => console.log('    [' + o + '→' + a + ']', skyUrls[i]));
assertEq(skyUrls.length, 4, '2 출발 × 2 도착 = 4개 조합');
assert(skyUrls[0].includes('/icn/orf/'), 'ICN→ORF 포함');
assert(skyUrls[1].includes('/icn/phf/'), 'ICN→PHF 포함');
assert(skyUrls[2].includes('/gmp/orf/'), 'GMP→ORF 포함');
assert(skyUrls[3].includes('/gmp/phf/'), 'GMP→PHF 포함');
assertEq(new Set(skyUrls).size, 4, '4개 URL 모두 고유함');
assert(skyUrls.every(u => u.includes('outboundstopdurationmin=120')), '모든 조합에 환승 최소 2시간 적용');

const bookingUrl6 = buildBookingUrl(t6, p6);
console.log('  Booking URL (Suffolk 좌표 기반):', bookingUrl6);
assert(bookingUrl6.includes('latitude=36.7282'), '정확한 lat');
assert(bookingUrl6.includes('longitude=-76.5836'), '정확한 lng');
assert(bookingUrl6.includes('order=distance_from_search'), '거리순 정렬');
assert(bookingUrl6.includes('Suffolk'), 'ss=Suffolk 포함');

console.log('\n[ 케이스 7: 인근 공항 자동 매칭 — Suffolk 좌표 → 가장 가까운 공항 ]');
const ports = sandbox.window.AIRPORTS;
const near = nearestAirports(ports, 36.7282, -76.5836, 5);
console.log('  Suffolk(36.73, -76.58) 인근 공항 5곳:');
near.forEach(a => console.log('    ' + a.code + ' ' + a.city + '  ' + a.distance.toFixed(1) + 'km'));
assert(near.length === 5, '5개 결과');
assert(near[0].distance < 100, '가장 가까운 공항 100km 이내');
console.log('  최근접 공항:', near[0].code, '(' + near[0].city + ')', near[0].distance.toFixed(1) + 'km');

console.log('\n[ 케이스 8: 일본 도쿄 좌표 → 인근 공항 ]');
const tokyoNear = nearestAirports(ports, 35.6762, 139.6503, 3);
tokyoNear.forEach(a => console.log('    ' + a.code + ' ' + a.city + '  ' + a.distance.toFixed(1) + 'km'));
assert(tokyoNear.some(a => a.code === 'HND' || a.code === 'NRT'), 'HND/NRT 둘 중 하나가 도쿄 인근');

console.log('\n[ 케이스 사용자선택: 환승 최소 시간 옵션 ]');
const tLay = {
  departures: [{ code: 'ICN', city: 'Seoul', cityEn: 'Seoul' }],
  destination: { displayName: 'Frankfurt, Germany', city: 'Frankfurt', lat: 50.11, lng: 8.68 },
  arrivalAirports: ['FRA'],
  workStart: '2026-09-10T09:00',
  workEnd:   '2026-09-12T18:00',
  people: 2, roomMode: 'double', restHours: 12, postHours: 4, cabinClass: 'economy', preferDirect: false,
  minLayoverMinutes: 240   // 사용자가 4시간 선택
};
const pLay = calculatePlan(tLay);
const urlLay = buildSkyscannerUrl(tLay, pLay, tLay.departures[0], tLay.arrivalAirports[0]);
console.log('  URL:', urlLay);
assert(urlLay.includes('outboundstopdurationmin=240'), '사용자 선택값 240분 (4시간) 반영');
assert(urlLay.includes('inboundstopdurationmin=240'), '귀로도 240분');

const tDefault = Object.assign({}, tLay, { minLayoverMinutes: undefined });
const urlDefault = buildSkyscannerUrl(tDefault, pLay, tDefault.departures[0], tDefault.arrivalAirports[0]);
assert(urlDefault.includes('outboundstopdurationmin=120'), '미지정 시 기본 120분');

const tStrict = Object.assign({}, tLay, { minLayoverMinutes: 300 });
const urlStrict = buildSkyscannerUrl(tStrict, pLay, tStrict.departures[0], tStrict.arrivalAirports[0]);
assert(urlStrict.includes('outboundstopdurationmin=300'), '5시간 선택 시 300분');

console.log('\n[ 케이스 9: 공항 좌표 검증 ]');
const icn = ports.find(a => a.code === 'ICN');
const orf = ports.find(a => a.code === 'ORF');
assert(icn && typeof icn.lat === 'number', 'ICN 좌표 존재');
assert(orf && typeof orf.lat === 'number', 'ORF 좌표 존재');
console.log('  ICN:', icn.lat, icn.lng);
console.log('  ORF:', orf.lat, orf.lng);
const dist_icn_to_orf = haversineKm(icn.lat, icn.lng, orf.lat, orf.lng);
console.log('  ICN→ORF 직선거리:', dist_icn_to_orf.toFixed(0), 'km');
assert(dist_icn_to_orf > 10000 && dist_icn_to_orf < 13000, 'ICN-ORF 약 11000km');

console.log('\n========================================');
console.log(`결과: ${pass} 통과 / ${fail} 실패`);
process.exit(fail > 0 ? 1 : 0);
