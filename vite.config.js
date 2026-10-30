import { defineConfig } from 'vite'

// base './' : 빌드 결과(dist)를 GitHub Pages 처럼 하위 경로에 올려도 파일을 찾도록 상대 경로로 만듭니다.
export default defineConfig({
  base: './',
})
