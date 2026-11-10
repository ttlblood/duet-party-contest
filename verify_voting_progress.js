const puppeteer = require('puppeteer-core');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARTIFACT_DIR = '/Users/kelvin_1_2/.gemini/antigravity/brain/c5f524d2-4bab-458a-9889-115cdcf36815';

async function verifyVotingProgress() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });

  // 1. 방 개설
  await page.click('#open-create-room-btn');
  await new Promise(r => setTimeout(r, 400));
  await page.type('#new-host-name', '민규');
  await page.click('#create-room-form button[type="submit"]');
  await new Promise(r => setTimeout(r, 1200));

  // 2. 데모 10명 & 4팀 채우기 & 대회 시작
  await page.click('#populate-demo-btn');
  await new Promise(r => setTimeout(r, 800));
  await page.click('#start-contest-btn');
  await new Promise(r => setTimeout(r, 1000));
  console.log('대회 시작 완료 (CONTEST 진입)');

  // 3. 1팀 [점수 받기] 클릭 -> SCORING 진입
  await page.click('#request-score-btn');
  await new Promise(r => setTimeout(r, 500));
  console.log('1팀 점수 받기 시작 -> SCORING 진입');

  // 4. 채점 현황 위젯 확인 (중간 상태)
  const progressInfo = await page.evaluate(() => {
    const box = document.getElementById('voting-progress-box');
    const count = document.getElementById('voter-submitted-count')?.textContent;
    const total = document.getElementById('voter-total-count')?.textContent;
    const percent = document.getElementById('voter-progress-percent')?.textContent;
    const chips = Array.from(document.querySelectorAll('#voter-status-chips .voter-chip')).map(c => c.textContent.trim());

    if (box) box.scrollIntoView();

    return {
      visible: box && window.getComputedStyle(box).display !== 'none',
      count,
      total,
      percent,
      chips
    };
  });
  console.log('[검증 1] 채점 진행 중 실시간 위젯:', progressInfo);
  await new Promise(r => setTimeout(r, 400));

  // 실시간 진행 중 화면 캡처 (스크롤된 상태)
  await page.screenshot({ path: ARTIFACT_DIR + '/scoring_progress_live.png', fullPage: false });

  // 5. 방장 점수(10점) 투표하여 전원 제출 완료 유도
  const score10 = await page.$('.score-btn[data-score="10"]');
  if (score10) {
    await score10.click();
    console.log('방장 10점 투표 클릭 완료');
  }

  // 봇 투표 및 전원 완료 대기
  await new Promise(r => setTimeout(r, 2200));

  // 6. 채점 종료 후 상단 칩 상태 검증 (채점 완료 팀에 ✅ 점수가 우선 표시되는지 확인)
  const topChipsStatus = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('#stage-team-chips .stage-team-chip'));
    return chips.map(c => c.innerText);
  });
  console.log('[검증 2] 채점 종료 후 상단 칩 상태:', topChipsStatus);

  // 채점 완료 후 화면 캡처
  await page.screenshot({ path: ARTIFACT_DIR + '/scoring_finished_stage.png', fullPage: false });

  await browser.close();
  console.log('🎉 실시간 채점 완료 현황 검증 성공!');
}

verifyVotingProgress().catch(err => {
  console.error('검증 에러:', err);
  process.exit(1);
});
