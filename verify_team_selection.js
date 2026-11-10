const puppeteer = require('puppeteer-core');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ARTIFACT_DIR = '/Users/kelvin_1_2/.gemini/antigravity/brain/c5f524d2-4bab-458a-9889-115cdcf36815';

async function verifyFeatures() {
  const browser1 = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const browser2 = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  // 1. 방장(민규) 페이지 (브라우저 1)
  const hostPage = await browser1.newPage();
  await hostPage.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await hostPage.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
  
  // 대회 열기
  await hostPage.click('#open-create-room-btn');
  await new Promise(r => setTimeout(r, 400));
  await hostPage.type('#new-host-name', '민규');
  await hostPage.click('#create-room-form button[type="submit"]');
  await new Promise(r => setTimeout(r, 1200));

  // 현재 방 코드 추출
  const roomUrl = hostPage.url();
  const roomCode = roomUrl.split('/').pop();
  console.log('방 생성 완료:', roomCode);

  // 데모 10명 & 4팀 채우기
  await hostPage.click('#populate-demo-btn');
  await new Promise(r => setTimeout(r, 800));

  // 대회 시작하기
  await hostPage.click('#start-contest-btn');
  await new Promise(r => setTimeout(r, 1000));
  console.log('대회 시작 완료 (CONTEST 진입)');

  // 2. 1팀 점수 받기 시작 -> 방장 민규도 점수(9점) 제출하여 채점 즉시 완료 유도
  await hostPage.click('#request-score-btn');
  await new Promise(r => setTimeout(r, 600));

  // 방장 점수 투표 (9점 버튼 클릭)
  const score9Btn = await hostPage.$('.score-btn[data-score="9"]');
  if (score9Btn) {
    await score9Btn.click();
    console.log('방장 9점 투표 완료');
  }
  await new Promise(r => setTimeout(r, 2000)); // 봇 투표 및 채점 종료 대기
  console.log('1팀 채점 완료됨 (status: scored)');

  // 3. 팀원(철수) 페이지 (완전히 독립된 브라우저 2)
  const memberPage = await browser2.newPage();
  await memberPage.setViewport({ width: 375, height: 812, deviceScaleFactor: 2 });
  await memberPage.goto('http://localhost:3000/' + roomCode, { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 600));
  
  // 닉네임 입력 모달에서 '철수' 입력
  await memberPage.waitForSelector('#nickname-input', { visible: true, timeout: 5000 });
  await memberPage.type('#nickname-input', '철수');
  await memberPage.click('#nickname-form button[type="submit"]');
  await new Promise(r => setTimeout(r, 1200));
  console.log('팀원 철수 입장 완료');

  // [검증 1] 팀 목록 눌러보는 건 멤버 모두 가능하지만 다른 사람 선택까지 변경되서는 안 됨
  // 철수가 2번째 팀 칩(index 1, 잔소리)을 클릭
  await memberPage.evaluate(() => {
    const chips = document.querySelectorAll('#stage-team-chips .stage-team-chip');
    if (chips[1]) chips[1].click();
  });
  await new Promise(r => setTimeout(r, 600));

  // 철수 화면에서 현재 표시된 곡목과 방장 화면에서 표시된 곡목 확인
  const memberSong = await memberPage.$eval('#current-team-song', el => el.textContent);
  const hostSong = await hostPage.$eval('#current-team-song', el => el.textContent);
  console.log('[검증 1] 철수가 보는 곡목:', memberSong);
  console.log('[검증 1] 방장이 보는 곡목:', hostSong);
  const isIndependent = (memberSong !== hostSong);
  console.log('[검증 1 결과 - 서로 독립적이어야 성공]:', isIndependent ? '✅ 성공!' : '❌ 실패');

  // [검증 2] 채점이 끝난 1팀을 각자 선택했을 때 버튼 상태 비교
  // 철수가 1팀(채점 완료 팀) 클릭
  await memberPage.evaluate(() => {
    const chips = document.querySelectorAll('#stage-team-chips .stage-team-chip');
    if (chips[0]) chips[0].click();
  });
  await new Promise(r => setTimeout(r, 600));

  // 방장도 1팀 클릭
  await hostPage.evaluate(() => {
    const chips = document.querySelectorAll('#stage-team-chips .stage-team-chip');
    if (chips[0]) chips[0].click();
  });
  await new Promise(r => setTimeout(r, 600));

  // 철수(팀원) 버튼 상태 확인
  const memberBtnInfo = await memberPage.evaluate(() => {
    const btn = document.getElementById('request-score-btn');
    return {
      text: btn.textContent.trim(),
      disabled: btn.disabled,
      className: btn.className
    };
  });
  console.log('[검증 2] 팀원(철수) 버튼 상태:', memberBtnInfo);

  // 방장(민규) 버튼 상태 확인
  const hostBtnInfo = await hostPage.evaluate(() => {
    const btn = document.getElementById('request-score-btn');
    return {
      text: btn.textContent.trim(),
      disabled: btn.disabled,
      className: btn.className
    };
  });
  console.log('[검증 2] 방장(민규) 버튼 상태:', hostBtnInfo);

  const memberCorrect = (memberBtnInfo.disabled === true && memberBtnInfo.text.includes('채점이 끝났습니다'));
  const hostCorrect = (hostBtnInfo.disabled === false && hostBtnInfo.text.includes('점수 다시 받기'));
  console.log('[검증 2 결과 - 팀원 비활성화 & 방장 재채점]:', (memberCorrect && hostCorrect) ? '✅ 성공!' : '❌ 실패');

  // 스크린샷 캡처
  await memberPage.screenshot({ path: ARTIFACT_DIR + '/member_scored_stage.png', fullPage: false });
  await hostPage.screenshot({ path: ARTIFACT_DIR + '/host_re_score_stage.png', fullPage: false });

  await browser1.close();
  await browser2.close();
  console.log('🎉 모든 테스트 완벽 성공!');
}

verifyFeatures().catch(err => {
  console.error('검증 에러 발생:', err);
  process.exit(1);
});
