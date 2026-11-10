/**
 * 듀엣 노래 대회 (Duet Party Contest) 메인 백엔드 서버
 * Express + Socket.IO 기반 실시간 파티 플랫폼
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
  }
});

const PORT = process.env.PORT || 3000;

// 정적 파일 서빙 디렉토리 설정 (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// 로컬 IP 주소 탐색 함수 (동일 Wi-Fi 내 스마트폰 접속을 위함)
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4이면서 내부 루프백 주소가 아닌 IP 선택
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIpAddress();
// 외부 공개 URL 환경변수(PUBLIC_URL)가 있으면 우선 적용 (클라우드 배포 및 터널 지원)
const serverUrl = process.env.PUBLIC_URL || `http://${localIp}:${PORT}`;
let qrCodeDataUrl = '';

// 서버 시작 시 QR 코드 생성
QRCode.toDataURL(serverUrl, { margin: 2, scale: 6 }, (err, url) => {
  if (!err) {
    qrCodeDataUrl = url;
  }
});

/**
 * 전역 상태 관리 객체
 */
const state = {
  // 접속자 정보: { [socketId]: { id, name, isReady } }
  users: {},
  // 등록된 팀 목록: [ { id, member1, member2, songTitle, rawScores: {}, avgScore: null, status: 'waiting' | 'scored' } ]
  teams: [],
  // 현재 무대 순번 (인덱스)
  currentTeamIndex: 0,
  // 게임 전체 상태: 'LOBBY' | 'CONTEST' | 'SCORING' | 'COUNTDOWN' | 'RESULT'
  gameStatus: 'LOBBY',
  // 채점 타이머 (초)
  scoringTimeLeft: 30,
  // 10초 역카운트다운 타이머 (초)
  countdownTimeLeft: 10,
};

let scoringTimerInterval = null;
let countdownTimerInterval = null;

// 전체 클라이언트에게 최신 게임 상태 브로드캐스트
function broadcastState() {
  io.emit('state_update', {
    users: Object.values(state.users),
    teams: state.teams,
    currentTeamIndex: state.currentTeamIndex,
    gameStatus: state.gameStatus,
    scoringTimeLeft: state.scoringTimeLeft,
    countdownTimeLeft: state.countdownTimeLeft,
    serverUrl,
    qrCodeDataUrl
  });
}

// 30초 채점 마감 처리 함수
function finalizeScoring() {
  if (scoringTimerInterval) {
    clearInterval(scoringTimerInterval);
    scoringTimerInterval = null;
  }

  const currentTeam = state.teams[state.currentTeamIndex];
  if (!currentTeam) return;

  // 채점 참여 대상자(팀원 2명 제외) 목록 추출
  const eligibleUsers = Object.values(state.users).filter(u => 
    u.name !== currentTeam.member1 && u.name !== currentTeam.member2
  );

  // 미입력자에게 기본 5점 부여 (30초 내 미입력 규칙)
  eligibleUsers.forEach(u => {
    if (currentTeam.rawScores[u.id] === undefined) {
      currentTeam.rawScores[u.id] = 5; // 미입력 시 중간 점수인 5점 부여
    }
  });

  // 평균 점수 계산
  const scoresArray = Object.values(currentTeam.rawScores);
  if (scoresArray.length > 0) {
    const sum = scoresArray.reduce((acc, cur) => acc + cur, 0);
    currentTeam.avgScore = parseFloat((sum / scoresArray.length).toFixed(2));
  } else {
    currentTeam.avgScore = 5.00; // 참가자가 없는 특수 상황 대비
  }

  currentTeam.status = 'scored';
  state.gameStatus = 'CONTEST';
  state.scoringTimeLeft = 30;

  // 전체 팀이 완료되었는지 확인
  const allTeamsFinished = state.teams.every(t => t.status === 'scored');

  // 점수 결과 이벤트 전송
  io.emit('score_revealed', {
    teamId: currentTeam.id,
    teamName: `${currentTeam.member1} & ${currentTeam.member2}`,
    songTitle: currentTeam.songTitle,
    rawScores: currentTeam.rawScores,
    avgScore: currentTeam.avgScore,
    integerPart: Math.floor(currentTeam.avgScore),
    allTeamsFinished,
  });

  broadcastState();
}

// Socket.io 연결 이벤트 핸들러
io.on('connection', (socket) => {
  // 연결 시 초기 상태 전송
  socket.emit('state_update', {
    users: Object.values(state.users),
    teams: state.teams,
    currentTeamIndex: state.currentTeamIndex,
    gameStatus: state.gameStatus,
    scoringTimeLeft: state.scoringTimeLeft,
    countdownTimeLeft: state.countdownTimeLeft,
    serverUrl,
    qrCodeDataUrl
  });

  // 1. 사용자 입장 및 닉네임 등록
  socket.on('user_join', ({ name }) => {
    const trimmedName = (name || '').trim();
    if (!trimmedName) return;

    state.users[socket.id] = {
      id: socket.id,
      name: trimmedName,
      isReady: false
    };

    broadcastState();
  });

  // 2. 레디(Ready) 토글
  socket.on('toggle_ready', () => {
    if (state.users[socket.id]) {
      state.users[socket.id].isReady = !state.users[socket.id].isReady;
      broadcastState();
    }
  });

  // 3. 듀엣 팀 및 곡목 등록 (1인이 여러 팀에 중복 출전 가능)
  socket.on('create_team', ({ member1, member2, songTitle }) => {
    const m1 = (member1 || '').trim();
    const m2 = (member2 || '').trim();
    const song = (songTitle || '').trim();

    if (!m1 || !m2 || !song) {
      return socket.emit('error_message', '팀원 두 명과 곡목을 모두 입력해주세요.');
    }

    if (m1 === m2) {
      return socket.emit('error_message', '듀엣은 서로 다른 두 명으로 구성해야 합니다.');
    }

    const newTeam = {
      id: 'team_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      member1: m1,
      member2: m2,
      songTitle: song,
      rawScores: {},
      avgScore: null,
      status: 'waiting'
    };

    state.teams.push(newTeam);
    broadcastState();
  });

  // 4. 팀 삭제 (로비 단계에서 잘못 등록했을 때)
  socket.on('delete_team', ({ teamId }) => {
    if (state.gameStatus === 'LOBBY') {
      state.teams = state.teams.filter(t => t.id !== teamId);
      broadcastState();
    }
  });

  // 5. 대회 시작 (로비에서 콘테스트 스테이지로 전환)
  socket.on('start_contest', () => {
    if (state.teams.length === 0) {
      return socket.emit('error_message', '최소 1팀 이상 등록되어야 대회를 시작할 수 있습니다.');
    }

    state.gameStatus = 'CONTEST';
    state.currentTeamIndex = 0;
    broadcastState();
  });

  // 6. 팀원의 [점수 받기] 클릭 -> 30초 채점 모드 시작
  socket.on('request_score', () => {
    const currentTeam = state.teams[state.currentTeamIndex];
    if (!currentTeam || state.gameStatus !== 'CONTEST') return;

    // 해당 팀원인지 확인 (진행 편의를 위해 사용자 검증 및 채점 전환)
    const currentUser = state.users[socket.id];
    if (!currentUser) return;

    // 팀원이거나 누구나 점수받기를 시작할 수 있도록 허용하되 팀원 우선
    currentTeam.rawScores = {};
    state.gameStatus = 'SCORING';
    state.scoringTimeLeft = 30;

    // 30초 카운트다운 타이머 시작
    if (scoringTimerInterval) clearInterval(scoringTimerInterval);

    scoringTimerInterval = setInterval(() => {
      state.scoringTimeLeft -= 1;
      io.emit('scoring_tick', { timeLeft: state.scoringTimeLeft });

      if (state.scoringTimeLeft <= 0) {
        finalizeScoring();
      }
    }, 1000);

    // 가상 봇 참가자가 있는 경우 1~2초 내 자동으로 7~10점 투표 처리
    Object.values(state.users).forEach(u => {
      if (u.isBot && u.name !== currentTeam.member1 && u.name !== currentTeam.member2) {
        setTimeout(() => {
          if (state.gameStatus === 'SCORING' && currentTeam.rawScores[u.id] === undefined) {
            currentTeam.rawScores[u.id] = Math.floor(Math.random() * 4) + 7; // 7, 8, 9, 10점 중 랜덤 부여
            
            const eligibleUsers = Object.values(state.users).filter(usr => 
              usr.name !== currentTeam.member1 && usr.name !== currentTeam.member2
            );
            const submittedCount = Object.keys(currentTeam.rawScores).length;

            if (submittedCount >= eligibleUsers.length && eligibleUsers.length > 0) {
              finalizeScoring();
            } else {
              broadcastState();
            }
          }
        }, Math.random() * 1200 + 400);
      }
    });

    broadcastState();
  });

  // 7. 관객의 점수 제출 (1~10점)
  socket.on('submit_score', ({ score }) => {
    if (state.gameStatus !== 'SCORING') return;

    const currentTeam = state.teams[state.currentTeamIndex];
    const user = state.users[socket.id];
    if (!currentTeam || !user) return;

    // 출전 팀원(본인)은 점수 제출 불가
    if (user.name === currentTeam.member1 || user.name === currentTeam.member2) {
      return socket.emit('error_message', '본인 무대에는 점수를 줄 수 없습니다.');
    }

    const numScore = parseInt(score, 10);
    if (isNaN(numScore) || numScore < 1 || numScore > 10) return;

    // 점수 저장
    currentTeam.rawScores[user.id] = numScore;

    // 점수 제출 완료 알림
    socket.emit('score_submitted_ack', { score: numScore });

    // 유효한 투표자 전원이 제출했는지 확인
    const eligibleUsers = Object.values(state.users).filter(u => 
      u.name !== currentTeam.member1 && u.name !== currentTeam.member2
    );

    const submittedCount = Object.keys(currentTeam.rawScores).length;

    // 전원 제출 시 즉시 마감
    if (submittedCount >= eligibleUsers.length && eligibleUsers.length > 0) {
      finalizeScoring();
    } else {
      broadcastState();
    }
  });

  // 8. 다음 팀 무대로 넘어가기
  socket.on('next_team', () => {
    if (state.currentTeamIndex < state.teams.length - 1) {
      state.currentTeamIndex += 1;
      state.gameStatus = 'CONTEST';
      broadcastState();
    }
  });

  // 9. [결과 확인하기] 클릭 -> 10초 역카운트다운 시작
  socket.on('start_result_countdown', () => {
    // 모든 팀 채점이 완료되었는지 체크
    const allFinished = state.teams.every(t => t.status === 'scored');
    if (!allFinished) {
      return socket.emit('error_message', '아직 채점이 완료되지 않은 팀이 있습니다.');
    }

    state.gameStatus = 'COUNTDOWN';
    state.countdownTimeLeft = 10;

    if (countdownTimerInterval) clearInterval(countdownTimerInterval);

    // 10초 타이머 동작
    countdownTimerInterval = setInterval(() => {
      state.countdownTimeLeft -= 1;
      io.emit('countdown_tick', { timeLeft: state.countdownTimeLeft });

      if (state.countdownTimeLeft <= 0) {
        clearInterval(countdownTimerInterval);
        countdownTimerInterval = null;
        state.gameStatus = 'RESULT';
        broadcastState();
      }
    }, 1000);

    broadcastState();
  });

  // 10. 대회 초기화 (새로운 게임 시작)
  socket.on('reset_contest', () => {
    if (scoringTimerInterval) clearInterval(scoringTimerInterval);
    if (countdownTimerInterval) clearInterval(countdownTimerInterval);

    state.teams = [];
    state.currentTeamIndex = 0;
    state.gameStatus = 'LOBBY';
    state.scoringTimeLeft = 30;
    state.countdownTimeLeft = 10;

    // 가상 봇 제거 및 실제 접속 유저만 유지
    for (const id in state.users) {
      if (state.users[id].isBot) {
        delete state.users[id];
      } else {
        state.users[id].isReady = false;
      }
    }

    broadcastState();
  });

  // 11. [데모 모드] 가상 참석자 10명 및 듀엣 4팀 자동 생성 (UI 화면 사전 점검용)
  socket.on('populate_demo_data', () => {
    const demoNames = [
      '지민', '정국', '태형', '민지', '하니',
      '다니엘', '유진', '원영', '카리나', '윈터'
    ];

    // 기존 봇 정리 후 10명 생성
    for (const id in state.users) {
      if (state.users[id].isBot) delete state.users[id];
    }

    demoNames.forEach((name, idx) => {
      const botId = `bot_${idx + 1}`;
      state.users[botId] = {
        id: botId,
        name: name,
        isReady: true,
        isBot: true
      };
    });

    // 듀엣 4팀 등록 (1인이 여러 팀에 중복 출전하는 규칙 완벽 반영)
    state.teams = [
      {
        id: 'team_demo_1',
        member1: '지민',
        member2: '정국',
        songTitle: '그 남자 그 여자 (바이브 & 장혜진)',
        rawScores: {},
        avgScore: null,
        status: 'waiting'
      },
      {
        id: 'team_demo_2',
        member1: '태형',
        member2: '지민', // 지민 중복 출전!
        songTitle: '잔소리 (아이유 & 임슬옹)',
        rawScores: {},
        avgScore: null,
        status: 'waiting'
      },
      {
        id: 'team_demo_3',
        member1: '민지',
        member2: '하니',
        songTitle: '남과 여 (박선주 & 김범수)',
        rawScores: {},
        avgScore: null,
        status: 'waiting'
      },
      {
        id: 'team_demo_4',
        member1: '원영',
        member2: '카리나',
        songTitle: 'All For You (서인국 & 정은지)',
        rawScores: {},
        avgScore: null,
        status: 'waiting'
      }
    ];

    state.currentTeamIndex = 0;
    state.gameStatus = 'LOBBY';
    broadcastState();
  });

  // 연결 해제 시 처리
  socket.on('disconnect', () => {
    delete state.users[socket.id];
    broadcastState();
  });
});

// 서버 기동
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🎤 듀엣 노래 대회 파티 서버가 실행되었습니다!`);
  console.log(`🌐 접속 주소: ${serverUrl}`);
  console.log(`📱 스마트폰으로 동일 Wi-Fi에서 위 주소나 QR 코드로 접속하세요.`);
  console.log(`===============================================`);
});
