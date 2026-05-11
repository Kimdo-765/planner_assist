#!/usr/bin/env python3
"""
Android TWA 서명용 PKCS12 keystore 생성.

산출물:
  android.keystore       — PKCS12 keystore (jarsigner / Bubblewrap 호환)
  android.keystore.base64— GitHub Secrets 업로드용 base64
  keystore-info.txt      — alias, 비밀번호, SHA-256 fingerprint (assetlinks 에 들어감)

Usage:
  python3 scripts/generate_keystore.py
  python3 scripts/generate_keystore.py --out /tmp/mykey.keystore

⚠️ keystore 파일과 비밀번호는 분실하면 같은 packageId 로 앱 업데이트를 못 합니다.
   안전한 곳에 백업하세요. (.gitignore 로 git 커밋은 자동 차단됨)
"""
import argparse
import base64
import datetime as dt
import hashlib
import secrets
import sys
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID


def generate_password(length: int = 24) -> str:
    # URL-safe, no padding — 32-bit shell-safe
    return secrets.token_urlsafe(length)[:length]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="android.keystore",
                    help="keystore 출력 경로 (기본: android.keystore)")
    ap.add_argument("--alias", default="android",
                    help="key alias (기본: android)")
    ap.add_argument("--cn", default="Planner Assist",
                    help="Common Name (기본: Planner Assist)")
    ap.add_argument("--org", default="Personal",
                    help="Organization (기본: Personal)")
    ap.add_argument("--country", default="KR",
                    help="Country (기본: KR)")
    ap.add_argument("--years", type=int, default=27,
                    help="유효기간 (년, 기본: 27 ≈ Google Play 권장 25년+)")
    args = ap.parse_args()

    out = Path(args.out)
    if out.exists():
        sys.exit(f"이미 존재함: {out} — 덮어쓰지 않습니다. 다른 경로를 지정하거나 삭제 후 재실행.")

    # 1) RSA 2048 키쌍
    print("→ RSA-2048 키 생성 중...")
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    # 2) self-signed 인증서
    name = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, args.country),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, args.org),
        x509.NameAttribute(NameOID.COMMON_NAME, args.cn),
    ])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5))
        .not_valid_after(now + dt.timedelta(days=365 * args.years))
        .sign(key, hashes.SHA256())
    )

    # 3) PKCS12 export
    storepass = generate_password()
    keypass = storepass  # PKCS12 는 사실상 한 비밀번호. Bubblewrap 도 동일 비번 가정
    p12 = pkcs12.serialize_key_and_certificates(
        name=args.alias.encode(),
        key=key,
        cert=cert,
        cas=None,
        encryption_algorithm=serialization.BestAvailableEncryption(storepass.encode()),
    )
    out.write_bytes(p12)
    out.chmod(0o600)

    # 4) SHA-256 fingerprint (assetlinks 용)
    der = cert.public_bytes(serialization.Encoding.DER)
    sha256 = hashlib.sha256(der).hexdigest().upper()
    fingerprint = ":".join(sha256[i:i + 2] for i in range(0, len(sha256), 2))

    # 5) base64 (GitHub Secrets 용)
    b64 = base64.b64encode(out.read_bytes()).decode()
    b64_path = out.with_suffix(out.suffix + ".base64")
    b64_path.write_text(b64)
    b64_path.chmod(0o600)

    # 6) 정보 파일
    info = f"""# Android TWA Keystore
생성 시각      : {now.isoformat()}
keystore 파일  : {out.resolve()}
포맷           : PKCS12
유효기간       : {args.years} 년 ({(now + dt.timedelta(days=365 * args.years)).date()} 까지)
alias          : {args.alias}
keystore 비번  : {storepass}
key 비번       : {keypass}
SHA-256 지문   : {fingerprint}

# GitHub Secrets 에 등록할 4 개 값
ANDROID_KEYSTORE_BASE64 = {b64_path.resolve()} 파일 내용 전체
ANDROID_KEYSTORE_PASSWORD = {storepass}
ANDROID_KEY_PASSWORD = {keypass}
ANDROID_KEY_ALIAS = {args.alias}

# assetlinks.json 에 들어갈 값
"sha256_cert_fingerprints": ["{fingerprint}"]
"""
    info_path = out.parent / "keystore-info.txt"
    info_path.write_text(info)
    info_path.chmod(0o600)

    print()
    print(info)
    print(f"→ keystore       : {out.resolve()}")
    print(f"→ base64         : {b64_path.resolve()}")
    print(f"→ info (비공개!) : {info_path.resolve()}")
    print()
    print("⚠️  keystore-info.txt 는 비밀번호가 평문으로 들어 있습니다.")
    print("    GitHub Secrets 등록을 끝낸 뒤에는 안전한 곳에 옮기거나 삭제하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
