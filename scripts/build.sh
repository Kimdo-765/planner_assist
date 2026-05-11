#!/usr/bin/env bash
# Build a production distribution of the Planner Assist PWA.
#
# 결과물:
#   dist/             — 정적 호스팅에 그대로 업로드 가능한 모든 파일
#   release.zip       — dist 내용을 zip 으로 압축한 배포 패키지
#
# Usage:
#   bash scripts/build.sh                # 기본 빌드
#   BUILD_VERSION=v1.2.3 bash scripts/build.sh   # SW 캐시 버전 강제 지정

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DIST_DIR="$ROOT_DIR/dist"
ZIP_PATH="$ROOT_DIR/release.zip"

# 버전: 인자가 없으면 UTC 타임스탬프
VERSION="${BUILD_VERSION:-$(date -u +%Y%m%d-%H%M%S)}"

echo "==> 1) 기존 산출물 정리"
rm -rf "$DIST_DIR" "$ZIP_PATH"
mkdir -p "$DIST_DIR"

echo "==> 2) 정적 파일 복사 (dist/)"
cp index.html        "$DIST_DIR/"
cp styles.css        "$DIST_DIR/"
cp app.js            "$DIST_DIR/"
cp airports.js       "$DIST_DIR/"
cp manifest.webmanifest "$DIST_DIR/"
cp service-worker.js "$DIST_DIR/"
cp -r icons          "$DIST_DIR/"

# TWA assetlinks (Digital Asset Links — APK 풀스크린 검증용)
if [ -d ".well-known" ]; then cp -r .well-known "$DIST_DIR/"; fi

# 호스팅별 헤더/리다이렉트 설정 동봉
if [ -f "_headers" ]; then cp _headers "$DIST_DIR/"; fi
if [ -f "_redirects" ]; then cp _redirects "$DIST_DIR/"; fi

echo "==> 3) Service Worker 캐시 버전 갱신: $VERSION"
# planner-assist-vN → planner-assist-<VERSION>
python3 - "$DIST_DIR/service-worker.js" "$VERSION" <<'PY'
import re, sys, pathlib
sw_path, version = sys.argv[1], sys.argv[2]
p = pathlib.Path(sw_path)
text = p.read_text(encoding='utf-8')
new_text, n = re.subn(
    r"const\s+CACHE_NAME\s*=\s*'[^']+'\s*;",
    f"const CACHE_NAME = 'planner-assist-{version}';",
    text,
    count=1,
)
if n != 1:
    sys.exit(f"service-worker.js: CACHE_NAME 라인을 찾지 못했습니다.")
p.write_text(new_text, encoding='utf-8')
print(f"   service-worker.js CACHE_NAME = planner-assist-{version}")
PY

echo "==> 4) manifest / 필수 자산 검증"
python3 - "$DIST_DIR" <<'PY'
import json, sys, pathlib
dist = pathlib.Path(sys.argv[1])
manifest = json.loads((dist / "manifest.webmanifest").read_text(encoding='utf-8'))
required_keys = ["name", "short_name", "start_url", "scope", "display", "icons"]
for k in required_keys:
    if k not in manifest:
        sys.exit(f"manifest 누락: {k}")
icons = manifest["icons"]
sizes = {i.get("sizes") for i in icons}
for need in ("192x192", "512x512"):
    if need not in sizes:
        sys.exit(f"manifest icons: {need} 누락")
for i in icons:
    f = dist / i["src"]
    if not f.exists():
        sys.exit(f"아이콘 파일 없음: {f}")
must_have = ["index.html", "app.js", "airports.js", "styles.css",
             "service-worker.js", "manifest.webmanifest"]
for f in must_have:
    if not (dist / f).exists():
        sys.exit(f"필수 파일 없음: {f}")
print(f"   manifest OK · icons={len(icons)} · 필수 파일 OK")
PY

echo "==> 5) 자체 단위 테스트 실행 (계산/URL 빌더)"
node scripts/test_logic.js > /tmp/planner_assist_test.log 2>&1 || {
  echo "테스트 실패. 로그:"; cat /tmp/planner_assist_test.log; exit 1;
}
TAIL_LINE=$(grep -E '^결과:' /tmp/planner_assist_test.log || true)
echo "   $TAIL_LINE"

echo "==> 6) release.zip 패키징"
(
  cd "$DIST_DIR"
  zip -qr "$ZIP_PATH" .
)

SIZE=$(du -sh "$DIST_DIR" | awk '{print $1}')
ZIP_SIZE=$(du -sh "$ZIP_PATH" | awk '{print $1}')
echo
echo "================ BUILD DONE ================"
echo "dist/         : $DIST_DIR ($SIZE)"
echo "release.zip   : $ZIP_PATH ($ZIP_SIZE)"
echo "SW version    : planner-assist-$VERSION"
echo "============================================"
echo
echo "다음 단계:"
echo "  • Netlify: \`npx netlify deploy --dir=dist --prod\` (또는 dist 폴더를 https://app.netlify.com/drop 에 드래그)"
echo "  • Vercel : \`npx vercel --prod dist\`"
echo "  • Cloudflare Pages: \`npx wrangler pages deploy dist\`"
echo "  • GitHub Pages: 저장소 푸시 후 .github/workflows/deploy.yml 가 자동 배포"
echo "  • APK(TWA) : docs/ANDROID_APK.md 참고 — twa-manifest.json 으로 Bubblewrap 빌드"
