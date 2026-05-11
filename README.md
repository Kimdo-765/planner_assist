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
│   ├── generate_keystore.py # Android 서명용 PKCS12 keystore 생성 (1회용)
│   ├── make_icons.py        # 아이콘 재생성
│   └── test_logic.js        # Node 단위 테스트 (48 cases)
├── .well-known/
│   └── assetlinks.json      # TWA 풀스크린 검증 (SHA-256 fingerprint)
├── netlify.toml             # Netlify 배포 설정
├── vercel.json              # Vercel 배포 설정
├── _headers / _redirects    # Netlify / Cloudflare Pages
├── .github/workflows/
│   ├── deploy.yml           # GitHub Pages 자동 배포
│   └── release-apk.yml      # 태그 푸시 → APK 빌드 → Releases 첨부
├── twa-manifest.json        # Bubblewrap TWA 설정
└── docs/ANDROID_APK.md      # APK 로컬 빌드 가이드 (TWA)
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

### C. 진짜 `.apk` 파일 — GitHub Actions 자동 빌드 + Releases

이 저장소에는 태그를 푸시하면 **APK / AAB 를 자동으로 빌드해서 GitHub Releases 에
첨부** 하는 워크플로(`.github/workflows/release-apk.yml`)가 들어 있습니다.

#### 1) GitHub Secrets 4개 등록 (최초 1회)

저장소 → **Settings → Secrets and variables → Actions → New repository secret**

| Secret 이름 | 값 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `android.keystore.base64` 파일 내용 전체 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 생성 시 출력된 비밀번호 |
| `ANDROID_KEY_PASSWORD` | (PKCS12 는 동일) |
| `ANDROID_KEY_ALIAS` | `android` |

keystore 가 없으면:

```bash
python3 scripts/generate_keystore.py
# → android.keystore, android.keystore.base64, keystore-info.txt 생성
```

`keystore-info.txt` 에 위 4개 값이 모두 있습니다. **`.gitignore` 로 자동 제외**되므로 푸시되지 않습니다. Secrets 등록을 끝낸 뒤에는 안전한 곳(1Password, 비밀 USB 등)으로 옮기세요.

#### 2) Digital Asset Links — 풀스크린(주소창 숨김) 검증

TWA APK 가 풀스크린으로 뜨려면 호스팅 도메인 루트에서 `/.well-known/assetlinks.json` 이 200 OK 로 내려가야 합니다.

이 저장소의 `.well-known/assetlinks.json` 에 SHA-256 fingerprint 가 이미 들어 있어, GitHub Pages 가 배포한 사이트에 자동 포함됩니다. **다만 GitHub Pages 의 user-page 서브패스 (`/planner_assist/`) 구조 때문에**, TWA 가 검증하는 경로는 호스트 루트(`https://kimdo-765.github.io/.well-known/assetlinks.json`) 입니다 — 즉, 이 파일이 **`kimdo-765.github.io`** 라는 별도 저장소에 호스팅되어 있어야 합니다.

**해결 방법**:

1. GitHub 에서 `kimdo-765.github.io` 라는 이름의 새 저장소 생성 (user-page)
2. 그 저장소 루트에 `.well-known/assetlinks.json` 파일 추가 — 본 저장소의 동일 파일을 그대로 복사
3. 푸시하면 `https://kimdo-765.github.io/.well-known/assetlinks.json` 에서 즉시 응답

> 이 단계를 건너뛰어도 APK 는 동작합니다. 다만 풀스크린 검증이 실패해 주소창이 보일 수 있습니다 (Chrome Custom Tab 폴백).

#### 3) 릴리스 만들기 = 태그 하나 푸시

```bash
git tag v1.0.0
git push --tags
```

워크플로가 자동으로:

1. Java 17 / Node 20 / Android SDK 설치
2. Bubblewrap 으로 Android 프로젝트 생성 + APK/AAB 빌드 (서명 포함)
3. **Releases v1.0.0** 생성하고 다음 자산 첨부
   - `planner-assist-1.0.0.apk` — 사이드로딩용
   - `planner-assist-1.0.0.aab` — Play 스토어용
   - `SHA256SUMS.txt` — 무결성 해시

수동으로 빌드만 해보고 싶다면 Actions 탭 → `Build APK & Publish Release` → `Run workflow`. 태그가 없을 때는 Release 가 만들어지지 않고 artifacts 만 다운로드됩니다.

#### 4) 단말에 설치

```bash
# 옵션 A: PC에서 adb 로 설치
adb install -r planner-assist-1.0.0.apk

# 옵션 B: APK 를 단말에 옮긴 뒤 탭하여 설치 (출처 알 수 없는 앱 허용 필요)
```

> TWA 는 단말의 Chrome 엔진을 사용합니다. 호스팅된 PWA 가 갱신되면 APK 재배포
> 없이도 앱 내용이 자동 갱신됩니다. APK 재빌드는 versionCode / 권한 / 매니페스트
> 자체를 바꿀 때만 필요합니다.

로컬에서 수동으로 빌드하고 싶다면 [`docs/ANDROID_APK.md`](docs/ANDROID_APK.md) 참고.

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
