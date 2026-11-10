/**
 * 가상 참석자 10명 및 듀엣 4팀 등록 후 각 주요 화면 캡처 스크립트
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const { io } = require('socket.io-client');

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARTIFACT_DIR = '/Users/kelvin_1_2/.gemini/antigravity/brain/c5f524d2-4bab-458a-9889-115cdcf36815';

async function captureScreens() {
  console.log('📸 스크린샷 캡처 시작...');

  // 1. 소켓 연결하여 데모 10명 & 4팀 데이터 채우기
  const socket = io('http://localhost:3000');
  await new Promise(r => setTimeout(r, 500));

  socket.emit('populate_demo_data');
  await new Promise(r => setTimeout(r, 600));

  // 브라우저 실행
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 420, height: 880, deviceScaleFactor: 2 });

  // ----------------------------------------------------
  // 화면 1: 로비 화면 (10명 참석자 + 4개 팀 등록 + 레디 완료)
  // ----------------------------------------------------
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  // 닉네임 입력 (관객 켈빈으로 입장)
  await page.evaluate(() => {
    localStorage.setItem('duet_user_name', '켈빈');
    location.reload();
  });
  await page.waitForNavigation({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen1_lobby.png')
  });
  console.log('✅ 1. 로비 화면 캡처 완료');

  // ----------------------------------------------------
  // 화면 2: 무대 진행 화면 (지민 & 정국 무대)
  // ----------------------------------------------------
  await page.click('#start-contest-btn');
  await new Promise(r => setTimeout(r, 800));

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen2_stage_now.png')
  });
  console.log('✅ 2. 무대 진행 화면 캡처 완료');

  // ----------------------------------------------------
  // 화면 3: 30초 점수 주기 화면 (관객 켈빈 시점)
  // ----------------------------------------------------
  await page.click('#request-score-btn');
  await new Promise(r => setTimeout(r, 500));

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen3_audience_scoring.png')
  });
  console.log('✅ 3. 관객 점수 주기 화면 캡처 완료');

  // ----------------------------------------------------
  // 화면 4: 출전 팀원 대기 화면 (지민 시점)
  // ----------------------------------------------------
  const performerPage = await browser.newPage();
  await performerPage.setViewport({ width: 420, height: 880, deviceScaleFactor: 2 });
  await performerPage.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  await performerPage.evaluate(() => {
    localStorage.setItem('duet_user_name', '지민'); // 지민은 1팀 출전자!
    location.reload();
  });
  await performerPage.waitForNavigation({ waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 800));

  await performerPage.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen4_performer_waiting.png')
  });
  console.log('✅ 4. 팀원 대기 화면 캡처 완료');
  await performerPage.close();

  // 관객이 9점 선택 제출
  await page.bringToFront();
  await page.click('.score-btn[data-score="9"]');
  // 봇들이 점수를 제출하고 채점이 자동 마감될 때까지 잠시 대기
  await new Promise(r => setTimeout(r, 2200));

  // ----------------------------------------------------
  // 화면 5: 중간 점수 공개 화면 (8.??점 마스킹 처리)
  // ----------------------------------------------------
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen5_masked_score.png')
  });
  console.log('✅ 5. 중간 점수 마스킹 화면 캡처 완료');

  // 나머지 2, 3, 4팀 빠르게 완료시켜 최종 확인 버튼 노출
  for (let i = 0; i < 3; i++) {
    await page.click('#next-team-btn');
    await new Promise(r => setTimeout(r, 500));
    await page.click('#request-score-btn');
    await new Promise(r => setTimeout(r, 500));
    await page.click('.score-btn[data-score="10"]');
    await new Promise(r => setTimeout(r, 2200));
  }

  // ----------------------------------------------------
  // 화면 6: 10초 역 카운트다운 화면
  // ----------------------------------------------------
  await page.click('#reveal-final-btn');
  await new Promise(r => setTimeout(r, 1200)); // 카운트다운 진행 중

  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen6_countdown.png')
  });
  console.log('✅ 6. 10초 역 카운트다운 화면 캡처 완료');

  // 카운트다운 종료 (약 9초 대기)
  await new Promise(r => setTimeout(r, 9500));

  // ----------------------------------------------------
  // 화면 7: 최종 시상식 화면 (포디움 1,2,3위 + 전체 순위 소수점 공개)
  // ----------------------------------------------------
  await page.screenshot({
    path: path.join(ARTIFACT_DIR, 'screen7_final_podium.png')
  });
  console.log('✅ 7. 최종 시상식 화면 캡처 완료');

  // 테스트 후 다시 사용자가 직접 조작해볼 수 있도록 로비에 데모 10명&4팀을 다시 세팅해둠!
  socket.emit('populate_demo_data');
  await new Promise(r => setTimeout(r, 500));

  await browser.close();
  socket.disconnect();
  console.log('🎉 모든 화면 캡처 완료 및 로비 데모 상태 재세팅 완료!');
}

captureScreens().catch(err => {
  console.error('❌ 에러 발생:', err);
  process.exit(1);
});
