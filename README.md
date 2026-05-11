# 해외 출장 플래너 (Planner Assist)

해외 출장 일정에 맞춰 **항공편(Skyscanner)**·**숙소(Booking.com)** 검색 조건을
자동 구성해 주는 안드로이드용 **PWA(Progressive Web App)**.

- 출발지 / 현지 업무 시간을 입력하면 권장 출국·귀국일, 박수, 객실 수까지 자동 계산
- 환승 지연 대비 2~4시간 buffer · `outboundstopdurationmin` 자동 반영
- 인원수에 따른 1인 1실 / 2인 1실 객실 산출 (홀수 인원 포함)
- 모든 출장 계획은 단말 로컬 저장 (재열람·편집·삭제)
- Android Chrome 의 **홈 화면에 추가** 로 네이티브 앱처럼 설치 가능
- (선택) **Bubblewrap TWA** 로 `.apk` 까지 패키징 가능

---

## 1. 폴더 구조

```
planner_assist/
├── index.html               # SPA 셸
├── styles.css               # 모바일 우선 CSS
├── app.js                   # SPA 라우팅, 폼/상세, 일정 계산, URL 빌더
├── airports.js              # 113개 IATA 공항 데이터
├── manifest.webmanifest     # PWA manifest
├── service-worker.js        # 오프라인 캐싱
├── icons/                   # 앱 아이콘 (svg, 192, 512)
├── scripts/
│   ├── build.sh             # dist/ 와 release.zip 생성
│   ├── make_icons.py        # 아이콘 재생성
│   └── test_logic.js        # Node 단위 테스트 (48 cases)
├── netlify.toml             # Netlify 배포 설정
├── vercel.json              # Vercel 배포 설정
├── _headers / _redirects    # Netlify / Cloudflare Pages
├── .github/workflows/
│   └── deploy.yml           # GitHub Pages 자동 배포
├── twa-manifest.json        # Bubblewrap TWA 설정
└── docs/ANDROID_APK.md      # APK 빌드 가이드 (TWA)
```

---

## 2. 로컬 실행

```bash
# Python 내장 서버
python3 -m http.server 8080 --bind 0.0.0.0
# 또는 Node.js
npx serve -l 8080 .
```

브라우저에서 `http://localhost:8080/` 접속.

---

## 3. 배포판 빌드

```bash
bash scripts/build.sh
```

산출물:

- `dist/` — 정적 호스팅에 그대로 업로드할 수 있는 전체 파일
- `release.zip` — `dist/` 의 zip (예: 사내 정적 서버 업로드용)

빌드 스크립트가 자동으로 처리하는 것:

1. `service-worker.js` 의 `CACHE_NAME` 을 빌드 타임스탬프(또는 `BUILD_VERSION`)로 갱신 → 신규 배포 즉시 반영
2. `manifest.webmanifest` 의 필수 키와 아이콘 192/512 존재 검증
3. `node scripts/test_logic.js` (48 단위 테스트) 통과 여부 확인
4. `release.zip` 으로 패키징

```bash
# 캐시 버전을 직접 지정
BUILD_VERSION=v1.2.3 bash scripts/build.sh
```

---

## 4. Android 단말에서 사용 — 3 가지 경로

> 어떤 경로든 결과는 동일합니다: 홈 화면 아이콘에서 풀스크린으로 실행, 시스템 뒤로가기 정상 동작, 오프라인 캐시 사용.

### A. 같은 Wi-Fi 의 PC 서버 — 가장 빠른 임시 테스트

1. PC: `python3 -m http.server 8080 --bind 0.0.0.0`
2. PC IP 확인: `ip addr show | grep inet`
3. Android Chrome 에서 `http://<PC-IP>:8080/` 접속
4. Chrome 메뉴 → **홈 화면에 추가**
5. 홈 화면 아이콘으로 실행

> `localhost` / 사설 IP(192.168.x.x, 127.0.0.1) 는 HTTP 라도 service worker 가
> 등록됩니다. 외부 도메인은 HTTPS 가 필수입니다.

### B. HTTPS 정적 호스팅 — **공식 배포**

`dist/` 를 아래 중 어디든 올리고, Android Chrome 으로 그 URL 에 접속 → **홈 화면에 추가**.

| 호스팅 | 한 줄 배포 명령 | 비고 |
| --- | --- | --- |
| **GitHub Pages** | `git push` 만 하면 됨 | `.github/workflows/deploy.yml` 가 자동 빌드·배포 |
| **Netlify** | `npx netlify deploy --dir=dist --prod` | 또는 `dist/` 를 https://app.netlify.com/drop 에 드래그 |
| **Vercel** | `npx vercel --prod dist` | `vercel.json` 자동 인식 |
| **Cloudflare Pages** | `npx wrangler pages deploy dist` | 글로벌 CDN |

> 모두 무료 HTTPS 제공. 배포 후 URL 을 단말 Chrome 으로 열고 "홈 화면에 추가".

### C. 진짜 `.apk` 파일 — Bubblewrap TWA

스토어 업로드 / 사이드로딩 / 사내 MDM 일괄 배포가 필요한 경우.
**자세한 절차는 [`docs/ANDROID_APK.md`](docs/ANDROID_APK.md) 참고.**

요약:

```bash
# 1) twa-manifest.json 안의 도메인 자리표시자를 실제 호스팅 도메인으로 치환
sed -i 's/REPLACE_WITH_YOUR_HTTPS_DOMAIN/your.domain.com/g' twa-manifest.json

# 2) Bubblewrap 으로 Android 프로젝트 생성 & 빌드
npm i -g @bubblewrap/cli
bubblewrap init --manifest=./twa-manifest.json --directory=./android
cd android && bubblewrap build
# → app-release-signed.apk (사이드로딩), app-release-bundle.aab (Play 스토어)

# 3) /.well-known/assetlinks.json 를 도메인에 호스팅 (주소창 숨김)
# 4) adb install -r app-release-signed.apk  또는  Play 콘솔 업로드
```

> TWA 는 단말의 Chrome 엔진을 사용합니다. 따라서 호스팅된 PWA 가 갱신되면
> APK 재배포 없이도 앱 내용이 자동 갱신됩니다.

---

## 5. 기능 요약

| 영역 | 내용 |
| --- | --- |
| 입력 | 출발/도착 공항(자동완성·IATA 직접입력·여러 곳 선택), 현지 업무 시작/종료, 인원수, 객실 유형, 좌석 등급, 환승 허용/직항 선호 + 환승 최소 대기 시간(2~5h), 도착 후 휴식(6~24h), 업무 후 출국 여유(2~24h) |
| 계산 | 권장 도착 시각(`업무시작 - 휴식시간`), 권장 출국 시각(`업무종료 + 여유시간`), 출국일·귀국일, 체크인·체크아웃, 박수, 객실 수 |
| 출력 | Skyscanner (`adultsv2`, `cabinclass`, `preferdirects`, `outboundstopdurationmin`, `inboundstopdurationmin`), Booking.com (`group_adults`, `no_rooms`), Google Flights / Hotels.com / Agoda 대체 링크 |
| 저장 | `localStorage` (`planner_assist_trips_v1`) — 단말 영구 저장 |

### 객실 수 계산

- **1인 1실**: 객실 수 = 인원수
- **2인 1실**:
  - 짝수 인원: 객실 수 = 인원/2
  - 홀수 인원: 2인실 `floor(인원/2)` + 1인실 1
  - Booking.com URL: `no_rooms = ceil(인원/2)`, `group_adults = 인원`

### 환승 처리

- **환승 최소 대기 시간** 셀렉트 값 → Skyscanner URL 의 `outboundstopdurationmin` / `inboundstopdurationmin` 에 반영
- **도착편 지연 2시간 buffer** 는 일정 계산(권장 도착 시각)에 자동 가산
- **직항 선호** 체크 시 `preferdirects=true`

---

## 6. 검증

```bash
node scripts/test_logic.js
```

- 48 단위 테스트 (계산 / URL 빌더 / 공항 데이터)
- 케이스: 1인 단순 왕복, 4인 2인1실, 5인(홀수) 2인1실, 당일치기 최소 1박, 환승 시간 옵션, 공항 좌표 무결성 등

---

## 7. 한계

- **실시간 가격 조회는 외부 사이트(Skyscanner / Booking.com 등)에서 표시됩니다.**
  본 앱은 입력값으로부터 *검색 조건을 자동 구성* 하여 해당 사이트로 라우팅합니다.
- 시간대(time zone)는 입력값을 그대로 도착지 현지 시각으로 해석합니다. 단말 로컬 타임존과 무관하게 결과는 동일합니다.
- 공항 데이터에 없는 도시는 **IATA 3자리 코드** 를 직접 입력하면 됩니다 (예: `BKK`, `LHR`).

---

## 8. 라이선스

MIT (별도 표기가 없는 한).
