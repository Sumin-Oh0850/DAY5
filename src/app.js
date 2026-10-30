'use strict'

// main.js 가 준비한 window.JEJU_DATA (API 의 위치정보 + 일반정보 합본, 실패 시 1단계 파일 데이터)
const data = (window.JEJU_DATA || []).map((r) => ({
  ...r,
  // "제주특별자치도 제주시 ..." 에서 두 번째 단어(제주시/서귀포시)를 지역으로 사용
  region: r.address.split(/\s+/)[1] || '',
}))
const byId = new Map(data.map((r) => [r.id, r]))

const $ = (id) => document.getElementById(id)
const els = {
  q: $('q'),
  tour: $('tour'),
  category: $('category'),
  region: $('region'),
  stampState: $('stampState'),
  sort: $('sort'),
  onlyFavs: $('onlyFavs'),
  reset: $('reset'),
  summary: $('summary'),
  cards: $('cards'),
  empty: $('empty'),
  map: $('map'),
  tourList: $('tour-list'),
  courseSummary: $('course-summary'),
  courseList: $('course-list'),
  courseEmpty: $('course-empty'),
  courseClear: $('course-clear'),
  recent: $('recent'),
  recentEmpty: $('recent-empty'),
  stampClear: $('stamp-clear'),
  courseMaps: $('course-maps'),
  courseCopy: $('course-copy'),
  detail: $('detail'),
  dTitle: $('d-title'),
  dBody: $('d-body'),
  dFav: $('d-fav'),
  dStamp: $('d-stamp'),
  toast: $('toast'),
}

// 설정 -------------------------------------------------------
const RADIUS_M = 300 // 이 거리 안에 있으면 "현장 인증"
const MEMO_MAX = 200 // 방문 메모 최대 글자 수
const MAPS_MAX_STOPS = 11 // 구글 지도 길찾기 주소: 출발 1 + 경유 9 + 도착 1
const MAP = { W: 600, H: 440, pad: 28 }

const LEVELS = [
  { min: 0, icon: '🎒', name: '탐라 여행 준비생' },
  { min: 1, icon: '🌱', name: '탐라 새내기' },
  { min: 10, icon: '⛰️', name: '오름 탐험가' },
  { min: 30, icon: '🛡️', name: '역사 지킴이' },
  { min: 60, icon: '📚', name: '탐라 학자' },
  { min: 100, icon: '🏆', name: '탐라 장인' },
  { min: data.length, icon: '👑', name: '탐라 마스터' },
]

// 세부분류(dir1)를 테마 투어로 묶음. 장소가 적은 분류는 "문화 한 조각" 으로 합침
const TOUR_DEFS = {
  자연: { icon: '🌿', name: '자연 탐방' },
  사회: { icon: '🏘️', name: '마을·사회 탐방' },
  의식주: { icon: '🍚', name: '의식주 탐방' },
  기타: { icon: '🧭', name: '숨은 명소 탐방' },
  관광: { icon: '📸', name: '관광 명소 탐방' },
  무속: { icon: '🕯️', name: '신당·무속 탐방' },
  역사: { icon: '🏯', name: '역사 유적 탐방' },
  생산기술: { icon: '⚓', name: '생산기술 탐방' },
}
const OTHER_TOUR = { key: '문화', icon: '📜', name: '문화 한 조각' }

const tours = []
for (const r of data) {
  const def = TOUR_DEFS[r.dir1]
  const key = def ? r.dir1 : OTHER_TOUR.key
  let tour = tours.find((t) => t.key === key)
  if (!tour) {
    tour = { key, ...(def ?? OTHER_TOUR), ids: [] }
    tours.push(tour)
  }
  tour.ids.push(r.id)
  r.tour = key
}
// 장소가 많은 투어를 앞에, "문화 한 조각" 은 마지막에
tours.sort((a, b) => (a.key === OTHER_TOUR.key) - (b.key === OTHER_TOUR.key) || b.ids.length - a.ids.length)
const tourByKey = new Map(tours.map((t) => [t.key, t]))

// 저장소 -----------------------------------------------------
// stamps: { [장소id]: { at: ISO 시각, method: 'gps' | 'manual' } }
// favs: 찜한 순서 그대로 = 나만의 답사 코스 순서
const KEY_STAMPS = 'jeju-2step-stamps'
const KEY_FAVS = 'jeju-2step-favs'
const KEY_MEMOS = 'jeju-2step-memos' // memos: { [장소id]: 방문 메모 }
function readStore(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key))
    return v ?? fallback
  } catch {
    return fallback // file:// 환경이나 시크릿 모드에서 저장소를 못 쓸 수 있음
  }
}
function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch { /* 저장 실패해도 화면 동작에는 영향 없음 */ }
}
function loadStamps() {
  const v = readStore(KEY_STAMPS, {})
  const out = {}
  for (const [id, s] of Object.entries(v && typeof v === 'object' ? v : {})) {
    if (byId.has(Number(id)) && s?.at) out[id] = { at: s.at, method: s.method === 'gps' ? 'gps' : 'manual' }
  }
  return out
}
function loadFavs() {
  const v = readStore(KEY_FAVS, [])
  return Array.isArray(v) ? v.filter((id) => byId.has(id)) : []
}
function loadMemos() {
  const v = readStore(KEY_MEMOS, {})
  const out = {}
  for (const [id, text] of Object.entries(v && typeof v === 'object' ? v : {})) {
    if (byId.has(Number(id)) && typeof text === 'string' && text.trim()) out[id] = text.trim().slice(0, MEMO_MAX)
  }
  return out
}

const state = {
  stamps: loadStamps(),
  favs: loadFavs(),
  memos: loadMemos(),
  myPos: null, // "가까운 순" 정렬에 쓰는 내 위치 { lat, lng }
  activeId: null,
  justStamped: null,
  busyId: null,
  view: { x: 0, y: 0, w: MAP.W, h: MAP.H },
}
const isStamped = (id) => Boolean(state.stamps[id])
const stampCount = () => Object.keys(state.stamps).length

// 유틸 -------------------------------------------------------
// 텍스트는 모두 textContent 로 넣어 HTML 이 해석되지 않게 함
function el(tag, props = {}, ...children) {
  const node = document.createElement(tag)
  Object.assign(node, props)
  node.append(...children.filter(Boolean))
  return node
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const pad2 = (n) => String(n).padStart(2, '0')
function fmtDate(iso, short = false) {
  const d = new Date(iso)
  return short ? `${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}` : `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`
}
const methodLabel = (m) => (m === 'gps' ? '📍 현장 인증' : '✍️ 직접 체크')

function fillSelect(select, values, label = (v) => v) {
  for (const v of values) select.append(el('option', { value: v, textContent: label(v) }))
}
const uniqueSorted = (values) => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'))
fillSelect(els.tour, tours.map((t) => t.key), (k) => `${tourByKey.get(k).icon} ${tourByKey.get(k).name}`)
fillSelect(els.category, uniqueSorted(data.map((r) => r.category)))
fillSelect(els.region, uniqueSorted(data.map((r) => r.region)))

let toastTimer = 0
function toast(message, ms = 3800) {
  els.toast.textContent = message
  els.toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (els.toast.hidden = true), ms)
}

// 지도 좌표 변환 --------------------------------------------
// 전체 데이터 범위에 고정해서 필터를 바꿔도 지도 위치가 흔들리지 않게 함.
// 경도 1도는 위도 1도보다 짧으므로 cos(위도) 로 보정해 실제 비율 유지
// jeju-outline.js (제주시/서귀포시 경계). 없으면 윤곽 없이 점만 그림
const outline = window.JEJU_OUTLINE || []
const outlinePts = outline.flatMap((r) => r.polygons.flat())
// 지도 범위에 섬 윤곽 전체가 들어가도록 장소 좌표와 윤곽 좌표를 함께 사용
const lats = [...data.map((r) => r.lat), ...outlinePts.map((p) => p[1])]
const lngs = [...data.map((r) => r.lng), ...outlinePts.map((p) => p[0])]
const minLat = Math.min(...lats), maxLat = Math.max(...lats)
const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
const spanX = Math.max((maxLng - minLng) * kx, 1e-6)
const spanY = Math.max(maxLat - minLat, 1e-6)
const scale = Math.min((MAP.W - MAP.pad * 2) / spanX, (MAP.H - MAP.pad * 2) / spanY)
const offX = (MAP.W - spanX * scale) / 2
const offY = (MAP.H - spanY * scale) / 2
const projectLng = (lng) => offX + (lng - minLng) * kx * scale
const projectLat = (lat) => offY + (maxLat - lat) * scale
for (const r of data) {
  r.x = projectLng(r.lng)
  r.y = projectLat(r.lat)
}

// 윤곽 좌표를 SVG 경로 문자열로 미리 변환 (확대/축소 때는 선 굵기만 다시 지정)
const outlinePaths = outline.map((region) => ({
  name: region.name,
  d: region.polygons
    .map((ring) => 'M' + ring.map(([lng, lat]) => `${projectLng(lng).toFixed(1)},${projectLat(lat).toFixed(1)}`).join('L') + 'Z')
    .join(''),
}))
// 한라산 백록담(해발 1,947m) 위치 - 방향 잡기용 표식
const HALLASAN = { name: '한라산', x: projectLng(126.5292), y: projectLat(33.3617) }

// 두 지점 사이 직선거리(km)
function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// 조회 -------------------------------------------------------
function getFiltered() {
  const q = els.q.value.trim().toLowerCase()
  const list = data.filter((r) => {
    if (els.onlyFavs.checked && !state.favs.includes(r.id)) return false
    if (els.tour.value && r.tour !== els.tour.value) return false
    if (els.category.value && r.category !== els.category.value) return false
    if (els.region.value && r.region !== els.region.value) return false
    if (els.stampState.value === 'done' && !isStamped(r.id)) return false
    if (els.stampState.value === 'todo' && isStamped(r.id)) return false
    if (!q) return true
    return [r.name, r.title, r.address, r.subject, r.content, r.dir2, r.author]
      .some((v) => v && v.toLowerCase().includes(q))
  })

  const key = els.sort.value
  if (key === 'near') {
    if (state.myPos) list.sort((a, b) => distanceKm(state.myPos, a) - distanceKm(state.myPos, b))
  } else if (key !== 'default') {
    const field = { name: 'name', region: 'region', category: 'category' }[key]
    list.sort((a, b) => String(a[field]).localeCompare(String(b[field]), 'ko') || a.id - b.id)
  }
  return list
}

const fmtKm = (km) => (km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`)
// "가까운 순" 정렬일 때 카드 주소 뒤에 붙이는 내 위치와의 직선거리
const nearText = (r) => (els.sort.value === 'near' && state.myPos ? ` · 📍 ${fmtKm(distanceKm(state.myPos, r))}` : '')

// 등급 / 진행 현황 -------------------------------------------
function levelFor(count) {
  let idx = 0
  LEVELS.forEach((l, i) => { if (count >= l.min) idx = i })
  return { level: LEVELS[idx], next: LEVELS[idx + 1] }
}

function tourProgress(tour) {
  const done = tour.ids.filter(isStamped).length
  return { done, total: tour.ids.length, complete: done === tour.ids.length }
}

function setBar(bar, ratio) {
  bar.firstElementChild.style.width = `${Math.round(ratio * 100)}%`
  bar.setAttribute('aria-valuenow', Math.round(ratio * 100))
}

function renderBanner() {
  const n = stampCount()
  const { level, next } = levelFor(n)
  $('level-icon').textContent = level.icon
  $('level-name').textContent = level.name
  $('stamp-count').textContent = n
  $('stamp-total').textContent = data.length
  setBar($('total-bar'), data.length ? n / data.length : 0)
  const gps = Object.values(state.stamps).filter((s) => s.method === 'gps').length
  $('next-goal').textContent = (next
    ? `다음 등급 '${next.name}'까지 ${next.min - n}개 남았어요.`
    : '모든 스탬프를 모았어요! 🎉') + (n ? `  (현장 인증 ${gps}개)` : '')

  const box = $('region-bars')
  box.replaceChildren(
    ...uniqueSorted(data.map((r) => r.region)).map((region) => {
      const ids = data.filter((r) => r.region === region)
      const done = ids.filter((r) => isStamped(r.id)).length
      const bar = el('div', { className: 'bar' }, el('span'))
      setBar(bar, ids.length ? done / ids.length : 0)
      bar.removeAttribute('aria-valuenow')
      return el(
        'div',
        { className: 'mini' },
        el('div', { className: 'mini__row' }, el('span', { textContent: region }), el('span', { textContent: `${done} / ${ids.length}` })),
        bar,
      )
    }),
  )
}

// 테마 투어 패널 ---------------------------------------------
function renderTours() {
  els.tourList.replaceChildren(
    ...tours.map((t) => {
      const p = tourProgress(t)
      const bar = el('div', { className: 'bar' }, el('span'))
      setBar(bar, p.done / p.total)
      const name = el('button', { type: 'button', className: 'tour__name', textContent: `${t.icon} ${t.name}`, title: '이 투어만 보기' })
      name.dataset.tour = t.key
      return el(
        'li',
        { className: 'tour' + (els.tour.value === t.key ? ' active' : '') },
        el(
          'div',
          { className: 'tour__head' },
          name,
          p.complete && el('span', { className: 'badge', textContent: '🏅 완주' }),
          el('span', { className: 'tour__num', textContent: `${p.done}/${p.total}` }),
        ),
        bar,
      )
    }),
  )
}

// 카드 -------------------------------------------------------
function renderCards(list) {
  els.cards.replaceChildren(
    ...list.map((r) => {
      const order = state.favs.indexOf(r.id) + 1
      const fav = order > 0
      const stamp = state.stamps[r.id]

      const heart = el('button', {
        type: 'button',
        className: 'heart',
        textContent: fav ? '♥' : '♡',
        title: fav ? '찜 해제' : '찜하기',
      })
      heart.dataset.fav = r.id
      heart.setAttribute('aria-pressed', String(fav))
      heart.setAttribute('aria-label', `${r.name} ${fav ? '찜 해제' : '찜하기'}`)

      let action
      if (stamp) {
        action = el('p', {
          className: 'stamp-done',
          textContent: `✓ ${fmtDate(stamp.at)} · ${methodLabel(stamp.method)}${state.memos[r.id] ? ' · 📝 메모' : ''}`,
        })
      } else {
        action = el('button', {
          type: 'button',
          className: 'stamp-btn',
          textContent: state.busyId === r.id ? '위치 확인 중...' : '📍 스탬프 찍기',
          disabled: state.busyId !== null,
        })
        action.dataset.stamp = r.id
      }

      const card = el(
        'article',
        { className: 'card' + (fav ? ' is-fav' : '') + (stamp ? ' is-done' : ''), tabIndex: 0 },
        el(
          'div',
          { className: 'card__top' },
          el('span', { className: 'tag', textContent: r.category || '-' }),
          fav && el('span', { className: 'order', textContent: `코스 ${order}번` }),
          el('span', { className: 'spacer' }),
          heart,
        ),
        el('h3', { textContent: r.name }),
        r.title && el('p', { className: 'title', textContent: r.title }),
        el('p', { className: 'addr', textContent: r.address + nearText(r) }),
        action,
        stamp &&
          el(
            'div',
            { className: 'seal' + (state.justStamped === r.id ? ' pop' : '') },
            el('span', { textContent: '방문' }),
            el('span', { textContent: '완료' }),
            el('span', { textContent: fmtDate(stamp.at, true) }),
          ),
      )
      card.dataset.id = r.id
      return card
    }),
  )
  els.empty.hidden = list.length > 0
}

// 지도 -------------------------------------------------------
const SVG_NS = 'http://www.w3.org/2000/svg'
function svg(tag, attrs = {}, title) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
  if (title) {
    const t = document.createElementNS(SVG_NS, 'title')
    t.textContent = title
    node.append(t)
  }
  return node
}

function applyView() {
  const { x, y, w, h } = state.view
  els.map.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
}

function renderMap(list) {
  // 확대해도 점·선·글자의 화면 크기가 일정하도록 배율 s 로 보정
  const s = state.view.w / MAP.W
  const map = els.map
  map.replaceChildren()
  applyView()

  // 위도/경도 0.1도 격자 (방향 감각용)
  const grid = svg('g', { class: 'grid', 'stroke-width': 0.6 * s })
  for (let lat = Math.ceil(minLat * 10) / 10; lat <= maxLat; lat += 0.1) {
    const y = projectLat(lat)
    grid.append(svg('line', { x1: 0, y1: y, x2: MAP.W, y2: y }))
  }
  for (let lng = Math.ceil(minLng * 10) / 10; lng <= maxLng; lng += 0.1) {
    const x = projectLng(lng)
    grid.append(svg('line', { x1: x, y1: 0, x2: x, y2: MAP.H }))
  }
  map.append(grid)

  // 제주도 윤곽: 제주시/서귀포시를 다른 색으로 구분 (바다는 배경색)
  outlinePaths.forEach((region) => {
    // 색은 시 이름 기준 (범례와 일치): 제주시 = 0, 서귀포시 = 1
    map.append(svg('path', { class: `land land--${region.name === '제주시' ? 0 : 1}`, d: region.d, 'stroke-width': 1.2 * s, 'stroke-linejoin': 'round' }, region.name))
  })
  if (outlinePaths.length) {
    const peak = svg('path', {
      class: 'peak',
      d: `M${HALLASAN.x},${HALLASAN.y - 6 * s}L${HALLASAN.x + 5.5 * s},${HALLASAN.y + 4 * s}L${HALLASAN.x - 5.5 * s},${HALLASAN.y + 4 * s}Z`,
    }, '한라산 (1,947m)')
    const label = svg('text', { class: 'peak-label', x: HALLASAN.x, y: HALLASAN.y + 15 * s, 'font-size': 10 * s })
    label.textContent = HALLASAN.name
    map.append(peak, label)
  }

  // 조회 결과 점: 스탬프를 찍은 곳은 초록색 (코스에 든 곳은 아래에서 번호 마커로 그림)
  for (const r of list) {
    if (state.favs.includes(r.id)) continue
    const done = isStamped(r.id)
    const dot = svg(
      'circle',
      { class: 'dot' + (done ? ' done' : ''), cx: r.x, cy: r.y, r: (done ? 5 : 4) * s, 'stroke-width': 0.8 * s },
      `${r.name}${done ? ' ✓' : ''} (${r.lat}, ${r.lng})`,
    )
    dot.dataset.id = r.id
    map.append(dot)
  }

  // 나만의 답사 코스: 찜한 순서대로 선으로 연결 (필터와 무관하게 항상 표시)
  const stops = state.favs.map((id) => byId.get(id))
  if (stops.length > 1) {
    map.append(
      svg('polyline', {
        class: 'route',
        points: stops.map((r) => `${r.x},${r.y}`).join(' '),
        'stroke-width': 2.6 * s,
        'stroke-dasharray': `${9 * s} ${5 * s}`,
      }),
    )
  }
  stops.forEach((r, i) => {
    const done = isStamped(r.id)
    const stop = svg(
      'circle',
      { class: 'stop' + (done ? ' done' : ''), cx: r.x, cy: r.y, r: 9 * s, 'stroke-width': (done ? 2.6 : 1.5) * s },
      `${i + 1}. ${r.name}${done ? ' ✓' : ''}`,
    )
    stop.dataset.id = r.id
    const num = svg('text', { class: 'stop-num', x: r.x, y: r.y, 'font-size': 10.5 * s })
    num.textContent = i + 1
    map.append(stop, num)
  })

  // 상세를 열어 둔 장소 강조
  const active = byId.get(state.activeId)
  if (active) map.append(svg('circle', { class: 'ring', cx: active.x, cy: active.y, r: 12 * s, 'stroke-width': 1.8 * s }))
}

// 확대/축소: (cx, cy) 지점이 화면에서 제자리에 머물도록 viewBox 조절
function zoomAt(factor, cx, cy) {
  const v = state.view
  const w = clamp(v.w * factor, MAP.W / 14, MAP.W)
  const h = (w * MAP.H) / MAP.W
  const rx = (cx - v.x) / v.w
  const ry = (cy - v.y) / v.h
  v.x = clamp(cx - rx * w, 0, MAP.W - w)
  v.y = clamp(cy - ry * h, 0, MAP.H - h)
  v.w = w
  v.h = h
  renderMap(getFiltered())
}
const toSvgPoint = (e) => {
  const rect = els.map.getBoundingClientRect()
  const v = state.view
  return { x: v.x + ((e.clientX - rect.left) / rect.width) * v.w, y: v.y + ((e.clientY - rect.top) / rect.height) * v.h }
}
const zoomCenter = (factor) => zoomAt(factor, state.view.x + state.view.w / 2, state.view.y + state.view.h / 2)

$('zoom-in').addEventListener('click', () => zoomCenter(0.7))
$('zoom-out').addEventListener('click', () => zoomCenter(1 / 0.7))
$('zoom-reset').addEventListener('click', () => {
  state.view = { x: 0, y: 0, w: MAP.W, h: MAP.H }
  renderMap(getFiltered())
})
els.map.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const p = toSvgPoint(e)
    zoomAt(e.deltaY < 0 ? 0.8 : 1.25, p.x, p.y)
  },
  { passive: false },
)

// 드래그로 이동. 점 클릭과 구분하기 위해 일정 거리 이상 움직였을 때만 이동으로 처리
let drag = null
let justDragged = false
els.map.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return
  drag = { sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y, moved: false }
})
window.addEventListener('pointermove', (e) => {
  if (!drag) return
  const dx = e.clientX - drag.sx
  const dy = e.clientY - drag.sy
  if (!drag.moved && Math.hypot(dx, dy) < 5) return
  drag.moved = true
  els.map.classList.add('dragging')
  const rect = els.map.getBoundingClientRect()
  const v = state.view
  v.x = clamp(drag.vx - (dx / rect.width) * v.w, 0, MAP.W - v.w)
  v.y = clamp(drag.vy - (dy / rect.height) * v.h, 0, MAP.H - v.h)
  applyView() // 이동만 할 때는 viewBox 만 바꿔 가볍게 처리
})
window.addEventListener('pointerup', () => {
  if (!drag) return
  justDragged = drag.moved
  drag = null
  els.map.classList.remove('dragging')
  setTimeout(() => (justDragged = false))
})

// 나만의 답사 코스 패널 --------------------------------------
function renderCourse() {
  const stops = state.favs.map((id) => byId.get(id))
  const legs = stops.map((r, i) => (i === 0 ? 0 : distanceKm(stops[i - 1], r)))
  const total = legs.reduce((a, b) => a + b, 0)
  const doneCount = stops.filter((r) => isStamped(r.id)).length

  els.courseEmpty.hidden = stops.length > 0
  els.courseClear.disabled = stops.length === 0
  els.courseMaps.disabled = stops.length < 2 // 길찾기는 출발지와 도착지가 있어야 함
  els.courseCopy.disabled = stops.length === 0
  els.courseSummary.textContent = stops.length
    ? `${stops.length}곳 · 총 ${total.toFixed(1)}km (직선거리 기준) · 스탬프 ${doneCount}/${stops.length}`
    : ''

  els.courseList.replaceChildren(
    ...stops.map((r, i) => {
      const li = el(
        'li',
        {},
        el('span', { className: 'n', textContent: i + 1 }),
        el('button', { type: 'button', className: 'name', textContent: r.name, title: '상세 보기' }),
        isStamped(r.id) && el('span', { className: 'ok', textContent: '✓', title: '스탬프 완료' }),
        i > 0 && el('span', { className: 'leg', textContent: `+${legs[i].toFixed(1)}km` }),
        el('button', { type: 'button', className: 'ctl', textContent: '↑', title: '앞으로', disabled: i === 0 }),
        el('button', { type: 'button', className: 'ctl', textContent: '↓', title: '뒤로', disabled: i === stops.length - 1 }),
        el('button', { type: 'button', className: 'ctl', textContent: '✕', title: '코스에서 빼기' }),
      )
      li.dataset.id = r.id
      return li
    }),
  )
}

// 최근 스탬프 ------------------------------------------------
function renderRecent() {
  const items = Object.entries(state.stamps)
    .map(([id, s]) => ({ r: byId.get(Number(id)), ...s }))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8)

  els.recentEmpty.hidden = items.length > 0
  els.stampClear.disabled = stampCount() === 0
  els.recent.replaceChildren(
    ...items.map(({ r, at, method }) => {
      const li = el(
        'li',
        {},
        el('button', { type: 'button', className: 'name', textContent: r.name, title: '상세 보기' }),
        el('span', { className: 'when', textContent: `${fmtDate(at)} ${method === 'gps' ? '📍' : '✍️'}`, title: methodLabel(method) }),
      )
      li.dataset.id = r.id
      return li
    }),
  )
}

// 스탬프 -----------------------------------------------------
function getPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), // 거부/실패/시간 초과 모두 "확인 불가" 로 처리
      { enableHighAccuracy: true, timeout: 7000, maximumAge: 30000 },
    )
  })
}

// 새로 달성한 등급/투어 완주를 알려 주기 위해 찍기 전후 상태를 비교
function snapshot() {
  return {
    level: levelFor(stampCount()).level.name,
    doneTours: tours.filter((t) => tourProgress(t).complete).map((t) => t.key),
  }
}

async function stampPlace(id) {
  const r = byId.get(id)
  if (!r || isStamped(id) || state.busyId !== null) return

  state.busyId = id
  toast(`${r.name} 에서 현재 위치를 확인하는 중...`, 8000)
  render()
  const pos = await getPosition()
  state.busyId = null

  let method = 'manual'
  if (pos) {
    const meters = distanceKm(pos, r) * 1000
    if (meters <= RADIUS_M) method = 'gps'
    else {
      const dist = meters >= 1000 ? `${(meters / 1000).toFixed(1)}km` : `${Math.round(meters)}m`
      if (!confirm(`현재 위치가 '${r.name}'에서 약 ${dist} 떨어져 있어요.\n현장 인증은 ${RADIUS_M}m 이내에서만 가능합니다.\n\n직접 방문 체크로 스탬프를 찍을까요?`)) {
        els.toast.hidden = true
        return render()
      }
    }
  } else if (!confirm(`현재 위치를 확인할 수 없어요. (위치 권한 거부 또는 지원하지 않는 환경)\n\n'${r.name}' 스탬프를 직접 방문 체크로 찍을까요?`)) {
    els.toast.hidden = true
    return render()
  }

  const before = snapshot()
  state.stamps[id] = { at: new Date().toISOString(), method }
  writeStore(KEY_STAMPS, state.stamps)
  state.justStamped = id
  const after = snapshot()

  const lines = [`🎉 ${r.name} 스탬프 완료! (${methodLabel(method)})`]
  for (const key of after.doneTours.filter((k) => !before.doneTours.includes(k))) {
    lines.push(`🏅 '${tourByKey.get(key).name}' 완주 배지를 받았어요!`)
  }
  if (after.level !== before.level) lines.push(`${levelFor(stampCount()).level.icon} 등급 상승: ${after.level}`)
  toast(lines.join('\n'), 5200)

  render()
  state.justStamped = null
}

function cancelStamp(id) {
  const r = byId.get(id)
  if (!r || !isStamped(id)) return
  if (!confirm(`'${r.name}' 스탬프를 취소할까요?`)) return
  delete state.stamps[id]
  writeStore(KEY_STAMPS, state.stamps)
  render()
}

els.stampClear.addEventListener('click', () => {
  if (stampCount() && confirm(`찍은 스탬프 ${stampCount()}개와 방문 메모를 모두 지울까요? 되돌릴 수 없습니다.\n(필요하면 먼저 "내 기록 내보내기"로 백업하세요)`)) {
    state.stamps = {}
    state.memos = {}
    writeStore(KEY_STAMPS, state.stamps)
    writeStore(KEY_MEMOS, state.memos)
    render()
  }
})

// 방문 메모 ---------------------------------------------------
function saveMemo(id, text) {
  const t = text.trim().slice(0, MEMO_MAX)
  if (t) state.memos[id] = t
  else delete state.memos[id]
  writeStore(KEY_MEMOS, state.memos)
  renderCards(getFiltered()) // 카드의 "📝 메모" 표시 갱신 (열려 있는 상세는 그대로 둠)
}

// 상세 팝업의 메모 입력칸. 스탬프를 찍은 장소에서만 보임
function memoBlock(id, stamped) {
  const input = el('textarea', {
    className: 'memo__input',
    rows: 3,
    maxLength: MEMO_MAX,
    placeholder: `이곳에서 느낀 점이나 기억하고 싶은 것을 적어 보세요 (최대 ${MEMO_MAX}자)`,
    value: state.memos[id] ?? '',
  })
  input.setAttribute('aria-label', '방문 메모')
  const count = el('span', { className: 'memo__count', textContent: `${input.value.length}/${MEMO_MAX}` })
  let timer = 0
  input.addEventListener('input', () => {
    count.textContent = `${input.value.length}/${MEMO_MAX}`
    clearTimeout(timer)
    timer = setTimeout(() => saveMemo(id, input.value), 300) // 입력이 멈추면 저장
  })
  input.addEventListener('blur', () => {
    clearTimeout(timer)
    saveMemo(id, input.value)
  })
  return el('div', { className: 'memo', hidden: !stamped }, el('h3', { textContent: '방문 메모' }), input, count)
}

// 내 기록 백업 / 복원 ----------------------------------------
// 브라우저 저장소(localStorage)가 지워지거나 다른 기기로 옮길 때를 위해 JSON 파일로 저장/불러오기
function exportBackup() {
  const payload = {
    app: 'jeju-stamp-tour',
    version: 1,
    exportedAt: new Date().toISOString(),
    stamps: state.stamps,
    favs: state.favs,
    memos: state.memos,
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
  const a = el('a', { href: url, download: `jeju-stamp-backup-${new Date().toISOString().slice(0, 10)}.json` })
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  toast('내 기록을 파일로 저장했어요.')
}

async function importBackup(file) {
  try {
    if (file.size > 1_000_000) throw new Error('파일이 너무 커요')
    let json
    try {
      json = JSON.parse(await file.text())
    } catch {
      throw new Error('올바른 JSON 파일이 아니에요')
    }
    if (json?.app !== 'jeju-stamp-tour') throw new Error('이 사이트에서 내보낸 백업 파일이 아니에요')

    // 파일 내용은 믿지 않고, 현재 장소 목록에 있는 것만 규칙에 맞게 걸러서 사용
    const stamps = {}
    for (const [id, s] of Object.entries(json.stamps ?? {})) {
      if (byId.has(Number(id)) && s?.at && !Number.isNaN(Date.parse(s.at))) {
        stamps[id] = { at: new Date(s.at).toISOString(), method: s.method === 'gps' ? 'gps' : 'manual' }
      }
    }
    const favs = [...new Set((Array.isArray(json.favs) ? json.favs : []).map(Number).filter((id) => byId.has(id)))]
    const memos = {}
    for (const [id, text] of Object.entries(json.memos ?? {})) {
      if (byId.has(Number(id)) && typeof text === 'string' && text.trim()) memos[id] = text.trim().slice(0, MEMO_MAX)
    }

    const summary = `스탬프 ${Object.keys(stamps).length}개 · 찜 ${favs.length}곳 · 메모 ${Object.keys(memos).length}개`
    if (!confirm(`${summary} 를 불러올까요?\n지금 기록은 이 내용으로 바뀝니다.`)) return

    state.stamps = stamps
    state.favs = favs
    state.memos = memos
    writeStore(KEY_STAMPS, stamps)
    writeStore(KEY_FAVS, favs)
    writeStore(KEY_MEMOS, memos)
    render()
    toast(`백업을 불러왔어요. (${summary})`)
  } catch (e) {
    toast(`백업을 불러오지 못했어요: ${e.message}`)
  }
}

$('backup-export').addEventListener('click', exportBackup)
$('backup-import').addEventListener('click', () => $('backup-file').click())
$('backup-file').addEventListener('change', (e) => {
  const file = e.target.files[0]
  e.target.value = '' // 같은 파일을 다시 골라도 change 가 일어나도록 초기화
  if (file) importBackup(file)
})

// 찜 / 코스 --------------------------------------------------
function toggleFav(id) {
  const i = state.favs.indexOf(id)
  if (i >= 0) state.favs.splice(i, 1)
  else state.favs.push(id) // 찜한 순서가 곧 코스 순서
  writeStore(KEY_FAVS, state.favs)
  render()
}

function moveFav(id, delta) {
  const i = state.favs.indexOf(id)
  const j = i + delta
  if (i < 0 || j < 0 || j >= state.favs.length) return
  ;[state.favs[i], state.favs[j]] = [state.favs[j], state.favs[i]]
  writeStore(KEY_FAVS, state.favs)
  render()
}

els.cards.addEventListener('click', (e) => {
  const heart = e.target.closest('[data-fav]')
  if (heart) {
    const id = Number(heart.dataset.fav)
    toggleFav(id)
    els.cards.querySelector(`[data-fav="${id}"]`)?.focus() // 다시 그린 뒤에도 키보드 포커스 유지
    return
  }
  const stampBtn = e.target.closest('[data-stamp]')
  if (stampBtn) return stampPlace(Number(stampBtn.dataset.stamp))
  const card = e.target.closest('.card')
  if (card) openDetail(Number(card.dataset.id))
})
els.cards.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('card')) openDetail(Number(e.target.dataset.id))
})

els.courseList.addEventListener('click', (e) => {
  const li = e.target.closest('li')
  const btn = e.target.closest('button')
  if (!li || !btn) return
  const id = Number(li.dataset.id)
  const buttons = [...li.querySelectorAll('button')]
  const idx = buttons.indexOf(btn) // 0: 이름, 1: ↑, 2: ↓, 3: ✕
  if (idx === 0) openDetail(id)
  else if (idx === 1) moveFav(id, -1)
  else if (idx === 2) moveFav(id, 1)
  else toggleFav(id)
})

els.courseClear.addEventListener('click', () => {
  if (state.favs.length && confirm('나만의 답사 코스를 모두 비울까요?')) {
    state.favs = []
    writeStore(KEY_FAVS, state.favs)
    render()
  }
})

// 코스를 구글 지도 길찾기로 열기 (찜한 순서 = 가는 순서, 자동차 기준)
els.courseMaps.addEventListener('click', () => {
  const stops = state.favs.map((id) => byId.get(id))
  if (stops.length < 2) return
  const used = stops.slice(0, MAPS_MAX_STOPS)
  const point = (r) => `${r.lat},${r.lng}`
  const params = new URLSearchParams({
    api: '1',
    origin: point(used[0]),
    destination: point(used[used.length - 1]),
    travelmode: 'driving',
  })
  if (used.length > 2) params.set('waypoints', used.slice(1, -1).map(point).join('|'))
  window.open(`https://www.google.com/maps/dir/?${params}`, '_blank', 'noopener')
  if (stops.length > used.length) {
    toast(`구글 지도는 최대 ${MAPS_MAX_STOPS}곳까지 열 수 있어 앞의 ${used.length}곳만 열었어요.`)
  }
})

// 코스를 글로 복사 (메신저, 메모장에 붙여넣기용)
els.courseCopy.addEventListener('click', async () => {
  const stops = state.favs.map((id) => byId.get(id))
  if (!stops.length) return
  const total = stops.reduce((sum, r, i) => sum + (i ? distanceKm(stops[i - 1], r) : 0), 0)
  const text = [
    `나만의 제주 답사 코스 (${stops.length}곳 · 총 ${total.toFixed(1)}km, 직선거리 기준)`,
    ...stops.map((r, i) => `${i + 1}. ${r.name} - ${r.address}`),
  ].join('\n')
  try {
    await navigator.clipboard.writeText(text)
    toast('코스를 복사했어요. 메신저나 메모장에 붙여넣어 보세요.')
  } catch {
    toast('복사하지 못했어요. 브라우저의 클립보드 권한을 확인해 주세요.')
  }
})

els.recent.addEventListener('click', (e) => {
  const li = e.target.closest('li')
  if (li && e.target.closest('button')) openDetail(Number(li.dataset.id))
})

els.tourList.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tour]')
  if (!btn) return
  els.tour.value = els.tour.value === btn.dataset.tour ? '' : btn.dataset.tour // 다시 누르면 해제
  render()
})

els.map.addEventListener('click', (e) => {
  if (justDragged) return
  const c = e.target.closest('circle[data-id]')
  if (c) openDetail(Number(c.dataset.id))
})

// 상세 -------------------------------------------------------
function section(title, rows) {
  const dl = el('dl')
  for (const [k, v, opts = {}] of rows) {
    if (!v) continue
    dl.append(el('dt', { textContent: k }))
    if (opts.long) dl.append(el('dd', {}, el('div', { className: 'long', textContent: v })))
    else if (opts.link) dl.append(el('dd', {}, el('a', { href: v, target: '_blank', rel: 'noopener noreferrer', textContent: v })))
    else dl.append(el('dd', { textContent: v }))
  }
  return [el('h3', { textContent: title }), dl]
}

function syncDetailActions() {
  const id = state.activeId
  els.dFav.textContent = state.favs.includes(id) ? '♥ 찜 해제' : '♡ 찜하기'
  const stamp = state.stamps[id]
  els.dStamp.textContent = stamp ? '스탬프 취소' : state.busyId === id ? '위치 확인 중...' : '📍 스탬프 찍기'
  els.dStamp.disabled = !stamp && state.busyId !== null
}

function openDetail(id) {
  const r = byId.get(id)
  if (!r) return
  state.activeId = id
  els.dTitle.textContent = r.name
  const stamp = state.stamps[id]
  const tour = tourByKey.get(r.tour)
  els.dBody.replaceChildren(
    ...section('스탬프 투어', [
      ['스탬프', stamp ? `✓ ${fmtDate(stamp.at)} · ${methodLabel(stamp.method)}` : '아직 찍지 않았어요'],
      ['테마 투어', `${tour.icon} ${tour.name}`],
    ]),
    memoBlock(id, Boolean(stamp)),
    ...section('위치정보', [
      ['장소명', r.name],
      ['주소', r.address],
      ['우편번호', r.zip],
      ['위도 / 경도', `${r.lat} / ${r.lng}`],
      ['좌표계', r.coordSystem],
      ['지도', `https://www.google.com/maps?q=${r.lat},${r.lng}`, { link: true }],
      ['상세 보기', r.detailUrl, { link: true }],
      ['데이터 기준일', r.baseDate],
    ]),
    ...section('일반정보', [
      ['분류', [r.category, r.dir1, r.dir2].filter(Boolean).join(' > ')],
      ['제목', r.title],
      ['부제목', r.subtitle],
      ['저작자', r.author],
      ['주제', r.subject],
      ['발행자', r.publisher],
      ['발행일', r.pubDate],
      ['자료 유형', [r.docType, r.docFormat].filter(Boolean).join(' / ')],
      ['언어', r.language],
      ['범위', r.scope],
      ['출처', r.source],
      ['기여자', r.contributor],
    ]),
    ...section('내용', [
      ['내용', r.content, { long: true }],
      ['초록', r.abstract, { long: true }],
      ['목차', r.toc, { long: true }],
      ['참고문헌', r.reference, { long: true }],
    ]),
  )
  syncDetailActions()
  renderMap(getFiltered())
  if (!els.detail.open) els.detail.showModal()
}

els.dFav.addEventListener('click', () => toggleFav(state.activeId))
els.dStamp.addEventListener('click', () => {
  const id = state.activeId
  if (isStamped(id)) {
    cancelStamp(id)
  } else {
    stampPlace(id).then(() => state.activeId === id && els.detail.open && openDetail(id))
  }
})
$('d-close').addEventListener('click', () => els.detail.close())
els.detail.addEventListener('click', (e) => {
  if (e.target === els.detail) els.detail.close() // 바깥(배경) 클릭 시 닫기
})
els.detail.addEventListener('close', () => {
  state.activeId = null
  renderMap(getFiltered())
})

// 제주 지역 날씨 -----------------------------------------------
// 기상청 초단기실황 스냅샷(weather-data.js). 갱신: node update-weather.mjs
const PTY_LABEL = { 0: '없음', 1: '비', 2: '비/눈', 3: '눈', 5: '빗방울', 6: '빗방울눈날림', 7: '눈날림' }
const COMPASS = ['북', '북북동', '북동', '동북동', '동', '동남동', '남동', '남남동', '남', '남남서', '남서', '서남서', '서', '서북서', '북서', '북북서']
const STALE_HOURS = 3 // 관측이 이보다 오래되면 "오래된 자료" 로 표시

function weatherIcon(w) {
  if ([3, 7].includes(w.precipType)) return '❄️'
  if ([2, 6].includes(w.precipType)) return '🌨️'
  if ([1, 5].includes(w.precipType)) return '🌧️'
  return w.temperature !== null && w.temperature >= 28 ? '☀️' : '🌤️'
}

// 오늘 스탬프 투어를 다닐 때 참고할 한 줄 안내
function weatherTip(items) {
  const hot = (f) => items.some(f)
  if (hot((w) => [1, 5].includes(w.precipType))) return '☔ 비가 내리고 있어요. 우산을 챙기고, 야외 유적은 날씨가 갠 뒤에 들러 보세요.'
  if (hot((w) => [3, 7].includes(w.precipType))) return '❄️ 눈이 내리고 있어요. 한라산 인근과 오름 방문은 길이 미끄러울 수 있으니 주의하세요.'
  if (hot((w) => [2, 6].includes(w.precipType))) return '🌨️ 비/눈이 섞여 내려요. 방수되는 신발과 우산을 준비하세요.'
  if (hot((w) => (w.windSpeed ?? 0) >= 9)) return '💨 바람이 강해요. 해안과 오름 방문은 조심하고, 모자나 가벼운 소지품을 챙기세요.'
  if (hot((w) => w.temperature !== null && w.temperature <= 3)) return '🧣 쌀쌀해요. 따뜻하게 입고 오래 걷는 코스는 천천히 다니세요.'
  if (hot((w) => w.temperature !== null && w.temperature >= 28)) return '🥵 더워요. 물을 챙기고 한낮 야외 이동은 줄여 보세요.'
  return '✅ 탐방하기 좋은 날씨예요. 스탬프 투어를 시작해 보세요!'
}

function renderWeather() {
  const box = $('weather')
  const weather = window.JEJU_WEATHER
  if (!weather?.items?.length) return // 데이터가 없으면 패널을 숨긴 채 둠
  box.hidden = false

  $('weather-cards').replaceChildren(
    ...weather.items.map((w) => {
      const compass = w.windDir === null ? '' : `${COMPASS[Math.round(w.windDir / 22.5) % 16]}풍 `
      const stats = [
        ['💧', `습도 ${w.humidity ?? '-'}%`],
        ['☔', w.precipType ? `${PTY_LABEL[w.precipType] ?? '강수'} ${w.rain1h ?? 0}mm` : '강수 없음'],
        ['🍃', `${compass}${w.windSpeed ?? '-'}m/s`],
      ]
      return el(
        'div',
        { className: 'wcard' },
        el('span', { className: 'wcard__icon', textContent: weatherIcon(w), ariaHidden: 'true' }),
        el(
          'div',
          {},
          el('p', { className: 'wcard__name', textContent: w.name }),
          el('p', { className: 'wcard__temp', textContent: w.temperature === null ? '-' : `${w.temperature}℃` }),
          el('ul', { className: 'wcard__list' }, ...stats.map(([icon, text]) => el('li', { textContent: `${icon} ${text}` }))),
        ),
      )
    }),
  )

  const observed = new Date(weather.items[0].observedAt)
  const hoursOld = (Date.now() - observed.getTime()) / 3600000
  const when = `${observed.getMonth() + 1}월 ${observed.getDate()}일 ${pad2(observed.getHours())}:00 관측`
  const meta = $('weather-meta')
  const stale = hoursOld > STALE_HOURS
  meta.textContent = `${when} · 기상청 초단기실황${stale ? ' · 오래된 자료예요 (node update-weather.mjs 로 갱신)' : ''}`
  meta.classList.toggle('stale', stale)
  $('weather-tip').textContent = weatherTip(weather.items)
}

// 전체 렌더 --------------------------------------------------
function render() {
  const list = getFiltered()
  els.summary.replaceChildren(
    `전체 ${data.length}건 중 `,
    el('strong', { textContent: `${list.length}건` }),
    ` 조회 · 스탬프 ${stampCount()}개 · 찜 ${state.favs.length}곳`,
  )
  renderBanner()
  renderTours()
  renderCards(list)
  renderMap(list)
  renderCourse()
  renderRecent()
  if (els.detail.open) {
    syncDetailActions()
    // 스탬프 상태가 바뀌었을 수 있으니 상세의 "스탬프" 줄도 갱신
    const row = els.dBody.querySelector('dl dd')
    const stamp = state.stamps[state.activeId]
    if (row) row.textContent = stamp ? `✓ ${fmtDate(stamp.at)} · ${methodLabel(stamp.method)}` : '아직 찍지 않았어요'
    const memoBox = els.dBody.querySelector('.memo')
    if (memoBox) memoBox.hidden = !stamp // 스탬프가 없으면 메모칸을 숨김
  }
}

for (const input of [els.q, els.tour, els.category, els.region, els.stampState, els.onlyFavs]) {
  input.addEventListener('input', render)
}
// "내 위치에서 가까운 순"은 먼저 현재 위치를 확인해야 함. 실패하면 기본 정렬로 되돌림
els.sort.addEventListener('input', async () => {
  if (els.sort.value === 'near') {
    toast('현재 위치를 확인하는 중...', 8000)
    const pos = await getPosition()
    if (!pos) {
      els.sort.value = 'default'
      toast('현재 위치를 확인할 수 없어요. 위치 권한을 허용했는지 확인해 주세요.')
      return render()
    }
    state.myPos = pos
    els.toast.hidden = true
  }
  render()
})
els.reset.addEventListener('click', () => {
  els.q.value = els.tour.value = els.category.value = els.region.value = els.stampState.value = ''
  els.sort.value = 'default'
  els.onlyFavs.checked = false
  render()
})

// 하단: 지금 보이는 장소 자료가 어디서 왔는지 표시
function renderSource() {
  const meta = window.JEJU_DATA_META || {}
  const note = $('data-source')
  if (meta.mode === 'live') {
    note.textContent = `📡 장소 자료: 공공데이터포털 API 실시간 조회 (${new Date(meta.fetchedAt).toLocaleString('ko-KR')})`
  } else {
    note.textContent = '🧪 장소 자료: 1단계 파일 데이터 (연습 모드)'
  }
}

render()
renderWeather()
renderSource()
