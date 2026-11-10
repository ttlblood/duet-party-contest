/**
 * 싱어게인 듀엣 노래 대회 (Duet Party Contest) 클라이언트 스크립트 (app.js)
 * 방(Room) 기반 멀티 대회 시스템, 관리자(Host) 권한 제어,
 * 실시간 소켓 통신, Web Audio 사운드, 캔버스 컨페티, 익명 투표 및 시상식 연출
 */

// Socket.io 연결
const socket = io();

// 전역 클라이언트 상태
let currentRoomCode = '';
let myUserName = localStorage.getItem('duet_user_name') || '';
let isHost = false;
let currentGameState = null;
let isSoundEnabled = true;
let hasSubmittedScore = false;
let mySelectedScore = null;
let localViewingTeamIndex = null; // 각 사용자가 개별적으로 탭해서 둘러보는 팀 인덱스 (다른 사람 화면에 영향 없음)
let latestRoomState = null;        // 서버에서 수신한 최신 방 상태 캐시

// =======================================================
// [1] Web Audio API 기반 파티 사운드 합성기
// (외부 mp3 파일 없이 브라우저 자체 오실레이터로 100% 동작)
// =======================================================
const AudioContext = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// 효과음 1: 버튼 클릭 비프음
function playClickSound() {
  if (!isSoundEnabled) return;
  initAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.08);
  gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.08);
}

// 효과음 2: 10초 카운트다운 심장박동 비트 (쿵!)
function playHeartbeatBeat(isLast = false) {
  if (!isSoundEnabled) return;
  initAudio();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  const freq = isLast ? 220 : 130;
  osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(40, audioCtx.currentTime + 0.25);
  gain.gain.setValueAtTime(isLast ? 0.4 : 0.25, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.25);
}

// 효과음 3: 최종 1위 발표 팡파르 화음
function playFanfareSound() {
  if (!isSoundEnabled) return;
  initAudio();
  const notes = [523.25, 659.25, 783.99, 1046.50];
  notes.forEach((freq, idx) => {
    setTimeout(() => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 1.2);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 1.2);
    }, idx * 120);
  });
}

// =======================================================
// [2] 캔버스 기반 파티 컨페티 (꽃가루 폭죽) 애니메이션
// =======================================================
const confettiCanvas = document.getElementById('confetti-canvas');
const ctx = confettiCanvas.getContext('2d');
let confettiParticles = [];
let confettiAnimationId = null;

function resizeCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function launchConfetti(durationSeconds = 6) {
  const colors = ['#ff2a85', '#00f0ff', '#ffe600', '#9d4edd', '#ffffff', '#ffbe0b'];
  confettiParticles = [];

  for (let i = 0; i < 150; i++) {
    confettiParticles.push({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      vx: (Math.random() - 0.5) * 22,
      vy: (Math.random() - 0.7) * 24,
      size: Math.random() * 8 + 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotationSpeed: (Math.random() - 0.5) * 12,
      gravity: 0.35,
      friction: 0.98,
      alpha: 1,
    });
  }

  const startTime = Date.now();
  function renderConfetti() {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    const elapsed = (Date.now() - startTime) / 1000;

    confettiParticles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += p.gravity;
      p.vx *= p.friction;
      p.vy *= p.friction;
      p.rotation += p.rotationSpeed;

      if (elapsed > durationSeconds - 2) {
        p.alpha -= 0.015;
      }

      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    });

    if (elapsed < durationSeconds) {
      confettiAnimationId = requestAnimationFrame(renderConfetti);
    } else {
      ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
      cancelAnimationFrame(confettiAnimationId);
    }
  }

  if (confettiAnimationId) cancelAnimationFrame(confettiAnimationId);
  renderConfetti();
}

// =======================================================
// [3] UI 토스트 알림 메시지
// =======================================================
const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}

// =======================================================
// [4] DOM 요소 바인딩
// =======================================================
// 헤더 요소
const contestMainTitle = document.getElementById('contest-main-title');
const roomBadge = document.getElementById('room-badge');
const roomCodeDisplay = document.getElementById('room-code-display');
const hostBadge = document.getElementById('host-badge');
const myProfileBadge = document.getElementById('my-profile-badge');
const myNameDisplay = document.getElementById('my-name-display');
const globalResetBtn = document.getElementById('global-reset-btn');
const qrModalBtn = document.getElementById('qr-modal-btn');
const soundToggleBtn = document.getElementById('sound-toggle-btn');

// 홈 뷰 요소
const openCreateRoomBtn = document.getElementById('open-create-room-btn');
const directJoinForm = document.getElementById('direct-join-form');
const directRoomInput = document.getElementById('direct-room-input');

// 로비 뷰 요소
const userCountDisplay = document.getElementById('user-count');
const teamCountDisplay = document.getElementById('team-count');
const usersTagList = document.getElementById('users-tag-list');
const populateDemoBtn = document.getElementById('populate-demo-btn');
const teamSelect1 = document.getElementById('team-member-1');
const teamSelect2 = document.getElementById('team-member-2');
const teamSongInput = document.getElementById('team-song');
const teamRegisterForm = document.getElementById('team-register-form');
const registeredTeamsList = document.getElementById('registered-teams-list');
const readyToggleBtn = document.getElementById('ready-toggle-btn');
const startContestBtn = document.getElementById('start-contest-btn');

// 무대/채점 뷰 요소
const currentRoundText = document.getElementById('current-round-text');
const currentTeamMembers = document.getElementById('current-team-members');
const currentTeamSong = document.getElementById('current-team-song');
const requestScoreBtn = document.getElementById('request-score-btn');
const scoringPanel = document.getElementById('scoring-panel');
const scoringTimerNumber = document.getElementById('scoring-timer-number');
const performerWaitingView = document.getElementById('performer-waiting-view');
const audienceScoringView = document.getElementById('audience-scoring-view');
const scoreButtons = document.querySelectorAll('.score-btn');
const scoreSubmittedMsg = document.getElementById('score-submitted-msg');
const myChosenScore = document.getElementById('my-chosen-score');

// 실시간 관객 채점 현황 위젯 요소
const votingProgressBox = document.getElementById('voting-progress-box');
const voterSubmittedCount = document.getElementById('voter-submitted-count');
const voterTotalCount = document.getElementById('voter-total-count');
const voterProgressPercent = document.getElementById('voter-progress-percent');
const votingProgressBarFill = document.getElementById('voting-progress-bar-fill');
const voterStatusChips = document.getElementById('voter-status-chips');

// 무대 결과 (소수점 물음표 처리)
const stageResultBox = document.getElementById('stage-result-box');
const maskedScoreText = document.getElementById('masked-score-text');
const scoreHintText = document.getElementById('score-hint-text');
const nextTeamBtn = document.getElementById('next-team-btn');
const revealFinalBtn = document.getElementById('reveal-final-btn');

// 카운트다운 뷰
const countdownBigNumber = document.getElementById('countdown-big-number');

// 최종 결과 뷰
const podiumContainer = document.getElementById('podium-container');
const fullRankingList = document.getElementById('full-ranking-list');
const resetContestBtn = document.getElementById('reset-contest-btn');

// 모달 요소
const createRoomModal = document.getElementById('create-room-modal');
const createRoomCloseBtn = document.getElementById('create-room-close-btn');
const createRoomForm = document.getElementById('create-room-form');
const newContestTitle = document.getElementById('new-contest-title');
const newHostName = document.getElementById('new-host-name');

const nicknameModal = document.getElementById('nickname-modal');
const nicknameForm = document.getElementById('nickname-form');
const nicknameInput = document.getElementById('nickname-input');
const roomWelcomeTitle = document.getElementById('room-welcome-title');

const qrModal = document.getElementById('qr-modal');
const qrCloseBtn = document.getElementById('qr-close-btn');
const qrImage = document.getElementById('qr-image');
const qrUrlText = document.getElementById('qr-url-text');
const copyUrlBtn = document.getElementById('copy-url-btn');

// =======================================================
// [5] 뷰(View) 전환 함수 (비활성 뷰는 완벽히 숨김 & CSS 캐시 무관 100% 방어)
// =======================================================
function switchView(viewName) {
  // 모든 뷰 섹션 비활성화 및 인라인 display: none 강제 적용
  document.querySelectorAll('.view-section').forEach(sec => {
    sec.classList.remove('active');
    sec.style.display = 'none';
  });

  const target = document.getElementById(`${viewName}-view`);
  if (target) {
    target.classList.add('active');
    // 카운트다운 뷰는 flex, 그 외 일반 뷰는 block으로 명시적 표시
    target.style.display = (viewName === 'countdown') ? 'flex' : 'block';
  }
}

// 관리자(Host) 권한 UI 갱신 함수
function setHostMode(isHostUser) {
  isHost = isHostUser;
  if (isHost) {
    document.body.classList.add('is-host');
    hostBadge.style.display = 'inline-flex';
    globalResetBtn.style.display = 'inline-flex';
  } else {
    document.body.classList.remove('is-host');
    hostBadge.style.display = 'none';
    globalResetBtn.style.display = 'none';
  }
}

// =======================================================
// [6] 라우팅 및 초기 진입 처리
// =======================================================
function checkInitialRoute() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  
  if (path && path.length >= 4) {
    // 특정 방 경로로 진입한 경우 (예: /aB3k9X)
    currentRoomCode = path;
    initRoomJoin(currentRoomCode);
  } else {
    // 루트 경로인 경우 -> 홈 뷰 표시
    switchView('home');
    roomBadge.style.display = 'none';
    hostBadge.style.display = 'none';
    myProfileBadge.style.display = 'none';
    qrModalBtn.style.display = 'none';
    globalResetBtn.style.display = 'none';
  }
}

// 방 입장 처리 함수 (공유받은 URL 접속 시)
function initRoomJoin(roomCode) {
  // 이전에 사용하던 이름이 있다면 입력창에 기본값으로 세팅 (수정 가능하도록 노출)
  if (myUserName) {
    nicknameInput.value = myUserName;
  }
  
  // 이름을 확인 및 변경할 수 있도록 건너뛰지 않고 반드시 닉네임 입력 모달을 표시!
  nicknameModal.style.display = 'flex';
  setTimeout(() => {
    nicknameInput.focus();
    nicknameInput.select(); // 바로 수정할 수 있도록 텍스트 전체 선택
  }, 100);
}

// 서버에 join_room 요청
function requestJoinRoom(roomCode, userName, adminToken) {
  socket.emit('join_room', { roomCode, userName, adminToken }, (res) => {
    if (!res || !res.success) {
      showToast(res ? res.message : '방 입장에 실패했습니다.');
      // 존재하지 않는 방이면 홈으로 이동
      setTimeout(() => {
        window.location.href = '/';
      }, 1500);
      return;
    }

    currentRoomCode = res.roomCode;
    myUserName = userName;
    localStorage.setItem('duet_user_name', myUserName);

    // 헤더 상태 갱신
    roomCodeDisplay.textContent = currentRoomCode;
    roomBadge.style.display = 'inline-flex';
    myProfileBadge.style.display = 'inline-flex';
    myNameDisplay.textContent = myUserName;
    qrModalBtn.style.display = 'inline-flex';

    if (res.title) {
      contestMainTitle.innerHTML = `<span class="neon-pink">${res.title}</span>`;
    }

    setHostMode(res.isHost);
    nicknameModal.style.display = 'none';
    switchView('lobby');
  });
}

// 디폴트 대회명 생성 함수 (년도.월 싱어게인 듀엣 가요제)
function getDefaultContestTitle() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}.${month} 싱어게인 듀엣 가요제`;
}

// =======================================================
// [7] 대회 열기 (방 생성) 및 홈 뷰 이벤트
// =======================================================

// [🏆 새 듀엣 대회 열기] 버튼 클릭
openCreateRoomBtn.addEventListener('click', () => {
  playClickSound();
  createRoomModal.style.display = 'flex';
  
  // 디폴트 대회명 자동 입력 (년도.월 싱어게인 듀엣 가요제)
  newContestTitle.value = getDefaultContestTitle();
  
  if (myUserName) {
    newHostName.value = myUserName;
  }
  newContestTitle.focus();
  newContestTitle.select(); // 편하게 수정할 수 있도록 전체 선택
});

createRoomCloseBtn.addEventListener('click', () => {
  createRoomModal.style.display = 'none';
});

// 대회 열기 폼 제출
createRoomForm.addEventListener('submit', (e) => {
  e.preventDefault();
  playClickSound();

  const title = newContestTitle.value.trim() || getDefaultContestTitle();
  const host = newHostName.value.trim();

  if (!host) {
    showToast('관리자(방장) 닉네임을 입력해 주세요.');
    return;
  }

  socket.emit('create_room', { title, hostName: host }, (res) => {
    if (!res || !res.success) {
      showToast('대회 방 생성에 실패했습니다.');
      return;
    }

    currentRoomCode = res.roomCode;
    myUserName = res.hostName;
    localStorage.setItem('duet_user_name', myUserName);
    localStorage.setItem('duet_admin_' + res.roomCode, res.adminToken);

    // URL을 6자리 방 경로로 갱신 (예: /aB3k9X)
    window.history.pushState(null, '', '/' + currentRoomCode);

    createRoomModal.style.display = 'none';
    setHostMode(true);

    roomCodeDisplay.textContent = currentRoomCode;
    roomBadge.style.display = 'inline-flex';
    myProfileBadge.style.display = 'inline-flex';
    myNameDisplay.textContent = myUserName;
    qrModalBtn.style.display = 'inline-flex';

    contestMainTitle.innerHTML = `<span class="neon-pink">${res.title}</span>`;
    switchView('lobby');

    showToast(`🎉 [${res.title}] 방이 개설되었습니다! 우측 상단 QR로 참가자를 초대하세요.`);
  });
});

// 방 코드 직접 입력 폼 제출
directJoinForm.addEventListener('submit', (e) => {
  e.preventDefault();
  playClickSound();
  const code = directRoomInput.value.trim();
  if (code) {
    window.location.href = '/' + code;
  }
});

// 참가자 닉네임 입력 폼 제출
nicknameForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = nicknameInput.value.trim();
  if (!name) return;

  const savedAdminToken = localStorage.getItem('duet_admin_' + currentRoomCode) || '';
  initAudio();
  playClickSound();
  requestJoinRoom(currentRoomCode, name, savedAdminToken);
});

// 방 코드 뱃지 클릭 시 초대 링크 복사
roomBadge.addEventListener('click', () => {
  playClickSound();
  const shareUrl = window.location.href;
  navigator.clipboard.writeText(shareUrl).then(() => {
    showToast(`📋 초대 링크가 복사되었습니다! (${currentRoomCode})`);
  });
});

// =======================================================
// [8] QR 모달 및 공통 컨트롤
// =======================================================
qrModalBtn.addEventListener('click', () => {
  playClickSound();
  qrModal.style.display = 'flex';
});

qrCloseBtn.addEventListener('click', () => {
  qrModal.style.display = 'none';
});

copyUrlBtn.addEventListener('click', () => {
  navigator.clipboard.writeText(qrUrlText.textContent).then(() => {
    showToast('접속 주소가 복사되었습니다! 단톡방에 공유하세요.');
  });
});

soundToggleBtn.addEventListener('click', () => {
  isSoundEnabled = !isSoundEnabled;
  soundToggleBtn.textContent = isSoundEnabled ? '🔊' : '🔇';
  showToast(isSoundEnabled ? '사운드가 켜졌습니다.' : '사운드가 음소거되었습니다.');
});

// =======================================================
// [9] 로비 기능: 팀 등록, 레디, 대회 시작, 데모 생성
// =======================================================

// 듀엣 팀 등록
teamRegisterForm.addEventListener('submit', (e) => {
  e.preventDefault();
  playClickSound();

  const m1 = teamSelect1.value;
  const m2 = teamSelect2.value;
  const song = teamSongInput.value.trim();

  if (!m1 || !m2 || !song) {
    showToast('파트너 두 명과 곡목을 모두 입력해주세요.');
    return;
  }

  if (m1 === m2) {
    showToast('듀엣은 서로 다른 두 명으로 선택해야 합니다.');
    return;
  }

  socket.emit('create_team', {
    member1: m1,
    member2: m2,
    songTitle: song
  });

  teamSongInput.value = '';
  showToast(`✨ ${m1} & ${m2} 팀이 등록되었습니다!`);
});

// 레디(Ready) 토글 버튼
readyToggleBtn.addEventListener('click', () => {
  playClickSound();
  socket.emit('toggle_ready');
});

// 대회 시작 버튼
startContestBtn.addEventListener('click', () => {
  playClickSound();
  socket.emit('start_contest');
});

// 데모용 가상 참석자 10명 & 4팀 생성 버튼
if (populateDemoBtn) {
  populateDemoBtn.addEventListener('click', () => {
    playClickSound();
    socket.emit('populate_demo_data');
    showToast('🎭 데모용 10명 & 듀엣 4팀이 등록되었습니다!');
  });
}

// 관리자 전용 리셋 버튼
if (globalResetBtn) {
  globalResetBtn.addEventListener('click', () => {
    if (!isHost) {
      showToast('대회 초기화는 관리자(방장)만 가능합니다.');
      return;
    }
    playClickSound();
    if (confirm('정말로 대회를 초기화하고 로비(대기실)로 돌아가시겠습니까?\n등록된 팀과 진행 점수가 모두 초기화됩니다.')) {
      socket.emit('reset_contest');
      showToast('대회가 초기화되었습니다.');
    }
  });
}

resetContestBtn.addEventListener('click', () => {
  if (!isHost) {
    showToast('대회 초기화는 관리자(방장)만 가능합니다.');
    return;
  }
  playClickSound();
  if (confirm('새로운 대회를 시작하시겠습니까? 등록된 팀과 점수가 초기화됩니다.')) {
    socket.emit('reset_contest');
  }
});

// =======================================================
// [10] 무대 및 채점 인터랙션
// =======================================================

// 해당 팀원 또는 방장의 [점수 받기] / [점수 다시 받기] 클릭
requestScoreBtn.addEventListener('click', () => {
  if (requestScoreBtn.disabled) return;
  playClickSound();

  // 현재 사용자가 화면에서 보고 있는 팀을 대상으로 점수 받기(또는 방장 재채점) 요청
  const viewingTeam = (latestRoomState && latestRoomState.teams && localViewingTeamIndex !== null)
    ? latestRoomState.teams[localViewingTeamIndex]
    : null;

  if (viewingTeam) {
    socket.emit('request_score', { teamId: viewingTeam.id });
  } else {
    socket.emit('request_score');
  }
});

// 관객의 1~10점 선택
scoreButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    if (hasSubmittedScore) return;

    playClickSound();
    const score = parseInt(btn.dataset.score, 10);
    mySelectedScore = score;

    scoreButtons.forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    socket.emit('submit_score', { score });
  });
});

// 다음 무대 버튼 (목록 선택 방식으로 전환됨에 따른 호환 처리)
if (nextTeamBtn) {
  nextTeamBtn.addEventListener('click', () => {
    playClickSound();
    socket.emit('next_team');
  });
}

// 최종 결과 확인하기 버튼 (10초 카운트다운 시작)
revealFinalBtn.addEventListener('click', () => {
  playClickSound();
  socket.emit('start_result_countdown');
});

// =======================================================
// [11] 소켓 이벤트 수신 및 상태 렌더링
// =======================================================

// 방 상태 전체 업데이트 수신
socket.on('state_update', (data) => {
  if (!currentRoomCode || currentRoomCode !== data.roomCode) return;
  currentGameState = data;
  renderState(data);
});

// 채점 30초 타이머 틱
socket.on('scoring_tick', ({ timeLeft }) => {
  scoringTimerNumber.textContent = timeLeft;
  if (timeLeft <= 5) {
    playHeartbeatBeat();
  }
});

// 점수 제출 완료 응답
socket.on('score_submitted_ack', ({ score }) => {
  hasSubmittedScore = true;
  myChosenScore.textContent = score;
  scoreSubmittedMsg.style.display = 'block';
});

// 무대 점수 공개 이벤트 (소수점 물음표 마스킹!)
socket.on('score_revealed', (result) => {
  scoringPanel.style.display = 'none';
  stageResultBox.style.display = 'block';

  maskedScoreText.textContent = `${result.integerPart}.??`;
  const chooseHint = document.getElementById('choose-next-hint');

  if (!result.allTeamsFinished) {
    scoreHintText.textContent = '🤫 전체 팀이 끝나지 않아 소수점은 비밀입니다!';
    if (chooseHint) chooseHint.style.display = 'block';
    if (nextTeamBtn) nextTeamBtn.style.display = 'none';
    revealFinalBtn.style.display = 'none';
  } else {
    scoreHintText.textContent = '🎉 모든 무대가 끝났습니다! 최종 결과 확인하기를 눌러주세요!';
    if (chooseHint) chooseHint.style.display = 'none';
    if (nextTeamBtn) nextTeamBtn.style.display = 'none';
    revealFinalBtn.style.display = 'block';
  }
});

// 10초 역 카운트다운 틱
socket.on('countdown_tick', ({ timeLeft }) => {
  countdownBigNumber.textContent = timeLeft;
  playHeartbeatBeat(timeLeft <= 3);
});

// 에러 메시지 알림
socket.on('error_message', (msg) => {
  showToast(`⚠️ ${msg}`);
});

// =======================================================
// [12] 상태 렌더러 함수
// =======================================================
function renderState(data) {
  latestRoomState = data; // 최신 상태 캐시 보관
  const { users, teams, currentTeamIndex, gameStatus, qrCodeDataUrl, roomUrl, title } = data;

  if (title) {
    contestMainTitle.innerHTML = `<span class="neon-pink">${title}</span>`;
  }

  userCountDisplay.textContent = users.length;
  if (qrCodeDataUrl) qrImage.src = qrCodeDataUrl;
  if (roomUrl) qrUrlText.textContent = roomUrl;

  const me = users.find(u => u.name === myUserName);
  if (me) {
    setHostMode(!!me.isHost); // 방장 여부 실시간 최신 동기화
    if (me.isReady) {
      readyToggleBtn.classList.add('active-ready');
      readyToggleBtn.textContent = '준비 완료됨 (READY 취소) ✔️';
    } else {
      readyToggleBtn.classList.remove('active-ready');
      readyToggleBtn.textContent = '준비 완료 (READY) 👍';
    }
  } else {
    setHostMode(false);
  }

  // 참가자 태그 렌더링
  usersTagList.innerHTML = '';
  users.forEach(u => {
    const span = document.createElement('span');
    span.className = 'user-tag';
    if (u.name === myUserName) span.classList.add('me');
    if (u.isReady) span.classList.add('ready');
    span.innerHTML = `${u.isHost ? '👑' : (u.isReady ? '⭐' : '👤')} ${u.name}`;
    usersTagList.appendChild(span);
  });

  // 파트너 선택 드롭다운 갱신
  updatePartnerDropdowns(users);

  // 팀 목록 렌더링
  teamCountDisplay.textContent = teams.length;
  renderTeamsList(teams, gameStatus);

  // 실시간 관객 채점 완료 현황 렌더링
  renderVotingProgress(data.votingProgress);

  // 게임 상태별 화면 전환
  if (gameStatus === 'LOBBY') {
    switchView('lobby');
    stageResultBox.style.display = 'none';
    scoringPanel.style.display = 'none';
    localViewingTeamIndex = null; // 로비 진입 시 로컬 선택 인덱스 초기화
  } else if (gameStatus === 'CONTEST' || gameStatus === 'SCORING') {
    switchView('contest');
    renderContestStage(teams, currentTeamIndex, gameStatus);
  } else if (gameStatus === 'COUNTDOWN') {
    switchView('countdown');
  } else if (gameStatus === 'RESULT') {
    switchView('result');
    renderFinalResults(teams);
  }
}

// 파트너 선택 드롭다운 업데이트 (파트너 2에는 본인이 노출되지 않도록 필터링)
function updatePartnerDropdowns(users) {
  const prev1 = teamSelect1.value;
  const prev2 = teamSelect2.value;

  teamSelect1.innerHTML = '<option value="">선택하세요</option>';
  teamSelect2.innerHTML = '<option value="">선택하세요</option>';

  // 파트너 1 목록: 전체 참석자 (기본 선택: 본인)
  users.forEach(u => {
    const opt1 = document.createElement('option');
    opt1.value = u.name;
    opt1.textContent = u.name + (u.name === myUserName ? ' (나)' : '');
    teamSelect1.appendChild(opt1);
  });

  // 파트너 2 목록: 본인(myUserName)을 제외한 다른 참가자만 노출
  users.forEach(u => {
    if (u.name === myUserName) return; // 파트너 2에는 본인 제외

    const opt2 = document.createElement('option');
    opt2.value = u.name;
    opt2.textContent = u.name;
    teamSelect2.appendChild(opt2);
  });

  // 파트너 1은 기본적으로 본인으로 세팅
  if (!prev1 && myUserName) {
    teamSelect1.value = myUserName;
  } else {
    teamSelect1.value = prev1;
  }

  // 파트너 2의 이전 선택값 복원 (단, 본인이 아니어야 함)
  if (prev2 && prev2 !== myUserName) {
    teamSelect2.value = prev2;
  } else {
    teamSelect2.value = '';
  }
}

function renderTeamsList(teams, gameStatus) {
  if (teams.length === 0) {
    registeredTeamsList.innerHTML = '<p class="empty-state">아직 등록된 듀엣 팀이 없습니다. 팀과 곡목을 등록해 주세요!</p>';
    return;
  }

  registeredTeamsList.innerHTML = '';
  teams.forEach((team, idx) => {
    const item = document.createElement('div');
    item.className = 'team-card-item';
    item.innerHTML = `
      <div class="team-info-box">
        <div class="team-members-name">${idx + 1}팀: ${team.member1} & ${team.member2}</div>
        <div class="team-song-name">🎵 ${team.songTitle}</div>
      </div>
      ${gameStatus === 'LOBBY' ? `<button class="team-delete-btn" onclick="deleteTeam('${team.id}')" title="삭제">&times;</button>` : ''}
    `;
    registeredTeamsList.appendChild(item);
  });
}

window.deleteTeam = function(teamId) {
  playClickSound();
  socket.emit('delete_team', { teamId });
};

// 실시간 관객 채점 참여 현황 렌더러 (점수는 비밀, 각 멤버의 채점 완료 여부만 실시간 표시)
function renderVotingProgress(votingProgress) {
  if (!votingProgress) {
    if (votingProgressBox) votingProgressBox.style.display = 'none';
    return;
  }

  if (votingProgressBox) votingProgressBox.style.display = 'block';

  const { voters, submittedCount, totalEligibleCount } = votingProgress;
  const percent = totalEligibleCount > 0 ? Math.round((submittedCount / totalEligibleCount) * 100) : 0;

  if (voterSubmittedCount) voterSubmittedCount.textContent = submittedCount;
  if (voterTotalCount) voterTotalCount.textContent = totalEligibleCount;
  if (voterProgressPercent) voterProgressPercent.textContent = `${percent}%`;
  if (votingProgressBarFill) votingProgressBarFill.style.width = `${percent}%`;

  if (voterStatusChips && voters) {
    voterStatusChips.innerHTML = '';
    voters.forEach(v => {
      const chip = document.createElement('span');
      chip.className = `voter-chip ${v.hasSubmitted ? 'done' : 'waiting'}`;
      chip.innerHTML = v.hasSubmitted 
        ? `✅ ${v.name} (완료)` 
        : `⏳ ${v.name} (채점 중...)`;
      voterStatusChips.appendChild(chip);
    });
  }
}

// 무대 및 채점 화면 렌더러
function renderContestStage(teams, officialTeamIndex, gameStatus) {
  if (!teams || teams.length === 0) return;

  // 1. 채점이 진행 중(SCORING)일 때는 모든 참가자가 공식 채점 중인 팀으로 강제 동기화
  if (gameStatus === 'SCORING') {
    localViewingTeamIndex = officialTeamIndex;
  } else {
    // 유효한 인덱스인지 체크하고 없으면 officialTeamIndex로 기본 세팅
    if (localViewingTeamIndex === null || localViewingTeamIndex >= teams.length || localViewingTeamIndex < 0) {
      localViewingTeamIndex = officialTeamIndex;
    }
  }

  // 사용자가 현재 화면에서 확인 중인 팀
  const viewingTeam = teams[localViewingTeamIndex] || teams[0];
  const isViewingScored = (viewingTeam.status === 'scored');
  const isPerformer = (myUserName === viewingTeam.member1 || myUserName === viewingTeam.member2);

  // 상단 STAGE 라운드 텍스트 및 현재 보고 있는 팀 정보 반영
  currentRoundText.textContent = `STAGE ${localViewingTeamIndex + 1} / ${teams.length}`;
  currentTeamMembers.textContent = `${viewingTeam.member1} & ${viewingTeam.member2}`;
  currentTeamSong.textContent = viewingTeam.songTitle;

  // 2. 출전 팀 목록 칩 렌더링 (순서 자유 확인 지원)
  const stageTeamChips = document.getElementById('stage-team-chips');
  const stageCompletedCount = document.getElementById('stage-completed-count');
  const stageTotalCount = document.getElementById('stage-total-count');

  if (stageTeamChips) {
    const scoredCount = teams.filter(t => t.status === 'scored').length;
    if (stageCompletedCount) stageCompletedCount.textContent = scoredCount;
    if (stageTotalCount) stageTotalCount.textContent = teams.length;

    stageTeamChips.innerHTML = '';
    teams.forEach((t, idx) => {
      const chip = document.createElement('div');
      chip.className = 'stage-team-chip';
      const isOfficialCurrent = (idx === officialTeamIndex);
      const isSelectedByMe = (idx === localViewingTeamIndex);
      const isScored = (t.status === 'scored');

      if (isSelectedByMe) chip.classList.add('viewing-stage');
      if (isOfficialCurrent && !isSelectedByMe) chip.classList.add('active-stage');

      let badgeHtml = '';
      if (isScored) {
        badgeHtml = `<span class="chip-status-badge chip-status-scored">✅ ${Math.floor(t.avgScore)}.??점</span>`;
        if (isOfficialCurrent) {
          badgeHtml += ' <span class="chip-status-badge chip-status-current">방금 무대</span>';
        }
      } else if (isOfficialCurrent) {
        badgeHtml = '<span class="chip-status-badge chip-status-current">🎤 지금 무대</span>';
      } else {
        badgeHtml = '<span class="chip-status-badge chip-status-waiting">대기 중</span>';
      }

      if (isSelectedByMe && !isOfficialCurrent) {
        badgeHtml += ' <span class="chip-status-badge chip-status-viewing">👀 확인 중</span>';
      }

      chip.innerHTML = `
        <div class="chip-info">
          <div class="chip-names">${idx + 1}팀: ${t.member1} & ${t.member2}</div>
          <div class="chip-song">🎵 ${t.songTitle}</div>
        </div>
        <div>${badgeHtml}</div>
      `;

      // [사용자 요구 반영] 칩 탭 시: 다른 사람 선택을 변경하지 않고, 오직 '내 화면'에서만 해당 팀을 확인하도록 로컬 갱신!
      chip.addEventListener('click', () => {
        if (gameStatus === 'SCORING') {
          showToast('채점이 진행 중일 때는 다른 팀을 확인할 수 없습니다.');
          return;
        }
        playClickSound();
        localViewingTeamIndex = idx;
        renderContestStage(teams, officialTeamIndex, gameStatus);
        showToast(`[${idx + 1}팀: ${t.member1} & ${t.member2}] 무대를 확인 중입니다.`);
      });

      stageTeamChips.appendChild(chip);
    });
  }

  // 3. 점수 받기 버튼 상태 및 권한 제어
  // [사용자 요구 반영]: "채점이 끝난 경우는 방장만 점수 다시받기 누를 수 있고, 팀원은 비활성화되어야해. 태점이 끝났다고 나와야해."
  const authStarterBox = document.getElementById('authorized-score-starter-box');
  const audienceWaitScoreBox = document.getElementById('audience-wait-score-box');
  const actionDesc = authStarterBox ? authStarterBox.querySelector('.action-desc') : null;

  if (authStarterBox) authStarterBox.style.display = 'block';
  if (audienceWaitScoreBox) audienceWaitScoreBox.style.display = 'none';

  if (isViewingScored) {
    // ------------------------------------------------------------------
    // A. 이미 채점이 완료된 팀을 보고 있는 경우
    // ------------------------------------------------------------------
    if (isHost) {
      // 관리자(방장): 점수 다시 받기(재채점) 가능
      requestScoreBtn.disabled = false;
      requestScoreBtn.className = 'btn btn-re-score btn-pulse btn-large';
      requestScoreBtn.innerHTML = '🔄 점수 다시 받기 (방장 재채점)';
      if (actionDesc) actionDesc.textContent = '💡 이미 채점이 완료된 팀입니다. 방장 권한으로 점수를 다시 받을 수 있습니다.';
    } else {
      // 팀원 및 일반 관객: 버튼 비활성화 및 "채점이 끝났습니다" 표시
      requestScoreBtn.disabled = true;
      requestScoreBtn.className = 'btn btn-disabled btn-large';
      requestScoreBtn.innerHTML = '✅ 채점이 끝났습니다';
      if (actionDesc) actionDesc.textContent = '이 팀의 무대 채점이 이미 완료되었습니다. (재채점은 방장만 가능)';
    }
  } else {
    // ------------------------------------------------------------------
    // B. 아직 채점이 진행되지 않은 대기 팀을 보고 있는 경우
    // ------------------------------------------------------------------
    if (isPerformer || isHost) {
      // 해당 팀원 또는 방장: 점수 받기 시작 버튼 활성화
      requestScoreBtn.disabled = false;
      requestScoreBtn.className = 'btn btn-party btn-pulse btn-large';
      requestScoreBtn.innerHTML = '📢 노래 끝! 점수 받기 시작! (30초)';
      if (actionDesc) actionDesc.textContent = '노래가 끝났나요? 팀원 또는 방장이 [점수 받기]를 눌러주세요!';
    } else {
      // 일반 관객: 대기 상태
      requestScoreBtn.disabled = true;
      requestScoreBtn.className = 'btn btn-disabled btn-large';
      requestScoreBtn.innerHTML = '🎵 노래 진행 중 (대기)';
      if (actionDesc) actionDesc.textContent = '노래가 끝난 후 팀원 또는 방장이 [점수 받기]를 누르면 채점이 시작됩니다!';
    }
  }

  // 4. 채점 패널 및 결과 점수 카드 렌더링
  const chooseHint = document.getElementById('choose-next-hint');
  const allTeamsFinished = teams.every(t => t.status === 'scored');

  if (gameStatus === 'SCORING') {
    scoringPanel.style.display = 'block';
    stageResultBox.style.display = 'none';

    // 공식 채점 중인 팀의 팀원인지 확인
    const officialTeam = teams[officialTeamIndex];
    const isOfficialPerformer = officialTeam && (myUserName === officialTeam.member1 || myUserName === officialTeam.member2);

    if (isOfficialPerformer) {
      performerWaitingView.style.display = 'block';
      audienceScoringView.style.display = 'none';
    } else {
      performerWaitingView.style.display = 'none';
      audienceScoringView.style.display = 'block';

      if (!hasSubmittedScore) {
        scoreButtons.forEach(b => b.classList.remove('selected'));
        scoreSubmittedMsg.style.display = 'none';
      }
    }
  } else {
    hasSubmittedScore = false;
    mySelectedScore = null;

    if (isViewingScored) {
      scoringPanel.style.display = 'none';
      stageResultBox.style.display = 'block';
      if (maskedScoreText) {
        maskedScoreText.textContent = `${Math.floor(viewingTeam.avgScore)}.??`;
      }

      if (allTeamsFinished) {
        if (chooseHint) chooseHint.style.display = 'none';
        revealFinalBtn.style.display = 'block';
      } else {
        if (chooseHint) chooseHint.style.display = 'block';
        revealFinalBtn.style.display = 'none';
      }
    } else {
      scoringPanel.style.display = 'none';
      stageResultBox.style.display = 'none';
    }
  }
}

function renderFinalResults(teams) {
  const sortedTeams = [...teams].sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0));

  podiumContainer.innerHTML = '';
  const top3 = sortedTeams.slice(0, 3);

  top3.forEach((team, idx) => {
    const rank = idx + 1;
    const col = document.createElement('div');
    col.className = `podium-col podium-${rank}`;
    const medalIcon = rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉';

    col.innerHTML = `
      <div class="podium-card">
        <div class="podium-rank-badge">${medalIcon}</div>
        <div class="podium-team-name">${team.member1} & ${team.member2}</div>
        <div class="podium-score">${team.avgScore ? team.avgScore.toFixed(2) : '0.00'}점</div>
      </div>
      <div class="podium-step">${rank}위</div>
    `;
    podiumContainer.appendChild(col);
  });

  fullRankingList.innerHTML = '';
  sortedTeams.forEach((team, idx) => {
    const rank = idx + 1;
    const row = document.createElement('div');
    row.className = 'ranking-item';
    row.innerHTML = `
      <div class="rank-num">${rank}위</div>
      <div class="rank-details">
        <div class="rank-members">${team.member1} & ${team.member2}</div>
        <div class="rank-song">🎵 ${team.songTitle}</div>
      </div>
      <div class="rank-final-score">${team.avgScore ? team.avgScore.toFixed(2) : '0.00'}점</div>
    `;
    fullRankingList.appendChild(row);
  });

  playFanfareSound();
  launchConfetti(8);
}

// 최초 진입 라우팅 실행
checkInitialRoute();
