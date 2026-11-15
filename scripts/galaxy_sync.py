#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3d/galaxy/data.json 자동 수집·병합 (표준 라이브러리만 사용, 외부 API·LLM 0건).

하는 일
  1) 공개 RSS/피드를 읽어 새 글만 골라 data.json 의 nodes 에 병합한다.
     - 네이버 블로그 2대: branson_note(기록노트), op213y(EB_note)
     - 티스토리 4대: yhcode(플로우 시스템), opyeb(OPYEB), euntu-note(은퇴노트), sharednote(테크 커런트)
  2) 저장소의 tools/ · labs/ · 3d/ · games/ · gallery/ 안에서 아직 등록되지 않은
     도구 페이지(index.html)를 찾아 tools 채널에 추가한다.
  3) 기존 항목은 절대 삭제·수정하지 않는다(추가만). 새 항목이 들어온 채널에 한해
     레이아웃 좌표 r(0=가장 오래된 별, 1=가장 최근 별) 과 밝기 i 를 다시 계산한다.
  4) 채널별 count · counts · total · generated 를 갱신한다.

안전장치
  - 기존 노드 수가 줄거나 채널 count 가 줄면 아무것도 쓰지 않고 비정상 종료한다.
  - 피드 하나가 실패해도 나머지는 계속 진행하고, 전부 실패하면 종료코드 2.
  - 새 항목이 없으면 파일을 건드리지 않는다(불필요한 커밋 방지).

사용법
  python3 scripts/galaxy_sync.py            # 수집 후 data.json 갱신
  python3 scripts/galaxy_sync.py --dry-run  # 쓰지 않고 결과만 출력
"""

from __future__ import annotations

import argparse
import html
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
UA = (
    "Mozilla/5.0 (compatible; portfolio-galaxy-sync/1.0; "
    "+https://kimyihyung.github.io/portfolio/3d/galaxy/)"
)

# ── 수집 대상 피드 ────────────────────────────────────────────────
# snippet: 목록 카드에 보여 줄 요약 길이(기존 항목과 같은 결로 맞춘 값)
FEEDS = [
    {
        "name": "branson_note",
        "channel": "note",
        "blog": "기록노트",
        "col": "#6ea8ff",
        "url": "https://rss.blog.naver.com/branson_note.xml",
        "snippet": 80,
    },
    {
        "name": "op213y",
        "channel": "eb",
        "blog": "EB_note",
        "col": "#b07bff",
        "url": "https://rss.blog.naver.com/op213y.xml",
        "snippet": 60,
    },
    {
        "name": "yhcode",
        "channel": "tistory",
        "blog": "플로우 시스템",
        "col": "#46e08a",
        "url": "https://yhcode.tistory.com/rss",
        "snippet": 168,
    },
    {
        "name": "opyeb",
        "channel": "tistory",
        "blog": "OPYEB",
        "col": "#3cbfe6",
        "url": "https://opyeb.tistory.com/rss",
        "snippet": 168,
    },
    {
        "name": "euntu-note",
        "channel": "tistory",
        "blog": "은퇴노트",
        "col": "#7bd7ff",
        "url": "https://euntu-note.tistory.com/rss",
        "snippet": 168,
    },
    {
        "name": "sharednote",
        "channel": "tistory",
        "blog": "테크 커런트",
        "col": "#2fd4c8",
        "url": "https://sharednote.tistory.com/rss",
        "snippet": 168,
    },
]

# 저장소 안에서 훑을 도구 디렉터리 (base 디렉터리 이름 → 표시용 b 값)
TOOL_BASES = [
    ("tools", "Tools"),
    ("labs", "Lab"),
    ("3d", "3D"),
    ("games", "Games"),
    ("gallery", "Gallery"),
]
TOOL_COLOR = "#ffc247"
SITE = "https://kimyihyung.github.io/portfolio/"

# 레이아웃 좌표 계산 규칙 (3d/galaxy/index.html 이 기대하는 값과 동일)
R_MIN, R_MAX = 0.0, 1.0
I_BASE, I_SPAN = 0.35, 0.65


# ── 유틸 ─────────────────────────────────────────────────────────
def log(msg: str) -> None:
    print(msg, flush=True)


def norm_url(url: str) -> str:
    """쿼리·프래그먼트·끝 슬래시를 떼어 비교용 키로 만든다(저장 값은 원형 유지)."""
    if not url:
        return ""
    u = url.split("#", 1)[0].split("?", 1)[0].strip()
    return u.rstrip("/")


def title_key(title: str) -> str:
    return re.sub(r"[\s\u00a0]+", "", title or "").lower()


def clean_text(raw: str) -> str:
    """HTML 조각을 목록 카드용 평문으로 만든다(태그 제거 후 개행 제거, 공백 정리)."""
    if not raw:
        return ""
    t = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", raw, flags=re.S | re.I)
    t = re.sub(r"<[^>]*>", "", t)
    t = html.unescape(t)
    t = re.sub(r"[\r\n\t\f\v]+", "", t)
    t = t.replace("\u200b", "")
    t = re.sub(r"\s{2,}", " ", t)
    return t.strip()


def clip(text: str, limit: int) -> str:
    """요약을 limit 자 근처에서 자르고 말줄임표를 붙인다."""
    if len(text) <= limit:
        return text
    cut = text[:limit]
    sp = cut.rfind(" ")
    if sp >= limit - 12:  # 단어 중간에서 끊기면 한 단어 물러난다
        cut = cut[:sp]
    return cut.rstrip() + "…"


def fetch(url: str, retries: int = 3) -> bytes:
    last_err: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": UA,
                    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
                    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
                },
            )
            with urllib.request.urlopen(req, timeout=30) as res:
                return res.read()
        except Exception as exc:  # noqa: BLE001 - 네트워크 오류는 재시도 후 보고
            last_err = exc
            if attempt < retries:
                time.sleep(2 * attempt)
    raise RuntimeError(f"{url} 요청 실패: {last_err}")


def parse_pub_date(value: str) -> str | None:
    if not value:
        return None
    try:
        dt = parsedate_to_datetime(value.strip())
    except Exception:  # noqa: BLE001
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=KST)
    return dt.astimezone(KST).date().isoformat()


# ── 피드 파싱 ─────────────────────────────────────────────────────
def parse_feed(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    items = root.findall("./channel/item")
    if not items:
        items = root.findall(".//item")
    out = []
    for it in items:
        link = (it.findtext("link") or "").strip()
        guid = (it.findtext("guid") or "").strip()
        title = clean_text(it.findtext("title") or "")
        desc = it.findtext("description") or ""
        date = parse_pub_date(it.findtext("pubDate") or "") or parse_pub_date(
            it.findtext("dc:date") or ""
        )
        cat = clean_text(it.findtext("category") or "")
        # 저장 URL 은 원문 기사 링크(link)를 쓴다 — 기존 data.json 과 같은 형태
        # (네이버는 link 에 붙은 ?fromRss·trackingCode 를 떼고, 티스토리는 /entry/ 슬러그 유지)
        url = link if link.startswith("http") else guid
        aliases = {norm_url(x) for x in (link, guid) if x.startswith("http")}
        out.append(
            {
                "title": title,
                "url": norm_url(url),
                "aliases": aliases,
                "desc": desc,
                "date": date,
                "category": cat,
            }
        )
    return out


def build_node(feed: dict, item: dict) -> dict:
    """data.json 의 기존 노드와 같은 키 순서로 새 항목을 만든다."""
    return {
        "c": feed["channel"],
        "t": item["title"],
        "u": item["url"],
        "d": item["date"],
        "s": clip(clean_text(item["desc"]), feed["snippet"]),
        "b": feed["blog"],
        "k": item.get("category") or "",
        "r": 1.0,
        "i": 1.0,
        "col": feed["col"],
    }


# ── 저장소 도구 페이지 수집 ────────────────────────────────────────
def git_last_date(path: Path) -> str | None:
    try:
        rel = path.relative_to(ROOT).as_posix()
        proc = subprocess.run(
            ["git", "-C", str(ROOT), "log", "-1", "--format=%cs", "--", rel],
            capture_output=True,
            text=True,
            timeout=25,
        )
        value = (proc.stdout or "").strip()
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            return value
    except Exception:  # noqa: BLE001 - git 이 없으면 오늘 날짜로 대체
        pass
    return None


def meta_content(page: str, keys: tuple[str, ...]) -> str:
    for key in keys:
        m = re.search(
            r'<meta[^>]+(?:name|property)=["\']%s["\'][^>]*content=["\'](.*?)["\']'
            % re.escape(key),
            page,
            re.I | re.S,
        )
        if not m:
            m = re.search(
                r'<meta[^>]+content=["\'](.*?)["\'][^>]*(?:name|property)=["\']%s["\']'
                % re.escape(key),
                page,
                re.I | re.S,
            )
        if m:
            text = clean_text(m.group(1))
            if text:
                return text
    return ""


def collect_tools(known_norm: set[str], today: str) -> list[dict]:
    found: list[dict] = []
    for base, label in TOOL_BASES:
        base_dir = ROOT / base
        if not base_dir.is_dir():
            continue
        for child in sorted(base_dir.iterdir()):
            if not child.is_dir() or child.name.startswith(".") or child.name.startswith("_"):
                continue
            page = child / "index.html"
            if not page.is_file():
                continue
            url = f"{SITE}{base}/{child.name}/"
            if norm_url(url) in known_norm:
                continue
            try:
                raw = page.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            title = meta_content(raw, ("og:title",))
            if not title:
                m = re.search(r"<title[^>]*>(.*?)</title>", raw, re.I | re.S)
                title = clean_text(m.group(1)) if m else child.name
            if not title:
                title = child.name
            desc = meta_content(raw, ("og:description", "description"))
            found.append(
                {
                    "c": "tools",
                    "t": title[:90],
                    "u": url,
                    "d": git_last_date(child) or today,
                    "s": clip(desc, 70) if desc else f"{label} 페이지",
                    "b": label,
                    "k": "portfolio",
                    "r": 1.0,
                    "i": 1.0,
                    "col": TOOL_COLOR,
                }
            )
    return found


# ── 병합 ─────────────────────────────────────────────────────────
def sort_key(node: dict):
    return (node.get("d") or "1970-01-01", node.get("ts") or "")


def main() -> int:
    ap = argparse.ArgumentParser(description="3d/galaxy/data.json 자동 수집·병합")
    ap.add_argument("--data", default=str(ROOT / "3d" / "galaxy" / "data.json"))
    ap.add_argument("--dry-run", action="store_true", help="파일을 쓰지 않고 결과만 출력")
    ap.add_argument("--today", default=None, help="generated 날짜 강제 지정(YYYY-MM-DD)")
    args = ap.parse_args()

    data_path = Path(args.data)
    raw = data_path.read_text(encoding="utf-8")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        log(f"[오류] data.json 파싱 실패: {exc}")
        return 3

    channels = data.get("channels") or []
    nodes = data.get("nodes") or []
    if not channels or not nodes:
        log("[오류] data.json 구조가 예상과 다릅니다(channels/nodes 없음)")
        return 3

    today = args.today or datetime.now(KST).date().isoformat()
    old_total = len(nodes)
    old_counts = {ch["id"]: sum(1 for n in nodes if n.get("c") == ch["id"]) for ch in channels}

    # 중복 판정용 색인 (기존 항목은 그대로 보존한다)
    known_norm = {norm_url(n.get("u", "")) for n in nodes}
    known_title = {(n.get("b") or "", title_key(n.get("t", ""))) for n in nodes}

    added: list[dict] = []
    changed_channels: set[str] = set()
    feed_ok = 0
    feed_err: list[str] = []

    for feed in FEEDS:
        try:
            items = parse_feed(fetch(feed["url"]))
        except Exception as exc:  # noqa: BLE001
            feed_err.append(f"{feed['name']}: {exc}")
            log(f"[경고] {feed['name']} 피드 실패 — {exc}")
            continue
        feed_ok += 1
        if not items:
            log(f"[경고] {feed['name']} 피드에 항목이 없습니다")
            continue
        new_here = 0
        for item in items:
            if not item["title"] or not item["url"] or not item["date"]:
                continue
            if any("/pages/" in a for a in item["aliases"]):
                continue  # 티스토리 고정 페이지(블로그 소개 등)는 글이 아니다
            if item["aliases"] & known_norm:
                continue
            if (feed["blog"], title_key(item["title"])) in known_title:
                continue
            node = build_node(feed, item)
            known_norm |= item["aliases"]
            known_title.add((feed["blog"], title_key(item["title"])))
            added.append(node)
            changed_channels.add(feed["channel"])
            new_here += 1
        log(f"[수집] {feed['name']}: 피드 {len(items)}건 · 신규 {new_here}건")

    if feed_ok == 0:
        log("[오류] 모든 피드가 실패해 수집을 중단합니다: " + " | ".join(feed_err))
        return 2

    # 저장소 도구 페이지
    tool_nodes = collect_tools(known_norm, today)
    for node in tool_nodes:
        if (node["b"], title_key(node["t"])) in known_title:
            continue
        added.append(node)
        changed_channels.add("tools")
    if tool_nodes:
        log(f"[수집] 저장소 도구 페이지: 신규 {len(tool_nodes)}건")

    if not added:
        log("[완료] 신규 항목 없음 — data.json 을 수정하지 않습니다")
        log(f"       현재 total={old_total}")
        return 0

    # 채널별로 모아 정렬 후 재구성 (기존 항목 순서·값은 그대로)
    by_ch: dict[str, list[dict]] = {ch["id"]: [] for ch in channels}
    for node in nodes:
        by_ch.setdefault(node.get("c"), []).append(node)
    for node in added:
        by_ch.setdefault(node["c"], []).append(node)

    merged: list[dict] = []
    for ch in channels:
        cid = ch["id"]
        bucket = by_ch[cid]
        if cid in changed_channels:
            bucket.sort(key=sort_key)
            n = len(bucket)
            for idx, node in enumerate(bucket):
                exact = idx / (n - 1) if n > 1 else R_MIN
                exact = max(R_MIN, min(R_MAX, exact))
                node["r"] = round(exact, 4)
                node["i"] = round(I_BASE + I_SPAN * exact, 3)
        merged.extend(bucket)

    # 안전 검증: 기존 항목 0건 손실
    if len(merged) != old_total + len(added):
        log(f"[오류] 병합 건수 불일치: 기존 {old_total} + 신규 {len(added)} != {len(merged)}")
        return 4

    # 통계·날짜 갱신
    new_counts = {}
    for ch in channels:
        cid = ch["id"]
        count = sum(1 for n in merged if n.get("c") == cid)
        if count < old_counts.get(cid, 0):
            log(f"[오류] {cid} 항목이 {old_counts.get(cid,0)} → {count} 로 줄었습니다. 중단합니다")
            return 4
        ch["count"] = count
        new_counts[cid] = count
    for cid, count in new_counts.items():
        if isinstance(data.get("counts"), dict):
            data["counts"][cid] = count
    data["nodes"] = merged
    data["total"] = len(merged)
    data["generated"] = today

    out = json.dumps(data, ensure_ascii=False, separators=(",", ":"))

    # JSON 문법 무결성 재확인
    check = json.loads(out)
    if len(check["nodes"]) != len(merged) or check["total"] != len(merged):
        log("[오류] 직렬화 결과 검증 실패")
        return 4
    if any(n["c"] != m["c"] or n["u"] != m["u"] for n, m in zip(check["nodes"], merged)):
        log("[오류] 직렬화 후 항목 정합성 불일치")
        return 4

    log(f"[병합] 신규 {len(added)}건 · total {old_total} → {len(merged)}")
    for cid in [ch["id"] for ch in channels]:
        if old_counts.get(cid, 0) != new_counts[cid]:
            log(f"       {cid}: {old_counts.get(cid,0)} → {new_counts[cid]}")
    for node in added[-10:]:
        log(f"       + [{node['c']}] {node['d']} {node['t'][:60]}")

    if args.dry_run:
        log("[드라이런] 파일을 쓰지 않았습니다")
        return 0

    if out == raw:
        log("[완료] 직렬화 결과가 기존과 같아 쓸 내용이 없습니다")
        return 0

    tmp = data_path.with_suffix(".json.tmp")
    tmp.write_text(out, encoding="utf-8")
    tmp.replace(data_path)
    log(f"[저장] {data_path} ({len(out)} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
