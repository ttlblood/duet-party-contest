/**
 * 듀엣 노래 대회 (Duet Party Contest) 메인 백엔드 서버
 * 방(Room) 기반 멀티 대회 시스템 및 관리자(Host) 권한 제어 지원
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
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
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalIpAddress();
// 외부 공개 URL 환경변수(PUBLIC_URL)가 있으면 우선 적용 (Cloudflare Tunnel 및 배포 지원)
const serverUrl = process.env.PUBLIC_URL || `http://${localIp}:${PORT}`;

// 6자리 가독성 높은 영문/숫자 방 코드 생성 함수
function generateRoomCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * 룸(Room) 기반 전체 상태 관리 객체
 * rooms[roomCode] = { ... }
 */
const rooms = {};

// 소켓 ID가 속한 방 코드 역참조 맵: socketRoomMap[socketId] = roomCode
const socketRoomMap = {};

// 특정 방의 QR 코드 생성 함수 (Promise)
async function generateRoomQRCode(roomCode) {
  const targetUrl = `${serverUrl}/${roomCode}`;
  try {
    return await QRCode.toDataURL(targetUrl, { margin: 2, scale: 6 });
  } catch (err) {
    console.error('QR 코드 생성 오류:', err);
    return '';
  }
}

// 특정 방의 최신 상태 브로드캐스트 함수
function broadcastRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit('state_update', {
    roomCode: room.id,
    title: room.title,
    hostName: room.hostName,
    users: Object.values(room.users),
    teams: room.teams,
    currentTeamIndex: room.currentTeamIndex,
    gameStatus: room.gameStatus,
    scoringTimeLeft: room.scoringTimeLeft,
    countdownTimeLeft: room.countdownTimeLeft,
    roomUrl: `${serverUrl}/${roomCode}`,
    qrCodeDataUrl: room.qrCodeDataUrl
  });
}

// 특정 방의 30초 채점 마감 처리 함수
function finalizeRoomScoring(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  if (room.scoringTimerInterval) {
    clearInterval(room.scoringTimerInterval);
    room.scoringTimerInterval = null;
  }

  const currentTeam = room.teams[room.currentTeamIndex];
  if (!currentTeam) return;

  // 채점 참여 대상자(팀원 2명 제외) 목록 추출
  const eligibleUsers = Object.values(room.users).filter(u => 
    u.name !== currentTeam.member1 && u.name !== currentTeam.member2
  );

  // 미입력자에게 기본 5점 부여 (30초 내 미선택 규칙)
  eligibleUsers.forEach(u => {
    if (currentTeam.rawScores[u.id] === undefined) {
      currentTeam.rawScores[u.id] = 5;
    }
  });

  // 평균 점수 계산
  const scoresArray = Object.values(currentTeam.rawScores);
  if (scoresArray.length > 0) {
    const sum = scoresArray.reduce((acc, cur) => acc + cur, 0);
    currentTeam.avgScore = parseFloat((sum / scoresArray.length).toFixed(2));
  } else {
    currentTeam.avgScore = 5.00;
  }

  currentTeam.status = 'scored';
  room.gameStatus = 'CONTEST';
  room.scoringTimeLeft = 30;

  const allTeamsFinished = room.teams.every(t => t.status === 'scored');

  io.to(roomCode).emit('score_revealed', {
    teamId: currentTeam.id,
    teamName: `${currentTeam.member1} & ${currentTeam.member2}`,
    songTitle: currentTeam.songTitle,
    rawScores: currentTeam.rawScores,
    avgScore: currentTeam.avgScore,
    integerPart: Math.floor(currentTeam.avgScore),
    allTeamsFinished,
  });

  broadcastRoomState(roomCode);
}

// Express 라우팅: 방 코드 경로로 접속 시 index.html 제공
app.get('/:roomCode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.IO 이벤트 리스너
io.on('connection', (socket) => {

  // 1. 새 듀엣 대회 방 생성 (개설자가 관리자가 됨)
  socket.on('create_room', async ({ title, hostName }, callback) => {
    const trimmedTitle = (title || '싱어게인 듀엣 노래 대회').trim();
    const trimmedHostName = (hostName || '관리자').trim();

    // 중복되지 않는 6자리 방 코드 생성
    let roomCode = generateRoomCode();
    while (rooms[roomCode]) {
      roomCode = generateRoomCode();
    }

    const adminToken = crypto.randomUUID();
    const qrData = await generateRoomQRCode(roomCode);

    // 새 방 초기화
    rooms[roomCode] = {
      id: roomCode,
      title: trimmedTitle,
      hostName: trimmedHostName,
      adminToken: adminToken,
      users: {},
      teams: [],
      currentTeamIndex: 0,
      gameStatus: 'LOBBY',
      scoringTimeLeft: 30,
      countdownTimeLeft: 10,
      scoringTimerInterval: null,
      countdownTimerInterval: null,
      qrCodeDataUrl: qrData,
      createdAt: Date.now()
    };

    // 소켓을 해당 방에 조인
    socket.join(roomCode);
    socketRoomMap[socket.id] = roomCode;

    // 개설자를 관리자로 사용자 등록
    rooms[roomCode].users[socket.id] = {
      id: socket.id,
      name: trimmedHostName,
      isReady: true,
      isHost: true
    };

    if (typeof callback === 'function') {
      callback({
        success: true,
        roomCode,
        adminToken,
        title: trimmedTitle,
        hostName: trimmedHostName
      });
    }

    broadcastRoomState(roomCode);
  });

  // 2. 방 입장 요청 (참가자 또는 새로고침한 관리자)
  socket.on('join_room', ({ roomCode, userName, adminToken }, callback) => {
    const room = rooms[roomCode];
    if (!room) {
      if (typeof callback === 'function') {
        callback({ success: false, message: '존재하지 않거나 종료된 대회 방입니다.' });
      }
      return socket.emit('error_message', '존재하지 않거나 종료된 대회 방입니다.');
    }

    const trimmedName = (userName || '').trim();
    if (!trimmedName) {
      if (typeof callback === 'function') {
        callback({ success: false, message: '이름을 입력해주세요.' });
      }
      return;
    }

    socket.join(roomCode);
    socketRoomMap[socket.id] = roomCode;

    // 관리자 토큰 검증
    const isHost = (adminToken && adminToken === room.adminToken) || (trimmedName === room.hostName && !Object.values(room.users).some(u => u.isHost));

    room.users[socket.id] = {
      id: socket.id,
      name: trimmedName,
      isReady: isHost ? true : false,
      isHost: isHost
    };

    if (typeof callback === 'function') {
      callback({
        success: true,
        roomCode,
        isHost,
        title: room.title,
        hostName: room.hostName
      });
    }

    broadcastRoomState(roomCode);
  });

  // 3. 레디(Ready) 토글
  socket.on('toggle_ready', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (room && room.users[socket.id]) {
      room.users[socket.id].isReady = !room.users[socket.id].isReady;
      broadcastRoomState(roomCode);
    }
  });

  // 4. 듀엣 팀 및 곡목 등록
  socket.on('create_team', ({ member1, member2, songTitle }) => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

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

    room.teams.push(newTeam);
    broadcastRoomState(roomCode);
  });

  // 5. 팀 삭제
  socket.on('delete_team', ({ teamId }) => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (room && room.gameStatus === 'LOBBY') {
      room.teams = room.teams.filter(t => t.id !== teamId);
      broadcastRoomState(roomCode);
    }
  });

  // 6. 대회 시작하기 (관리자 또는 참가자)
  socket.on('start_contest', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    if (room.teams.length === 0) {
      return socket.emit('error_message', '최소 1팀 이상 등록되어야 대회를 시작할 수 있습니다.');
    }

    room.gameStatus = 'CONTEST';
    room.currentTeamIndex = 0;
    broadcastRoomState(roomCode);
  });

  // 7. 팀원의 [점수 받기] 클릭 -> 30초 채점 시작
  socket.on('request_score', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room || room.gameStatus !== 'CONTEST') return;

    const currentTeam = room.teams[room.currentTeamIndex];
    if (!currentTeam) return;

    currentTeam.rawScores = {};
    room.gameStatus = 'SCORING';
    room.scoringTimeLeft = 30;

    if (room.scoringTimerInterval) clearInterval(room.scoringTimerInterval);

    room.scoringTimerInterval = setInterval(() => {
      room.scoringTimeLeft -= 1;
      io.to(roomCode).emit('scoring_tick', { timeLeft: room.scoringTimeLeft });

      if (room.scoringTimeLeft <= 0) {
        finalizeRoomScoring(roomCode);
      }
    }, 1000);

    // 가상 봇 참가자가 있는 경우 자동 점수 투표
    Object.values(room.users).forEach(u => {
      if (u.isBot && u.name !== currentTeam.member1 && u.name !== currentTeam.member2) {
        setTimeout(() => {
          if (room.gameStatus === 'SCORING' && currentTeam.rawScores[u.id] === undefined) {
            currentTeam.rawScores[u.id] = Math.floor(Math.random() * 4) + 7;
            const eligibleUsers = Object.values(room.users).filter(usr => 
              usr.name !== currentTeam.member1 && usr.name !== currentTeam.member2
            );
            const submittedCount = Object.keys(currentTeam.rawScores).length;

            if (submittedCount >= eligibleUsers.length && eligibleUsers.length > 0) {
              finalizeRoomScoring(roomCode);
            } else {
              broadcastRoomState(roomCode);
            }
          }
        }, Math.random() * 1200 + 400);
      }
    });

    broadcastRoomState(roomCode);
  });

  // 8. 관객 점수 제출 (1~10점)
  socket.on('submit_score', ({ score }) => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room || room.gameStatus !== 'SCORING') return;

    const currentTeam = room.teams[room.currentTeamIndex];
    const user = room.users[socket.id];
    if (!currentTeam || !user) return;

    // 본인 무대 투표 차단
    if (user.name === currentTeam.member1 || user.name === currentTeam.member2) {
      return socket.emit('error_message', '본인 무대에는 점수를 줄 수 없습니다.');
    }

    const numScore = parseInt(score, 10);
    if (isNaN(numScore) || numScore < 1 || numScore > 10) return;

    currentTeam.rawScores[user.id] = numScore;
    socket.emit('score_submitted_ack', { score: numScore });

    const eligibleUsers = Object.values(room.users).filter(u => 
      u.name !== currentTeam.member1 && u.name !== currentTeam.member2
    );
    const submittedCount = Object.keys(currentTeam.rawScores).length;

    if (submittedCount >= eligibleUsers.length && eligibleUsers.length > 0) {
      finalizeRoomScoring(roomCode);
    } else {
      broadcastRoomState(roomCode);
    }
  });

  // 9. 다음 팀 무대로
  socket.on('next_team', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    if (room.currentTeamIndex < room.teams.length - 1) {
      room.currentTeamIndex += 1;
      room.gameStatus = 'CONTEST';
      broadcastRoomState(roomCode);
    }
  });

  // 10. 결과 확인 10초 역카운트다운 시작
  socket.on('start_result_countdown', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    const allFinished = room.teams.every(t => t.status === 'scored');
    if (!allFinished) {
      return socket.emit('error_message', '아직 채점이 완료되지 않은 팀이 있습니다.');
    }

    room.gameStatus = 'COUNTDOWN';
    room.countdownTimeLeft = 10;

    if (room.countdownTimerInterval) clearInterval(room.countdownTimerInterval);

    room.countdownTimerInterval = setInterval(() => {
      room.countdownTimeLeft -= 1;
      io.to(roomCode).emit('countdown_tick', { timeLeft: room.countdownTimeLeft });

      if (room.countdownTimeLeft <= 0) {
        clearInterval(room.countdownTimerInterval);
        room.countdownTimerInterval = null;
        room.gameStatus = 'RESULT';
        broadcastRoomState(roomCode);
      }
    }, 1000);

    broadcastRoomState(roomCode);
  });

  // 11. 대회 초기화 (관리자 전용 기능)
  socket.on('reset_contest', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    const user = room.users[socket.id];
    // 관리자(방장) 권한 확인
    if (!user || !user.isHost) {
      return socket.emit('error_message', '대회 초기화는 관리자(방장)만 가능합니다.');
    }

    if (room.scoringTimerInterval) clearInterval(room.scoringTimerInterval);
    if (room.countdownTimerInterval) clearInterval(room.countdownTimerInterval);

    room.teams = [];
    room.currentTeamIndex = 0;
    room.gameStatus = 'LOBBY';
    room.scoringTimeLeft = 30;
    room.countdownTimeLeft = 10;

    for (const id in room.users) {
      if (room.users[id].isBot) {
        delete room.users[id];
      } else {
        room.users[id].isReady = room.users[id].isHost ? true : false;
      }
    }

    broadcastRoomState(roomCode);
  });

  // 12. 데모용 10명 & 4팀 생성
  socket.on('populate_demo_data', () => {
    const roomCode = socketRoomMap[socket.id];
    const room = rooms[roomCode];
    if (!room) return;

    const demoNames = [
      '지민', '정국', '태형', '민지', '하니',
      '다니엘', '유진', '원영', '카리나', '윈터'
    ];

    for (const id in room.users) {
      if (room.users[id].isBot) delete room.users[id];
    }

    demoNames.forEach((name, idx) => {
      const botId = `bot_${roomCode}_${idx + 1}`;
      room.users[botId] = {
        id: botId,
        name: name,
        isReady: true,
        isBot: true
      };
    });

    room.teams = [
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
        member2: '지민',
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

    room.currentTeamIndex = 0;
    room.gameStatus = 'LOBBY';
    broadcastRoomState(roomCode);
  });

  // 연결 종료 시 처리
  socket.on('disconnect', () => {
    const roomCode = socketRoomMap[socket.id];
    if (roomCode && rooms[roomCode]) {
      delete rooms[roomCode].users[socket.id];
      delete socketRoomMap[socket.id];
      broadcastRoomState(roomCode);
    }
  });
});

// 서버 실행
server.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🎤 싱어게인 듀엣 노래 대회 서버 실행 완료!`);
  console.log(`🌐 서비스 메인 주소: ${serverUrl}`);
  console.log(`===============================================`);
});
