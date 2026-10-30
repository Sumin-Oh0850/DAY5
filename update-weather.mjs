// 기상청 초단기실황(getUltraSrtNcst)을 받아 weather-data.js 로 저장합니다.
//   node update-weather.mjs
// 인증키는 환경변수 KMA_SERVICE_KEY 또는 ../weather/.env 의 KMA_SERVICE_KEY 에서 읽으며,
// 키는 이 스크립트 안에서만 쓰이고 weather-data.js 에는 기록되지 않습니다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = process.env.KMA_ENV ?? path.join(here, '..', 'weather', '.env')
const OUT = path.join(here, 'src', 'data', 'weather-data.js')
const ENDPOINT = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst'

// 격자 좌표: weather 프로젝트와 동일 (제주시 52,38 / 서귀포시 52,33)
const LOCATIONS = [
  { name: '제주시', nx: 52, ny: 38 },
  { name: '서귀포시', nx: 52, ny: 33 },
]

// 찾는 순서: 환경변수 → 이 폴더의 .env.local(VITE_DATA_API_KEY) → ../weather/.env(KMA_SERVICE_KEY)
function readFromEnvFile(file, names) {
  if (!existsSync(file)) return ''
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const name = names.find((n) => line.startsWith(`${n}=`))
    const value = name && line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
    if (value) return value
  }
  return ''
}

function readKey() {
  const key =
    process.env.KMA_SERVICE_KEY ||
    readFromEnvFile(path.join(here, '.env.local'), ['VITE_DATA_API_KEY']) ||
    readFromEnvFile(ENV_PATH, ['KMA_SERVICE_KEY'])
  if (!key) {
    throw new Error(`인증키를 찾을 수 없습니다. 환경변수 KMA_SERVICE_KEY 를 설정하거나 .env.local(VITE_DATA_API_KEY) 또는 ${ENV_PATH} 를 준비하세요.`)
  }
  return key
}

const pad = (n) => String(n).padStart(2, '0')

// 정시 자료는 매시 10분 이후 제공되므로 10분 전이면 한 시간 전 자료를 요청 (hoursBack 으로 더 이전도 가능)
function getBase(hoursBack = 0, now = new Date()) {
  const kst = new Date(now.getTime() + 9 * 3600 * 1000) // UTC+9 로 옮긴 뒤 getUTC* 사용
  if (kst.getUTCMinutes() < 10) hoursBack += 1
  kst.setUTCHours(kst.getUTCHours() - hoursBack)
  return {
    baseDate: `${kst.getUTCFullYear()}${pad(kst.getUTCMonth() + 1)}${pad(kst.getUTCDate())}`,
    baseTime: `${pad(kst.getUTCHours())}00`,
  }
}

const num = (v) => (Number.isFinite(v) && v > -900 ? v : null) // 결측값(-999 등)은 null

async function fetchOne(key, loc, hoursBack) {
  const { baseDate, baseTime } = getBase(hoursBack)
  const encoded = key.includes('%') ? key : encodeURIComponent(key) // Encoding 키는 그대로, Decoding 키는 인코딩
  const url = `${ENDPOINT}?serviceKey=${encoded}&numOfRows=10&pageNo=1&dataType=JSON&base_date=${baseDate}&base_time=${baseTime}&nx=${loc.nx}&ny=${loc.ny}`

  const res = await fetch(url)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`응답을 해석할 수 없습니다 (HTTP ${res.status}). 인증키와 활용 신청 상태를 확인하세요. → ${text.slice(0, 120)}`)
  }
  const header = json.response?.header
  if (header?.resultCode !== '00') {
    const err = new Error(`기상청 오류 ${header?.resultCode}: ${header?.resultMsg}`)
    err.code = header?.resultCode
    throw err
  }

  const v = Object.fromEntries(json.response.body.items.item.map((i) => [i.category, Number(i.obsrValue)]))
  const windDir = num(v.VEC)
  const windSpeed = num(v.WSD)
  return {
    name: loc.name,
    nx: loc.nx,
    ny: loc.ny,
    baseDate,
    baseTime,
    observedAt: `${baseDate.slice(0, 4)}-${baseDate.slice(4, 6)}-${baseDate.slice(6, 8)}T${baseTime.slice(0, 2)}:00:00+09:00`,
    temperature: num(v.T1H),
    humidity: num(v.REH),
    rain1h: num(v.RN1),
    precipType: num(v.PTY),
    windDir,
    windSpeed,
  }
}

const key = readKey()
const items = []
for (const loc of LOCATIONS) {
  let item
  for (const back of [0, 1]) {
    try {
      item = await fetchOne(key, loc, back)
      break
    } catch (e) {
      // 03(NODATA_ERROR): 아직 자료가 올라오기 전이면 한 시간 전 자료로 재시도
      if (e.code === '03' && back === 0) continue
      throw e
    }
  }
  items.push(item)
  console.log(`${loc.name}: ${item.observedAt} ${item.temperature}℃ 습도 ${item.humidity}% 강수 ${item.rain1h}mm 풍속 ${item.windSpeed}m/s`)
}

const out =
  '// 기상청 초단기실황 스냅샷. update-weather.mjs 로 갱신합니다.\n' +
  'export default ' + JSON.stringify({ fetchedAt: new Date().toISOString(), items }, null, 1) + ';\n'
writeFileSync(OUT, out, 'utf8')
console.log('wrote', path.basename(OUT))
