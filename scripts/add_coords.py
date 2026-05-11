#!/usr/bin/env python3
"""OpenFlights airports.dat 의 lat/lng 정보를 airports.js 에 병합."""
import csv
import io
import json
import os
import re
import urllib.request

OPENFLIGHTS_URL = "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airports.dat"
APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(APP_DIR, "airports.js")

def fetch_openflights():
    print("Downloading OpenFlights airports.dat ...")
    req = urllib.request.Request(OPENFLIGHTS_URL, headers={"User-Agent": "PlannerAssist/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = r.read().decode("utf-8")
    coords = {}
    reader = csv.reader(io.StringIO(data))
    for row in reader:
        if len(row) < 8:
            continue
        iata = row[4].strip().strip('"')
        if not re.fullmatch(r"[A-Z]{3}", iata):
            continue
        try:
            lat = float(row[6])
            lng = float(row[7])
        except ValueError:
            continue
        coords[iata] = (lat, lng)
    print(f"  Loaded {len(coords)} airports with valid IATA + coordinates.")
    return coords

# 보강용 좌표 (OpenFlights에 누락 또는 신공항으로 빠진 경우)
MANUAL = {
    "PKX": (39.5098, 116.4106),  # 베이징 다싱
    "TFU": (30.3125, 104.4417),  # 청두 톈푸
    "DWC": (24.8967, 55.1614),   # 두바이 알막툼
    "BER": (52.3667, 13.5033),   # 베를린 브란덴부르크
    "WMI": (52.4514, 20.6517),   # 바르샤바 모들린
    "NQZ": (51.0222, 71.4669),   # 누르술탄 (신코드)
    "RSU": (34.8417, 127.6167),  # 여수
    "MWX": (34.9914, 126.3828),  # 무안
    "HIN": (35.0886, 128.0717),  # 사천
    "KPO": (35.9879, 129.4203),  # 포항
    "WJU": (37.4381, 127.9603),  # 원주
    "KUV": (35.9038, 126.6156),  # 군산
}

def main():
    coords = fetch_openflights()
    coords.update(MANUAL)

    with open(SRC, "r", encoding="utf-8") as f:
        src = f.read()

    pattern = re.compile(r"\{\s*code:\s*'([A-Z]{3})'(.+?)\}", re.DOTALL)
    missing = []
    updated = 0

    def repl(m):
        nonlocal updated
        code = m.group(1)
        body = m.group(2)
        # 이미 lat 가 있으면 건너뜀
        if re.search(r"\blat:\s*-?[0-9]", body):
            return m.group(0)
        latlng = coords.get(code)
        if not latlng:
            missing.append(code)
            return m.group(0)
        lat, lng = latlng
        # 'label' 이후 어딘가에 추가하지 말고, 닫는 } 바로 앞에 끼워넣음
        # 끝의 공백을 보존
        new_body = body.rstrip().rstrip(",")
        new_body = new_body + f", lat: {lat:.4f}, lng: {lng:.4f} "
        updated += 1
        return "{ code: '" + code + "'" + new_body + "}"

    new_src = pattern.sub(repl, src)

    with open(SRC, "w", encoding="utf-8") as f:
        f.write(new_src)

    print(f"\nUpdated airports: {updated}")
    if missing:
        print(f"Missing coordinates for {len(missing)} codes: {', '.join(missing[:30])}{'...' if len(missing) > 30 else ''}")
    else:
        print("All airports have coordinates!")

if __name__ == "__main__":
    main()
