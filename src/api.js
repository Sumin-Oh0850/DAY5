// 공공데이터포털(odcloud) "제주특별자치도_제주역사문화" 위치정보 + 일반정보 API
//   위치정보: https://infuser.odcloud.kr/oas/docs?namespace=15109570/v1
//   일반정보: https://infuser.odcloud.kr/oas/docs?namespace=15109587/v1
// 인증키는 .env.local 의 VITE_DATA_API_KEY 에서 읽습니다. (오류 메시지에는 키를 넣지 않습니다)

const ENDPOINTS = {
  location: 'https://api.odcloud.kr/api/15109570/v1/uddi:8781448b-81a8-487c-bc95-d26335bafa82',
  general: 'https://api.odcloud.kr/api/15109587/v1/uddi:56c2b3a4-4b4b-46cd-a1fa-f928ef731ffb',
}
const TIMEOUT_MS = 10000

// code: no-key | auth | http | timeout | network | bad-response
export class ApiError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

const getKey = () => String(import.meta.env.VITE_DATA_API_KEY ?? '').trim()

async function fetchAll(base, key) {
  // Encoding 키는 이미 % 인코딩되어 있으므로 그대로, Decoding 키는 인코딩해서 사용
  const serviceKey = key.includes('%') ? key : encodeURIComponent(key)
  const rows = []

  for (let page = 1; page <= 20; page++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    let res
    try {
      res = await fetch(`${base}?page=${page}&perPage=500&serviceKey=${serviceKey}`, { signal: controller.signal })
    } catch (e) {
      throw e.name === 'AbortError'
        ? new ApiError('timeout', `응답이 ${TIMEOUT_MS / 1000}초 안에 오지 않았어요`)
        : new ApiError('network', '네트워크에 연결할 수 없어요')
    } finally {
      clearTimeout(timer)
    }

    if (res.status === 401 || res.status === 403) {
      throw new ApiError('auth', `인증키가 올바르지 않거나 활용 신청이 승인되지 않았어요 (HTTP ${res.status})`)
    }
    if (!res.ok) throw new ApiError('http', `API 서버가 오류를 돌려줬어요 (HTTP ${res.status})`)

    let json
    try {
      json = await res.json()
    } catch {
      throw new ApiError('bad-response', '받은 자료를 해석할 수 없어요')
    }
    if (!Array.isArray(json.data)) throw new ApiError('bad-response', '받은 자료의 형식이 달라요')

    rows.push(...json.data)
    if (rows.length >= json.totalCount || json.data.length === 0) break
  }
  return rows
}

const clean = (v) => {
  const s = String(v ?? '').trim()
  return s === '해당없음' ? '' : s
}

// "데이터 고유번호" 기준으로 두 API 응답을 합쳐 화면이 쓰는 필드 이름으로 변환
function mergePlaces(locationRows, generalRows) {
  const general = new Map(generalRows.map((g) => [Number(g['데이터 고유번호']), g]))
  return locationRows.map((l) => {
    const id = Number(l['데이터 고유번호'])
    const g = general.get(id) ?? {}
    return {
      id,
      name: String(l['장소명'] ?? '').trim(),
      lat: Number(l['위도']),
      lng: Number(l['경도']),
      zip: String(l['우편번호'] ?? '').trim(),
      address: String(l['위치'] ?? '').trim(),
      coordSystem: String(l['좌표계값'] ?? '').trim(),
      detailUrl: String(l['데이터 상세보기 URL'] ?? '').trim(),
      baseDate: String(l['데이터기준일자'] ?? '').trim(),
      category: clean(g['분류']),
      dir1: clean(g['디렉토리1']),
      dir2: clean(g['디렉토리2']),
      title: clean(g['제목']),
      subtitle: clean(g['부제목']),
      author: clean(g['저작자']),
      subject: clean(g['주제']),
      content: clean(g['내용']),
      toc: clean(g['목차']),
      abstract: clean(g['초록']),
      publisher: clean(g['발행자']),
      pubDate: clean(g['발행일']),
      docType: clean(g['자료유형']),
      docFormat: clean(g['자료형태']),
      language: clean(g['언어']),
      scope: clean(g['범위']),
      source: clean(g['출처']),
      contributor: clean(g['기여자']),
      reference: clean(g['참고문헌']),
    }
  })
}

export async function fetchPlaces() {
  const key = getKey()
  if (!key) throw new ApiError('no-key', '인증키가 없어요 (.env.local 의 VITE_DATA_API_KEY)')

  const [location, general] = await Promise.all([fetchAll(ENDPOINTS.location, key), fetchAll(ENDPOINTS.general, key)])
  // 화면이 지도에 찍을 수 있는(좌표가 올바른) 장소만 사용
  const places = mergePlaces(location, general).filter(
    (p) => Number.isFinite(p.id) && p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng),
  )
  if (places.length === 0) throw new ApiError('bad-response', '받은 장소 자료가 비어 있어요')
  return places
}
