#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tools/index.html 에 무업로드 툴 4종(AudioTrim·DiffForge·DayOff·MockFrame) 반영.

- 카드 4장을 카테고리 자리에 끼워 넣고 번호(01~19)를 다시 매긴다
- EN/KO 사전에 c16~c19 문구 추가
- 상단 칩·카운트·eyebrow 15 → 19, JSON-LD ItemList 19개
- 한 번 돌려도 결과가 같도록(멱등) 이미 있으면 건너뛴다
"""
import json
import re
from pathlib import Path

P = Path(__file__).resolve().parent.parent / 'tools' / 'index.html'
src = P.read_text(encoding='utf-8')

CARDS = {
    'audio': '''      <li class="card" data-cat="privacy">
        <div class="card-head">
          <span class="num">00</span>
          <span class="lang" title="Interface language" data-i18n-title="langTitle" data-i18n="langBoth">EN / KO</span>
        </div>
        <h2><a href="/portfolio/tools/audio-trim/">AudioTrim</a></h2>
        <p data-i18n-html="c16d">
          The good part is twelve seconds in. Drop an MP3, WAV, M4A, OGG or FLAC on the waveform, drag the two handles
          or type a millisecond, and <span class="hlgt">preview it with fade in, fade out and level applied</span> before
          you commit. What comes back is a <span class="hlgt">WAV encoded in this tab</span> — the audio is never decoded
          on a server because it never leaves the device.
        </p>
        <ul class="tags">
          <li data-i18n="c16t1">Waveform</li>
          <li data-i18n="c16t2">Fade · Level</li>
          <li data-i18n="c16t3">WAV out</li>
          <li data-i18n="c16t4">0 uploads</li>
        </ul>
        <div class="card-foot">
          <a class="open" href="/portfolio/tools/audio-trim/"><span data-i18n="openTool">Open Tool</span> <span class="arw" aria-hidden="true">→</span></a>
          <span class="kind" data-i18n="kPrivacy">Privacy &amp; Media</span>
        </div>
      </li>

''',
    'mock': '''      <li class="card" data-cat="privacy">
        <div class="card-head">
          <span class="num">00</span>
          <span class="lang" title="Interface language" data-i18n-title="langTitle" data-i18n="langBoth">EN / KO</span>
        </div>
        <h2><a href="/portfolio/tools/mock-frame/">MockFrame</a></h2>
        <p data-i18n-html="c17d">
          A screenshot on its own looks like a screenshot. Put it <span class="hlgt">inside a macOS window, an iPhone or a
          minimal rounded card</span>, set it on a gradient backdrop, tune padding, radius and shadow, and take a
          <span class="hlgt">2× PNG</span> — the frame is drawn over your pixels in this tab, and the image is never
          uploaded to a mockup service.
        </p>
        <ul class="tags">
          <li data-i18n="c17t1">macOS · iPhone</li>
          <li data-i18n="c17t2">Gradient</li>
          <li data-i18n="c17t3">2× PNG</li>
        </ul>
        <div class="card-foot">
          <a class="open" href="/portfolio/tools/mock-frame/"><span data-i18n="openTool">Open Tool</span> <span class="arw" aria-hidden="true">→</span></a>
          <span class="kind" data-i18n="kPrivacy">Privacy &amp; Media</span>
        </div>
      </li>

''',
    'diff': '''      <li class="card" data-cat="creator">
        <div class="card-head">
          <span class="num">00</span>
          <span class="lang" title="Interface language" data-i18n-title="langTitle" data-i18n="langBoth">EN / KO</span>
        </div>
        <h2><a href="/portfolio/tools/diff-forge/">DiffForge</a></h2>
        <p data-i18n-html="c18d">
          Paste two texts, two JSON documents or two CSV files and see <span class="hlgt">added, removed and changed lines
          or keys</span> side by side. The same tab formats, minifies and sorts keys, and converts
          <span class="hlgt">JSON ⇄ CSV</span> — so the file you are comparing never has to be pasted into a web service
          that keeps a copy.
        </p>
        <ul class="tags">
          <li data-i18n="c18t1">Text · JSON · CSV</li>
          <li data-i18n="c18t2">Added · Removed</li>
          <li data-i18n="c18t3">Format · Minify</li>
          <li data-i18n="c18t4">JSON ⇄ CSV</li>
        </ul>
        <div class="card-foot">
          <a class="open" href="/portfolio/tools/diff-forge/"><span data-i18n="openTool">Open Tool</span> <span class="arw" aria-hidden="true">→</span></a>
          <span class="kind" data-i18n="kCreator">Creator Tools</span>
        </div>
      </li>

''',
    'dayoff': '''      <li class="card" data-cat="money">
        <div class="card-head">
          <span class="num">00</span>
          <span class="lang" title="Interface language" data-i18n-title="langTitle" data-i18n="langBoth">EN / KO</span>
        </div>
        <h2><a href="/portfolio/tools/day-off/">DayOff</a></h2>
        <p data-i18n-html="c19d">
          Annual leave, counted the way the Korean Labor Standards Act counts it: <span class="hlgt">11 monthly days in
          year one, 15 days after a year, +1 every two years up to 25</span>. Then every window in 2026 and 2027 where
          <span class="hlgt">1–3 leave days buy 4–9 days off</span> — public holidays already taken into account, so a
          Thursday becomes a five-day trip instead of a guess.
        </p>
        <ul class="tags">
          <li data-i18n="c19t1">11 → 25 days</li>
          <li data-i18n="c19t2">Golden week</li>
          <li data-i18n="c19t3">2026–2027</li>
          <li data-i18n="c19t4">0 uploads</li>
        </ul>
        <div class="card-foot">
          <a class="open" href="/portfolio/tools/day-off/"><span data-i18n="openTool">Open Tool</span> <span class="arw" aria-hidden="true">→</span></a>
          <span class="kind" data-i18n="kMoney">Money &amp; Life</span>
        </div>
      </li>

''',
}

EN_KEYS = """      c16d: 'The good part is twelve seconds in. Drop an MP3, WAV, M4A, OGG or FLAC on the waveform, drag the two handles or type a millisecond, and <span class="hlgt">preview it with fade in, fade out and level applied</span> before you commit. What comes back is a <span class="hlgt">WAV encoded in this tab</span> — the audio is never decoded on a server because it never leaves the device.',
      c16t1: 'Waveform', c16t2: 'Fade · Level', c16t3: 'WAV out', c16t4: '0 uploads',
      c17d: 'A screenshot on its own looks like a screenshot. Put it <span class="hlgt">inside a macOS window, an iPhone or a minimal rounded card</span>, set it on a gradient backdrop, tune padding, radius and shadow, and take a <span class="hlgt">2× PNG</span> — the frame is drawn over your pixels in this tab, and the image is never uploaded to a mockup service.',
      c17t1: 'macOS · iPhone', c17t2: 'Gradient', c17t3: '2× PNG',
      c18d: 'Paste two texts, two JSON documents or two CSV files and see <span class="hlgt">added, removed and changed lines or keys</span> side by side. The same tab formats, minifies and sorts keys, and converts <span class="hlgt">JSON ⇄ CSV</span> — so the file you are comparing never has to be pasted into a web service that keeps a copy.',
      c18t1: 'Text · JSON · CSV', c18t2: 'Added · Removed', c18t3: 'Format · Minify', c18t4: 'JSON ⇄ CSV',
      c19d: 'Annual leave, counted the way the Korean Labor Standards Act counts it: <span class="hlgt">11 monthly days in year one, 15 days after a year, +1 every two years up to 25</span>. Then every window in 2026 and 2027 where <span class="hlgt">1–3 leave days buy 4–9 days off</span> — public holidays already taken into account, so a Thursday becomes a five-day trip instead of a guess.',
      c19t1: '11 → 25 days', c19t2: 'Golden week', c19t3: '2026–2027', c19t4: '0 uploads',
"""

KO_KEYS = """      c16d: '좋은 대목은 12초 뒤에 있습니다. MP3·WAV·M4A·OGG·FLAC을 파형 위에 올리고 손잡이 두 개를 끌거나 밀리초를 직접 적은 뒤, <span class="hlgt">페이드 인·아웃과 음량을 적용한 상태로 미리 들어</span> 보고 확정하세요. 결과물은 <span class="hlgt">이 탭에서 인코딩한 WAV</span>이고, 오디오는 기기 밖으로 나가지 않으니 서버에서 디코딩될 일도 없습니다.',
      c16t1: '파형 편집', c16t2: '페이드 · 음량', c16t3: 'WAV 저장', c16t4: '업로드 0',
      c17d: '스크린샷만 붙이면 그냥 스크린샷입니다. <span class="hlgt">macOS 창·아이폰·미니멀 라운드 카드</span> 안에 넣고 그라데이션 배경 위에 올린 뒤 여백·모서리·그림자를 다듬어 <span class="hlgt">2배수 PNG</span>로 받으세요. 액자는 이 탭에서 여러분의 픽셀 위에 그려지고, 이미지는 목업 서비스로 업로드되지 않습니다.',
      c17t1: 'macOS · 아이폰', c17t2: '그라데이션', c17t3: '2× PNG',
      c18d: '텍스트 두 개, JSON 문서 두 개, CSV 두 개를 붙여넣으면 <span class="hlgt">추가·삭제·변경된 줄과 키</span>가 나란히 표시됩니다. 같은 탭에서 포맷·압축·키 정렬과 <span class="hlgt">JSON ⇄ CSV 변환</span>까지 하니, 비교하려고 사본을 남기는 웹 서비스에 파일을 넣을 필요가 없습니다.',
      c18t1: '텍스트 · JSON · CSV', c18t2: '추가 · 삭제', c18t3: '포맷 · 압축', c18t4: 'JSON ⇄ CSV',
      c19d: '연차는 근로기준법이 세는 방식 그대로 — <span class="hlgt">1년 차에는 1개월 개근당 1일(최대 11일), 1년 뒤 15일, 이후 2년마다 1일씩 늘어 최대 25일</span>. 그 위에서 2026·2027년 중 <span class="hlgt">연차 1~3일로 4~9일을 쉬는 구간</span>을 전부 찾아 줍니다. 공휴일을 미리 반영하니 목요일 하루가 닷새 여행이 됩니다.',
      c19t1: '11 → 25일', c19t2: '황금연휴', c19t3: '2026–2027', c19t4: '업로드 0',
"""

NEW_JSONLD = [
    {"name": "AudioTrim", "cat": "MultimediaApplication", "slug": "audio-trim",
     "desc": "Trims audio files on a waveform with drag handles or millisecond input, previews the selection with fade in, fade out and level applied, and exports a WAV encoded in the browser — no uploads, no external requests."},
    {"name": "MockFrame", "cat": "DesignApplication", "slug": "mock-frame",
     "desc": "Wraps a screenshot in a macOS window, an iPhone or a minimal rounded card on a gradient backdrop with adjustable padding, radius and shadow, and exports a 2x PNG — entirely in the browser with zero uploads."},
    {"name": "DiffForge", "cat": "UtilitiesApplication", "slug": "diff-forge",
     "desc": "Compares two texts, JSON documents or CSV files side by side and marks added, removed and changed lines or keys, then formats, minifies, sorts keys and converts JSON and CSV — entirely in the browser with zero uploads."},
    {"name": "DayOff", "cat": "FinanceApplication", "slug": "day-off",
     "desc": "Counts Korean annual leave under the Labor Standards Act — 11 monthly days in year one, 15 after a year, +1 every two years up to 25 — and finds every 2026-2027 stretch where 1-3 leave days buy 4-9 days off, entirely in the browser."},
]


def add_card(html, after_slug, card, label):
    anchor = 'href="/portfolio/tools/%s/"><span data-i18n="openTool"' % after_slug
    i = html.find(anchor)
    if i == -1:
        raise SystemExit('anchor not found for %s' % label)
    end = html.find('      </li>\n', i)
    if end == -1:
        raise SystemExit('card end not found for %s' % label)
    end += len('      </li>\n')
    if html[end:end + 1] == '\n':
        end += 1
    return html[:end] + card + html[end:]


# 1) 카드 삽입 (이미 있으면 건너뜀)
if '/portfolio/tools/audio-trim/' in src:
    print('cards: already present — skipped')
else:
    src = add_card(src, 'redac-snap', CARDS['audio'], 'audio-trim')
    src = add_card(src, 'audio-trim', CARDS['mock'], 'mock-frame')
    src = add_card(src, 'text-lens', CARDS['diff'], 'diff-forge')
    src = add_card(src, 'split-snap', CARDS['dayoff'], 'day-off')
    print('cards: 4 inserted')

# 2) 번호 재정렬 (01~)
grid_start = src.index('<ul class="tools" id="toolGrid">')
grid_end = src.index('</ul>\n    <p class="empty"', grid_start)
grid = src[grid_start:grid_end]
n = [0]


def renum(m):
    n[0] += 1
    return '<span class="num">%02d</span>' % n[0]


grid2 = re.sub(r'<span class="num">\d+</span>', renum, grid)
src = src[:grid_start] + grid2 + src[grid_end:]
print('cards renumbered 01..%02d' % n[0])

# 3) i18n 사전
if 'c16d:' in src:
    print('i18n: already present — skipped')
else:
    en_anchor = "      c15t1: '1·2·3 rounds', c15t2: 'Alcohol out', c15t3: '10·100 rounding', c15t4: 'Kakao · PNG',\n"
    ko_anchor = "      c15t1: '1·2·3차', c15t2: '주류 제외', c15t3: '10·100원 단위', c15t4: '카톡 · PNG',\n"
    assert src.count(en_anchor) == 1 and src.count(ko_anchor) == 1
    src = src.replace(en_anchor, en_anchor + EN_KEYS, 1)
    src = src.replace(ko_anchor, ko_anchor + KO_KEYS, 1)
    print('i18n: EN/KO keys added')

# 4) 카운트 표기
src = src.replace('Tools · v1 · 15 live', 'Tools · v1 · 19 live')
src = src.replace("eyebrow: '도구 · v1 · 15종 라이브'", "eyebrow: '도구 · v1 · 19종 라이브'")
src = src.replace('<span class="count" id="count" aria-live="polite">15 tools</span>',
                  '<span class="count" id="count" aria-live="polite">19 tools</span>')
src = src.replace('<span data-i18n="fAll">All</span> <span class="n">15</span>',
                  '<span data-i18n="fAll">All</span> <span class="n">19</span>')
src = src.replace('<span data-i18n="fPrivacy">Privacy &amp; Media</span> <span class="n">7</span>',
                  '<span data-i18n="fPrivacy">Privacy &amp; Media</span> <span class="n">9</span>')
src = src.replace('<span data-i18n="fCreator">Creator Tools</span> <span class="n">3</span>',
                  '<span data-i18n="fCreator">Creator Tools</span> <span class="n">4</span>')
src = src.replace('<span data-i18n="fMoney">Money &amp; Life</span> <span class="n">1</span>',
                  '<span data-i18n="fMoney">Money &amp; Life</span> <span class="n">2</span>')

# 5) JSON-LD
m = re.search(r'<script type="application/ld\+json">\n(\{.*?\})\n</script>', src, re.S)
if not m:
    raise SystemExit('JSON-LD not found')
data = json.loads(m.group(1))
ilist = data['mainEntity']
names = [e['item']['name'] for e in ilist['itemListElement']]
if 'AudioTrim' in names:
    print('JSON-LD: already present — skipped')
else:
    for extra in NEW_JSONLD:
        pos = len(ilist['itemListElement']) + 1
        ilist['itemListElement'].append({
            "@type": "ListItem", "position": pos,
            "item": {
                "@type": "SoftwareApplication", "name": extra['name'],
                "applicationCategory": extra['cat'], "operatingSystem": "Any (web browser)",
                "url": "https://kimyihyung.github.io/portfolio/tools/%s/" % extra['slug'],
                "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                "description": extra['desc'],
            },
        })
    ilist['numberOfItems'] = len(ilist['itemListElement'])
    new_block = '<script type="application/ld+json">\n' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n</script>'
    src = src[:m.start()] + new_block + src[m.end():]
    print('JSON-LD: numberOfItems =', ilist['numberOfItems'])

# 6) 검색 설명문에 새 4종 반영
src = src.replace(
    'generate and read QR codes, generate GPU backgrounds, walk a 3D gallery — all running 100% in your browser',
    'generate and read QR codes, generate GPU backgrounds, trim audio, diff JSON and CSV, plan Korean annual leave, frame screenshots, walk a 3D gallery — all running 100% in your browser', 1)
src = src.replace(
    'QR 코드 생성·판독, GPU 배경 생성, 3D 전시관까지',
    'QR 코드 생성·판독, GPU 배경 생성, 오디오 자르기, JSON·CSV 비교, 연차 황금연휴 계산, 스크린샷 목업, 3D 전시관까지', 1)
src = src.replace(
    "metaDesc: 'A small shelf of browser tools that never see your files. Strip photo metadata, build editorial carousels, extract video frames and storyboards, generate and read QR codes, generate GPU backgrounds, walk a 3D gallery — all running 100% in your browser with zero uploads and zero sign-ups.'",
    "metaDesc: 'A small shelf of browser tools that never see your files. Strip photo metadata, build editorial carousels, extract video frames and storyboards, generate and read QR codes, trim audio, diff JSON and CSV, plan Korean annual leave, frame screenshots, walk a 3D gallery — all running 100% in your browser with zero uploads and zero sign-ups.'", 1)
src = src.replace(
    "metaDesc: '파일을 보지 않는 브라우저 도구 모음. 사진 메타데이터 제거, 에디토리얼 카드 제작, 영상 프레임·스토리보드 추출, QR 코드 생성·판독, GPU 배경 생성, 3D 전시관까지 — 모두 업로드·가입 없이 브라우저 안에서만 실행됩니다.'",
    "metaDesc: '파일을 보지 않는 브라우저 도구 모음. 사진 메타데이터 제거, 에디토리얼 카드 제작, 영상 프레임·스토리보드 추출, QR 코드 생성·판독, 오디오 자르기, JSON·CSV 비교, 연차 황금연휴 계산, 스크린샷 목업, 3D 전시관까지 — 모두 업로드·가입 없이 브라우저 안에서만 실행됩니다.'", 1)

P.write_text(src, encoding='utf-8')
print('written', P)
