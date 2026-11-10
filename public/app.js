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
// [5] 뷰(View) 전환 함수 (비활성 뷰는 완벽히 숨김)
// =======================================================
function switchView(viewName) {
  document.querySelectorAll('.view-section').forEach(sec => sec.classList.remove('active'));
  const target = document.getElementById(`${viewName}-view`);
  if (target) {
    target.classList.add('active');
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

// =======================================================
// [7] 대회 열기 (방 생성) 및 홈 뷰 이벤트
// =======================================================

// [🏆 새 듀엣 대회 열기] 버튼 클릭
openCreateRoomBtn.addEventListener('click', () => {
  playClickSound();
  createRoomModal.style.display = 'flex';
  if (myUserName) {
    newHostName.value = myUserName;
  }
  newContestTitle.focus();
});

createRoomCloseBtn.addEventListener('click', () => {
  createRoomModal.style.display = 'none';
});

// 대회 열기 폼 제출
createRoomForm.addEventListener('submit', (e) => {
  e.preventDefault();
  playClickSound();

  const title = newContestTitle.value.trim();
  const host = newHostName.value.trim();

  if (!title || !host) {
    showToast('대회 이름과 닉네임을 입력해 주세요.');
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

// 해당 팀원의 [점수 받기] 클릭
requestScoreBtn.addEventListener('click', () => {
  playClickSound();
  socket.emit('request_score');
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

// 다음 무대 버튼
nextTeamBtn.addEventListener('click', () => {
  playClickSound();
  socket.emit('next_team');
});

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

  if (!result.allTeamsFinished) {
    maskedScoreText.textContent = `${result.integerPart}.??`;
    scoreHintText.textContent = '🤫 전체 팀이 끝나지 않아 소수점은 비밀입니다!';
    nextTeamBtn.style.display = 'block';
    revealFinalBtn.style.display = 'none';
  } else {
    maskedScoreText.textContent = `${result.integerPart}.??`;
    scoreHintText.textContent = '🎉 모든 무대가 끝났습니다! 최종 결과 확인하기를 눌러주세요!';
    nextTeamBtn.style.display = 'none';
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
  const { users, teams, currentTeamIndex, gameStatus, qrCodeDataUrl, roomUrl, title } = data;

  if (title) {
    contestMainTitle.innerHTML = `<span class="neon-pink">${title}</span>`;
  }

  userCountDisplay.textContent = users.length;
  if (qrCodeDataUrl) qrImage.src = qrCodeDataUrl;
  if (roomUrl) qrUrlText.textContent = roomUrl;

  const me = users.find(u => u.name === myUserName);
  if (me) {
    if (me.isReady) {
      readyToggleBtn.classList.add('active-ready');
      readyToggleBtn.textContent = '준비 완료됨 (READY 취소) ✔️';
    } else {
      readyToggleBtn.classList.remove('active-ready');
      readyToggleBtn.textContent = '준비 완료 (READY) 👍';
    }
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

  // 게임 상태별 화면 전환
  if (gameStatus === 'LOBBY') {
    switchView('lobby');
    stageResultBox.style.display = 'none';
    scoringPanel.style.display = 'none';
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

function updatePartnerDropdowns(users) {
  const prev1 = teamSelect1.value;
  const prev2 = teamSelect2.value;

  teamSelect1.innerHTML = '<option value="">선택하세요</option>';
  teamSelect2.innerHTML = '<option value="">선택하세요</option>';

  users.forEach(u => {
    const opt1 = document.createElement('option');
    opt1.value = u.name;
    opt1.textContent = u.name + (u.name === myUserName ? ' (나)' : '');
    teamSelect1.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = u.name;
    opt2.textContent = u.name + (u.name === myUserName ? ' (나)' : '');
    teamSelect2.appendChild(opt2);
  });

  if (!prev1 && myUserName) {
    teamSelect1.value = myUserName;
  } else {
    teamSelect1.value = prev1;
  }
  teamSelect2.value = prev2;
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

function renderContestStage(teams, currentTeamIndex, gameStatus) {
  const currentTeam = teams[currentTeamIndex];
  if (!currentTeam) return;

  currentRoundText.textContent = `ROUND ${currentTeamIndex + 1} / ${teams.length}`;
  currentTeamMembers.textContent = `${currentTeam.member1} & ${currentTeam.member2}`;
  currentTeamSong.textContent = currentTeam.songTitle;

  const isPerformer = (myUserName === currentTeam.member1 || myUserName === currentTeam.member2);

  if (gameStatus === 'SCORING') {
    scoringPanel.style.display = 'block';
    stageResultBox.style.display = 'none';

    if (isPerformer) {
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

    if (currentTeam.status === 'scored') {
      scoringPanel.style.display = 'none';
      stageResultBox.style.display = 'block';
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
