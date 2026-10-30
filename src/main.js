// 진입 파일: 장소 자료를 불러온 뒤 화면(app.js)을 시작합니다.
//   1) 불러오는 동안 "불러오는 중" 표시
//   2) 공공데이터포털 API 성공 → 실시간 자료
//   3) 실패(키 없음/잘못된 키/네트워크 오류 등) → 1단계 파일 데이터 + "연습 모드" 표시
import './style.css'
import { fetchPlaces } from './api.js'
import step1Places from './data/step1-data.js'
import outline from './data/jeju-outline.js'
import weather from './data/weather-data.js'

const $ = (id) => document.getElementById(id)

async function loadPlaces() {
  try {
    return { places: await fetchPlaces(), mode: 'live', fetchedAt: new Date().toISOString() }
  } catch (e) {
    console.warn('[API] 연습 모드로 전환합니다:', e.code ?? e.name) // 인증키는 로그에 남기지 않음
    return {
      places: step1Places,
      mode: 'practice',
      reason: e.code ? e.message : '알 수 없는 오류가 발생했어요',
    }
  }
}

async function main() {
  const result = await loadPlaces()

  // app.js 가 읽는 자료 (app.js 는 이 값이 준비된 뒤에 불러옴)
  window.JEJU_DATA = result.places
  window.JEJU_OUTLINE = outline
  window.JEJU_WEATHER = weather
  window.JEJU_DATA_META = { mode: result.mode, fetchedAt: result.fetchedAt, reason: result.reason }

  await import('./app.js')

  $('loading').remove()
  $('app').hidden = false
  if (result.mode === 'practice') {
    $('practice-reason').textContent = result.reason
    $('practice-banner').hidden = false
  }
}

$('practice-retry').addEventListener('click', () => location.reload())

main().catch((e) => {
  console.error(e)
  $('loading').textContent = '화면을 시작하지 못했어요. 새로고침해 주세요.'
  $('loading').classList.add('loading--error')
})
