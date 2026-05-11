# Android APK 만들기 (TWA, Trusted Web Activity)

이미 PWA 로 동작하므로, Android 사용자는 Chrome 의 **홈 화면에 추가** 만으로
네이티브 앱처럼 사용할 수 있습니다. 그래도 **`.apk` 파일을 직접 배포**(사이드로딩)
하거나 **Google Play 에 올리고 싶다면** 아래 절차로 TWA 래퍼 APK 를 만들 수 있습니다.

> TWA = Trusted Web Activity. Chrome 엔진이 풀스크린으로 호스팅된 PWA URL 을
> 띄우는 얇은 네이티브 셸. 자체 WebView 가 아니라 사용자 단말의 Chrome 을 사용하므로
> 보안 업데이트가 자동 반영되고, 호스팅된 PWA 가 갱신되면 앱도 즉시 갱신됩니다.

---

## 0) 사전 조건

1. **PWA 가 HTTPS 도메인에 배포되어 있어야 합니다.**
   `localhost` / 사설 IP 로는 TWA 가 동작하지 않습니다.
   - 추천: GitHub Pages, Netlify, Vercel, Cloudflare Pages — 모두 무료 HTTPS 제공
2. **로컬에 설치할 것**
   - Java JDK 17 이상
   - Android SDK (또는 Android Studio)
   - Node.js 18 이상
   - `bubblewrap` CLI: `npm install -g @bubblewrap/cli`

---

## 1) 도메인 결정 & 매니페스트 자리표시자 치환

`twa-manifest.json` 안의 `REPLACE_WITH_YOUR_HTTPS_DOMAIN` 을 실제 도메인으로 바꿉니다.

예: `planner-assist.example.com`

```bash
sed -i 's/REPLACE_WITH_YOUR_HTTPS_DOMAIN/planner-assist.example.com/g' twa-manifest.json
```

> macOS 의 BSD `sed` 는 `-i ''` 가 필요합니다: `sed -i '' 's/.../.../g' twa-manifest.json`

---

## 2) Bubblewrap 으로 Android 프로젝트 생성

```bash
# 처음 한 번만: SDK 자동 다운로드 동의 + JAVA_HOME 자동 검색
bubblewrap doctor

# 기존 twa-manifest.json 으로부터 Android 프로젝트 폴더 생성
bubblewrap init --manifest=./twa-manifest.json --directory=./android
```

생성된 `android/` 안에 Gradle 기반 Android 프로젝트가 만들어집니다.

---

## 3) 서명 키 생성 (1 회)

```bash
keytool -genkey -v \
  -keystore android.keystore \
  -alias android \
  -keyalg RSA -keysize 2048 -validity 10000
```

> **이 키스토어 파일은 분실하면 Play 스토어에 더 이상 업데이트를 올릴 수 없습니다.**
> 안전한 곳에 백업하세요. 비밀번호도 잊지 말 것.

---

## 4) 빌드

### 서명된 릴리스 APK / AAB

```bash
cd android
bubblewrap build
```

산출물:

- `app-release-signed.apk`  ← **사이드로딩용** (USB 로 직접 설치 / 카톡으로 보내기 등)
- `app-release-bundle.aab`  ← **Play 스토어 업로드용**

> Bubblewrap 은 SHA-256 fingerprint 를 출력합니다. 이 값은 다음 단계에서 사용합니다.

---

## 5) Digital Asset Links — 주소창 숨김 (필수)

TWA 가 **풀스크린** 으로 뜨려면 (= 주소창 없이) 도메인이 자신의 APK 를 "신뢰"한다고
선언해야 합니다.

PWA 서버의 `/.well-known/assetlinks.json` 경로에 아래 파일을 호스팅하세요.

```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "app.plannerassist.twa",
    "sha256_cert_fingerprints": ["BUBBLEWRAP_BUILD_으로부터_받은_SHA256_FINGERPRINT"]
  }
}]
```

> Play 스토어 업로드 시 Google 이 **다른 서명 키** 로 재서명할 수 있습니다.
> 그 경우 Play Console → 앱 무결성 → "App signing key certificate" 의 SHA-256 도
> `sha256_cert_fingerprints` 배열에 추가해야 주소창이 사라집니다.

---

## 6) 단말 설치 (사이드로딩)

```bash
adb install -r app-release-signed.apk
```

또는 `app-release-signed.apk` 를 단말에 옮긴 뒤 파일을 탭하여 설치.
("출처 알 수 없는 앱 설치 허용" 이 필요합니다.)

---

## 7) (선택) Play 스토어 업로드

1. [Google Play Console](https://play.google.com/console) 에서 새 앱 만들기
2. 내부 테스트 트랙에 `app-release-bundle.aab` 업로드
3. 콘솔이 부여한 새 SHA-256 키도 `assetlinks.json` 에 추가
4. 스토어 등록 정보(스크린샷, 설명, 정책 등) 채우기 → 심사 제출

---

## 트러블슈팅

| 증상 | 원인 / 해결 |
| --- | --- |
| 앱 실행 시 주소창이 보임 | `assetlinks.json` 호스팅 실패 또는 SHA-256 불일치. `https://<도메인>/.well-known/assetlinks.json` 가 200 OK 로 JSON 을 내려주는지 확인 |
| 설치 후 "앱이 설치되지 않음" | 동일 packageId 의 다른 키로 서명된 앱이 이미 설치됨. 기존 앱 제거 후 재설치 |
| Bubblewrap 이 JDK 못 찾음 | `bubblewrap doctor` 후 안내대로 `JAVA_HOME` 설정 |
| Chrome 이 너무 오래된 단말 (Chrome < 72) | TWA 미지원. PWA "홈 화면에 추가" 로 폴백 |

---

## 요약: 가장 빠른 경로

PWA 만 잘 호스팅하면 사실 **APK 없이도 Android 사용자는 충분히 만족스럽게** 쓸 수 있습니다.
APK 가 굳이 필요한 경우는:

- 사내 MDM 으로 일괄 배포해야 한다
- Play 스토어에 노출되어야 한다
- 사용자가 Chrome 의 "홈 화면에 추가" 를 어려워한다

이 셋 중 하나라도 해당될 때만 위 작업을 진행하시면 됩니다.
