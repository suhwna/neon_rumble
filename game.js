const { BUTTONS, FIGHTERS, STAGES, ITEMS, DEFAULT_RULES } = window.NEON_CONTENT;
const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const menu = document.querySelector('#menu');
const result = document.querySelector('#result');
const countdown = document.querySelector('#countdown');
const fighterGrid = document.querySelector('#fighter-grid');
const paletteOptions = document.querySelector('#palette-options');
const roomBar = document.querySelector('#room-bar');
const lobbyActions = document.querySelector('#lobby-actions');
const queueBar = document.querySelector('#queue-bar');
const roomSettings = document.querySelector('#room-settings');
const playerList = document.querySelector('#player-list');
const roomInput = document.querySelector('#room-input');
const roomBrowser = document.querySelector('#room-browser');
const roomBrowserList = document.querySelector('#room-browser-list');
const roomNotice = document.querySelector('#room-notice');
const waitingRoom = document.querySelector('#waiting-room');
const waitingNotice = document.querySelector('#waiting-notice');
const waitingReady = document.querySelector('#waiting-ready');
const waitingStart = document.querySelector('#waiting-start');
const paletteSelector = document.querySelector('#palette-selector');
const nicknameInput = document.querySelector('#nickname-input');
const connectionError = document.querySelector('#connection-error');
const trainingPanel = document.querySelector('#training-panel');
const trainingGuide = document.querySelector('#training-guide');
const trainingGuideToggle = document.querySelector('#training-guide-toggle');
const trainingTutorial = document.querySelector('#training-tutorial');
const trainingTutorialToggle = document.querySelector('#training-tutorial-toggle');
const trainingFighterSelect = document.querySelector('#training-fighter-select');
const trainingBotSelect = document.querySelector('#training-bot-select');
const socket = io();

const WORLD_W = 1280, WORLD_H = 720;
let dpr = 1, viewScale = 1, viewOffsetX = 0, viewOffsetY = 0;
let camera = { x: 640, y: 355, zoom: 1 }, screenShake = 0, cameraPunch = 0, criticalFlash = 0, impactRings = [], blastMarks = [];
let ultimateCinematic = null;
let state = 'menu', room = null, myIndex = -1, identity = null;
let selectedCharacter = localStorage.getItem('neon_character') || 'volt';
let selectedPalette = Number(localStorage.getItem('neon_palette') || 0);
let players = [], platforms = [], entities = [], items = [], stage = STAGES[0], rules = { ...DEFAULT_RULES };
let snapshots = [], latestSnapshot = null, keys = new Set(), particles = [], trails = [], lastEvents = new Set(), trailClock = 0;
let lastFrame = performance.now(), inputSeq = 0, lastInputSent = 0, muted = false, audio;
let pingSamples = [], ping = 0, adaptiveDelay = 90, remainingTicks = 0, winnerIndex = null;
let paused = false, hitboxes = false, localCue = null, localAttackIntent = null;
let trainingInputHistory = [], trainingInputSignature = '', trainingInputSequence = 0;
let tutorialState = { active: false, index: 0, lastButtons: 0, startX: 0, advancing: false, advanceTimer: null };
let roomNoticeTimer = null;
const waitingUiNodes = [
  [roomSettings, document.querySelector('#waiting-settings-mount')],
  [playerList, document.querySelector('#waiting-roster-mount')],
  [fighterGrid, document.querySelector('#waiting-fighter-mount')],
  [paletteSelector, document.querySelector('#waiting-palette-mount')]
].map(([node, mount]) => {
  const marker = document.createComment(`home:${node.id}`);
  node.parentNode.insertBefore(marker, node);
  return { node, mount, marker };
});

const TRAINING_SPECIALS = {
  volt: [
    ['X', '아크 샷', '빠른 전기 투사체로 원거리 견제'],
    ['←/→ + X', '펄스 러시', '전방으로 빠르게 돌진하며 타격'],
    ['↑ + X', '썬더 라이즈', '대각선 상승 복귀기'],
    ['↓ + X', '스태틱 스윕', '발밑의 짧은 범위를 쓸어 연계하는 전기 공격']
  ],
  blaze: [
    ['X', '코어 캐논', '강력한 폭발 포탄 · 홀드해서 차지'],
    ['←/→ + X', '아머 차지', '공격을 버티며 전진하는 중량 돌진'],
    ['↑ + X', '로켓 어퍼', '로켓 추진으로 상승하는 복귀기'],
    ['↓ + X', '블레이즈 카운터', '받는 공격을 되받아치는 방어 기술']
  ],
  bolt: [
    ['X', '부메랑 오브', '돌아오는 구체로 왕복 견제'],
    ['←/→ + X', '휠 러시', '몸을 말아 다단 돌진 공격'],
    ['↑ + X', '스프링 점프', '가장 높게 솟는 수직 복귀기'],
    ['↓ + X', '퀘이크', '넓은 지면 충격파로 주변 공격']
  ],
  nova: [
    ['X', '스타 웨이브', '흔들리며 전진하는 별 투사체'],
    ['←/→ + X', '블링크 슬래시', '지정 방향으로 순간이동 베기'],
    ['↑ + X', '워프 라이즈', '대각선 워프로 멀리 복귀'],
    ['↓ + X', '그래비티 필드', '적을 중심으로 끌어당기는 지속 장판']
  ]
};
const TRAINING_ULTIMATES = {
  volt: ['천뢰 낙하', '전방 지점에 예고 후 강한 낙뢰. 표시 범위 밖으로 피할 수 있습니다.'],
  blaze: ['브레이커 러시', '슈퍼아머 돌진을 직접 맞혀야 폭발적인 넉백이 발생합니다.'],
  bolt: ['오버드라이브 오브', '전방으로 빠르게 관통하는 구체. 점프하거나 회피해 경로를 벗어날 수 있습니다.'],
  nova: ['싱귤래리티', '중력으로 끌어당긴 뒤 폭발. 중심에서 벗어나면 피할 수 있습니다.']
};
const ULTIMATE_TITLES = {
  volt: ['THUNDER VERDICT', '천뢰 낙하'],
  blaze: ['BREAKER RUSH', '브레이커 러시'],
  bolt: ['OVERDRIVE ORB', '오버드라이브 오브'],
  nova: ['SINGULARITY', '싱귤래리티']
};

const TUTORIAL_STEPS = [
  { id: 'move', category: '이동 기초', title: '좌우로 이동', command: '← / →', goal: '좌우로 100px 이동', description: '방향키를 눌러 거리를 벌렸다가 다시 접근하세요.', tip: '한 번 입력은 일반 이동, 같은 방향을 빠르게 두 번 입력하면 대시합니다.' },
  { id: 'dash', category: '이동 기초', title: '대시', command: '→ →', goal: '대시 상태 만들기', description: '같은 방향을 빠르게 두 번 입력해 대시하세요.', tip: '대시는 접근과 거리 조절의 핵심입니다.' },
  { id: 'jump', category: '공중 이동', title: '점프', command: '↑', goal: '지상에서 점프', description: '위 방향키로 점프하세요. 짧게 놓으면 숏홉이 됩니다.', tip: '공격과 동시에 누르면 숏홉 공중기가 바로 나갑니다.' },
  { id: 'double-jump', category: '공중 이동', title: '2단 점프', command: '공중 ↑', goal: '공중에서 다시 점프', description: '첫 점프가 끝나기 전에 위 방향키를 다시 누르세요.', tip: '복귀할 때 바로 소비하지 말고 필요한 높이에서 사용하세요.' },
  { id: 'basic-hit', category: '공격 기초', title: '기본 공격 적중', command: 'Z', goal: '더미에게 공격 적중', description: '더미 가까이에서 Z로 기본 공격을 맞히세요.', tip: 'Z를 연속 입력하면 3단 잽으로 이어집니다.' },
  { id: 'tilt', category: '공격 기초', title: '틸트 공격', command: '방향 → Z', goal: '틸트 공격 발동', description: '방향을 먼저 누른 상태에서 Z를 누르세요.', tip: '빠르고 후딜이 짧아 콤보와 견제에 유리합니다.' },
  { id: 'smash', category: '공격 기초', title: '스매시 공격', command: 'Z 홀드', goal: '스매시 공격 발동', description: '지상에서 Z를 잠시 유지하면 방향에 맞는 스매시를 충전합니다. 키를 놓으면 공격합니다.', tip: 'X는 언제나 캐릭터 필살기이며, 방향 없이 Z를 홀드하면 앞 스매시가 나갑니다.' },
  { id: 'shield', category: '방어 기초', title: '실드', command: 'C 유지', goal: '실드 펼치기', description: 'C를 유지해 공격을 막는 실드를 펼치세요.', tip: '실드가 깨지면 긴 시간 무방비 상태가 됩니다.' },
  { id: 'parry', category: '방어 기초', title: '패링', command: '공격 직전 C 탭', goal: '패링 성공', description: '상대 공격이 닿기 직전에 C를 누르세요. 처음 5프레임 동안 패링하며, 계속 누르면 일반 실드로 이어집니다.', tip: '성공하면 상대만 16프레임 정지해 강한 반격 기회를 얻습니다.' },
  { id: 'dodge', category: '방어 기초', title: '구르기 회피', command: '←/→ + C', goal: '지상 구르기 사용', description: '방향키와 C를 함께 눌러 상대를 통과하며 회피하세요.', tip: '회피를 반복하면 무적 시간은 줄고 후딜은 늘어납니다.' },
  { id: 'special', category: '캐릭터 기술', title: '필살기', command: 'X / 방향 + X', goal: '아무 필살기 사용', description: 'X와 방향키 조합으로 캐릭터 고유 기술을 사용하세요.', tip: '중립·옆·위·아래 필살기는 서로 역할이 다릅니다.' },
  { id: 'throw', category: '잡기', title: '잡기와 던지기', command: 'V → 방향', goal: '더미를 잡아 던지기', description: '더미 가까이에서 V로 잡은 뒤 방향키로 던지세요.', tip: '실드 중인 상대도 잡을 수 있습니다.' },
  { id: 'recovery', category: '복귀', title: '위 필살기로 복귀', command: '공중 ↑ + X', goal: '공중에서 위 필살기', description: '점프한 뒤 위 방향키와 X를 눌러 복귀기를 사용하세요.', tip: '공중 점프와 옆 필살기를 먼저 쓰면 복귀 거리를 더 확보할 수 있습니다.' }
];

function renderTutorial() {
  const complete = tutorialState.index >= TUTORIAL_STEPS.length;
  const step = TUTORIAL_STEPS[Math.min(tutorialState.index, TUTORIAL_STEPS.length - 1)];
  trainingTutorial.classList.toggle('complete', complete);
  document.querySelector('#tutorial-progress').textContent = complete ? `${TUTORIAL_STEPS.length} / ${TUTORIAL_STEPS.length}` : `${tutorialState.index + 1} / ${TUTORIAL_STEPS.length}`;
  document.querySelector('#tutorial-progress-bar').style.width = `${complete ? 100 : (tutorialState.index + 1) / TUTORIAL_STEPS.length * 100}%`;
  document.querySelector('#tutorial-category').textContent = complete ? 'ROOKIE COURSE COMPLETE' : step.category;
  document.querySelector('#tutorial-title').textContent = complete ? '기본 전투 준비 완료!' : step.title;
  document.querySelector('#tutorial-description').textContent = complete ? '이동·공격·방어·잡기·복귀의 기본을 모두 익혔습니다.' : step.description;
  document.querySelector('#tutorial-command').textContent = complete ? '완료' : step.command;
  document.querySelector('#tutorial-goal').textContent = complete ? '실전에서 조합해 보세요' : step.goal;
  document.querySelector('#tutorial-tip').textContent = complete ? '설명서에서 캐릭터별 필살기와 고급 조작도 확인할 수 있습니다.' : step.tip;
  document.querySelector('#tutorial-skip').textContent = complete ? '다시 시작' : '단계 건너뛰기';
}

function beginTutorialStep(index) {
  if (tutorialState.advanceTimer) clearTimeout(tutorialState.advanceTimer);
  tutorialState.advanceTimer = null;
  tutorialState.index = clamp(index, 0, TUTORIAL_STEPS.length);
  tutorialState.advancing = false;
  tutorialState.lastButtons = readInput().buttons;
  tutorialState.startX = players.find(player => player.i === myIndex)?.x || 0;
  document.querySelector('#tutorial-command').style.background = '';
  renderTutorial();
}

function openTutorial() {
  tutorialState.active = true;
  trainingTutorial.classList.remove('hidden');
  trainingTutorialToggle.classList.add('active');
  setTrainingGuideOpen(false);
  document.querySelector('#cpu-select').value = 'dummy';
  socket.emit('training:command', { type: 'cpu', value: 'dummy' });
  socket.emit('training:command', { type: 'reset' });
  beginTutorialStep(0);
}

function closeTutorial() {
  if (tutorialState.advanceTimer) clearTimeout(tutorialState.advanceTimer);
  tutorialState.advanceTimer = null;
  tutorialState.active = false;
  trainingTutorial.classList.add('hidden');
  trainingTutorialToggle.classList.remove('active');
}

function completeTutorialStep() {
  if (!tutorialState.active || tutorialState.advancing || tutorialState.index >= TUTORIAL_STEPS.length) return;
  tutorialState.advancing = true;
  const command = document.querySelector('#tutorial-command');
  command.textContent = '성공';
  command.style.background = '#67f59b';
  beep(840, .06, 'square');
  const nextIndex = tutorialState.index + 1;
  tutorialState.advanceTimer = setTimeout(() => {
    tutorialState.advanceTimer = null;
    command.style.background = '';
    beginTutorialStep(nextIndex);
  }, 520);
}

function updateTutorialInput(input) {
  if (!tutorialState.active || tutorialState.advancing || tutorialState.index >= TUTORIAL_STEPS.length) return;
  const step = TUTORIAL_STEPS[tutorialState.index];
  const fresh = input.buttons & ~tutorialState.lastButtons;
  const self = players.find(player => player.i === myIndex);
  if (step.id === 'double-jump' && self && !self.grounded && fresh & BUTTONS.UP) completeTutorialStep();
  tutorialState.lastButtons = input.buttons;
}

function updateTutorialState() {
  if (!tutorialState.active || tutorialState.advancing || tutorialState.index >= TUTORIAL_STEPS.length) return;
  const self = players.find(player => player.i === myIndex);
  if (!self) return;
  const step = TUTORIAL_STEPS[tutorialState.index];
  if (step.id === 'move' && Math.abs(self.x - tutorialState.startX) >= 100) completeTutorialStep();
  else if (step.id === 'dash' && (self.actionName === 'dash' || Math.abs(self.vx) > 380)) completeTutorialStep();
  else if (step.id === 'jump' && !self.grounded && (self.actionName === 'jump' || self.vy < -120)) completeTutorialStep();
  else if (step.id === 'shield' && self.shielding) completeTutorialStep();
  else if (step.id === 'dodge' && ['roll', 'spotDodge'].includes(self.actionName)) completeTutorialStep();
  else if (step.id === 'recovery' && self.actionName === 'specialUp' && !self.grounded) completeTutorialStep();
}

function updateTutorialEvent(event) {
  if (!tutorialState.active || tutorialState.advancing || tutorialState.index >= TUTORIAL_STEPS.length) return;
  const step = TUTORIAL_STEPS[tutorialState.index];
  if (step.id === 'basic-hit' && event.type === 'hit' && event.attacker === myIndex) completeTutorialStep();
  else if (step.id === 'tilt' && event.type === 'action' && event.player === myIndex && event.variant === 'tilt') completeTutorialStep();
  else if (step.id === 'smash' && event.type === 'action' && event.player === myIndex && event.variant === 'smash') completeTutorialStep();
  else if (step.id === 'special' && event.type === 'action' && event.player === myIndex && String(event.action).startsWith('special')) completeTutorialStep();
  else if (step.id === 'parry' && event.type === 'parry' && event.player === myIndex) completeTutorialStep();
  else if (step.id === 'throw' && event.type === 'throw' && event.player === myIndex) completeTutorialStep();
}

function setTrainingGuideOpen(open) {
  trainingGuide.classList.toggle('collapsed', !open);
  trainingGuideToggle.classList.toggle('active', open);
  trainingGuideToggle.setAttribute('aria-expanded', String(open));
  const label = trainingGuideToggle.querySelector('b');
  if (label) label.textContent = open ? '설명서 접기' : '조작·기술 설명';
}

function renderTrainingGuide(characterId = selectedCharacter) {
  const fighter = FIGHTERS.find(item => item.id === characterId) || FIGHTERS[0];
  const ultimate = TRAINING_ULTIMATES[fighter.id];
  document.querySelector('#training-guide-fighter').textContent = fighter.name;
  document.querySelector('#training-guide-fighter').style.color = fighter.color;
  document.querySelector('#training-guide-role').textContent = fighter.archetype;
  document.querySelector('#training-special-list').innerHTML = [...(TRAINING_SPECIALS[fighter.id] || []), ['Z + X', ultimate[0], ultimate[1]]].map(([input, name, description]) =>
    `<li><kbd>${input}</kbd><span><b>${name}</b>${description}</span></li>`
  ).join('');
}

function renderTrainingInputHistory() {
  const list = document.querySelector('#training-input-history');
  if (!trainingInputHistory.length) {
    list.innerHTML = '<li class="empty">키를 입력하면 순서대로 표시됩니다.</li>';
    return;
  }
  list.innerHTML = trainingInputHistory.map(entry =>
    `<li><span class="input-command"><b class="input-direction">${entry.direction}</b>${entry.buttons.map(button => `<i class="input-button ${button.kind}">${button.label}</i>`).join('')}</span><small class="input-duration">${entry.frames}F</small></li>`
  ).join('');
  list.scrollTop = list.scrollHeight;
}

function resetTrainingInputHistory() {
  trainingInputHistory = []; trainingInputSignature = ''; trainingInputSequence = 0;
  renderTrainingInputHistory();
}

function recordTrainingInput(input) {
  if (rules.mode !== 'training') return;
  const horizontal = input.horizontal < -.2 ? -1 : input.horizontal > .2 ? 1 : 0;
  const vertical = input.vertical < -.2 ? -1 : input.vertical > .2 ? 1 : 0;
  const directions = { '-1,-1': '↖', '0,-1': '↑', '1,-1': '↗', '-1,0': '←', '0,0': '·', '1,0': '→', '-1,1': '↙', '0,1': '↓', '1,1': '↘' };
  const buttons = [];
  if (input.buttons & BUTTONS.ATTACK) buttons.push({ label: 'Z', kind: '' });
  if (input.buttons & BUTTONS.SPECIAL) buttons.push({ label: 'X', kind: 'special' });
  if (input.buttons & BUTTONS.GRAB) buttons.push({ label: 'V', kind: 'special' });
  if (input.buttons & BUTTONS.SHIELD) buttons.push({ label: 'C', kind: 'defense' });
  const direction = directions[`${horizontal},${vertical}`];
  if (!trainingInputHistory.length && direction === '·' && buttons.length === 0) return;
  const signature = `${direction}|${buttons.map(button => button.label).join('+')}`;
  if (signature === trainingInputSignature && trainingInputHistory.length) {
    trainingInputHistory[trainingInputHistory.length - 1].frames += 2;
  } else {
    trainingInputSignature = signature;
    trainingInputHistory.push({ sequence: ++trainingInputSequence, direction, buttons, frames: 1 });
    if (trainingInputHistory.length > 14) trainingInputHistory.shift();
  }
  renderTrainingInputHistory();
}

function resize() {
  const width = innerWidth, height = innerHeight;
  dpr = Math.min(devicePixelRatio || 1, 1.5);
  canvas.width = width * dpr; canvas.height = height * dpr;
  canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
  viewScale = Math.min(width / WORLD_W, height / WORLD_H);
  viewOffsetX = (width - WORLD_W * viewScale) / 2;
  viewOffsetY = (height - WORLD_H * viewScale) / 2;
}
addEventListener('resize', resize); resize();

function setError(message = '') { connectionError.textContent = message; }
function emitAck(event, payload) { return new Promise(resolve => payload === undefined ? socket.emit(event, resolve) : socket.emit(event, payload, resolve)); }
function saveSession(value) {
  if (value) sessionStorage.setItem('neon_session', JSON.stringify(value));
  else sessionStorage.removeItem('neon_session');
  localStorage.removeItem('neon_session');
}
function getSession() {
  try {
    const current = sessionStorage.getItem('neon_session');
    if (current) return JSON.parse(current);
    const legacy = localStorage.getItem('neon_session');
    if (!legacy) return null;
    sessionStorage.setItem('neon_session', legacy); localStorage.removeItem('neon_session');
    return JSON.parse(legacy);
  } catch { saveSession(null); return null; }
}

async function initializeIdentity() {
  // A participant identity belongs to a tab so several local tabs can join the
  // same room for testing. sessionStorage still survives a normal refresh.
  const storedId = sessionStorage.getItem('neon_client_id');
  const storedToken = sessionStorage.getItem('neon_identity_token');
  const name = nicknameInput.value.trim() || localStorage.getItem('neon_nickname') || `RUMBLER${Math.floor(Math.random() * 900 + 100)}`;
  nicknameInput.value = name;
  const response = await emitAck('identity:init', { clientId: storedId, token: storedToken, nickname: name, characterId: selectedCharacter, palette: selectedPalette });
  if (!response?.ok) return setError('사용자 초기화에 실패했습니다.');
  identity = response; sessionStorage.setItem('neon_client_id', response.clientId); sessionStorage.setItem('neon_identity_token', response.token); localStorage.setItem('neon_nickname', response.nickname);
  localStorage.removeItem('neon_client_id'); localStorage.removeItem('neon_identity_token');
  updateStats(response.stats);
  const session = getSession();
  if (session) {
    const resumed = await emitAck('room:resume', session);
    if (resumed?.ok) {
      myIndex = resumed.index;
      inputSeq = Math.max(inputSeq, Number(resumed.lastSeq) || 0);
      enterRoom(resumed.room, resumed.snapshot);
      if (resumed.snapshot && resumed.room.playing) beginMatch(resumed.snapshot);
    }
    else saveSession(null);
  }
  if (!room) refreshRoomDirectory();
}

function updateStats(stats) {
  document.querySelector('#stats-summary').textContent = `${stats?.matches || 0}전 · ${stats?.wins || 0}승 · ${stats?.kos || 0}KO`;
}

function showRoomNotice(message, leaving = false) {
  clearTimeout(roomNoticeTimer);
  const target = state === 'waiting' ? waitingNotice : roomNotice;
  target.textContent = message;
  target.style.borderLeftColor = leaving ? '#ffca3a' : '#67f59b';
  target.style.background = leaving ? 'rgba(255,202,58,.08)' : 'rgba(103,245,155,.08)';
  target.classList.remove('hidden');
  roomNoticeTimer = setTimeout(() => target.classList.add('hidden'), 2400);
}

function mountWaitingUi() {
  for (const entry of waitingUiNodes) entry.mount.appendChild(entry.node);
}

function restoreMainUi() {
  for (const entry of waitingUiNodes) entry.marker.parentNode.insertBefore(entry.node, entry.marker.nextSibling);
}

function beginWarmup(snapshot) {
  if (!snapshot) return;
  state = 'waiting';
  snapshots = []; latestSnapshot = null; players = []; particles = []; trails = []; impactRings = []; blastMarks = []; localCue = null; ultimateCinematic = null; lastEvents.clear();
  receiveSnapshot(snapshot);
}

async function leaveRoomToMenu() {
  saveSession(null);
  releaseAllInputs();
  await emitAck('room:leave');
  state = 'menu'; room = null; myIndex = -1;
  players = []; snapshots = []; latestSnapshot = null; localCue = null; ultimateCinematic = null;
  particles = []; trails = []; impactRings = []; blastMarks = [];
  paused = false; hitboxes = false;
  closeTutorial(); setTrainingGuideOpen(false); resetTrainingInputHistory();
  trainingPanel.querySelectorAll('[data-training]').forEach(tool => {
    tool.classList.remove('active');
    if (tool.hasAttribute('aria-pressed')) tool.setAttribute('aria-pressed', 'false');
  });
  restoreMainUi();
  waitingRoom.classList.add('hidden'); trainingPanel.classList.add('hidden'); countdown.classList.add('hidden'); result.classList.add('hidden'); menu.classList.remove('hidden');
  lobbyActions.classList.remove('hidden'); queueBar.classList.add('hidden'); roomBar.classList.add('hidden');
  roomSettings.classList.add('hidden'); playerList.classList.add('hidden'); roomBrowser.classList.remove('hidden');
  renderFighters(); setError(''); refreshRoomDirectory();
}

function renderRoomDirectory(entries = []) {
  if (!entries.length) {
    roomBrowserList.innerHTML = '<p class="room-browser-empty">현재 참가 가능한 공개 방이 없습니다.</p>';
    return;
  }
  const modeNames = { stock: '목숨전', time: '시간전', team: '2대2 팀전' };
  roomBrowserList.innerHTML = entries.map(entry => {
    const stageDefinition = STAGES.find(item => item.id === entry.stageId) || STAGES[0];
    const full = entry.playerCount >= entry.capacity;
    const names = entry.players?.length ? entry.players.map(escapeHtml).join(', ') : escapeHtml(entry.owner);
    return `<article class="public-room-card" style="--room-color:${stageDefinition.color}">
      <div><strong>${escapeHtml(entry.owner)}의 방 · ${escapeHtml(entry.code)}</strong>
      <small>${modeNames[entry.mode] || entry.mode} · ${stageDefinition.name} · ${entry.playerCount}/${entry.capacity}명 · ${names}</small></div>
      <button type="button" data-public-room="${escapeHtml(entry.code)}" ${full ? 'disabled' : ''}>${full ? 'FULL' : '입장'}</button>
    </article>`;
  }).join('');
  roomBrowserList.querySelectorAll('[data-public-room]').forEach(button => button.addEventListener('click', () => {
    roomInput.value = button.dataset.publicRoom;
    joinRoom(false);
  }));
}

async function refreshRoomDirectory() {
  if (!socket.connected || room) return;
  const response = await emitAck('rooms:list');
  if (response?.ok) renderRoomDirectory(response.rooms || []);
}

socket.on('connect', initializeIdentity);
socket.on('connect_error', () => setError('게임 서버에 연결할 수 없습니다.'));
socket.on('room:state', next => {
  if (room?.code === next.code) {
    const previousIds = new Set(room.players.map(player => player.clientId));
    const nextIds = new Set(next.players.map(player => player.clientId));
    const joined = next.players.find(player => !previousIds.has(player.clientId));
    const left = room.players.find(player => !nextIds.has(player.clientId));
    if (joined && joined.clientId !== identity?.clientId) showRoomNotice(`${joined.nickname}님이 방에 들어왔습니다.`);
    else if (left && left.clientId !== identity?.clientId) showRoomNotice(`${left.nickname}님이 방에서 나갔습니다.`, true);
  }
  room = next; rules = next.rules; renderLobby();
});
socket.on('rooms:changed', () => { if (!room && state === 'menu') refreshRoomDirectory(); });
socket.on('queue:state', data => { queueBar.classList.remove('hidden'); document.querySelector('#queue-status').textContent = `${data.position}번째 · ${Math.floor(data.elapsedMs / 1000)}초`; });
socket.on('match:found', data => { myIndex = data.index; saveSession({ code: data.code, resumeToken: data.resumeToken }); queueBar.classList.add('hidden'); });
socket.on('match:start', payload => { room = payload.room; rules = room.rules; waitingRoom.classList.add('hidden'); beginMatch(payload.snapshot); });
socket.on('state:snapshot', receiveSnapshot);
socket.on('match:end', payload => { receiveSnapshot(payload.snapshot); showResult(payload.winner); });

function enterRoom(nextRoom, warmupSnapshot = null) {
  room = nextRoom; rules = room.rules; state = room.playing ? 'playing' : 'waiting';
  mountWaitingUi();
  menu.classList.add('hidden'); waitingRoom.classList.toggle('hidden', room.playing); result.classList.add('hidden'); trainingPanel.classList.add('hidden'); countdown.classList.add('hidden');
  lobbyActions.classList.add('hidden'); roomBrowser.classList.add('hidden'); queueBar.classList.add('hidden'); roomBar.classList.remove('hidden'); playerList.classList.remove('hidden');
  roomSettings.classList.toggle('hidden', room.quick);
  document.querySelector('#room-code').textContent = room.code;
  document.querySelector('#waiting-room-code').textContent = room.code;
  renderLobby(); setError('');
  if (warmupSnapshot && !room.playing) beginWarmup(warmupSnapshot);
}

function renderLobby() {
  if (!room) { renderFighters(); return; }
  const mine = room.players.find(player => player.clientId === identity?.clientId);
  if (mine) { myIndex = mine.index; selectedCharacter = mine.characterId; selectedPalette = mine.palette; }
  renderFighters();
  const owner = room.ownerClientId === identity?.clientId;
  document.querySelector('#lobby-status').textContent = `${room.players.length}/4명${owner ? ' · 방장' : ''}`;
  const slots = Array.from({ length: 4 }, (_, index) => room.players.find(player => player.index === index));
  playerList.innerHTML = `<div class="player-list-head"><strong>FIGHTERS CONNECTED</strong><span>${room.players.length} / 4</span></div>
    <div class="player-slots">${slots.map((player, index) => {
      if (!player) return `<span class="player-pill empty">P${index + 1} · OPEN SLOT</span>`;
      const fighter = FIGHTERS.find(item => item.id === player.characterId);
      const color = fighter?.palettes?.[player.palette % fighter.palettes.length] || fighter?.color || '#fff';
      const stateLabel = player.connected ? player.ready ? '✓ 준비 완료' : '● 준비 필요' : '↻ 재접속 중';
      const stateClass = !player.connected ? 'disconnected' : player.ready ? 'ready' : 'not-ready';
      return `<span class="player-pill ${stateClass}" style="--pill:${color}">
        <i class="slot-avatar">${fighter?.icon || '·'}</i>
        <span class="slot-copy"><b>P${player.index + 1} ${escapeHtml(player.nickname)}${player.clientId === identity?.clientId ? ' · YOU' : ''}</b><small>${fighter?.name || ''}${player.clientId === room.ownerClientId ? ' · HOST' : ''}</small></span>
        <em class="slot-state">${stateLabel}</em>
      </span>`;
    }).join('')}</div>`;
  document.querySelector('#mode-select').value = room.rules.mode;
  document.querySelector('#stage-select').value = room.rules.stageId;
  document.querySelector('#hazards-toggle').checked = room.rules.hazards;
  document.querySelector('#stocks-input').value = room.rules.stocks;
  document.querySelector('#time-input').value = Math.round(room.rules.timeSeconds / 60);
  roomSettings.querySelectorAll('select,input').forEach(control => control.disabled = !owner || room.playing);
  const minimumPlayers = room.rules.mode === 'training' ? 1 : 2;
  const enoughPlayers = room.players.length >= minimumPlayers;
  const allReady = enoughPlayers && room.players.every(player => player.ready);
  const readyCount = room.players.filter(player => player.ready).length;
  const remainingReady = room.players.length - readyCount;
  const readySummary = document.querySelector('#waiting-ready-summary');
  readySummary.classList.toggle('complete', allReady);
  readySummary.classList.toggle('attention', !mine?.ready);
  if (!enoughPlayers) {
    readySummary.innerHTML = `<b>${readyCount}/${room.players.length} 준비</b><small>상대를 기다리는 중 · 입장한 플레이어는 캐릭터 선택 후 준비해야 합니다</small>`;
  } else if (allReady) {
    readySummary.innerHTML = `<b>✓ 전원 준비 완료</b><small>${owner ? '본 경기 시작 버튼을 눌러주세요' : '방장이 경기를 시작할 때까지 기다려주세요'}</small>`;
  } else {
    readySummary.innerHTML = `<b>${readyCount}/${room.players.length} 준비 · ${remainingReady}명 남음</b><small>${mine?.ready ? '다른 플레이어의 준비를 기다리는 중입니다' : '캐릭터 선택을 마쳤다면 준비하기 버튼을 눌러주세요'}</small>`;
  }
  waitingReady.classList.toggle('active', !!mine?.ready);
  waitingReady.textContent = mine?.ready ? '✓ 준비 완료 · 취소' : '준비하기';
  waitingReady.disabled = !mine || room.playing;
  waitingStart.classList.toggle('hidden', !owner);
  waitingStart.disabled = room.playing || !allReady;
  waitingStart.textContent = allReady ? '본 경기 시작' : `시작 대기 (${readyCount}/${room.players.length})`;
  updateRuleBadges();
}

function renderFighters() {
  fighterGrid.innerHTML = FIGHTERS.map((fighter, index) => {
    const selected = fighter.id === selectedCharacter;
    return `<article class="fighter-card active ${selected ? 'selected' : ''}" style="--fighter:${fighter.color}" data-character="${fighter.id}">
      <span class="fighter-number">${String(index + 1).padStart(2, '0')}</span><div class="fighter-icon">${fighter.icon}</div>
      <h3>${fighter.name}</h3><p>${fighter.archetype}</p></article>`;
  }).join('');
  fighterGrid.querySelectorAll('[data-character]').forEach(card => card.addEventListener('click', () => selectCharacter(card.dataset.character)));
  renderPaletteSelector();
}
renderFighters();

async function selectCharacter(characterId) {
  selectedCharacter = characterId; localStorage.setItem('neon_character', characterId); renderFighters();
  if (room && (!room.playing || room.rules.mode === 'training')) {
    const response = await emitAck('player:select', { characterId, palette: selectedPalette, team: myIndex % 2, ready: false });
    if (!response?.ok) setError('캐릭터를 선택할 수 없습니다.');
    else if (room.rules.mode === 'training') {
      trainingFighterSelect.value = characterId;
      renderTrainingGuide(characterId);
    }
  }
}

function renderPaletteSelector() {
  const fighter = FIGHTERS.find(item => item.id === selectedCharacter) || FIGHTERS[0];
  paletteOptions.innerHTML = fighter.palettes.map((color, palette) => `<button class="palette-option ${palette === selectedPalette ? 'on' : ''}" style="--swatch:${color}" data-palette="${palette}" aria-label="색상 ${palette + 1}" aria-pressed="${palette === selectedPalette}"></button>`).join('');
  paletteOptions.querySelectorAll('[data-palette]').forEach(button => button.addEventListener('click', () => selectPalette(Number(button.dataset.palette))));
}

async function selectPalette(palette) {
  selectedPalette = Math.max(0, Math.min(3, palette));
  localStorage.setItem('neon_palette', selectedPalette);
  renderPaletteSelector();
  if (room && !room.playing) {
    const response = await emitAck('player:select', { characterId: selectedCharacter, palette: selectedPalette, team: myIndex % 2, ready: false });
    if (!response?.ok) setError('색상을 선택할 수 없습니다.');
  }
}

function updateRuleBadges() {
  const labels = document.querySelectorAll('.rules span');
  if (!labels.length) return;
  labels[0].innerHTML = `<b>${rules.mode === 'time' ? Math.round(rules.timeSeconds / 60) : rules.stocks}</b> ${rules.mode === 'time' ? 'MIN' : 'STOCK'}`;
  labels[1].innerHTML = '<b>2–4</b> PLAYERS';
  if (labels[2]) labels[2].classList.add('hidden');
}

document.querySelector('#create-button').addEventListener('click', async () => {
  const response = await emitAck('room:create', { characterId: selectedCharacter, palette: selectedPalette, rules: currentSettings() });
  if (!response?.ok) return setError(response?.error);
  myIndex = response.index; saveSession({ code: response.code, resumeToken: response.resumeToken }); enterRoom(response.room, response.snapshot);
});
document.querySelector('#quick-button').addEventListener('click', async () => {
  const response = await emitAck('queue:join', { characterId: selectedCharacter, palette: selectedPalette });
  if (response?.ok) { lobbyActions.classList.add('hidden'); roomBrowser.classList.add('hidden'); queueBar.classList.remove('hidden'); setError(''); }
});
document.querySelector('#practice-button').addEventListener('click', async () => {
  setError('');
  const response = await emitAck('room:create', {
    characterId: selectedCharacter,
    palette: selectedPalette,
    rules: { ...currentSettings(), mode: 'training', items: false, hazards: false }
  });
  if (!response?.ok) return setError(response?.error || '연습 모드를 시작할 수 없습니다.');
  myIndex = response.index;
  saveSession({ code: response.code, resumeToken: response.resumeToken });
  enterRoom(response.room, response.snapshot);
  const started = await emitAck('room:start');
  if (!started?.ok) setError(started?.error || '연습 모드를 시작할 수 없습니다.');
});
document.querySelector('#queue-cancel').addEventListener('click', async () => { await emitAck('queue:leave'); queueBar.classList.add('hidden'); lobbyActions.classList.remove('hidden'); roomBrowser.classList.remove('hidden'); refreshRoomDirectory(); });
document.querySelector('#room-browser-refresh').addEventListener('click', refreshRoomDirectory);
document.querySelector('#join-button').addEventListener('click', joinRoom);
roomInput.addEventListener('keydown', event => { if (event.key === 'Enter') joinRoom(); });
async function joinRoom() {
  const code = roomInput.value.trim().toUpperCase(); if (!code) return setError('방 코드를 입력하세요.');
  const response = await emitAck('room:join', { code, characterId: selectedCharacter, palette: selectedPalette });
  if (!response?.ok) return setError(response?.error);
  myIndex = response.index;
  saveSession({ code, resumeToken: response.resumeToken });
  enterRoom(response.room, response.room.playing ? null : response.snapshot); if (response.snapshot && response.room.playing) beginMatch(response.snapshot);
}
document.querySelector('#copy-button').addEventListener('click', async event => { await navigator.clipboard.writeText(room?.code || ''); event.currentTarget.textContent = '복사됨'; setTimeout(() => event.currentTarget.textContent = '코드 복사', 1000); });
document.querySelector('#waiting-copy').addEventListener('click', async event => { await navigator.clipboard.writeText(room?.code || ''); event.currentTarget.textContent = '복사됨'; setTimeout(() => event.currentTarget.textContent = '복사', 1000); });
document.querySelector('#waiting-leave').addEventListener('click', leaveRoomToMenu);
waitingReady.addEventListener('click', async () => {
  const mine = room?.players.find(player => player.clientId === identity?.clientId);
  if (!mine || room.playing) return;
  await emitAck('player:select', { characterId: selectedCharacter, palette: selectedPalette, team: mine.team, ready: !mine.ready });
});
waitingStart.addEventListener('click', async () => {
  if (!room || room.ownerClientId !== identity?.clientId) return;
  const response = await emitAck('room:start');
  if (!response?.ok) showRoomNotice(response?.error || '아직 경기를 시작할 수 없습니다.', true);
});
nicknameInput.addEventListener('change', initializeIdentity);

function currentSettings() {
  return {
    mode: document.querySelector('#mode-select').value,
    stageId: document.querySelector('#stage-select').value,
    stocks: Number(document.querySelector('#stocks-input').value),
    timeSeconds: Number(document.querySelector('#time-input').value) * 60,
    items: false,
    hazards: document.querySelector('#hazards-toggle').checked,
  };
}
roomSettings.querySelectorAll('select,input').forEach(control => control.addEventListener('change', async () => { const response = await emitAck('room:configure', currentSettings()); if (!response?.ok) setError(response?.error); }));

function beginMatch(snapshot) {
  state = 'playing'; menu.classList.add('hidden'); waitingRoom.classList.add('hidden'); result.classList.add('hidden');
  trainingPanel.classList.toggle('hidden', snapshot.rules.mode !== 'training');
  if (snapshot.rules.mode === 'training') {
    const trainingPlayer = snapshot.players.find(player => player.i === myIndex) || snapshot.players[0];
    const trainingBot = snapshot.players.find(player => String(player.clientId || '').startsWith('cpu:'));
    selectedCharacter = trainingPlayer?.characterId || selectedCharacter;
    trainingFighterSelect.value = selectedCharacter;
    if (trainingBot) trainingBotSelect.value = trainingBot.characterId;
    renderTrainingGuide(selectedCharacter);
    resetTrainingInputHistory();
    closeTutorial();
    setTrainingGuideOpen(false);
  }
  snapshots = []; latestSnapshot = null; players = []; particles = []; trails = []; impactRings = []; blastMarks = []; localCue = null; ultimateCinematic = null; lastEvents.clear();
  receiveSnapshot(snapshot);
}

function receiveSnapshot(snapshot) {
  if (!snapshot) return;
  if (myIndex >= 0 && snapshot.ackSeq) inputSeq = Math.max(inputSeq, Number(snapshot.ackSeq[myIndex]) || 0);
  const buffered = { receivedAt: performance.now(), data: snapshot };
  snapshots.push(buffered); if (snapshots.length > 30) snapshots.shift(); latestSnapshot = buffered;
  rules = snapshot.rules; stage = STAGES.find(item => item.id === snapshot.stage.id) || STAGES[0]; remainingTicks = snapshot.remainingTicks;
  if (snapshot.rules.mode === 'training') {
    const trainingBot = snapshot.players.find(player => String(player.clientId || '').startsWith('cpu:'));
    if (trainingBot && trainingBotSelect.value !== trainingBot.characterId) trainingBotSelect.value = trainingBot.characterId;
  }
  processEvents(snapshot.events || []);
  if (snapshot.phase === 'countdown') { countdown.textContent = Math.max(1, Math.ceil(snapshot.countdown / 60)); countdown.classList.remove('hidden'); }
  else countdown.classList.add('hidden');
}

function processEvents(events) {
  for (const event of events) {
    if (lastEvents.has(event.id)) continue; lastEvents.add(event.id); if (lastEvents.size > 150) lastEvents.delete(lastEvents.values().next().value);
    updateTutorialEvent(event);
    if (event.type === 'hit' || event.type === 'shield-hit' || event.type === 'parry' || event.type === 'pummel') {
      const pummel = event.type === 'pummel';
      const player = players.find(item => item.i === (pummel ? event.target : event.player));
      const attacker = players.find(item => item.i === (pummel ? event.player : event.attacker));
      const hitX = event.x ?? player?.x, hitY = event.y ?? player?.y;
      const sweet = event.quality === 'sweet', critical = event.type === 'hit' && event.critical, ultimate = !!event.ultimate;
      const impactColor = event.type === 'parry' ? '#fff36b' : event.type === 'shield-hit' ? '#79efff' : event.color || '#ffffff';
      const impactStrength = pummel ? .42 : clamp((event.launchSpeed || (event.power || 4) * 55) / 500, .4, 1.55);
      const impactAngle = Number.isFinite(event.launchAngle)
        ? event.launchAngle
        : Math.atan2((player?.y || 0) - (attacker?.y || 0), (player?.x || 0) - (attacker?.x || 0));
      if (Number.isFinite(hitX) && Number.isFinite(hitY)) {
        const particleCount = ultimate ? 44 : event.type === 'parry' ? 28 : critical ? 30 : sweet ? 22 : event.type === 'shield-hit' ? 13 : pummel ? 9 : 16;
        const particleSpeed = ultimate ? 520 : 145 + impactStrength * (critical ? 215 : 135);
        burst(hitX, hitY, impactColor, particleCount, particleSpeed, impactAngle, ultimate ? 2.05 : critical ? 1.8 : sweet ? 1.45 : pummel ? .88 : 1.22);
        if (ultimate) burst(hitX, hitY, '#ffffff', 24, 370, impactAngle + Math.PI, 1.45);
        if (event.type === 'parry' || event.type === 'shield-hit') {
          const ringDuration = event.type === 'parry' ? .32 : .23;
          impactRings.push({
            x: hitX, y: hitY, angle: impactAngle,
            radius: 22 + impactStrength * 18,
            color: impactColor,
            kind: 'pulse',
            life: ringDuration, duration: ringDuration
          });
          if (impactRings.length > 10) impactRings.splice(0, impactRings.length - 10);
        }
      }
      if (player) player.flashUntil = performance.now() + (event.type === 'parry' ? 190 : critical ? 240 : sweet ? 180 : pummel ? 100 : 145);
      screenShake = Math.max(screenShake, ultimate ? 22 : event.type === 'parry' ? 12 : critical ? 17 : 3 + impactStrength * 4.5 + (sweet ? 2 : 0));
      cameraPunch = Math.max(cameraPunch, ultimate ? .145 : event.type === 'parry' ? .075 : critical ? .12 : Math.min(.078, .012 + impactStrength * .045));
      if (critical || ultimate) criticalFlash = 1;
      beep(ultimate ? 48 : event.type === 'parry' ? 620 : critical ? 58 : pummel ? 155 : 110, ultimate ? .22 : critical ? .15 : pummel ? .035 : .06, event.type === 'parry' ? 'square' : 'sawtooth');
    }
    if (event.type === 'counter') {
      const defender = players.find(item => item.i === event.player);
      const attacker = players.find(item => item.i === event.attacker);
      const x = event.x ?? (defender && attacker ? (defender.x + attacker.x) / 2 : defender?.x);
      const y = event.y ?? (defender && attacker ? (defender.y + attacker.y) / 2 : defender?.y);
      const angle = event.direction < 0 ? Math.PI : 0;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        burst(x, y, '#fff4dc', 26, 330, angle, 1.6);
        burst(x, y, '#ff4d6d', 14, 230, angle, 1.25);
      }
      if (defender) defender.flashUntil = performance.now() + 260;
      screenShake = Math.max(screenShake, 14);
      cameraPunch = Math.max(cameraPunch, .095);
      criticalFlash = Math.max(criticalFlash, .7);
      beep(72, .12, 'square');
    }
    if (event.type === 'ultimate-start') {
      const player = players.find(item => item.i === event.player);
      if (player) player.flashUntil = performance.now() + 360;
      ultimateCinematic = {
        player: event.player, fighter: event.fighter,
        color: player ? (FIGHTERS.find(item => item.id === player.characterId)?.palettes?.[player.palette % 4] || '#ffffff') : '#ffffff',
        started: performance.now(), duration: 820
      };
      screenShake = Math.max(screenShake, 9);
      cameraPunch = Math.max(cameraPunch, .065);
      beep(72, .2, 'square');
    }
    if (event.type === 'ultimate-cancel' && ultimateCinematic?.player === event.player) ultimateCinematic.duration = Math.min(ultimateCinematic.duration, performance.now() - ultimateCinematic.started + 120);
    if (event.type === 'ko') { screenShake = 18; cameraPunch = .11; beep(60, .2, 'sawtooth'); }
    if (event.type === 'land') { screenShake = Math.max(screenShake, 1); beep(72, .025, 'sine'); }
    if (event.type === 'tech') beep(720, .055, 'square');
    if (event.type === 'knockdown') { screenShake = Math.max(screenShake, 3); beep(85, .04, 'sine'); }
    if (event.type === 'chain') { screenShake = Math.max(screenShake, 4); beep(760, .045, 'square'); }
    if (event.type === 'projectile-clash') {
      if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
        burst(event.x, event.y, event.firstColor || '#ffffff', 12, 185, Math.PI, 1.05);
        burst(event.x, event.y, event.secondColor || '#ffffff', 12, 185, 0, 1.05);
        impactRings.push({ x:event.x, y:event.y, radius:24, color:'#ffffff', kind:'pulse', life:.18, duration:.18 });
        if (impactRings.length > 10) impactRings.splice(0, impactRings.length - 10);
      }
      screenShake = Math.max(screenShake, event.winner == null ? 4 : 2.5);
      beep(event.winner == null ? 310 : 240, .055, 'square');
    }
    if (event.type === 'explosion') {
      screenShake = Math.max(screenShake, 11); cameraPunch = Math.max(cameraPunch, .07);
      if (Number.isFinite(event.x) && Number.isFinite(event.y) && Number.isFinite(event.radius)) blastMarks.push({ x:event.x, y:event.y, radius:event.radius, color:event.color || '#ffcf6b', life:.2, duration:.2 });
      beep(75, .13, 'sawtooth');
    }
  }
}

function copyState(target, source) {
  for (const key of ['clientId','nickname','vx','vy','face','grounded','jumps','doubleJumpSerial','damage','stocks','score','shield','shielding','parryFrames','shieldStun','shieldDropLag','invincible','dodgeFrames','dodgeTotalFrames','dodgeElapsed','dodgeStartVx','dodgeStartVy','dodgeInitialVx','dodgeInitialVy','dodgeWindupFrames','dodgeNeutral','airDodgeAvailable','recoveryAvailable','ledge','ledgeGrabs','grabbedBy','grabbing','grabFrames','grabEscape','grabPummelCooldown','comboCount','jabStep','jabTimer','actionName','actionFrame','actionPhase','actionVariant','actionMotion','actionTiming','phaseProgress','actionHitbox','strikePoints','hurtboxes','chargeFrames','chargeScale','projectileCooldown','projectileCooldownMax','ultimateMeter','stun','hitstop','landingLag','tumbling','tumbleRecoverFrames','techWindow','knockdownFrames','criticalFlightFrames','dodgeFatigue','dashFrames','jumpSquatFrames','eliminated','respawn','ackSeq','heldItem','team','characterId','palette','width','height']) target[key] = source[key];
}
function lerp(a, b, amount) { return a + (b - a) * amount; }
function actionPhaseFrames(player, phase = player.actionPhase, actionName = player.actionName) {
  const fighter = FIGHTERS.find(item => item.id === player.characterId) || FIGHTERS[0];
  const move = fighter.moves[actionName];
  const timing = player.actionTiming || move;
  if (!timing) return 1;
  if (phase === 'startup') return Math.max(1, timing.startup);
  if (phase === 'active') return Math.max(1, timing.active);
  if (phase === 'recovery') return Math.max(1, timing.recovery);
  if (phase === 'charge') return 90;
  return 1;
}
function extrapolatedPhaseProgress(player, elapsed) {
  const progress = clamp(Number(player.phaseProgress) || 0, 0, 1);
  if (!player.actionPhase || player.hitstop > 0) return progress;
  return clamp(progress + elapsed * 60 / actionPhaseFrames(player), 0, 1);
}
function renderNetworkState(dt, now) {
  if (!latestSnapshot) return;
  const renderAt = now - adaptiveDelay;
  while (snapshots.length > 2 && snapshots[1].receivedAt <= renderAt) snapshots.shift();
  const older = snapshots[0] || latestSnapshot, newer = snapshots[1] || older;
  const mix = clamp((renderAt - older.receivedAt) / Math.max(1, newer.receivedAt - older.receivedAt), 0, 1);
  platforms = newer.data.platforms || [];
  entities = newer.data.entities || []; items = newer.data.items || [];
  const activeClientIds = new Set(newer.data.players.map(player => player.clientId));
  players = players.filter(player => activeClientIds.has(player.clientId));
  for (const source of newer.data.players) {
    let display = players.find(item => item.clientId === source.clientId);
    if (!display) { display = { ...source, x: source.x, y: source.y }; players.push(display); }
    const from = older.data.players.find(item => item.i === source.i) || source;
    if (source.i === myIndex) {
      const localSource = latestSnapshot.data.players.find(item => item.i === source.i) || source;
      const elapsed = Math.min(.1, Math.max(0, (now - latestSnapshot.receivedAt) / 1000));
      const local = readInput(); const fighter = FIGHTERS.find(item => item.id === localSource.characterId);
      const actionName = localSource.actionName || '';
      const aerialDrift = /^air(Neutral|Forward|Back|Up|Down)$/.test(actionName);
      const locked = !aerialDrift && /ground|air|special|item|grab|throw|landing|hit|tech|roll|dodge|knockdown|getup|dashAttack|jumpSquat/.test(actionName);
      const groundPredictionSpeed = localSource.dashFrames > 0 ? 470 : 290;
      const targetVx = locked ? localSource.vx : local.horizontal * (localSource.grounded ? groundPredictionSpeed * fighter.speed : 345 * fighter.air);
      const predictedVx = lerp(localSource.vx, targetVx, clamp(elapsed * (localSource.grounded ? 25 : 14), 0, 1));
      const predictedX = localSource.x + (localSource.vx + predictedVx) * .5 * elapsed;
      const predictedY = localSource.y + (localSource.grounded ? 0 : localSource.vy * elapsed + 720 * elapsed * elapsed);
      const correction = Math.hypot(predictedX - display.x, predictedY - display.y) > 90 ? 1 : Math.min(1, dt * 30);
      display.x = lerp(display.x, predictedX, correction); display.y = lerp(display.y, predictedY, correction);
      copyState(display, localSource);
      display.actionFrame = (Number(localSource.actionFrame) || 0) + (localSource.hitstop > 0 ? 0 : elapsed * 60);
      display.phaseProgress = extrapolatedPhaseProgress(localSource, elapsed);
      if (localCue && localSource.ackSeq >= localCue.seq) localCue = null;
    } else {
      display.x = lerp(from.x, source.x, mix); display.y = lerp(from.y, source.y, mix);
      copyState(display, mix < .5 ? from : source);
      if (from.actionName === source.actionName && from.actionPhase === source.actionPhase) {
        display.actionFrame = lerp(Number(from.actionFrame) || 0, Number(source.actionFrame) || 0, mix);
        display.phaseProgress = lerp(Number(from.phaseProgress) || 0, Number(source.phaseProgress) || 0, mix);
      }
    }
  }
}

function readInput() {
  const gp = navigator.getGamepads?.()[0];
  const horizontal = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) || (Math.abs(gp?.axes?.[0] || 0) > .2 ? gp.axes[0] : 0);
  const vertical = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) || (Math.abs(gp?.axes?.[1] || 0) > .2 ? gp.axes[1] : 0);
  let buttons = 0;
  if (horizontal < -.2) buttons |= BUTTONS.LEFT; if (horizontal > .2) buttons |= BUTTONS.RIGHT;
  if (vertical < -.2 || keys.has('Space') || gp?.buttons?.[0]?.pressed) buttons |= BUTTONS.UP; if (vertical > .2) buttons |= BUTTONS.DOWN;
  if (keys.has('KeyZ') || keys.has('KeyF') || gp?.buttons?.[2]?.pressed) buttons |= BUTTONS.ATTACK;
  if (keys.has('KeyX') || keys.has('KeyG') || gp?.buttons?.[1]?.pressed) buttons |= BUTTONS.SPECIAL;
  if (keys.has('KeyC') || keys.has('ShiftLeft') || keys.has('ShiftRight') || gp?.buttons?.[4]?.pressed || gp?.buttons?.[5]?.pressed) buttons |= BUTTONS.SHIELD;
  if (keys.has('KeyV') || keys.has('KeyE') || gp?.buttons?.[3]?.pressed) buttons |= BUTTONS.GRAB;
  return { buttons, horizontal: clamp(horizontal, -1, 1), vertical: clamp(vertical, -1, 1) };
}
function sendInput(now, force = false) {
  if (!['playing', 'waiting'].includes(state) || !force && now - lastInputSent < 33) return;
  const input = readInput(); recordTrainingInput(input); updateTutorialInput(input); socket.emit('input:frame', { seq: ++inputSeq, clientTime: performance.now(), ...input }); lastInputSent = now;
}

setInterval(() => {
  if (!socket.connected) return;
  const sent = performance.now(); socket.emit('latency:ping', sent, response => {
    if (!response || !Number.isFinite(response.clientTime)) return;
    const sample = performance.now() - response.clientTime; pingSamples.push(sample); if (pingSamples.length > 9) pingSamples.shift();
    ping = [...pingSamples].sort((a,b) => a-b)[Math.floor(pingSamples.length / 2)] || 0; adaptiveDelay = clamp(60 + ping * .45, 60, 140);
  });
}, 1500);

function updateCamera(dt) {
  const visible = players.filter(player => !player.eliminated && player.respawn === 0 && player.x > -370 && player.x < WORLD_W + 370 && player.y > -310 && player.y < WORLD_H + 270);
  if (visible.length) {
    const xs = visible.map(player => player.x), ys = visible.map(player => player.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const targetX = clamp((minX + maxX) / 2, 260, 1020);
    const targetY = clamp((minY + maxY) / 2 - 35, 220, 475);
    const spanX = Math.max(430, maxX - minX + 380), spanY = Math.max(330, maxY - minY + 300);
    const targetZoom = clamp(Math.min(1120 / spanX, 590 / spanY), .68, visible.length <= 2 ? 1.24 : 1.12);
    const follow = 1 - Math.exp(-dt * 5.5);
    camera.x = lerp(camera.x, targetX, follow); camera.y = lerp(camera.y, targetY, follow);
    camera.zoom = lerp(camera.zoom, targetZoom, 1 - Math.exp(-dt * 3.5));
  }
  screenShake = Math.max(0, screenShake - dt * 42);
  cameraPunch = Math.max(0, cameraPunch - dt * .35);
  criticalFlash = Math.max(0, criticalFlash - dt * 7);
}

function draw(dt) {
  updateCamera(dt);
  ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = '#080a12'; ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.setTransform(dpr*viewScale,0,0,dpr*viewScale,viewOffsetX*dpr,viewOffsetY*dpr);
  const shakeX = (Math.random() - .5) * screenShake, shakeY = (Math.random() - .5) * screenShake;
  ctx.translate(WORLD_W / 2 + shakeX, WORLD_H / 2 + shakeY);
  ctx.scale(camera.zoom + cameraPunch, camera.zoom + cameraPunch);
  ctx.translate(-camera.x, -camera.y);
  drawBackground(); drawBlastZone(); drawPlatforms(); drawEntities();
  drawTrails();
  for (const player of players) drawPlayer(player, dt);
  drawBlastMarks();
  drawParticles();
  drawImpactRings();
  ctx.setTransform(dpr*viewScale,0,0,dpr*viewScale,viewOffsetX*dpr,viewOffsetY*dpr);
  drawCameraIndicators();
  if (criticalFlash > 0) {
    ctx.save();
    ctx.globalAlpha = criticalFlash * .14;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.globalAlpha = criticalFlash * .1;
    ctx.fillStyle = '#ff335f';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);
    ctx.restore();
  }
  drawUltimateCinematic();
  if (state === 'playing' || state === 'waiting') drawBattleHUD();
}

function drawUltimateCinematic() {
  if (!ultimateCinematic) return;
  const age = performance.now() - ultimateCinematic.started;
  if (age >= ultimateCinematic.duration) { ultimateCinematic = null; return; }
  const intro = clamp(age / 130, 0, 1), outro = clamp((ultimateCinematic.duration - age) / 180, 0, 1);
  const alpha = Math.min(intro, outro), slide = (1 - intro) * 150;
  const fighter = FIGHTERS.find(item => item.id === ultimateCinematic.fighter) || FIGHTERS[0];
  const [english, korean] = ULTIMATE_TITLES[fighter.id] || ['ULTIMATE', '궁극기'];
  ctx.save();
  ctx.globalAlpha = alpha * .24;
  ctx.fillStyle = '#02040b'; ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  ctx.globalAlpha = alpha * .94;
  ctx.fillStyle = 'rgba(4,7,16,.92)';
  ctx.beginPath();ctx.moveTo(-40,54);ctx.lineTo(820-slide,54);ctx.lineTo(760-slide,132);ctx.lineTo(-40,132);ctx.closePath();ctx.fill();
  ctx.fillStyle = ultimateCinematic.color;ctx.fillRect(0,54,12,78);
  ctx.fillRect(26,112,620-slide,4);
  ctx.globalAlpha = alpha * .22;ctx.fillStyle = ultimateCinematic.color;
  for(let index=0;index<7;index++)ctx.fillRect(40+index*92-slide*.3,63,54,2);
  ctx.globalAlpha = alpha;
  ctx.textAlign='left';ctx.fillStyle='#ffffff';ctx.font='900 31px Inter';ctx.fillText(english,42-slide*.18,92);
  ctx.fillStyle=ultimateCinematic.color;ctx.font='900 13px Inter';ctx.fillText(`${fighter.name}  //  ${korean}`,44-slide*.12,117);
  ctx.textAlign='right';ctx.globalAlpha=alpha*.62;ctx.fillStyle='#ffffff';ctx.font='900 11px Inter';ctx.fillText('Z + X',742-slide,118);
  ctx.restore();
}

function drawBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  if (stage.id === 'sky-rail') { gradient.addColorStop(0, '#18254b'); gradient.addColorStop(.58, '#55365f'); gradient.addColorStop(1, '#101426'); }
  else if (stage.id === 'reactor-core') { gradient.addColorStop(0, '#210f2d'); gradient.addColorStop(.58, '#291529'); gradient.addColorStop(1, '#080a12'); }
  else { gradient.addColorStop(0, '#08182d'); gradient.addColorStop(.58, '#17152e'); gradient.addColorStop(1, '#060810'); }
  ctx.fillStyle = gradient; ctx.fillRect(-430, -330, WORLD_W + 860, WORLD_H + 620);

  if (stage.id === 'neon-deck') {
    ctx.save(); ctx.translate(640, 285);
    const sun = ctx.createRadialGradient(0, 0, 10, 0, 0, 180); sun.addColorStop(0, 'rgba(38,217,255,.18)'); sun.addColorStop(1, 'rgba(38,217,255,0)');
    ctx.fillStyle = sun; ctx.beginPath(); ctx.arc(0, 0, 180, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 7; i++) { ctx.strokeStyle = `rgba(38,217,255,${.13 - i * .012})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 58 + i * 29, 0, Math.PI * 2); ctx.stroke(); }
    ctx.restore();
    for (let i = 0; i < 18; i++) { const w = 36 + i % 4 * 13, h = 70 + i % 6 * 22, x = i * 78 - 60; ctx.fillStyle = i % 2 ? '#0b1730' : '#101b38'; ctx.fillRect(x, 500 - h, w, h); ctx.fillStyle = 'rgba(38,217,255,.24)'; for (let y = 446 - h; y < 485; y += 18) ctx.fillRect(x + 8, y, 4, 8); }
  } else if (stage.id === 'sky-rail') {
    for (let i = 0; i < 9; i++) { const x = 80 + i * 155, y = 150 + i % 3 * 85; ctx.fillStyle = 'rgba(255,255,255,.055)'; ctx.beginPath(); ctx.ellipse(x, y, 105, 26, -.12, 0, Math.PI * 2); ctx.fill(); }
    ctx.strokeStyle = 'rgba(255,202,58,.13)'; ctx.lineWidth = 3; for (let i = -3; i < 6; i++) { ctx.beginPath(); ctx.moveTo(-200, 520 + i * 28); ctx.lineTo(1480, 360 + i * 18); ctx.stroke(); }
  } else {
    ctx.save(); ctx.translate(640, 485); ctx.shadowBlur = 45; ctx.shadowColor = '#ff335f';
    for (let i = 5; i > 0; i--) { ctx.strokeStyle = `rgba(255,51,95,${.05 + i * .035})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 40 + i * 32, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#ff335f'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 12; for (const x of [120, 1160]) { ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x + (x < 640 ? 180 : -180), 570); ctx.stroke(); }
  }
  const horizon = 520; ctx.strokeStyle = 'rgba(112,190,255,.07)'; ctx.lineWidth = 1;
  for (let y = horizon; y < 760; y += 24) { ctx.beginPath(); ctx.moveTo(-220, y); ctx.lineTo(1500, y); ctx.stroke(); }
  for (let x = -200; x <= 1480; x += 80) { ctx.beginPath(); ctx.moveTo(640, horizon); ctx.lineTo(x, 760); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,.014)'; for (let y = -100; y < 820; y += 6) ctx.fillRect(-240, y, 1760, 1);
}
function drawBlastZone(){ctx.save();ctx.strokeStyle='rgba(255,51,95,.32)';ctx.lineWidth=5;ctx.shadowBlur=18;ctx.shadowColor='#ff335f';ctx.setLineDash([14,18]);ctx.strokeRect(-360,-300,WORLD_W+720,WORLD_H+560);ctx.setLineDash([]);ctx.restore();}
function drawPlatforms(){for(const p of platforms){ctx.save();ctx.shadowBlur=p.passThrough?10:22;ctx.shadowColor=stage.color;const top=ctx.createLinearGradient(p.x,p.y,p.x+p.w,p.y);top.addColorStop(0,stage.color);top.addColorStop(.18,'#f3fdff');top.addColorStop(.82,'#f3fdff');top.addColorStop(1,stage.color);ctx.fillStyle=top;ctx.fillRect(p.x,p.y,p.w,p.passThrough?6:9);ctx.shadowBlur=0;if(p.passThrough){ctx.fillStyle='rgba(255,255,255,.13)';for(let x=p.x+8;x<p.x+p.w-8;x+=22)ctx.fillRect(x,p.y+8,12,2);}else{const g=ctx.createLinearGradient(0,p.y,0,p.y+78);g.addColorStop(0,'rgba(44,54,82,.98)');g.addColorStop(.55,'rgba(17,22,40,.92)');g.addColorStop(1,'rgba(7,9,18,.05)');ctx.fillStyle=g;ctx.beginPath();ctx.moveTo(p.x,p.y+8);ctx.lineTo(p.x+p.w,p.y+8);ctx.lineTo(p.x+p.w-62,p.y+72);ctx.lineTo(p.x+62,p.y+72);ctx.closePath();ctx.fill();ctx.strokeStyle='rgba(255,255,255,.09)';ctx.lineWidth=2;for(let x=p.x+80;x<p.x+p.w-60;x+=95){ctx.beginPath();ctx.moveTo(x,p.y+13);ctx.lineTo(x+25,p.y+48);ctx.stroke();}}ctx.restore();}}
function itemShortName(item) {
  return ({
    'pulse-hammer': 'HAMMER',
    'rail-blaster': 'BLASTER',
    'gravity-mine': 'MINE',
    'shield-battery': 'BATTERY',
    'jump-coil': 'JUMP COIL',
    'warp-bomb': 'BOMB'
  })[item?.id] || item?.name || 'ITEM';
}
function drawItemGlyph(def) {
  ctx.fillStyle = def.color;
  ctx.strokeStyle = '#f7fbff';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (def.kind === 'melee') {
    ctx.save(); ctx.rotate(-.55);
    ctx.fillRect(-3, -3, 6, 25); ctx.fillRect(-14, -13, 28, 12);
    ctx.strokeRect(-14, -13, 28, 12); ctx.restore();
  } else if (def.kind === 'blaster') {
    ctx.fillRect(-17, -8, 27, 13); ctx.fillRect(7, -5, 17, 6);
    ctx.beginPath(); ctx.moveTo(-5, 5); ctx.lineTo(1, 17); ctx.lineTo(10, 5); ctx.closePath(); ctx.fill(); ctx.stroke();
  } else if (def.kind === 'mine') {
    ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(18, 13); ctx.lineTo(-18, 13); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(-3, -3, 6, 8);
  } else if (def.kind === 'heal-shield') {
    ctx.fillRect(-15, -18, 30, 36); ctx.strokeRect(-15, -18, 30, 36);
    ctx.fillStyle = '#071018'; ctx.fillRect(-3, -11, 6, 22); ctx.fillRect(-10, -3, 20, 6);
  } else if (def.kind === 'jump') {
    ctx.beginPath(); ctx.moveTo(-15, 14); ctx.lineTo(14, 14); ctx.lineTo(-11, 5); ctx.lineTo(11, -4); ctx.lineTo(-8, -13); ctx.lineTo(8, -19); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.arc(-2, 2, 16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, -12); ctx.lineTo(17, -22); ctx.lineTo(23, -16); ctx.stroke();
  }
}
function drawItems() {
  for (const item of items) {
    const def = item.definition;
    if (!def) continue;
    const bob = Math.sin(performance.now() / 220 + item.x) * 3;
    ctx.save();
    ctx.translate(item.x, item.y + bob);
    ctx.shadowBlur = 18; ctx.shadowColor = def.color;
    drawItemGlyph(def);
    ctx.shadowBlur = 0;
    const label = def.name;
    ctx.font = '900 10px Inter'; ctx.textAlign = 'center';
    const width = Math.max(84, ctx.measureText(label).width + 18);
    ctx.fillStyle = 'rgba(5,8,18,.9)'; ctx.fillRect(-width / 2, 25, width, 29);
    ctx.fillStyle = def.color; ctx.fillText(label, 0, 37);
    ctx.fillStyle = '#dce5f7'; ctx.font = '800 8px Inter'; ctx.fillText('V  줍기', 0, 49);
    ctx.restore();
  }
}
function drawEntities(){
  const now=performance.now();
  for(const e of entities){
    const color=e.color||'#fff',spin=now/180*(e.returning?-1:1);ctx.save();ctx.translate(e.x,e.y);ctx.shadowBlur=18;ctx.shadowColor=color;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineCap='round';
    if(e.kind==='ultimateVolt'){
      const armed=e.arm<=0,r=e.radius||86,flicker=.82+Math.sin(now*.09)*.18;ctx.globalAlpha=armed?.98:.34*flicker;
      if(armed){
        for(let bolt=-2;bolt<=2;bolt++){ctx.strokeStyle=bolt===0?'#ffffff':color;ctx.lineWidth=bolt===0?13:5;ctx.beginPath();ctx.moveTo(bolt*17,-300);ctx.lineTo(bolt*7-12,-220);ctx.lineTo(bolt*13+9,-142);ctx.lineTo(bolt*4-7,-62);ctx.lineTo(bolt*11,38);ctx.stroke();}
        ctx.globalAlpha=.82;ctx.lineWidth=4;for(let spark=-3;spark<=3;spark++){ctx.beginPath();ctx.moveTo(0,35);ctx.lineTo(spark*28,52+Math.abs(spark)*7);ctx.stroke();}
      }else{
        ctx.setLineDash([13,11]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-r*.48,-245);ctx.lineTo(-r*.48,47);ctx.moveTo(r*.48,-245);ctx.lineTo(r*.48,47);ctx.stroke();ctx.setLineDash([]);
        const bracket=24;ctx.lineWidth=4;for(const sx of [-1,1])for(const sy of [-1,1]){ctx.beginPath();ctx.moveTo(sx*r,34+sy*r*.22);ctx.lineTo(sx*(r-bracket),34+sy*r*.22);ctx.moveTo(sx*r,34+sy*r*.22);ctx.lineTo(sx*r,34+sy*(r*.22-bracket*.35));ctx.stroke();}
        ctx.globalAlpha=.7*flicker;ctx.fillStyle='#ffffff';ctx.fillRect(-3,-190,6,226);
      }
    }else if(e.kind==='ultimateNova'){
      const armed=e.arm<=0,r=e.radius||165,collapse=armed?.12:clamp((e.arm||0)/24,0,1);ctx.globalAlpha=armed?.96:.42;ctx.lineWidth=armed?6:2.5;
      for(let spoke=0;spoke<12;spoke++){const a=spoke*Math.PI/6+now*.00018,outer=r*(.78+.15*Math.sin(now*.002+spoke)),inner=18+collapse*38;ctx.beginPath();ctx.moveTo(Math.cos(a)*outer,Math.sin(a)*outer);ctx.lineTo(Math.cos(a+.11)*inner,Math.sin(a+.11)*inner);ctx.stroke();}
      for(let mote=0;mote<18;mote++){const a=mote*2.399+now*.00012,travel=((now*.00055+mote*.071)%1),distance=18+(r-18)*(1-travel);ctx.globalAlpha=(armed?.9:.55)*(1-travel*.45);ctx.fillStyle=mote%4===0?'#ffffff':color;ctx.fillRect(Math.cos(a)*distance-2,Math.sin(a)*distance-2,4,4);}
      ctx.rotate(now*.0012);ctx.globalAlpha=armed?1:.75;ctx.fillStyle=armed?'#ffffff':'#05030d';ctx.strokeStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,-24);ctx.lineTo(24,0);ctx.lineTo(0,24);ctx.lineTo(-24,0);ctx.closePath();ctx.fill();ctx.stroke();
    }else if(e.kind==='ultimateBolt'){
      const r=e.radius||42;ctx.rotate(Math.atan2(e.vy||0,e.vx||1));
      for(let streak=0;streak<5;streak++){ctx.globalAlpha=.16+streak*.11;ctx.strokeStyle=streak===4?'#ffffff':color;ctx.lineWidth=2+streak*2;ctx.beginPath();ctx.moveTo(-r*(4.8-streak*.55),(streak-2)*8);ctx.lineTo(r*.42,(streak-2)*3);ctx.stroke();}
      ctx.rotate(spin*1.8);ctx.globalAlpha=.9;for(let blade=0;blade<4;blade++){ctx.rotate(Math.PI/2);ctx.fillStyle=blade%2?'#ffffff':color;ctx.beginPath();ctx.moveTo(8,-7);ctx.lineTo(r*1.18,0);ctx.lineTo(8,7);ctx.closePath();ctx.fill();}
      ctx.fillStyle='#07101a';ctx.fillRect(-9,-9,18,18);
    }else if(e.kind==='gravity'){
      const pulse=.92+Math.sin(now/140)*.08;ctx.globalAlpha=.12;ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,0,e.radius*pulse,0,Math.PI*2);ctx.fill();ctx.globalAlpha=.75;ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.stroke();for(let i=0;i<3;i++){ctx.globalAlpha=.3;ctx.beginPath();ctx.arc(0,0,35+i*25+Math.sin(now/180+i)*7,0,Math.PI*2);ctx.stroke();}
    }else if(e.kind==='static'){
      ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-16,10);ctx.lineTo(-8,-8);ctx.lineTo(0,8);ctx.lineTo(9,-11);ctx.lineTo(17,9);ctx.stroke();ctx.globalAlpha=e.arm>0?.24:.72;
      for(let i=0;i<8;i++){const a=i*Math.PI/4+Math.sin(now/260)*.04,r=(e.radius||78);ctx.beginPath();ctx.moveTo(Math.cos(a)*r*.82,Math.sin(a)*r*.82);ctx.lineTo(Math.cos(a-.08)*r,Math.sin(a-.08)*r);ctx.lineTo(Math.cos(a+.05)*r*.9,Math.sin(a+.05)*r*.9);ctx.stroke();}
    }else if(e.kind==='core'){
      ctx.rotate(spin*.35);ctx.globalAlpha=.25;ctx.beginPath();ctx.arc(0,0,e.radius||46,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;ctx.fillRect(-15,-15,30,30);ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.strokeRect(-21,-21,42,42);
    }else if(e.kind==='boomerang'){
      const r=e.radius||32;ctx.rotate(spin);ctx.lineWidth=Math.max(7,r*.28);ctx.beginPath();ctx.arc(0,0,r*.58,-1.15,1.15);ctx.stroke();ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,r,-1.05,1.05);ctx.stroke();
    }else if(e.kind==='star'){
      const outer=e.radius||27;ctx.rotate(spin*.55);ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?outer*.42:outer;i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();
    }else if(e.kind==='arc'){
      const r=e.radius||23;ctx.lineWidth=6;ctx.beginPath();ctx.moveTo(-r,-r*.34);ctx.lineTo(-r*.36,r*.22);ctx.lineTo(r*.04,-r*.3);ctx.lineTo(r*.43,r*.3);ctx.lineTo(r,-r*.22);ctx.stroke();
    }else{ctx.beginPath();ctx.arc(0,0,e.type==='trap'?12:8,0,Math.PI*2);ctx.fill();}
    if(hitboxes){
      const collisionRadius=e.radius||34;
      ctx.save();
      ctx.globalAlpha=1;ctx.shadowBlur=0;ctx.lineWidth=2.5;
      ctx.strokeStyle=e.arm>0?'#ffd35c':'#ff426a';
      ctx.fillStyle=e.arm>0?'rgba(255,211,92,.07)':'rgba(255,66,106,.11)';
      ctx.setLineDash(e.arm>0?[7,6]:[]);
      ctx.beginPath();ctx.arc(0,0,collisionRadius,0,Math.PI*2);ctx.fill();ctx.stroke();
      ctx.setLineDash([4,6]);
      if(e.splashRadius>collisionRadius){ctx.strokeStyle='#ff9f43';ctx.beginPath();ctx.arc(0,0,e.splashRadius,0,Math.PI*2);ctx.stroke();}
      if(e.chainRadius>collisionRadius){ctx.strokeStyle='#63e6ff';ctx.beginPath();ctx.arc(0,0,e.chainRadius,0,Math.PI*2);ctx.stroke();}
      ctx.setLineDash([]);
      ctx.restore();
    }
    ctx.restore();
  }
}
function displayedAction(player) {
  if (player.i === myIndex && localCue && player.ackSeq < localCue.seq) {
    const fighter = FIGHTERS.find(item => item.id === player.characterId) || FIGHTERS[0];
    const move = fighter.moves[localCue.name];
    const cueLifetime = move ? Math.min(900, (move.startup + move.active + move.recovery) * 1000 / 60) : 180;
    if (performance.now() - localCue.started < cueLifetime) return localCue.name;
  }
  return player.actionName || 'idle';
}

function actionLabel(name) {
  if (name === 'ultimate') return 'ULTIMATE';
  if (name === 'grab') return 'GRAB';
  if (name === 'dashAttack') return 'DASH ATTACK';
  if (name === 'tech' || name === 'techRoll') return 'TECH';
  if (name === 'getupAttack') return 'GET-UP ATTACK';
  if (name.startsWith('special')) return `${name.includes('Up') ? 'UP ' : name.includes('Down') ? 'DOWN ' : name.includes('Side') ? 'SIDE ' : ''}SPECIAL`;
  if (name.startsWith('ground') || name.startsWith('air')) return `${name.includes('Up') ? 'UP ' : name.includes('Down') ? 'DOWN ' : name.includes('Back') ? 'BACK ' : name.includes('Side') || name.includes('Forward') ? 'SIDE ' : 'NEUTRAL '}ATTACK`;
  return '';
}

function motionCurve(phase, progress) {
  const t = clamp(Number.isFinite(progress) ? progress : 0, 0, 1);
  const smooth = t * t * (3 - 2 * t);
  if (phase === 'startup' || phase === 'charge') return { windup: smooth, impact: 0, recoil: 0 };
  if (phase === 'active') return { windup: 1 - smooth * .3, impact: 1 - Math.pow(1 - t, 3), recoil: 0 };
  if (phase === 'recovery') return { windup: 0, impact: 0, recoil: Math.pow(1 - t, 2) };
  return { windup: 0, impact: 0, recoil: 0 };
}

const BASE_KEY_POSE = Object.freeze({
  bodyX: 0, bodyY: 0, rotation: 0, scaleX: 1, scaleY: 1,
  frontHandX: 23, frontHandY: -5, backHandX: -18, backHandY: 2,
  frontFootX: 14, frontFootLift: 0, backFootX: -14, backFootLift: 0
});

const LOOP_KEYFRAMES = Object.freeze({
  idle: [
    { t: 0, bodyX: 0, bodyY: 1, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 },
    { t: .5, bodyX: -1, bodyY: -1, rotation: .006, frontHandX: 23, frontHandY: -9, backHandX: -18, backHandY: 0, frontFootX: 14, backFootX: -16 },
    { t: 1, bodyX: 0, bodyY: 1, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  walk: [
    { t: 0, bodyX: 1, bodyY: 0, rotation: .035, frontHandX: -17, frontHandY: -2, backHandX: 16, backHandY: -9, frontFootX: 21, frontFootLift: 0, backFootX: -18, backFootLift: 0 },
    { t: .25, bodyX: 0, bodyY: -2, rotation: .015, frontHandX: -3, frontHandY: -5, backHandX: 4, backHandY: -8, frontFootX: 6, frontFootLift: 2, backFootX: -7, backFootLift: 7 },
    { t: .5, bodyX: 1, bodyY: 0, rotation: -.015, frontHandX: 17, frontHandY: -9, backHandX: -16, backHandY: -2, frontFootX: -18, frontFootLift: 0, backFootX: 21, backFootLift: 0 },
    { t: .75, bodyX: 0, bodyY: -2, rotation: .015, frontHandX: 4, frontHandY: -8, backHandX: -3, backHandY: -5, frontFootX: -7, frontFootLift: 7, backFootX: 6, backFootLift: 2 },
    { t: 1, bodyX: 1, bodyY: 0, rotation: .035, frontHandX: -17, frontHandY: -2, backHandX: 16, backHandY: -9, frontFootX: 21, frontFootLift: 0, backFootX: -18, backFootLift: 0 }
  ],
  run: [
    { t: 0, bodyX: 3, bodyY: 1, rotation: .11, frontHandX: -25, frontHandY: 1, backHandX: 23, backHandY: -14, frontFootX: 31, frontFootLift: 0, backFootX: -26, backFootLift: 0 },
    { t: .25, bodyX: 2, bodyY: -4, rotation: .085, frontHandX: -7, frontHandY: -5, backHandX: 8, backHandY: -11, frontFootX: 7, frontFootLift: 3, backFootX: -9, backFootLift: 12 },
    { t: .5, bodyX: 3, bodyY: 1, rotation: .11, frontHandX: 23, frontHandY: -14, backHandX: -25, backHandY: 1, frontFootX: -26, frontFootLift: 0, backFootX: 31, backFootLift: 0 },
    { t: .75, bodyX: 2, bodyY: -4, rotation: .085, frontHandX: 8, frontHandY: -11, backHandX: -7, backHandY: -5, frontFootX: -9, frontFootLift: 12, backFootX: 7, backFootLift: 3 },
    { t: 1, bodyX: 3, bodyY: 1, rotation: .11, frontHandX: -25, frontHandY: 1, backHandX: 23, backHandY: -14, frontFootX: 31, frontFootLift: 0, backFootX: -26, backFootLift: 0 }
  ],
  shield: [
    { t: 0, bodyX: -2, bodyY: 7, rotation: .035, scaleX: 1.12, scaleY: .84, frontHandX: 22, frontHandY: -13, backHandX: 8, backHandY: -2, frontFootX: 22, backFootX: -23 },
    { t: .5, bodyX: -3, bodyY: 8, rotation: .045, scaleX: 1.15, scaleY: .81, frontHandX: 20, frontHandY: -15, backHandX: 10, backHandY: -1, frontFootX: 23, backFootX: -24 },
    { t: 1, bodyX: -2, bodyY: 7, rotation: .035, scaleX: 1.12, scaleY: .84, frontHandX: 22, frontHandY: -13, backHandX: 8, backHandY: -2, frontFootX: 22, backFootX: -23 }
  ],
  tumble: [
    { t: 0, bodyY: -2, scaleX: 1.06, scaleY: .92, frontHandX: 13, frontHandY: 4, backHandX: -11, backHandY: 5, frontFootX: 14, frontFootLift: 11, backFootX: -12, backFootLift: 9 },
    { t: .5, bodyY: -1, scaleX: 1.08, scaleY: .9, frontHandX: -11, frontHandY: 5, backHandX: 13, backHandY: 4, frontFootX: -12, frontFootLift: 9, backFootX: 14, backFootLift: 11 },
    { t: 1, bodyY: -2, scaleX: 1.06, scaleY: .92, frontHandX: 13, frontHandY: 4, backHandX: -11, backHandY: 5, frontFootX: 14, frontFootLift: 11, backFootX: -12, backFootLift: 9 }
  ]
});

const ONESHOT_KEYFRAMES = Object.freeze({
  jumpSquat: [
    { t: 0, bodyY: 0 },
    { t: .55, bodyX: -2, bodyY: 10, rotation: .035, scaleX: 1.2, scaleY: .74, frontHandX: -24, frontHandY: 9, backHandX: -18, backHandY: 5, frontFootX: 19, backFootX: -20 },
    { t: 1, bodyX: 1, bodyY: 5, rotation: -.025, scaleX: 1.08, scaleY: .88, frontHandX: 26, frontHandY: -13, backHandX: -20, backHandY: -7, frontFootX: 14, backFootX: -13 }
  ],
  jump: [
    { t: 0, bodyX: 1, bodyY: 5, rotation: -.025, scaleX: 1.08, scaleY: .9, frontHandX: 26, frontHandY: -13, backHandX: -20, backHandY: -7, frontFootX: 14, frontFootLift: 4, backFootX: -13, backFootLift: 6 },
    { t: .5, bodyX: 2, bodyY: -6, rotation: -.05, scaleX: .94, scaleY: 1.08, frontHandX: 29, frontHandY: -18, backHandX: -23, backHandY: -11, frontFootX: 9, frontFootLift: 14, backFootX: -8, backFootLift: 18 },
    { t: 1, bodyX: 0, bodyY: -2, rotation: .015, scaleX: .99, scaleY: 1.01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }
  ],
  fall: [
    { t: 0, bodyY: -1, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 },
    { t: .5, bodyY: 2, rotation: .025, scaleX: 1.05, scaleY: .96, frontHandX: 31, frontHandY: 1, backHandX: -29, backHandY: 4, frontFootX: 17, frontFootLift: 3, backFootX: -15, backFootLift: 6 },
    { t: 1, bodyY: -1, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }
  ],
  landing: [
    { t: 0, bodyX: 2, bodyY: 12, rotation: -.035, scaleX: 1.24, scaleY: .71, frontHandX: 31, frontHandY: 8, backHandX: -28, backHandY: 7, frontFootX: 24, backFootX: -25 },
    { t: .45, bodyX: 1, bodyY: 8, rotation: .02, scaleX: 1.16, scaleY: .81, frontHandX: 26, frontHandY: 2, backHandX: -23, backHandY: 4, frontFootX: 21, backFootX: -22 },
    { t: 1, bodyX: 0, bodyY: 0, rotation: .018, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  hit: [
    { t: 0, bodyX: 9, bodyY: -7, rotation: .32, scaleX: .76, scaleY: 1.18, frontHandX: -35, frontHandY: -17, backHandX: -27, backHandY: 17, frontFootX: 23, frontFootLift: 5, backFootX: -17, backFootLift: 13 },
    { t: .55, bodyX: 5, bodyY: -3, rotation: .21, scaleX: .87, scaleY: 1.09, frontHandX: -29, frontHandY: -11, backHandX: -22, backHandY: 13, frontFootX: 19, frontFootLift: 4, backFootX: -14, backFootLift: 9 },
    { t: 1, bodyX: 2, bodyY: 0, rotation: .08, scaleX: .96, scaleY: 1.02, frontHandX: -20, frontHandY: -4, backHandX: -15, backHandY: 8, frontFootX: 15, frontFootLift: 2, backFootX: -13, backFootLift: 5 }
  ],
  groundHit: [
    { t: 0, bodyX: 8, bodyY: 12, rotation: .25, scaleX: 1.24, scaleY: .7, frontHandX: -36, frontHandY: -10, backHandX: -29, backHandY: 14, frontFootX: 30, backFootX: -27 },
    { t: .65, bodyX: 4, bodyY: 8, rotation: .13, scaleX: 1.15, scaleY: .8, frontHandX: -28, frontHandY: -6, backHandX: -22, backHandY: 11, frontFootX: 24, backFootX: -22 },
    { t: 1, bodyX: 0, bodyY: 3, rotation: .035, scaleX: 1.04, scaleY: .94, frontHandX: -19, frontHandY: -2, backHandX: -15, backHandY: 7, frontFootX: 17, backFootX: -17 }
  ],
  shieldHit: [
    { t: 0, bodyX: -11, bodyY: 12, rotation: -.19, scaleX: 1.3, scaleY: .68, frontHandX: 10, frontHandY: -22, backHandX: 2, backHandY: 2, frontFootX: 17, backFootX: -30 },
    { t: .55, bodyX: -6, bodyY: 9, rotation: -.1, scaleX: 1.22, scaleY: .75, frontHandX: 16, frontHandY: -17, backHandX: 6, backHandY: -2, frontFootX: 20, backFootX: -27 },
    { t: 1, bodyX: -2, bodyY: 7, rotation: .035, scaleX: 1.12, scaleY: .84, frontHandX: 22, frontHandY: -13, backHandX: 8, backHandY: -2, frontFootX: 22, backFootX: -23 }
  ],
  parry: [
    { t: 0, bodyX: -3, bodyY: 6, rotation: .08, scaleX: 1.18, scaleY: .82, frontHandX: 42, frontHandY: -15, backHandX: -12, backHandY: -5, frontFootX: 26, backFootX: -27 },
    { t: .45, bodyX: 2, bodyY: -2, rotation: -.07, scaleX: .97, scaleY: 1.07, frontHandX: 36, frontHandY: -18, backHandX: -19, backHandY: -3, frontFootX: 23, backFootX: -23 },
    { t: 1, bodyY: 0, rotation: .018, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  roll: [
    { t: 0, bodyX: 1, bodyY: 3, rotation: 0, scaleX: 1.04, scaleY: .94, frontHandX: 18, frontHandY: 5, backHandX: -16, backHandY: 6, frontFootX: 15, frontFootLift: 1, backFootX: -15, backFootLift: 1 },
    { t: .25, bodyX: 3, bodyY: 14, rotation: 1.55, scaleX: 1.18, scaleY: .64, frontHandX: 8, frontHandY: 11, backHandX: -8, backHandY: 11, frontFootX: 8, frontFootLift: 8, backFootX: -8, backFootLift: 8 },
    { t: .5, bodyX: 4, bodyY: 15, rotation: 3.14, scaleX: 1.2, scaleY: .62, frontHandX: 7, frontHandY: 12, backHandX: -7, backHandY: 12, frontFootX: 7, frontFootLift: 9, backFootX: -7, backFootLift: 9 },
    { t: .75, bodyX: 3, bodyY: 12, rotation: 4.72, scaleX: 1.14, scaleY: .7, frontHandX: 9, frontHandY: 9, backHandX: -9, backHandY: 9, frontFootX: 9, frontFootLift: 7, backFootX: -9, backFootLift: 7 },
    { t: 1, bodyX: 1, bodyY: 0, rotation: 6.28, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  crouch: [
    { t: 0 },
    { t: .55, bodyX: -1, bodyY: 10, rotation: .03, scaleX: 1.16, scaleY: .72, frontHandX: 23, frontHandY: -1, backHandX: -13, backHandY: 7, frontFootX: 20, backFootX: -21 },
    { t: 1, bodyX: -1, bodyY: 10, rotation: .03, scaleX: 1.16, scaleY: .72, frontHandX: 23, frontHandY: -1, backHandX: -13, backHandY: 7, frontFootX: 20, backFootX: -21 }
  ],
  doubleJump: [
    { t: 0, bodyY: -2, frontHandX: 25, frontHandY: -8, backHandX: -22, backHandY: -4, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 10 },
    { t: .28, bodyY: -11, rotation: 1.5, scaleX: 1.16, scaleY: .74, frontHandX: 10, frontHandY: 8, backHandX: -10, backHandY: 8, frontFootX: 8, frontFootLift: 15, backFootX: -8, backFootLift: 14 },
    { t: .58, bodyY: -8, rotation: 3.15, scaleX: .84, scaleY: 1.18, frontHandX: 20, frontHandY: -16, backHandX: -18, backHandY: -12, frontFootX: 10, frontFootLift: 12, backFootX: -9, backFootLift: 17 },
    { t: 1, bodyY: -2, rotation: 6.28, scaleX: .99, scaleY: 1.01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }
  ],
  spotDodge: [
    { t: 0 },
    { t: .3, bodyX: -10, bodyY: -5, rotation: -.18, scaleX: .8, scaleY: 1.1, frontHandX: 16, frontHandY: -13, backHandX: -10, backHandY: -8, frontFootX: 16, backFootX: -17 },
    { t: .7, bodyX: -7, bodyY: -3, rotation: -.11, scaleX: .86, scaleY: 1.06, frontHandX: 19, frontHandY: -10, backHandX: -12, backHandY: -5, frontFootX: 16, backFootX: -17 },
    { t: 1 }
  ],
  airDodge: [
    { t: 0, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 7, backFootX: -11, backFootLift: 9 },
    { t: .38, bodyY: -6, rotation: -.13, scaleX: .76, scaleY: 1.16, frontHandX: 9, frontHandY: 7, backHandX: -9, backHandY: 7, frontFootX: 7, frontFootLift: 14, backFootX: -7, backFootLift: 14 },
    { t: .72, bodyY: -4, rotation: .07, scaleX: .85, scaleY: 1.09, frontHandX: 13, frontHandY: 3, backHandX: -13, backHandY: 4, frontFootX: 9, frontFootLift: 11, backFootX: -9, backFootLift: 12 },
    { t: 1, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }
  ],
  knockdown: [
    { t: 0, bodyY: 13, rotation: 1.45, scaleX: 1.2, scaleY: .64, frontHandX: 28, frontHandY: 12, backHandX: -25, backHandY: 11, frontFootX: 28, backFootX: -25 },
    { t: 1, bodyY: 13, rotation: 1.45, scaleX: 1.2, scaleY: .64, frontHandX: 28, frontHandY: 12, backHandX: -25, backHandY: 11, frontFootX: 28, backFootX: -25 }
  ],
  getup: [
    { t: 0, bodyY: 13, rotation: 1.45, scaleX: 1.2, scaleY: .64, frontHandX: 28, frontHandY: 12, backHandX: -25, backHandY: 11, frontFootX: 28, backFootX: -25 },
    { t: .48, bodyY: 7, rotation: .55, scaleX: 1.1, scaleY: .78, frontHandX: 30, frontHandY: -15, backHandX: -20, backHandY: 8, frontFootX: 24, backFootX: -21 },
    { t: .78, bodyY: -4, rotation: -.08, scaleX: .9, scaleY: 1.12, frontHandX: 17, frontHandY: -17, backHandX: -15, backHandY: -13, frontFootX: 16, backFootX: -16 },
    { t: 1 }
  ],
  grabHold: [
    { t: 0, bodyX: 3, bodyY: 2, scaleX: 1.06, scaleY: .94, frontHandX: 34, frontHandY: -12, backHandX: 31, backHandY: 12, frontFootX: 18, backFootX: -18 },
    { t: .5, bodyX: 5, bodyY: 3, scaleX: 1.08, scaleY: .92, frontHandX: 36, frontHandY: -13, backHandX: 32, backHandY: 11, frontFootX: 19, backFootX: -19 },
    { t: 1, bodyX: 3, bodyY: 2, scaleX: 1.06, scaleY: .94, frontHandX: 34, frontHandY: -12, backHandX: 31, backHandY: 12, frontFootX: 18, backFootX: -18 }
  ],
  grabbed: [
    { t: 0, bodyY: -2, rotation: .08, scaleX: .82, scaleY: 1.08, frontHandX: -8, frontHandY: -18, backHandX: 5, backHandY: -21, frontFootX: 7, frontFootLift: 2, backFootX: -7, backFootLift: 2 },
    { t: .5, bodyY: -3, rotation: .11, scaleX: .8, scaleY: 1.1, frontHandX: -10, frontHandY: -20, backHandX: 7, backHandY: -19, frontFootX: 6, frontFootLift: 3, backFootX: -6, backFootLift: 3 },
    { t: 1, bodyY: -2, rotation: .08, scaleX: .82, scaleY: 1.08, frontHandX: -8, frontHandY: -18, backHandX: 5, backHandY: -21, frontFootX: 7, frontFootLift: 2, backFootX: -7, backFootLift: 2 }
  ],
  grabEscape: [
    { t: 0, bodyX: -7, bodyY: 6, rotation: -.13, scaleX: 1.12, scaleY: .86, frontHandX: -30, frontHandY: 3, backHandX: 23, backHandY: -14, frontFootX: 18, backFootX: -17 },
    { t: .55, bodyX: -10, bodyY: 3, rotation: -.2, scaleX: 1.18, scaleY: .82, frontHandX: -35, frontHandY: -1, backHandX: 27, backHandY: -17, frontFootX: 21, backFootX: -19 },
    { t: 1 }
  ]
});

const ATTACK_KEYFRAMES = Object.freeze({
  jab1: {
    startup: [{ t: 0 }, { t: 1, bodyX: -4, bodyY: 1, rotation: .1, frontHandX: -10, frontHandY: 1, backHandX: -18, backHandY: -6, frontFootX: 16, backFootX: -20 }],
    active: [{ t: 0, bodyX: -4, bodyY: 1, rotation: .1, frontHandX: -10, frontHandY: 1, backHandX: -18, backHandY: -6 }, { t: .28, bodyX: 10, bodyY: 0, rotation: -.17, frontHandX: 61, frontHandY: -7, backHandX: -19, backHandY: -5, frontFootX: 24, backFootX: -17 }, { t: 1, bodyX: 7, rotation: -.1, frontHandX: 51, frontHandY: -5, backHandX: -18, backHandY: -4, frontFootX: 21, backFootX: -18 }],
    recovery: [{ t: 0, bodyX: 7, rotation: -.1, frontHandX: 51, frontHandY: -5, backHandX: -18, backHandY: -4, frontFootX: 21, backFootX: -18 }, { t: 1, bodyX: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  jab2: {
    startup: [{ t: 0 }, { t: 1, bodyX: -3, bodyY: 1, rotation: -.12, frontHandX: 19, frontHandY: -8, backHandX: -24, backHandY: 1, frontFootX: 18, backFootX: -21 }],
    active: [{ t: 0, bodyX: -3, bodyY: 1, rotation: -.12, frontHandX: 19, frontHandY: -8, backHandX: -24, backHandY: 1 }, { t: .3, bodyX: 9, rotation: .18, frontHandX: 17, frontHandY: -7, backHandX: 64, backHandY: -9, frontFootX: 18, backFootX: -25 }, { t: 1, bodyX: 6, rotation: .11, frontHandX: 18, frontHandY: -6, backHandX: 53, backHandY: -7, frontFootX: 18, backFootX: -23 }],
    recovery: [{ t: 0, bodyX: 6, rotation: .11, frontHandX: 18, frontHandY: -6, backHandX: 53, backHandY: -7, frontFootX: 18, backFootX: -23 }, { t: 1, bodyX: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  finisher: {
    startup: [{ t: 0 }, { t: 1, bodyX: -9, bodyY: 5, rotation: .22, scaleX: 1.12, scaleY: .88, frontHandX: -27, frontHandY: -10, backHandX: -22, backHandY: 10, frontFootX: 22, backFootX: -27 }],
    active: [{ t: 0, bodyX: -9, bodyY: 5, rotation: .22, frontHandX: -27, frontHandY: -10, backHandX: -22, backHandY: 10 }, { t: .35, bodyX: 15, bodyY: 2, rotation: -.31, scaleX: 1.18, scaleY: .84, frontHandX: 72, frontHandY: -10, backHandX: 39, backHandY: 5, frontFootX: 32, backFootX: -25 }, { t: 1, bodyX: 10, rotation: -.2, scaleX: 1.12, scaleY: .9, frontHandX: 61, frontHandY: -7, backHandX: 31, backHandY: 5, frontFootX: 28, backFootX: -23 }],
    recovery: [{ t: 0, bodyX: 10, rotation: -.2, frontHandX: 61, frontHandY: -7, backHandX: 31, backHandY: 5, frontFootX: 28, backFootX: -23 }, { t: 1, bodyX: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  side: {
    startup: [{ t: 0 }, { t: 1, bodyX: -10, bodyY: 4, rotation: .2, scaleX: 1.12, scaleY: .9, frontHandX: -30, frontHandY: 0, backHandX: -21, backHandY: 8, frontFootX: 21, backFootX: -27 }],
    active: [{ t: 0, bodyX: -10, bodyY: 4, rotation: .2, frontHandX: -30, frontHandY: 0, backHandX: -21, backHandY: 8 }, { t: .3, bodyX: 18, bodyY: 2, rotation: -.29, scaleX: 1.2, scaleY: .84, frontHandX: 78, frontHandY: -6, backHandX: -20, backHandY: 7, frontFootX: 33, backFootX: -23 }, { t: 1, bodyX: 13, rotation: -.18, scaleX: 1.13, scaleY: .9, frontHandX: 66, frontHandY: -4, backHandX: -19, backHandY: 7, frontFootX: 29, backFootX: -22 }],
    recovery: [{ t: 0, bodyX: 13, rotation: -.18, frontHandX: 66, frontHandY: -4, backHandX: -19, backHandY: 7, frontFootX: 29, backFootX: -22 }, { t: 1, bodyX: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  up: {
    startup: [{ t: 0 }, { t: 1, bodyX: -2, bodyY: 8, rotation: .03, scaleX: 1.14, scaleY: .82, frontHandX: -5, frontHandY: 12, backHandX: -15, backHandY: 7, frontFootX: 20, backFootX: -21 }],
    active: [{ t: 0, bodyX: -2, bodyY: 8, rotation: .03, frontHandX: -5, frontHandY: 12, backHandX: -15, backHandY: 7 }, { t: .3, bodyX: 3, bodyY: -13, rotation: -.07, scaleX: .84, scaleY: 1.25, frontHandX: 12, frontHandY: -59, backHandX: -14, backHandY: -34, frontFootX: 16, backFootX: -16 }, { t: 1, bodyX: 2, bodyY: -8, rotation: -.04, scaleX: .9, scaleY: 1.16, frontHandX: 13, frontHandY: -50, backHandX: -16, backHandY: -28 }],
    recovery: [{ t: 0, bodyX: 2, bodyY: -8, rotation: -.04, frontHandX: 13, frontHandY: -50, backHandX: -16, backHandY: -28 }, { t: 1, bodyX: 0, bodyY: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  down: {
    startup: [{ t: 0 }, { t: 1, bodyX: -2, bodyY: 9, rotation: .05, scaleX: 1.22, scaleY: .76, frontHandX: 16, frontHandY: 6, backHandX: -21, backHandY: 5, frontFootX: 19, backFootX: -21 }],
    active: [{ t: 0, bodyX: -2, bodyY: 9, rotation: .05, frontHandX: 16, frontHandY: 6, backHandX: -21, backHandY: 5 }, { t: .32, bodyX: 4, bodyY: 10, rotation: -.09, scaleX: 1.26, scaleY: .72, frontHandX: -6, frontHandY: 11, backHandX: -27, backHandY: 14, frontFootX: 59, frontFootLift: 4, backFootX: -20 }, { t: 1, bodyX: 2, bodyY: 8, rotation: -.05, frontHandX: 3, frontHandY: 8, backHandX: -23, backHandY: 11, frontFootX: 48, frontFootLift: 3, backFootX: -19 }],
    recovery: [{ t: 0, bodyX: 2, bodyY: 8, rotation: -.05, frontHandX: 3, frontHandY: 8, backHandX: -23, backHandY: 11, frontFootX: 48, frontFootLift: 3, backFootX: -19 }, { t: 1, bodyX: 0, bodyY: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  getupAttack: {
    startup: [
      { t: 0, bodyY: 13, rotation: 1.45, scaleX: 1.2, scaleY: .64, frontHandX: 28, frontHandY: 12, backHandX: -25, backHandY: 11, frontFootX: 28, backFootX: -25 },
      { t: 1, bodyY: 8, rotation: .48, scaleX: 1.18, scaleY: .76, frontHandX: 22, frontHandY: 5, backHandX: -22, backHandY: 5, frontFootX: 26, frontFootLift: 5, backFootX: -25, backFootLift: 5 }
    ],
    active: [
      { t: 0, bodyY: 8, rotation: .48, scaleX: 1.18, scaleY: .76, frontHandX: 22, frontHandY: 5, backHandX: -22, backHandY: 5, frontFootX: 26, frontFootLift: 5, backFootX: -25, backFootLift: 5 },
      { t: .32, bodyY: 6, rotation: -.05, scaleX: 1.28, scaleY: .72, frontHandX: 35, frontHandY: 10, backHandX: -34, backHandY: 10, frontFootX: 61, frontFootLift: 7, backFootX: -59, backFootLift: 7 },
      { t: 1, bodyY: 5, rotation: .04, scaleX: 1.22, scaleY: .78, frontHandX: 29, frontHandY: 7, backHandX: -29, backHandY: 7, frontFootX: 52, frontFootLift: 5, backFootX: -51, backFootLift: 5 }
    ],
    recovery: [
      { t: 0, bodyY: 5, rotation: .04, scaleX: 1.22, scaleY: .78, frontHandX: 29, frontHandY: 7, backHandX: -29, backHandY: 7, frontFootX: 52, frontFootLift: 5, backFootX: -51, backFootLift: 5 },
      { t: .5, bodyY: 2, rotation: 0, scaleX: 1.08, scaleY: .92, frontHandX: 23, frontHandY: -7, backHandX: -22, backHandY: -5, frontFootX: 26, backFootX: -25 },
      { t: 1 }
    ]
  },
  airForward: {
    startup: [{ t: 0 }, { t: 1, bodyX: -2, rotation: .13, frontHandX: -22, frontHandY: -9, backHandX: -28, backHandY: 6, frontFootX: 10, frontFootLift: 11, backFootX: -18, backFootLift: 8 }],
    active: [{ t: 0, bodyX: -2, rotation: .13, frontHandX: -22, frontHandY: -9, backHandX: -28, backHandY: 6 }, { t: .3, bodyX: 5, rotation: -.25, frontHandX: -27, frontHandY: -5, backHandX: -31, backHandY: 8, frontFootX: 68, frontFootLift: 21, backFootX: -20, backFootLift: 8 }, { t: 1, bodyX: 3, rotation: -.16, frontHandX: -24, frontHandY: -4, backHandX: -28, backHandY: 7, frontFootX: 57, frontFootLift: 18 }],
    recovery: [{ t: 0, bodyX: 3, rotation: -.16, frontHandX: -24, frontHandY: -4, backHandX: -28, backHandY: 7, frontFootX: 57, frontFootLift: 18 }, { t: 1, bodyX: 0, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
  },
  airBack: {
    startup: [{ t: 0 }, { t: 1, bodyX: 2, rotation: -.15, frontHandX: 24, frontHandY: -7, backHandX: 31, backHandY: 7, frontFootX: 18, frontFootLift: 8, backFootX: -10, backFootLift: 12 }],
    active: [{ t: 0, bodyX: 2, rotation: -.15, frontHandX: 24, frontHandY: -7, backHandX: 31, backHandY: 7 }, { t: .3, bodyX: -5, rotation: .26, frontHandX: 29, frontHandY: -4, backHandX: 33, backHandY: 9, frontFootX: 20, frontFootLift: 8, backFootX: -69, backFootLift: 22 }, { t: 1, bodyX: -3, rotation: .17, frontHandX: 27, frontHandY: -4, backHandX: 30, backHandY: 8, backFootX: -58, backFootLift: 19 }],
    recovery: [{ t: 0, bodyX: -3, rotation: .17, frontHandX: 27, frontHandY: -4, backHandX: 30, backHandY: 8, backFootX: -58, backFootLift: 19 }, { t: 1, bodyX: 0, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
  },
  airNeutral: {
    startup: [{ t: 0 }, { t: 1, bodyY: -2, rotation: .04, scaleX: .88, scaleY: 1.1, frontHandX: 16, frontHandY: -16, backHandX: -15, backHandY: -12, frontFootX: 9, frontFootLift: 13, backFootX: -8, backFootLift: 15 }],
    active: [{ t: 0, bodyY: -2, rotation: .04, scaleX: .88, scaleY: 1.1 }, { t: .35, bodyY: 2, rotation: -.05, scaleX: 1.18, scaleY: .84, frontHandX: 31, frontHandY: -7, backHandX: -29, backHandY: -4, frontFootX: 47, frontFootLift: 4, backFootX: -45, backFootLift: 20 }, { t: 1, bodyY: 1, rotation: -.03, scaleX: 1.1, scaleY: .9, frontHandX: 28, frontHandY: -6, backHandX: -26, backHandY: -3, frontFootX: 39, backFootX: -37 }],
    recovery: [{ t: 0, bodyY: 1, rotation: -.03, scaleX: 1.1, scaleY: .9, frontHandX: 28, frontHandY: -6, backHandX: -26, backHandY: -3, frontFootX: 39, backFootX: -37 }, { t: 1, bodyY: -1, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
  },
  airDown: {
    startup: [{ t: 0 }, { t: 1, bodyY: -5, rotation: -.03, scaleX: .9, scaleY: 1.1, frontHandX: 28, frontHandY: -14, backHandX: -26, backHandY: -12, frontFootX: 8, frontFootLift: 14, backFootX: -8, backFootLift: 12 }],
    active: [{ t: 0, bodyY: -5, rotation: -.03, frontHandX: 28, frontHandY: -14, backHandX: -26, backHandY: -12 }, { t: .3, bodyY: 7, rotation: .035, scaleX: 1.08, scaleY: 1.16, frontHandX: 31, frontHandY: -5, backHandX: -30, backHandY: -4, frontFootX: 8, frontFootLift: -28, backFootX: -8, backFootLift: -24 }, { t: 1, bodyY: 5, rotation: .02, frontHandX: 29, frontHandY: -4, backHandX: -28, backHandY: -3, frontFootLift: -22, backFootLift: -20 }],
    recovery: [{ t: 0, bodyY: 5, rotation: .02, frontHandX: 29, frontHandY: -4, backHandX: -28, backHandY: -3, frontFootLift: -22, backFootLift: -20 }, { t: 1, bodyY: -1, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
  },
  cast: {
    startup: [{ t: 0 }, { t: 1, bodyX: -11, bodyY: 3, rotation: .18, scaleX: 1.14, scaleY: .88, frontHandX: -10, frontHandY: -13, backHandX: -21, backHandY: 9, frontFootX: 20, backFootX: -23 }],
    active: [{ t: 0, bodyX: -11, bodyY: 3, rotation: .18, frontHandX: -10, frontHandY: -13, backHandX: -21, backHandY: 9 }, { t: .35, bodyX: 13, bodyY: 1, rotation: -.27, frontHandX: 70, frontHandY: -14, backHandX: 40, backHandY: 8, frontFootX: 27, backFootX: -20 }, { t: 1, bodyX: 8, rotation: -.16, frontHandX: 60, frontHandY: -11, backHandX: 34, backHandY: 7, frontFootX: 24, backFootX: -19 }],
    recovery: [{ t: 0, bodyX: 8, rotation: -.16, frontHandX: 60, frontHandY: -11, backHandX: 34, backHandY: 7, frontFootX: 24, backFootX: -19 }, { t: 1, bodyX: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  rush: {
    startup: [{ t: 0 }, { t: 1, bodyX: -8, bodyY: 6, rotation: .18, scaleX: 1.16, scaleY: .84, frontHandX: 18, frontHandY: -5, backHandX: -31, backHandY: 7, frontFootX: 20, backFootX: -27 }],
    active: [{ t: 0, bodyX: -8, bodyY: 6, rotation: .18, frontHandX: 18, frontHandY: -5, backHandX: -31, backHandY: 7 }, { t: .25, bodyX: 24, bodyY: 4, rotation: -.33, scaleX: 1.32, scaleY: .76, frontHandX: 28, frontHandY: -5, backHandX: -37, backHandY: 7, frontFootX: 0, backFootX: -31 }, { t: 1, bodyX: 18, bodyY: 4, rotation: -.24, scaleX: 1.22, scaleY: .82, frontHandX: 26, frontHandY: -4, backHandX: -33, backHandY: 6, frontFootX: 4, backFootX: -28 }],
    recovery: [{ t: 0, bodyX: 18, bodyY: 4, rotation: -.24, scaleX: 1.22, scaleY: .82, frontHandX: 26, frontHandY: -4, backHandX: -33, backHandY: 6, frontFootX: 4, backFootX: -28 }, { t: 1, bodyX: 0, bodyY: 0, rotation: .018, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }]
  },
  rise: {
    startup: [{ t: 0 }, { t: 1, bodyX: -2, bodyY: 9, rotation: .035, scaleX: 1.18, scaleY: .8, frontHandX: -5, frontHandY: 7, backHandX: -16, backHandY: 6, frontFootX: 19, backFootX: -20 }],
    active: [{ t: 0, bodyX: -2, bodyY: 9, rotation: .035, frontHandX: -5, frontHandY: 7, backHandX: -16, backHandY: 6 }, { t: .25, bodyX: 3, bodyY: -20, rotation: -.06, scaleX: .72, scaleY: 1.42, frontHandX: 12, frontHandY: -62, backHandX: -14, backHandY: -34, frontFootX: 8, frontFootLift: 14, backFootX: -7, backFootLift: 18 }, { t: 1, bodyX: 2, bodyY: -13, rotation: -.035, scaleX: .82, scaleY: 1.28, frontHandX: 13, frontHandY: -53, backHandX: -16, backHandY: -29, frontFootX: 10, frontFootLift: 10, backFootX: -9, backFootLift: 14 }],
    recovery: [{ t: 0, bodyX: 2, bodyY: -13, rotation: -.035, scaleX: .82, scaleY: 1.28, frontHandX: 13, frontHandY: -53, backHandX: -16, backHandY: -29, frontFootX: 10, frontFootLift: 10, backFootX: -9, backFootLift: 14 }, { t: 1, bodyX: 0, bodyY: -1, rotation: .01, scaleX: 1, scaleY: 1, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
  },
  counterGuard: {
    startup: [
      { t: 0 },
      { t: .55, bodyX: -3, bodyY: 5, rotation: .04, scaleX: 1.12, scaleY: .86, frontHandX: 18, frontHandY: -20, backHandX: 10, backHandY: 2, frontFootX: 21, backFootX: -23 },
      { t: 1, bodyX: -5, bodyY: 7, rotation: .06, scaleX: 1.17, scaleY: .8, frontHandX: 15, frontHandY: -23, backHandX: 13, backHandY: 3, frontFootX: 23, backFootX: -25 }
    ],
    active: [
      { t: 0, bodyX: -5, bodyY: 7, rotation: .06, scaleX: 1.17, scaleY: .8, frontHandX: 15, frontHandY: -23, backHandX: 13, backHandY: 3, frontFootX: 23, backFootX: -25 },
      { t: .5, bodyX: -6, bodyY: 8, rotation: .07, scaleX: 1.19, scaleY: .78, frontHandX: 14, frontHandY: -24, backHandX: 14, backHandY: 4, frontFootX: 24, backFootX: -26 },
      { t: 1, bodyX: -5, bodyY: 7, rotation: .06, scaleX: 1.17, scaleY: .8, frontHandX: 15, frontHandY: -23, backHandX: 13, backHandY: 3, frontFootX: 23, backFootX: -25 }
    ],
    recovery: [
      { t: 0, bodyX: -5, bodyY: 7, rotation: .06, scaleX: 1.17, scaleY: .8, frontHandX: 15, frontHandY: -23, backHandX: 13, backHandY: 3, frontFootX: 23, backFootX: -25 },
      { t: .55, bodyX: -2, bodyY: 3, rotation: .02, scaleX: 1.07, scaleY: .92, frontHandX: 19, frontHandY: -13, backHandX: -2, backHandY: 2, frontFootX: 17, backFootX: -19 },
      { t: 1 }
    ]
  },
  counterStrike: {
    startup: [
      { t: 0, bodyX: -5, bodyY: 7, rotation: .06, scaleX: 1.17, scaleY: .8, frontHandX: 15, frontHandY: -23, backHandX: 13, backHandY: 3, frontFootX: 23, backFootX: -25 },
      { t: 1, bodyX: -8, bodyY: 8, rotation: .12, scaleX: 1.22, scaleY: .76, frontHandX: 9, frontHandY: -20, backHandX: -18, backHandY: 8, frontFootX: 25, backFootX: -28 }
    ],
    active: [
      { t: 0, bodyX: -8, bodyY: 8, rotation: .12, scaleX: 1.22, scaleY: .76, frontHandX: 9, frontHandY: -20, backHandX: -18, backHandY: 8, frontFootX: 25, backFootX: -28 },
      { t: .18, bodyX: 20, bodyY: 3, rotation: -.3, scaleX: 1.28, scaleY: .82, frontHandX: 76, frontHandY: -7, backHandX: -20, backHandY: 11, frontFootX: 34, backFootX: -27 },
      { t: .55, bodyX: 16, bodyY: 4, rotation: -.23, scaleX: 1.22, scaleY: .86, frontHandX: 69, frontHandY: -6, backHandX: -18, backHandY: 10, frontFootX: 31, backFootX: -25 },
      { t: 1, bodyX: 11, bodyY: 5, rotation: -.16, scaleX: 1.15, scaleY: .9, frontHandX: 58, frontHandY: -5, backHandX: -16, backHandY: 8, frontFootX: 27, backFootX: -23 }
    ],
    recovery: [
      { t: 0, bodyX: 11, bodyY: 5, rotation: -.16, scaleX: 1.15, scaleY: .9, frontHandX: 58, frontHandY: -5, backHandX: -16, backHandY: 8, frontFootX: 27, backFootX: -23 },
      { t: .5, bodyX: 4, bodyY: 2, rotation: -.06, scaleX: 1.06, scaleY: .96, frontHandX: 35, frontHandY: -5, backHandX: -16, backHandY: 5, frontFootX: 19, backFootX: -19 },
      { t: 1 }
    ]
  }
});

const TILT_ATTACK_KEYFRAMES = Object.freeze({
  tiltSide: {
    startup: [
      { t: 0 },
      { t: 1, bodyX: -3, bodyY: 2, rotation: .075, scaleX: 1.04, scaleY: .96, frontHandX: 3, frontHandY: -3, backHandX: -19, backHandY: 3, frontFootX: 17, backFootX: -19 }
    ],
    active: [
      { t: 0, bodyX: -3, bodyY: 2, rotation: .075, frontHandX: 3, frontHandY: -3, backHandX: -19, backHandY: 3, frontFootX: 17, backFootX: -19 },
      { t: .35, bodyX: 7, rotation: -.1, scaleX: 1.07, scaleY: .94, frontHandX: 55, frontHandY: -5, backHandX: -20, backHandY: 2, frontFootX: 23, backFootX: -18 },
      { t: 1, bodyX: 5, rotation: -.07, frontHandX: 49, frontHandY: -4, backHandX: -19, backHandY: 2, frontFootX: 21, backFootX: -18 }
    ],
    recovery: [
      { t: 0, bodyX: 5, rotation: -.07, frontHandX: 49, frontHandY: -4, backHandX: -19, backHandY: 2, frontFootX: 21, backFootX: -18 },
      { t: 1, bodyX: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
    ]
  },
  tiltUp: {
    startup: [
      { t: 0 },
      { t: 1, bodyX: -1, bodyY: 5, rotation: .025, scaleX: 1.07, scaleY: .9, frontHandX: 3, frontHandY: 3, backHandX: -17, backHandY: 4, frontFootX: 18, backFootX: -19 }
    ],
    active: [
      { t: 0, bodyX: -1, bodyY: 5, rotation: .025, scaleX: 1.07, scaleY: .9, frontHandX: 3, frontHandY: 3, backHandX: -17, backHandY: 4, frontFootX: 18, backFootX: -19 },
      { t: .35, bodyX: 2, bodyY: -6, rotation: -.045, scaleX: .94, scaleY: 1.1, frontHandX: 11, frontHandY: -48, backHandX: -17, backHandY: -24, frontFootX: 15, backFootX: -16 },
      { t: 1, bodyX: 1, bodyY: -3, rotation: -.025, scaleX: .97, scaleY: 1.06, frontHandX: 12, frontHandY: -42, backHandX: -18, backHandY: -20 }
    ],
    recovery: [
      { t: 0, bodyX: 1, bodyY: -3, rotation: -.025, scaleX: .97, scaleY: 1.06, frontHandX: 12, frontHandY: -42, backHandX: -18, backHandY: -20 },
      { t: 1, bodyX: 0, bodyY: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
    ]
  },
  tiltDown: {
    startup: [
      { t: 0 },
      { t: 1, bodyX: -1, bodyY: 8, rotation: .04, scaleX: 1.12, scaleY: .82, frontHandX: 14, frontHandY: 5, backHandX: -20, backHandY: 6, frontFootX: 19, backFootX: -20 }
    ],
    active: [
      { t: 0, bodyX: -1, bodyY: 8, rotation: .04, scaleX: 1.12, scaleY: .82, frontHandX: 14, frontHandY: 5, backHandX: -20, backHandY: 6, frontFootX: 19, backFootX: -20 },
      { t: .35, bodyX: 3, bodyY: 8, rotation: -.05, scaleX: 1.16, scaleY: .78, frontHandX: -2, frontHandY: 10, backHandX: -24, backHandY: 11, frontFootX: 50, frontFootLift: 3, backFootX: -18 },
      { t: 1, bodyX: 2, bodyY: 7, rotation: -.03, scaleX: 1.12, scaleY: .82, frontHandX: 5, frontHandY: 8, backHandX: -22, backHandY: 9, frontFootX: 43, frontFootLift: 2, backFootX: -18 }
    ],
    recovery: [
      { t: 0, bodyX: 2, bodyY: 7, rotation: -.03, scaleX: 1.12, scaleY: .82, frontHandX: 5, frontHandY: 8, backHandX: -22, backHandY: 9, frontFootX: 43, frontFootLift: 2, backFootX: -18 },
      { t: 1, bodyX: 0, bodyY: 0, rotation: .018, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
    ]
  }
});

function sampleKeyframes(frames, value) {
  const t = clamp(Number(value) || 0, 0, 1);
  let rightIndex = frames.findIndex(frame => frame.t >= t);
  if (rightIndex <= 0) return { ...BASE_KEY_POSE, ...frames[0] };
  if (rightIndex < 0) rightIndex = frames.length - 1;
  const left = { ...BASE_KEY_POSE, ...frames[rightIndex - 1] };
  const right = { ...BASE_KEY_POSE, ...frames[rightIndex] };
  const span = Math.max(.0001, right.t - left.t);
  const raw = clamp((t - left.t) / span, 0, 1);
  const mix = raw * raw * (3 - 2 * raw);
  const pose = {};
  for (const key of Object.keys(BASE_KEY_POSE)) pose[key] = lerp(left[key], right[key], mix);
  return pose;
}

function attackPhaseFrames(profile, phase) {
  const startup = profile.startup;
  if (phase === 'startup' || phase === 'charge') return startup;
  const startupEnd = { ...BASE_KEY_POSE, ...startup[startup.length - 1] };
  const active = profile.active.map((frame, index) => index === 0 ? { ...startupEnd, ...frame } : frame);
  if (phase === 'active') return active;
  const activeEnd = { ...BASE_KEY_POSE, ...active[active.length - 1] };
  return profile.recovery.map((frame, index) => index === 0 ? { ...activeEnd, ...frame } : frame);
}

function attackKeyframeProfile(action, motion, variant) {
  if (action === 'ultimate') return variant === 'blaze' ? 'rush' : 'cast';
  if (motion === 'counter') return variant === 'counterSuccess' ? 'counterStrike' : 'counterGuard';
  if (action === 'getupAttack' || motion === 'getupSweep') return 'getupAttack';
  if (variant === 'tilt') {
    if (action === 'groundUp') return 'tiltUp';
    if (action === 'groundDown') return 'tiltDown';
    if (action === 'groundSide') return 'tiltSide';
  }
  if (action === 'groundNeutral' || action === 'pummel') return 'jab1';
  if (action === 'groundJab2') return 'jab2';
  if (action === 'groundJab3') return 'finisher';
  if (action === 'groundSide' || action === 'dashAttack') return 'side';
  if (action === 'groundUp' || action === 'airUp') return 'up';
  if (action === 'groundDown') return 'down';
  if (action === 'airForward') return 'airForward';
  if (action === 'airBack') return 'airBack';
  if (action === 'airNeutral') return 'airNeutral';
  if (action === 'airDown') return 'airDown';
  if (['cast','cannon','throw','deploy','discharge','gravity','quake'].includes(motion)) return 'cast';
  if (['rush','shoulder','roll','blink'].includes(motion)) return 'rush';
  if (['rise','rocket','spring','warp'].includes(motion)) return 'rise';
  return 'side';
}

function keyframePoseFor(player, action, motion, phase, progress, attack, age, variant = player.actionVariant) {
  if (attack && phase) {
    const profileName = attackKeyframeProfile(action, motion, variant);
    const profile = TILT_ATTACK_KEYFRAMES[profileName] || ATTACK_KEYFRAMES[profileName];
    const frames = profile && attackPhaseFrames(profile, phase);
    if (frames) {
      const poseProgress = phase === 'charge'
        ? .72 + clamp(((player.chargeFrames || 10) - 10) / 80, 0, 1) * .28
        : progress;
      return sampleKeyframes(frames, poseProgress);
    }
  }
  if (action === 'shieldHit') return sampleKeyframes(ONESHOT_KEYFRAMES.shieldHit, clamp(age / .22, 0, 1));
  if (action === 'parrySuccess') return sampleKeyframes(ONESHOT_KEYFRAMES.parry, clamp(age / .24, 0, 1));
  if (action === 'roll' || action === 'techRoll' || action === 'getupRoll' || action === 'ledgeRoll') return sampleKeyframes(ONESHOT_KEYFRAMES.roll, clamp(age / .38, 0, 1));
  if (player.shielding || action === 'shield') return sampleKeyframes(LOOP_KEYFRAMES.shield, (age / .8) % 1);
  if (action === 'walk') return sampleKeyframes(LOOP_KEYFRAMES.walk, (age / .72) % 1);
  if (action === 'run' || action === 'dash') return sampleKeyframes(LOOP_KEYFRAMES.run, (age / (action === 'dash' ? .34 : .46)) % 1);
  if (action === 'idle') return sampleKeyframes(LOOP_KEYFRAMES.idle, (age / 1.4) % 1);
  if (action === 'jumpSquat') return sampleKeyframes(ONESHOT_KEYFRAMES.jumpSquat, clamp(age / .09, 0, 1));
  if (action === 'jump') return sampleKeyframes(ONESHOT_KEYFRAMES.jump, clamp(age / .24, 0, 1));
  if (action === 'fall') return sampleKeyframes(ONESHOT_KEYFRAMES.fall, (age / .8) % 1);
  if (action === 'landing') return sampleKeyframes(ONESHOT_KEYFRAMES.landing, clamp(age / .2, 0, 1));
  if (action === 'groundHit') return sampleKeyframes(ONESHOT_KEYFRAMES.groundHit, clamp(age / .24, 0, 1));
  if (action === 'hit' || action === 'airRecover') return sampleKeyframes(ONESHOT_KEYFRAMES.hit, clamp(age / .28, 0, 1));
  if (action === 'tumble') return sampleKeyframes(LOOP_KEYFRAMES.tumble, (age / .42) % 1);
  if (action === 'crouch') return sampleKeyframes(ONESHOT_KEYFRAMES.crouch, clamp(age / .12, 0, 1));
  if (action === 'spotDodge') return sampleKeyframes(ONESHOT_KEYFRAMES.spotDodge, clamp((player.dodgeElapsed || 0) / Math.max(1, player.dodgeTotalFrames || 24), 0, 1));
  if (action === 'airDodge') return sampleKeyframes(ONESHOT_KEYFRAMES.airDodge, clamp((player.dodgeElapsed || 0) / Math.max(1, player.dodgeTotalFrames || 44), 0, 1));
  if (action === 'knockdown') return sampleKeyframes(ONESHOT_KEYFRAMES.knockdown, 1);
  if (action === 'getup' || action === 'tech') return sampleKeyframes(ONESHOT_KEYFRAMES.getup, clamp(age / .3, 0, 1));
  if (action === 'grabHold') return sampleKeyframes(ONESHOT_KEYFRAMES.grabHold, (age / .55) % 1);
  if (action === 'grabbed' || action === 'grabbedHit') return sampleKeyframes(ONESHOT_KEYFRAMES.grabbed, (age / .42) % 1);
  if (action === 'grabEscape') return sampleKeyframes(ONESHOT_KEYFRAMES.grabEscape, clamp(age / .2, 0, 1));
  return null;
}

function drawOutlinedLimb(points, color, alpha = 1, width = 7) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
  ctx.strokeStyle = '#080d19'; ctx.lineWidth = width + 4; ctx.stroke();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
  ctx.restore();
}

function drawSpecialEffect(player, fighter, action, color, phase, progress) {
  const active = phase === 'active', startup = phase === 'startup' || phase === 'charge';
  const energy = active ? 1 : startup ? Math.max(.12, progress) : Math.max(0, 1 - progress);
  const neutral = action === 'specialNeutral', side = action === 'specialSide', up = action === 'specialUp', down = action === 'specialDown';
  ctx.globalAlpha = .28 + energy * .62;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 18; ctx.lineCap = 'round';
  if (neutral) {
    const handX = player.face * (player.width / 2 + 12), radius = 7 + energy * (fighter.id === 'blaze' ? 25 : 14);
    ctx.lineWidth = 3 + energy * 4; ctx.beginPath(); ctx.arc(handX, -5, radius, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha *= .55; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(handX, -5, radius + 8 + i * 7, -.8 + i, .8 + i); ctx.stroke(); }
    if (active) { ctx.globalAlpha = .9; ctx.lineWidth = fighter.id === 'blaze' ? 15 : 8; ctx.beginPath(); ctx.moveTo(handX, -5); ctx.lineTo(handX + player.face * (fighter.id === 'bolt' ? 54 : 88), -5); ctx.stroke(); }
  } else if (side) {
    ctx.lineWidth = fighter.id === 'blaze' ? 18 : 10;
    if (fighter.id === 'nova') {
      for (const offset of [-42, 42]) { ctx.beginPath(); ctx.ellipse(offset * player.face, 0, 13 + energy * 8, 31, 0, 0, Math.PI * 2); ctx.stroke(); }
      if (active) { ctx.setLineDash([10, 10]); ctx.beginPath(); ctx.moveTo(-player.face * 48, 0); ctx.lineTo(player.face * 56, 0); ctx.stroke(); ctx.setLineDash([]); }
    } else if (fighter.id === 'bolt') {
      ctx.beginPath(); ctx.arc(0, 0, 25 + energy * 17, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha *= .55; ctx.beginPath(); ctx.arc(0, 0, 34 + energy * 22, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(-player.face * (20 + 35 * energy), 8); ctx.lineTo(player.face * (48 + 54 * energy), -8); ctx.stroke();
      if (fighter.id === 'volt') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-35 * player.face, -22); ctx.lineTo(4 * player.face, 3); ctx.lineTo(48 * player.face, -27); ctx.stroke(); }
    }
  } else if (up) {
    ctx.lineWidth = fighter.id === 'blaze' ? 16 : 9;
    if (fighter.id === 'bolt') { for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.ellipse(0, player.height / 2 + 9 - i * 11, 34 - i * 8, 8, 0, 0, Math.PI * 2); ctx.stroke(); } }
    else if (fighter.id === 'nova') { ctx.beginPath(); ctx.ellipse(0, 0, 34, 52 + energy * 30, 0, 0, Math.PI * 2); ctx.stroke(); ctx.beginPath(); ctx.ellipse(0, -58, 20, 8, 0, 0, Math.PI * 2); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(0, player.height / 2 + 10); ctx.lineTo(player.face * 5, -player.height / 2 - 56 * energy); ctx.stroke(); if (fighter.id === 'volt') { ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-18, 15); ctx.lineTo(12, -8); ctx.lineTo(-7, -34); ctx.lineTo(18, -60); ctx.stroke(); } }
  } else if (down) {
    if (fighter.id === 'blaze') {
      const direction = player.face;
      const success = player.actionVariant === 'counterSuccess';
      if (success) {
        const snap = phase === 'active' ? 1 - Math.min(1, progress * 1.7) : 0;
        ctx.globalAlpha = .35 + snap * .55;
        ctx.lineWidth = 3 + snap * 3;
        ctx.beginPath();
        ctx.moveTo(direction * 8, -7);
        ctx.lineTo(direction * (48 + snap * 28), -7);
        ctx.stroke();
      } else {
        const brace = startup ? progress : active ? 1 : Math.max(0, 1 - progress);
        const guardX = direction * (25 + brace * 5);
        ctx.globalAlpha = .24 + brace * .42;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(guardX + direction * 7, -player.height * .3);
        ctx.lineTo(guardX, -player.height * .17);
        ctx.lineTo(guardX, player.height * .17);
        ctx.lineTo(guardX + direction * 7, player.height * .3);
        ctx.stroke();
      }
    } else {
      const groundSweep = fighter.id === 'volt' || fighter.id === 'bolt';
      const radius = fighter.id === 'volt' ? 45 + energy * 24 : fighter.id === 'bolt' ? 62 + energy * 23 : 48 + energy * (fighter.id === 'nova' ? 42 : 24);
      const centerY = groundSweep ? player.height * .28 : player.height / 2 + 5;
      const radiusY = fighter.id === 'volt' ? 10 + energy * 5 : fighter.id === 'bolt' ? 11 + energy * 7 : 13 + energy * 8;
      ctx.lineWidth = groundSweep ? 3 + energy * 3 : 5 + energy * 5; ctx.beginPath(); ctx.ellipse(0, centerY, radius, radiusY, 0, 0, Math.PI * 2); ctx.stroke();
      if (fighter.id === 'nova') { ctx.globalAlpha *= .4; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(0, 0, 20 + i * 18 + energy * 12, 0, Math.PI * 2); ctx.stroke(); } }
    }
  }
  return true;
}

function drawAttackEffect(player, action, color, age, phase, progress, fighter) {
  const active = player.actionPhase === 'active' || player.i === myIndex && localCue && age > 45 && age < 150;
  const attackPhase = phase === 'startup' || phase === 'active' || phase === 'recovery' || phase === 'charge';
  if (!active && !player.chargeFrames && !action.startsWith('special') && !attackPhase) return;
  ctx.save();
  const effectStrength = phase === 'startup' ? .12 + progress * .28 : phase === 'active' ? .85 : phase === 'recovery' ? Math.max(0, (1 - progress) * .62) : player.chargeFrames ? .38 : 0;
  ctx.globalAlpha = effectStrength;
  ctx.strokeStyle = action.startsWith('special') ? color : '#ffffff';
  ctx.fillStyle = color;
  ctx.lineWidth = action.startsWith('special') ? 10 : 6;
  ctx.shadowColor = color; ctx.shadowBlur = 14;
  if (action === 'ultimate' && phase) {
    const charge = phase === 'startup' ? progress : phase === 'active' ? 1 : 1 - progress;
    ctx.globalAlpha = .24 + charge * .7;ctx.strokeStyle = phase === 'active' ? '#ffffff' : color;ctx.fillStyle=color;
    if(fighter.id==='blaze'){
      const direction=player.face,reach=phase==='active'?190:65+charge*55;ctx.lineWidth=4+charge*5;
      for(let lane=-2;lane<=2;lane++){ctx.beginPath();ctx.moveTo(-direction*reach,lane*15);ctx.lineTo(direction*(20+charge*42),lane*5);ctx.stroke();}
      ctx.globalAlpha*=.42;ctx.beginPath();ctx.moveTo(-direction*reach,-42);ctx.lineTo(direction*62,0);ctx.lineTo(-direction*reach,42);ctx.closePath();ctx.fill();
    }else if(fighter.id==='volt'){
      ctx.lineWidth=3+charge*4;for(let index=-2;index<=2;index++){const x=index*17;ctx.beginPath();ctx.moveTo(x,-player.height*.76);ctx.lineTo(x-8,player.height*.56);ctx.stroke();}
    }else if(fighter.id==='bolt'){
      ctx.lineWidth=3+charge*4;for(let lane=-1;lane<=1;lane++){ctx.beginPath();ctx.moveTo(-player.face*(55+charge*55),lane*18);ctx.lineTo(player.face*(28+charge*28),lane*6);ctx.stroke();}
    }else{
      ctx.lineWidth=2.5+charge*3;for(let index=0;index<10;index++){const a=index*Math.PI*.2,distance=70-charge*42;const x=Math.cos(a)*distance,y=Math.sin(a)*distance;ctx.fillStyle=index%3===0?'#ffffff':color;ctx.fillRect(x-3,y-3,6,6);}
      ctx.fillStyle='rgba(4,2,12,.78)';ctx.fillRect(-14,-14,28,28);
    }
  } else if (action.startsWith('special') && phase) {
    drawSpecialEffect(player, fighter, action, color, phase, progress);
  } else if (player.chargeFrames) {
    const charge = clamp((player.chargeFrames - 10) / 80, 0, 1);
    const width = 58, x = -width / 2, y = -player.height / 2 - 24;
    ctx.shadowBlur = 8 + charge * 12;
    ctx.fillStyle = 'rgba(5,8,18,.9)'; ctx.fillRect(x - 3, y - 3, width + 6, 12);
    ctx.fillStyle = charge >= .99 ? '#ffffff' : color; ctx.fillRect(x, y, width * charge, 6);
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.strokeRect(x, y, width, 6);
    for (let segment = 1; segment < 4; segment++) { const marker = x + width * segment / 4; ctx.beginPath(); ctx.moveTo(marker, y); ctx.lineTo(marker, y + 6); ctx.stroke(); }
  } else if (active && player.actionHitbox && hitboxes) {
    const box = player.actionHitbox;
    ctx.globalAlpha = hitboxes ? .55 : .22;
    ctx.lineWidth = hitboxes ? 3 : 7;
    if (box.type === 'circle') {
      ctx.beginPath(); ctx.arc(box.x - player.x, box.y - player.y, box.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.roundRect(box.x - player.x - box.w / 2, box.y - player.y - box.h / 2, box.w, box.h, Math.min(18, box.h / 2)); ctx.fill(); ctx.stroke();
    }
  } else if (action.includes('Up')) {
    ctx.lineWidth *= .55 + effectStrength * .55;
    ctx.beginPath(); ctx.arc(0, -player.height * .55, 46, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
  } else if (action.includes('Down')) {
    ctx.lineWidth *= .55 + effectStrength * .55;
    ctx.beginPath(); ctx.ellipse(0, player.height / 2 + 5, 64, 15, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (action === 'grab') {
    // The reaching hands already communicate the grab. Keep debug geometry out of normal play.
  } else {
    const radius = (action.includes('Side') || action.includes('Forward') ? 49 : action.startsWith('special') ? 58 : 34) * (.72 + effectStrength * .28);
    const centerX = player.face * (player.width / 2 + radius * .24);
    const start = player.face > 0 ? -1.05 : Math.PI - 2.1;
    const end = player.face > 0 ? 1.05 : Math.PI + 2.1;
    ctx.beginPath(); ctx.arc(centerX, 0, radius, start, end); ctx.stroke();
    ctx.globalAlpha *= .45; ctx.lineWidth *= .42; ctx.beginPath(); ctx.arc(centerX, 0, radius + 10, start, end); ctx.stroke();
  }
  ctx.restore();
}

function drawSpecialCue(player, fighter, action, color, phase, progress) {
  if (!phase || phase === 'recovery') return;
  const up = action === 'specialUp', down = action === 'specialDown', side = action === 'specialSide';
  const energy = phase === 'active' ? 1 : clamp(progress, .08, 1);
  const anchorX = side ? player.face * (player.width / 2 + 10) : up || down ? 0 : player.face * (player.width / 2 + 8);
  const anchorY = up ? -player.height / 2 - 8 : down ? player.height / 2 + 2 : -5;
  const radius = 4 + energy * (fighter.id === 'blaze' ? 10 : 7);
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .18 + energy * .38;
  ctx.strokeStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(anchorX, anchorY, radius, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha *= .35; ctx.beginPath(); ctx.arc(anchorX, anchorY, radius + 6, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawAlignedStrike(player, action, color, progress, fighter) {
  const box = player.actionHitbox;
  if (!box) return;
  if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return;
  if (box.type === 'circle' ? !Number.isFinite(box.radius) : !Number.isFinite(box.w) || !Number.isFinite(box.h)) return;
  const motion = fighter.moves[action]?.motion || '';
  const x = box.x - player.x, y = box.y - player.y;
  const pulse = .7 + Math.sin(clamp(progress, 0, 1) * Math.PI) * .3;
  ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter'; ctx.shadowColor = color; ctx.shadowBlur = 9;
  if (box.type === 'circle') {
    const radius = box.radius * (.72 + pulse * .16);
    ctx.globalAlpha = .58; ctx.strokeStyle = color; ctx.lineWidth = motion.includes('wheel') || motion.includes('Spin') ? 5 : 3;
    ctx.beginPath(); ctx.arc(0, 0, radius, -Math.PI * .82, Math.PI * .72); ctx.stroke();
    ctx.globalAlpha = .28; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, radius * .72, Math.PI * .18, Math.PI * 1.55); ctx.stroke();
    if (motion.includes('wheel')) for (let i = 0; i < 4; i++) { const angle = i * Math.PI / 2 + progress * 2; ctx.beginPath(); ctx.moveTo(Math.cos(angle) * radius * .25, Math.sin(angle) * radius * .25); ctx.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius); ctx.stroke(); }
    ctx.restore();
    return;
  } else if (action === 'airNeutral') {
    // Match the two visible kicking legs; avoid implying a circular full-body hit.
    const direction = player.face;
    ctx.globalAlpha = .78; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-direction * box.w * .1, -box.h * .08);
    ctx.lineTo(direction * box.w * .44, box.h * .22);
    ctx.moveTo(direction * box.w * .1, box.h * .08);
    ctx.lineTo(-direction * box.w * .44, -box.h * .22);
    ctx.stroke();
  } else if (box.grab) {
    const direction = player.face;
    ctx.globalAlpha = .72; ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-direction * box.w * .28, -box.h * .24); ctx.lineTo(direction * box.w * .32, -box.h * .12); ctx.moveTo(-direction * box.w * .28, box.h * .24); ctx.lineTo(direction * box.w * .32, box.h * .12); ctx.stroke();
  } else {
    const vertical = action.includes('Up') || action.includes('Down');
    const direction = action.includes('Down') ? 1 : action.includes('Up') ? -1 : action.includes('Back') ? -player.face : player.face;
    const gradient = vertical ? ctx.createLinearGradient(0, -direction * box.h / 2, 0, direction * box.h / 2) : ctx.createLinearGradient(-direction * box.w / 2, 0, direction * box.w / 2, 0);
    gradient.addColorStop(0, 'rgba(255,255,255,0)'); gradient.addColorStop(.58, color); gradient.addColorStop(1, '#ffffff');
    ctx.fillStyle = gradient; ctx.globalAlpha = (motion === 'hammer' || motion === 'anvilDrop' ? .34 : .24) * pulse; ctx.beginPath();
    if (vertical) {
      const back = -direction * box.h / 2, front = direction * box.h / 2;
      ctx.moveTo(-box.w * .1, back); ctx.quadraticCurveTo(-box.w * .46, 0, 0, front); ctx.quadraticCurveTo(box.w * .46, 0, box.w * .1, back); ctx.closePath();
    } else {
      const back = -direction * box.w / 2, front = direction * box.w / 2;
      ctx.moveTo(back, -box.h * .1); ctx.quadraticCurveTo(0, -box.h * .46, front, 0); ctx.quadraticCurveTo(0, box.h * .46, back, box.h * .1); ctx.closePath();
    }
    ctx.fill();
    if (['lightningLunge','flashUpper','boltDive','backSpark'].includes(motion)) {
      ctx.globalAlpha = .88; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.5; ctx.beginPath();
      if (vertical) { const d=direction;ctx.moveTo(-8,-d*box.h*.32);ctx.lineTo(7,-d*box.h*.05);ctx.lineTo(-5,d*box.h*.14);ctx.lineTo(5,d*box.h*.42); }
      else { const d=direction;ctx.moveTo(-d*box.w*.34,-7);ctx.lineTo(-d*box.w*.08,6);ctx.lineTo(d*box.w*.14,-5);ctx.lineTo(d*box.w*.42,3); }
      ctx.stroke(); ctx.restore(); return;
    }
    if (['crescent','starRise','warpKick','cometDrop','blinkSlash'].includes(motion)) {
      ctx.globalAlpha = .86; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath();
      if (vertical) ctx.arc(0, 0, Math.max(box.w,box.h)*.38, direction>0?Math.PI*.1:Math.PI*1.1, direction>0?Math.PI*.9:Math.PI*1.9);
      else ctx.arc(-direction*box.w*.08,0,Math.max(box.w,box.h)*.42,direction>0?-Math.PI*.58:Math.PI*.42,direction>0?Math.PI*.58:Math.PI*1.58);
      ctx.stroke(); ctx.restore(); return;
    }
    ctx.globalAlpha = .82 * pulse; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = motion === 'hammer' || motion === 'backFist' ? 4 : 2; ctx.beginPath();
    if (vertical) { ctx.moveTo(0, -direction * box.h * .32); ctx.lineTo(0, direction * box.h * .4); }
    else { ctx.moveTo(-direction * box.w * .32, 0); ctx.lineTo(direction * box.w * .4, 0); }
    ctx.stroke();
  }
  ctx.restore();
}

function drawAttackEffectAligned(player, action, color, phase, progress, fighter) {
  if (player.chargeFrames) drawSpecialCue(player, fighter, action, color, 'charge', player.chargeFrames / 90);
  else if (action.startsWith('special') && !player.actionHitbox) drawSpecialCue(player, fighter, action, color, phase, progress);
  if (phase === 'active' && player.actionHitbox) drawAlignedStrike(player, action, color, progress, fighter);
}

function drawPlayer(p, dt) {
  if (p.eliminated || p.respawn > 0) return;
  const fighter = FIGHTERS.find(item => item.id === p.characterId) || FIGHTERS[0];
  const color = fighter.palettes[p.palette % fighter.palettes.length];
  const hitFlash = p.flashUntil > performance.now();
  const renderColor = hitFlash ? '#ffffff' : color;
  const action = displayedAction(p);
  if (p.keyframeAction !== action) {
    p.keyframeAction = action;
    p.keyframeAge = 0;
  } else if (p.hitstop <= 0) p.keyframeAge = (p.keyframeAge || 0) + dt;
  const moveMotion = p.actionMotion || fighter.moves[action]?.motion || '';
  const counterSuccess = p.actionVariant === 'counterSuccess';
  const cueAge = localCue ? performance.now() - localCue.started : 999;
  const attack = /ground|air|special|ultimate|item|throw|grab|pummel|getupAttack|dashAttack/.test(action);
  const up = action.includes('Up'), down = action.includes('Down'), side = action.includes('Side') || action.includes('Forward') || action.includes('Back') || action === 'dashAttack';
  const cueMove = fighter.moves[action] || { startup: 3, active: 3, recovery: 8 };
  const cueFrame = cueAge / (1000 / 60), cueActiveStart = cueMove.startup, cueRecoveryStart = cueMove.startup + cueMove.active;
  const cuePhase = cueFrame < cueActiveStart ? 'startup' : cueFrame < cueRecoveryStart ? 'active' : 'recovery';
  const waitingForServer = p.i === myIndex && localCue && p.ackSeq < localCue.seq;
  const phase = waitingForServer ? cuePhase : p.actionPhase;
  const rawProgress = waitingForServer ? cuePhase === 'startup' ? clamp(cueFrame / Math.max(1, cueMove.startup), 0, 1) : cuePhase === 'active' ? clamp((cueFrame - cueActiveStart) / Math.max(1, cueMove.active), 0, 1) : clamp((cueFrame - cueRecoveryStart) / Math.max(1, cueMove.recovery), 0, 1) : clamp(Number(p.phaseProgress) || 0, 0, 1);
  const visualPhaseKey = `${action}:${phase || 'none'}:${p.actionVariant || 'base'}`;
  if (p.visualPhaseKey !== visualPhaseKey || waitingForServer) {
    p.visualPhaseKey = visualPhaseKey;
    p.visualProgress = rawProgress;
  } else if (phase) {
    const phaseFrames = actionPhaseFrames(p, phase, action);
    const nextProgress = (Number(p.visualProgress) || 0) + (p.hitstop > 0 ? 0 : dt * 60 / phaseFrames);
    p.visualProgress = clamp(Math.max(rawProgress, Math.min(rawProgress + 2 / phaseFrames, nextProgress)), 0, 1);
  } else p.visualProgress = 0;
  const progress = waitingForServer ? rawProgress : p.visualProgress;
  const enteredActive = p.visualPhase !== phase && phase === 'active';
  p.visualPhase = phase;
  const motion = motionCurve(phase, progress);
  const visualVariant = waitingForServer ? localCue?.variant : p.actionVariant;
  let keyPose = keyframePoseFor(p, action, moveMotion, phase, progress, attack, p.keyframeAge || 0, visualVariant);
  const keyPoseFacing = action === 'hit' || action === 'groundHit' ? Math.sign(p.vx || p.face) || 1 : p.face;
  const smashPose = visualVariant === 'smash' || p.chargeFrames > 0;
  const chargeAmount = p.chargeFrames ? clamp((p.chargeFrames - 10) / 80, 0, 1) : clamp(((p.chargeScale || 1) - 1) / .8, 0, 1);
  const tiltPose = visualVariant === 'tilt';
  const strike = phase === 'startup' ? -.28 * Math.sin(progress * Math.PI / 2) : phase === 'active' ? 1 : phase === 'recovery' ? Math.cos(progress * Math.PI / 2) : 0;
  const run = Math.sin(performance.now() / 55 + p.x * .03);
  const bob = action === 'idle' && p.grounded ? Math.sin(performance.now() / 180 + p.i) * 1.5 : 0;
  const serverDoubleJumpSerial = Number(p.doubleJumpSerial) || 0;
  if (p.visualDoubleJumpSerial == null) p.visualDoubleJumpSerial = serverDoubleJumpSerial;
  if (serverDoubleJumpSerial > p.visualDoubleJumpSerial) {
    p.visualDoubleJumpAge = 0;
    p.visualDoubleJumpSerial = serverDoubleJumpSerial;
  } else if (serverDoubleJumpSerial < p.visualDoubleJumpSerial) {
    p.visualDoubleJumpSerial = serverDoubleJumpSerial;
    p.visualDoubleJumpAge = 1;
  }
  p.visualDoubleJumpAge = Math.min(1, (p.visualDoubleJumpAge ?? 1) + dt / .32);
  const doubleJumpActive = p.visualDoubleJumpAge < 1 && !attack && p.stun <= 0 && p.hitstop <= 0;
  const doubleJumpProgress = doubleJumpActive ? p.visualDoubleJumpAge * p.visualDoubleJumpAge * (3 - 2 * p.visualDoubleJumpAge) : 0;
  const doubleJumpTuck = doubleJumpActive ? Math.sin(doubleJumpProgress * Math.PI) : 0;
  if (doubleJumpActive) keyPose = sampleKeyframes(ONESHOT_KEYFRAMES.doubleJump, doubleJumpProgress);
  let scaleX = 1, scaleY = 1, rotation = 0, bodyX = 0, bodyY = bob;
  if (attack) {
    const anticipation = smashPose ? 1.45 : tiltPose ? .78 : 1;
    const release = smashPose ? 1.35 : tiltPose ? .88 : 1;
    bodyX -= p.face * 5 * motion.windup * anticipation;
    rotation += p.face * .09 * motion.windup * anticipation;
    bodyX += p.face * 8 * motion.impact * release;
    rotation -= p.face * .13 * motion.impact * release;
    bodyX += p.face * 3 * motion.recoil;
  }
  if (p.chargeFrames) {
    const tension = .35 + chargeAmount * .65;
    scaleX = 1.08 + .12 * tension; scaleY = .92 - .16 * tension;
    bodyX -= p.face * (5 + 9 * tension); bodyY = 3 + 5 * tension;
    rotation += p.face * (.08 + .11 * tension);
    if (chargeAmount > .45) {
      const tremor = (chargeAmount - .45) / .55;
      bodyX += Math.sin(performance.now() * .09 + p.i) * 1.25 * tremor;
      bodyY += Math.cos(performance.now() * .12 + p.i) * .75 * tremor;
    }
  }
  if (down && attack) { scaleX = 1 + .2 * Math.max(0, strike); scaleY = 1 - .25 * Math.max(0, strike); bodyY = 8 * Math.max(0, strike); }
  if (up && attack) { scaleX = 1 - .16 * Math.max(0, strike); scaleY = 1 + .18 * Math.max(0, strike); bodyY = -6 * Math.max(0, strike); }
  if (side && attack) { rotation = p.face * -.15 * strike; bodyX = p.face * 8 * strike; }
  if (smashPose && phase === 'active') {
    bodyX += p.face * chargeAmount * 12;
    rotation -= p.face * chargeAmount * .12;
    scaleX += chargeAmount * .12;
    scaleY -= chargeAmount * .08;
  }
  if (enteredActive && smashPose) {
    screenShake = Math.max(screenShake, 2.5 + chargeAmount * 3.5);
    cameraPunch = Math.max(cameraPunch, .018 + chargeAmount * .028);
    if (p.i === myIndex) beep(105 - chargeAmount * 35, .035 + chargeAmount * .025, 'square');
  }
  if (attack && !side && !up && !down) { rotation = p.face * -.07 * strike; bodyX = p.face * 5 * strike; scaleX += .06 * Math.max(0,strike); }
  if (action === 'run' || action === 'dash' || action === 'dashAttack') rotation = p.face * .07;
  if (action === 'walk') rotation = p.face * .025;
  if (action === 'crouch') { scaleX = 1.16; scaleY = .72; bodyY = 10; }
  if (action === 'jump') { scaleX = .9; scaleY = 1.08; }
  if (action === 'jumpSquat') { scaleX = 1.24; scaleY = .72; bodyY = 9; }
  if (action === 'fall') { scaleX = 1.08; scaleY = .94; }
  if (doubleJumpActive) {
    rotation = p.face * Math.PI * 2 * doubleJumpProgress;
    scaleX = .88 + doubleJumpTuck * .3;
    scaleY = 1.12 - doubleJumpTuck * .34;
    bodyY = -5 - doubleJumpTuck * 8;
  }
  if (action === 'landing') { scaleX = 1.2; scaleY = .78; bodyY = 7; }
  if (action === 'grabHold') { scaleX = 1.06; scaleY = .94; bodyX = p.face * 4; }
  if (action === 'pummel') { scaleX = 1.14; scaleY = .88; bodyX = p.face * 9; rotation = p.face * -.1; }
  if (action === 'grabbed') { scaleX = .82; scaleY = 1.08; rotation = p.face * .08; bodyY = -2; }
  if (action === 'grabbedHit') { scaleX = 1.12; scaleY = .78; rotation = -p.face * .16; bodyX = -p.face * 5; bodyY = 7; }
  const launchDirection = Math.sign(p.vx || p.face) || 1;
  if (action === 'hit') { scaleX = .72; scaleY = 1.22; bodyX = launchDirection * 8; bodyY = -7; rotation = launchDirection * .34; }
  if (action === 'groundHit') { scaleX = 1.22; scaleY = .72; bodyX = launchDirection * 6; bodyY = 11; rotation = launchDirection * .24; }
  if (action === 'grabEscape') { scaleX = 1.12; scaleY = .86; bodyX = -p.face * 8; bodyY = 6; rotation = -p.face * .13; }
  if (action.startsWith('throw')) {
    const backThrow = action === 'throwBack', verticalThrow = action === 'throwUp' || action === 'throwDown';
    rotation = verticalThrow ? p.face * .08 * motion.recoil : p.face * (backThrow ? .28 : -.24) * Math.max(motion.impact, motion.recoil);
    bodyX = p.face * (backThrow ? -10 : 13) * Math.max(motion.impact, motion.recoil);
    scaleX = 1.12; scaleY = .9;
  }
  if (['sparkJab','lightningLunge','blinkSlash'].includes(moveMotion) && attack) bodyX += p.face * 7 * Math.max(0, strike);
  if (['hammer','heavyJab','bodyCheck','backFist'].includes(moveMotion) && attack) { scaleX += .14 * Math.max(0, strike); scaleY -= .1 * Math.max(0, strike); bodyY += 5 * Math.max(0, strike); }
  if (['launcher','flashUpper','starRise','springKick'].includes(moveMotion) && attack) { scaleX -= .1 * Math.max(0, strike); scaleY += .18 * Math.max(0, strike); bodyY -= 7 * Math.max(0, strike); }
  if (['wheelSpin','ironSpin','voltSpin','starOrbit','backRoll'].includes(moveMotion) && attack && action !== 'airNeutral') rotation += p.face * (phase === 'active' ? progress * 2.6 : phase === 'recovery' ? 2.6 * (1-progress) : -.25 * progress);
  if (['anvilDrop','boltDive','wheelDrop','cometDrop'].includes(moveMotion) && attack) { scaleX += .12 * Math.max(0,strike); scaleY += .16 * Math.max(0,strike); rotation *= .35; }
  const rolling = action === 'techRoll' || action === 'getupRoll' || action === 'roll' || action === 'ledgeRoll';
  const rollDuration = Math.max(1, p.dodgeTotalFrames || (action === 'techRoll' ? 16 : action === 'getupRoll' ? 20 : action === 'ledgeRoll' ? 18 : 22));
  const rollProgress = rolling ? clamp((p.dodgeElapsed ?? (rollDuration - (p.dodgeFrames || 0))) / rollDuration, 0, 1) : 0;
  const rollEase = rollProgress * rollProgress * (3 - 2 * rollProgress);
  const rollTuck = rolling ? Math.sin(rollProgress * Math.PI) : 0;
  const rollDirection = rolling ? (Math.sign(p.vx || p.face) || 1) : p.face;
  const airDodgeDuration = Math.max(1, p.dodgeTotalFrames || (p.dodgeNeutral ? 42 : 50));
  const airDodgeProgress = action === 'airDodge' ? clamp((p.dodgeElapsed || 0) / airDodgeDuration, 0, 1) : 0;
  const airDodgeTuck = action === 'airDodge' ? Math.sin(airDodgeProgress * Math.PI) : 0;
  const spinning = action === 'tumble';
  if (spinning) {
    const spinDirection = Math.sign(p.vx || p.face);
    p.visualSpin = (p.visualSpin || 0) + spinDirection * dt * 5.5;
    rotation = p.visualSpin;
  } else p.visualSpin = rotation;
  if (action === 'tumble') { scaleX = .92; scaleY = 1.08; }
  if (rolling) {
    scaleX = 1 + .2 * rollTuck;
    scaleY = 1 - .38 * rollTuck;
    bodyY = (p.grounded ? 15 : 5) * rollTuck;
    rotation = rollDirection * rollEase * Math.PI * 2.2;
  }
  if (action === 'knockdown') { rotation = p.face * 1.45; scaleX = 1.12; scaleY = .7; bodyY = p.height * .31; }
  if (action === 'tech') { scaleX = 1.28; scaleY = .68; bodyY = 8; }
  if (action === 'spotDodge') {
    const spotDuration = Math.max(1, p.dodgeTotalFrames || 24), spotProgress = clamp((p.dodgeElapsed || 0) / spotDuration, 0, 1);
    const spotTuck = Math.sin(spotProgress * Math.PI);
    scaleX = 1 - .2 * spotTuck; scaleY = 1 + .08 * spotTuck;
    bodyX = -p.face * 9 * spotTuck; bodyY = -5 * spotTuck; rotation = -p.face * .16 * spotTuck;
  }
  if (action === 'airDodge') {
    const windupRatio = p.dodgeNeutral ? 0 : clamp((p.dodgeWindupFrames || 4) / airDodgeDuration, 0, .2);
    const inWindup = airDodgeProgress < windupRatio;
    scaleX = 1 - (p.dodgeNeutral ? .16 : .28) * airDodgeTuck;
    scaleY = 1 + (p.dodgeNeutral ? .1 : .16) * airDodgeTuck;
    rotation = p.dodgeNeutral ? p.face * .08 * airDodgeTuck : clamp((p.dodgeStartVy || 0) / 360, -1, 1) * .38 - clamp((p.dodgeStartVx || 0) / 390, -1, 1) * (inWindup ? -.16 : .12);
    bodyY = -5 * airDodgeTuck;
  }
  if (action === 'airRecover') { scaleX = 1.08; scaleY = .94; rotation = -p.face * .08; bodyY = -4; }
  if (p.shielding || action === 'shield' || action === 'shieldHit') { scaleX = 1.16; scaleY = .78; bodyY = 8; }
  if (action === 'parryReady') { scaleX = 1.08; scaleY = .94; bodyY = -3; rotation = 0; }
  if (action === 'parrySuccess') { scaleX = 1.24; scaleY = .78; bodyX = p.face * 5; bodyY = 7; rotation = -p.face * .12; }
  if (action === 'getup') { scaleX = .9; scaleY = 1.1; bodyY = -4; }
  if (action === 'airNeutral') {
    const airKick = phase === 'startup' ? -progress * .12 : phase === 'active' ? .18 + progress * .12 : .3 * (1 - progress);
    rotation = p.face * airKick;
    scaleX = 1.04; scaleY = .96; bodyY -= 2 * Math.max(0, strike);
  }
  if (action === 'airForward') rotation += p.face * -.2 * Math.max(0, strike);
  if (action === 'airBack') rotation += p.face * .24 * Math.max(0, strike);
  if (action === 'airUp') rotation += p.face * .12 * Math.max(0, strike);
  if (action === 'airDown') { rotation *= .35; scaleX += .08 * Math.max(0, strike); scaleY += .12 * Math.max(0, strike); }
  if (action.startsWith('special')) {
    const motion = moveMotion;
    const windup = phase === 'startup' || phase === 'charge' ? progress : phase === 'active' ? 1 - progress * .35 : 0;
    const activeEase = phase === 'active' ? progress * progress * (3 - 2 * progress) : 0;
    const release = phase === 'active' ? activeEase : phase === 'recovery' ? 1 - progress : 0;
    if (motion === 'cast' || motion === 'cannon' || motion === 'throw') { bodyX = -p.face * 12 * windup + p.face * 16 * release; rotation = p.face * (.2 * windup - .34 * release); scaleY = 1 - .16 * windup; scaleX = 1 + .18 * windup; }
    if (motion === 'rush' || motion === 'shoulder') { bodyX = p.face * 20 * release; rotation = p.face * -.32 * release; scaleX = 1 + .3 * release; scaleY = 1 - .22 * release; }
    if (motion === 'roll') rotation = p.face * (p.actionFrame || cueAge / 16) * .65;
    if (motion === 'blink') { scaleX = phase === 'active' ? .34 : 1 + .2 * windup; scaleY = phase === 'active' ? 1.5 : 1 - .16 * windup; }
    if (motion === 'rise' || motion === 'rocket' || motion === 'spring' || motion === 'warp') { scaleX = 1 - .28 * release; scaleY = 1 + .42 * release; bodyY -= 17 * release; }
    if (motion === 'deploy' || motion === 'discharge' || motion === 'gravity') { scaleX = 1 + .36 * release; scaleY = 1 - .4 * release; bodyY += 14 * release; }
    if (motion === 'quake') {
      const prepare = phase === 'startup' ? progress * progress * (3 - 2 * progress) : 0;
      const impact = phase === 'active' ? 1 : phase === 'recovery' ? 1 - progress * progress * (3 - 2 * progress) : 0;
      scaleX = 1 - .08 * prepare + .25 * impact;
      scaleY = 1 + .13 * prepare - .24 * impact;
      bodyX = 0; bodyY = 0; rotation = 0;
    }
    if (motion === 'counter') {
      if (counterSuccess) {
        const punch = phase === 'active' ? 1 : Math.max(0, 1 - progress);
        scaleX = 1.18 + punch * .34; scaleY = .82 - punch * .12;
        bodyX = p.face * punch * 18; bodyY = 7; rotation = -p.face * punch * .18;
      } else {
        scaleX = 1.2; scaleY = .84; bodyX = -p.face * 5; bodyY = 7; rotation = p.face * .08;
      }
    }
  }
  if (keyPose) {
    bodyX = keyPose.bodyX * keyPoseFacing;
    bodyY = keyPose.bodyY;
    rotation = keyPose.rotation * keyPoseFacing;
    scaleX = keyPose.scaleX;
    scaleY = keyPose.scaleY;
  }
  if (p.hitstop > 0) { scaleX *= 1.08; scaleY *= .92; bodyY -= 2; }
  if (p.grounded) bodyY += p.height / 2 * (1 - scaleY);
  const targetPose={scaleX,scaleY,rotation,bodyX,bodyY};
  const pose=p.visualPose||={...targetPose};
  const doubleJumpEnded = !doubleJumpActive && p.visualDoubleJumpWasActive;
  if (p.visualAction !== action) {
    if (Math.abs(pose.rotation) > Math.PI) pose.rotation = 0;
    p.visualAction = action;
    p.visualActionAge = 0;
  } else p.visualActionAge = (p.visualActionAge || 0) + dt;
  const poseRate=p.hitstop>0?90:keyPose?96:doubleJumpActive?72:action==='groundHit'?62:spinning?38:rolling?36:enteredActive?72:phase==='active'?58:phase==='startup'?34:phase==='recovery'?30:attack?26:22,poseMix=1-Math.exp(-Math.max(.001,dt)*poseRate);
  for(const key of Object.keys(targetPose))pose[key]=lerp(pose[key],targetPose[key],poseMix);
  if (doubleJumpActive) pose.rotation = rotation;
  else if (doubleJumpEnded) pose.rotation = 0;
  p.visualDoubleJumpWasActive = doubleJumpActive;
  ({scaleX,scaleY,rotation,bodyX,bodyY}=pose);

  ctx.save(); ctx.translate(p.x, p.y);
  if (action === 'dash' || action === 'dashAttack' || action === 'specialSide') {
    ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let i = 1; i <= 4; i++) { const offset=-p.face*i*17;ctx.globalAlpha=.16/i*2;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(offset,-p.height*.34);ctx.lineTo(offset,p.height*.28);ctx.stroke(); }
  }
  if (action === 'airRecover') {
    const recoverAge=clamp((p.visualActionAge||0)/.14,0,1);
    ctx.save();ctx.globalAlpha=(1-recoverAge)*.72;ctx.strokeStyle='#b9fbff';ctx.lineWidth=3;ctx.shadowBlur=12;ctx.shadowColor='#65ecff';
    ctx.beginPath();ctx.arc(0,0,p.width*.55+recoverAge*16,-Math.PI*.85,Math.PI*.7);ctx.stroke();ctx.restore();
  }
  ctx.globalAlpha = p.invincible > 0 && Math.floor(p.invincible / 3) % 2 ? .42 : 1;
  if (p.shielding) {
    const shieldScale = .58 + .42 * clamp((p.shield || 0) / 100, 0, 1);
    const shieldRadius = Math.max(p.width * .9 + 15, p.height * .75 + 12) * shieldScale;
    const shieldHit = action === 'shieldHit';
    ctx.fillStyle = shieldHit ? 'rgba(255,174,82,.34)' : 'rgba(100,224,255,.3)'; ctx.strokeStyle = shieldHit ? '#fff0a8' : p.parryFrames > 0 ? '#fff36b' : '#d9fbff'; ctx.lineWidth = shieldHit ? 6 : p.parryFrames > 0 ? 5 : 4;
    ctx.shadowBlur=shieldHit?20:12;ctx.shadowColor=ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur=0;ctx.globalAlpha*=.72;ctx.beginPath();ctx.moveTo(-12,-3);ctx.lineTo(0,10);ctx.lineTo(12,-3);ctx.stroke();
    ctx.globalAlpha*=.65;ctx.lineWidth=2;ctx.beginPath();
    ctx.arc(p.face * shieldRadius * .16, 0, shieldRadius * .62, -Math.PI * .68, Math.PI * .68);
    ctx.stroke();
    if ((p.shield || 100) < 42) {
      const crack = shieldRadius * .46;
      ctx.globalAlpha=.82;ctx.strokeStyle='#ffcf78';ctx.beginPath();
      ctx.moveTo(-crack*.18,-crack);ctx.lineTo(crack*.06,-crack*.42);ctx.lineTo(-crack*.14,-crack*.05);
      ctx.lineTo(crack*.16,crack*.34);ctx.lineTo(crack*.05,crack*.82);ctx.stroke();
    }
    ctx.globalAlpha=1;
  }
  if (p.parryFrames > 0 && !p.shielding) {
    ctx.strokeStyle = '#fff36b'; ctx.lineWidth = 5; ctx.globalAlpha *= .45 + p.parryFrames * .12;
    ctx.beginPath(); ctx.arc(0, 0, p.width + (5 - p.parryFrames) * 8, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.translate(bodyX, bodyY); ctx.rotate(rotation); ctx.scale(scaleX, scaleY);
  const legLength = 18, bodyHeight = p.height - legLength, bodyCenterY = -legLength / 2;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const targetLegSwing = action === 'dash' ? run * 13 : action === 'run' ? run * 9 : action === 'walk' ? run * 5 : 0;
  p.visualLegSwing = lerp(p.visualLegSwing || 0, targetLegSwing, 1-Math.exp(-Math.max(.001,dt)*24));
  const legSwing = p.visualLegSwing;
  const hipY = p.height / 2 - legLength - 1;
  const legStrike = action === 'groundDown' || action === 'airForward' || action === 'airBack' || action === 'airDown' || action === 'airNeutral';
  const localStrikePoint = point => {
    const relX = point.x - p.x - bodyX, relY = point.y - p.y - bodyY, cos = Math.cos(rotation), sin = Math.sin(rotation);
    return {
      x: (relX * cos + relY * sin) / Math.max(.01, scaleX),
      y: (-relX * sin + relY * cos) / Math.max(.01, scaleY)
    };
  };
  const limitLimb = (originX, originY, point, maxLength) => {
    const reachX = point.x - originX, reachY = point.y - originY;
    const amount = Math.min(1, maxLength / Math.max(1, Math.hypot(reachX, reachY)));
    return { x: originX + reachX * amount, y: originY + reachY * amount };
  };
  let frontFootX = p.face * (11 + legSwing), frontFootY = p.height / 2;
  let backFootX = -p.face * (11 + legSwing), backFootY = p.height / 2;
  if (attack && p.grounded && !action.startsWith('throw')) {
    frontFootX = p.face * (15 + motion.impact * 7);
    backFootX = -p.face * (14 + motion.windup * 6);
    frontFootY = backFootY = p.height / 2;
  }
  if (action === 'groundNeutral' || action === 'groundJab2') {
    frontFootX = p.face * (14 + motion.impact * 5);
    backFootX = -p.face * (16 + motion.windup * 4);
  }
  if (action === 'groundSide') {
    frontFootX = p.face * (17 + motion.impact * 13);
    backFootX = -p.face * (19 + motion.windup * 4);
  }
  if (action === 'groundDown') { frontFootX = p.face * (20 + Math.max(0, strike) * 37); frontFootY = hipY + 11; backFootX = -p.face * 15; backFootY = p.height / 2; }
  if (action === 'airForward') { frontFootX = p.face * (22 + Math.max(0, strike) * 40); frontFootY = hipY - 2; backFootX = -p.face * 18; backFootY = hipY + 17; }
  if (action === 'airBack') { backFootX = -p.face * (24 + Math.max(0, strike) * 42); backFootY = hipY - 4; frontFootX = p.face * 18; frontFootY = hipY + 18; }
  if (action === 'airNeutral') { frontFootX = p.face * (24 + Math.max(0, strike) * 24); frontFootY = hipY + 19; backFootX = -p.face * (24 + Math.max(0, strike) * 18); backFootY = hipY - 2; }
  if (action === 'airDown') { frontFootX = p.face * 8; frontFootY = p.height / 2 + Math.max(0, strike) * 30; backFootX = -p.face * 8; backFootY = p.height / 2 + Math.max(0, strike) * 25; }
  if ((action === 'dashAttack' || action === 'specialSide') && phase === 'active') { frontFootX = -p.face * 2; backFootX = -p.face * 27; backFootY = hipY + 12; }
  if (action === 'grabHold') { frontFootX = p.face * 18; backFootX = -p.face * 18; }
  if (action === 'grabbed') { frontFootX = p.face * 7; backFootX = -p.face * 7; frontFootY = backFootY = p.height / 2 + 3; }
  if (action === 'grabbedHit') { frontFootX = p.face * 14; backFootX = -p.face * 13; frontFootY = backFootY = p.height / 2 + 3; }
  if (action.startsWith('throw')) { frontFootX = p.face * 24; backFootX = -p.face * 20; }
  if (action === 'hit' || action === 'grabEscape') { frontFootX = launchDirection * 20; backFootX = -launchDirection * 14; frontFootY = hipY + 14; backFootY = hipY + 8; }
  if (action === 'groundHit') { frontFootX = launchDirection * 27; backFootX = -launchDirection * 24; frontFootY = backFootY = p.height / 2; }
  if (action === 'tumble') { frontFootX = p.face * 29; frontFootY = hipY - 2; backFootX = -p.face * 27; backFootY = hipY + 18; }
  if (rolling) {
    frontFootX = lerp(p.face*12,p.face*5,rollTuck); frontFootY = lerp(p.height/2,hipY+7,rollTuck);
    backFootX = lerp(-p.face*12,-p.face*5,rollTuck); backFootY = lerp(p.height/2,hipY+7,rollTuck);
  }
  if (action === 'airDodge') {
    frontFootX = p.face * lerp(13, 5, airDodgeTuck); frontFootY = hipY + lerp(18, 8, airDodgeTuck);
    backFootX = -p.face * lerp(13, 5, airDodgeTuck); backFootY = hipY + lerp(16, 8, airDodgeTuck);
  }
  if (action === 'airRecover') { frontFootX = p.face * 19; frontFootY = hipY + 17; backFootX = -p.face * 17; backFootY = hipY + 12; }
  if (doubleJumpActive) {
    frontFootX = p.face * (10 - doubleJumpTuck * 4); frontFootY = hipY + 16 - doubleJumpTuck * 9;
    backFootX = -p.face * (10 - doubleJumpTuck * 4); backFootY = hipY + 13 - doubleJumpTuck * 7;
  }
  if (p.shielding || action === 'shield' || action === 'shieldHit') { frontFootX = p.face * 21; backFootX = -p.face * 21; frontFootY = backFootY = p.height / 2; }
  if (action === 'parryReady') { frontFootX = p.face * 24; backFootX = -p.face * 24; }
  if (keyPose) {
    frontFootX = keyPoseFacing * keyPose.frontFootX;
    backFootX = keyPoseFacing * keyPose.backFootX;
    frontFootY = p.height / 2 - keyPose.frontFootLift;
    backFootY = p.height / 2 - keyPose.backFootLift;
  }
  if (phase === 'active' && legStrike && p.strikePoints?.length) {
    const primaryHipX = action === 'airBack' ? -p.face * 6 : p.face * 6;
    const primary = limitLimb(primaryHipX, hipY, localStrikePoint(p.strikePoints[0]), 82);
    if (action === 'airBack') { backFootX = primary.x; backFootY = primary.y; }
    else { frontFootX = primary.x; frontFootY = primary.y; }
    if (p.strikePoints[1]) {
      const secondary = limitLimb(-p.face * 6, hipY, localStrikePoint(p.strikePoints[1]), 82);
      backFootX = secondary.x; backFootY = secondary.y;
    }
  }
  const targetFeet={frontFootX,frontFootY,backFootX,backFootY},feet=p.visualFeet||={...targetFeet},feetMix=1-Math.exp(-Math.max(.001,dt)*(p.hitstop>0||action==='groundHit'?90:keyPose?108:enteredActive?110:phase==='active'?72:phase==='startup'?38:phase==='recovery'?28:22));
  for(const key of Object.keys(targetFeet))feet[key]=lerp(feet[key],targetFeet[key],feetMix);
  ({frontFootX,frontFootY,backFootX,backFootY}=feet);
  const frontKnee=[(p.face*6+frontFootX)*.5+p.face*4,(hipY+frontFootY)*.5];
  const backKnee=[(-p.face*6+backFootX)*.5-p.face*4,(hipY+backFootY)*.5];
  drawOutlinedLimb([[-p.face*4,hipY],backKnee,[backFootX,backFootY]],renderColor,.58,4);
  drawOutlinedLimb([[p.face*4,hipY],frontKnee,[frontFootX,frontFootY]],renderColor,1,5);
  let frontX = p.face * 23, frontY = 3, backX = -p.face * 18, backY = 7;
    if (attack) {
    const windup = phase === 'startup' ? progress : 0, extension = Math.max(0, strike);
    if (action === 'groundNeutral' || action === 'groundJab2' || action === 'groundJab3' || action === 'pummel') { frontX = p.face * (12 - windup * 21 + extension * 47); frontY = -8 + windup * 8; backX = -p.face * 18; backY = -1; }
    else if (action === 'groundSide' || action === 'dashAttack') { frontX = p.face * (10 - windup * 27 + extension * 61); frontY = -7; backX = -p.face * (14 + windup * 12); backY = 10; }
    else if (action === 'grab') { frontX = p.face * (14 + extension * 39); frontY = -9; backX = p.face * (8 + extension * 35); backY = 9; }
    else if (action === 'airNeutral') { frontX = p.face * (20 + extension * 8); frontY = -15; backX = -p.face * (17 + extension * 6); backY = -8; }
    else if (action === 'airForward') { frontX = -p.face * 21; frontY = -13; backX = -p.face * 27; backY = 7; }
    else if (action === 'airBack') { frontX = p.face * 23; frontY = -11; backX = p.face * 28; backY = 10; }
    else if (action === 'airDown') { frontX = p.face * 25; frontY = -15; backX = -p.face * 25; backY = -15; }
    else if (up) { frontX = p.face * 8; frontY = -p.height / 2 - 22; backX = -p.face * 7; backY = -p.height / 2 - 10; }
    else if (down) { frontX = p.face * 28; frontY = p.height / 2 - 1; backX = -p.face * 24; backY = p.height / 2 - 4; }
    else { frontX = p.face * (20 + (action.startsWith('special') ? 30 : 20) * extension); frontY = -4; backX = p.face * (10 + 12 * extension); backY = 12; }
    if (['hammer','heavyJab','backFist'].includes(moveMotion)) { frontX=p.face*(18+Math.max(0,strike)*48);frontY=-10;backX=p.face*(8+Math.max(0,strike)*38);backY=8; }
    if (['launcher','flashUpper','starRise'].includes(moveMotion)) { frontX=p.face*7;frontY=-p.height/2-24*Math.max(0,strike);backX=-p.face*7;backY=-p.height/2-12*Math.max(0,strike); }
    if (['starJab','orbJab','sparkJab'].includes(moveMotion)) { frontX=p.face*(15+Math.max(0,strike)*42);frontY=-5;backX=-p.face*15;backY=5; }
    if (action.startsWith('special')) {
      const motion = moveMotion;
      if (['cast','cannon','throw'].includes(motion)) { frontX = p.face * (22 + 45 * Math.max(extension, .25)); frontY = -15; backX = p.face * (10 + 34 * Math.max(extension, .2)); backY = 13; }
      else if (motion === 'quake') {
        const impact = phase === 'active' ? 1 : phase === 'recovery' ? 1 - progress * progress * (3 - 2 * progress) : 0;
        const readyY = -p.height / 2 + 7, groundY = p.height / 2 - 3;
        frontX = lerp(p.face * 17, p.face * 45, impact);
        frontY = lerp(readyY, groundY, impact);
        backX = lerp(-p.face * 17, -p.face * 45, impact);
        backY = lerp(readyY + 3, groundY, impact);
      }
      else if (['deploy','discharge','gravity'].includes(motion)) { frontX = p.face * 42; frontY = p.height / 2 + 1; backX = -p.face * 38; backY = p.height / 2; }
      else if (motion === 'counter') {
        if (counterSuccess) {
          frontX = p.face * 68; frontY = -5;
          backX = -p.face * 18; backY = 12;
        } else {
          frontX = p.face * 25; frontY = -18;
          backX = -p.face * 20; backY = -12;
        }
      }
      else if (motion === 'shoulder' || motion === 'rush') { frontX = p.face * 17; frontY = -8; backX = -p.face * 31; backY = 8; }
      else if (motion === 'roll') { frontX = p.face * 7; frontY = 13; backX = -p.face * 7; backY = 13; }
      else if (motion === 'blink') { frontX = p.face * 21; frontY = -17; backX = -p.face * 21; backY = 14; }
      else if (['rise','rocket','spring','warp'].includes(motion)) { frontX = p.face * 11; frontY = -p.height / 2 - 19; backX = -p.face * 9; backY = -p.height / 2 - 8; }
    }
  }
  if (action === 'grabHold') {
    frontX = p.face * 34; frontY = -12;
    backX = p.face * 31; backY = 12;
  } else if (action === 'grabbed') {
    frontX = -p.face * 8; frontY = -18;
    backX = p.face * 5; backY = -21;
  } else if (action === 'grabbedHit') {
    frontX = -p.face * 24; frontY = -16;
    backX = -p.face * 18; backY = 18;
  } else if (action.startsWith('throw')) {
    const throwAmount = phase === 'startup' ? .16 + progress * .3 : Math.max(.48, motion.impact, motion.recoil);
    if (action === 'throwUp') { frontX = p.face * 9; frontY = -p.height / 2 - 31 * throwAmount; backX = -p.face * 8; backY = -p.height / 2 - 23 * throwAmount; }
    else if (action === 'throwDown') { frontX = p.face * 30; frontY = p.height / 2 - 2; backX = -p.face * 23; backY = p.height / 2 - 4; }
    else if (action === 'throwBack') { frontX = -p.face * (17 + 34 * throwAmount); frontY = -12; backX = -p.face * (10 + 27 * throwAmount); backY = 12; }
    else { frontX = p.face * (22 + 31 * throwAmount); frontY = -9; backX = p.face * (12 + 24 * throwAmount); backY = 11; }
  } else if (action === 'hit') {
    frontX = -launchDirection * 31; frontY = -21;
    backX = -launchDirection * 24; backY = 19;
  } else if (action === 'groundHit') {
    frontX = -launchDirection * 34; frontY = -14;
    backX = -launchDirection * 27; backY = 15;
  } else if (action === 'grabEscape') {
    frontX = -p.face * 30; frontY = 3;
    backX = p.face * 23; backY = -14;
  }
  if (action === 'tumble') {
    frontX = p.face * 31; frontY = -24;
    backX = -p.face * 31; backY = 22;
  } else if (rolling) {
    frontX = lerp(p.face*22,p.face*6,rollTuck); frontY = lerp(3,12,rollTuck);
    backX = lerp(-p.face*18,-p.face*6,rollTuck); backY = lerp(7,12,rollTuck);
  } else if (action === 'airDodge') {
    frontX = p.face * lerp(20, 7, airDodgeTuck); frontY = lerp(-7, 8, airDodgeTuck);
    backX = -p.face * lerp(20, 7, airDodgeTuck); backY = lerp(-3, 8, airDodgeTuck);
  } else if (action === 'airRecover') {
    frontX = p.face * 28; frontY = -15;
    backX = -p.face * 25; backY = -10;
  } else if (doubleJumpActive) {
    frontX = p.face * (24 - doubleJumpTuck * 14); frontY = -15 + doubleJumpTuck * 12;
    backX = -p.face * (24 - doubleJumpTuck * 14); backY = -10 + doubleJumpTuck * 9;
  } else if (p.shielding || action === 'shield' || action === 'shieldHit') {
    frontX = -p.face * 16; frontY = -10;
    backX = p.face * 14; backY = -6;
  } else if (action === 'parryReady') {
    frontX = p.face * 31; frontY = -20;
    backX = -p.face * 31; backY = -20;
  } else if (action === 'parrySuccess') {
    frontX = p.face * 38; frontY = -23;
    backX = -p.face * 38; backY = -23;
  }
  if (keyPose) {
    frontX = keyPoseFacing * keyPose.frontHandX;
    frontY = keyPose.frontHandY;
    backX = keyPoseFacing * keyPose.backHandX;
    backY = keyPose.backHandY;
  }
  if (phase === 'active' && p.strikePoints?.length && !legStrike) {
    const shoulderY = bodyCenterY - 2;
    const primary = limitLimb(p.face * 6, shoulderY, localStrikePoint(p.strikePoints[0]), 82);
    frontX = primary.x; frontY = primary.y - bodyCenterY;
    if (p.strikePoints[1]) {
      const secondary = limitLimb(-p.face * 6, shoulderY, localStrikePoint(p.strikePoints[1]), 82);
      backX = secondary.x; backY = secondary.y - bodyCenterY;
    }
  }
  const targetArms={frontX,frontY,backX,backY},arms=p.visualArms||={...targetArms},armMix=1-Math.exp(-Math.max(.001,dt)*(p.hitstop>0||action==='groundHit'?96:keyPose?116:enteredActive?116:phase==='active'?76:phase==='startup'?40:phase==='recovery'?30:23));
  for(const key of Object.keys(targetArms))arms[key]=lerp(arms[key],targetArms[key],armMix);
  ({frontX,frontY,backX,backY}=arms);
  const frontElbow=[(p.face*7+frontX)*.52+p.face*4,(bodyCenterY-7+frontY+bodyCenterY)*.5];
  const backElbow=[(-p.face*6+backX)*.52-p.face*3,(bodyCenterY-4+backY+bodyCenterY)*.5];
  drawOutlinedLimb([[-p.face*4,bodyCenterY-4],backElbow,[backX,backY+bodyCenterY]],renderColor,.58,4);
  drawOutlinedLimb([[p.face*4,bodyCenterY-6],frontElbow,[frontX,frontY+bodyCenterY]],renderColor,1,5);

  const bodyColor = renderColor;
  const headY=bodyCenterY-bodyHeight*.33,headRadius=fighter.id==='blaze'?13:12,torsoBottom=bodyCenterY+bodyHeight*.43;
  ctx.shadowBlur=hitFlash?14:6;ctx.shadowColor=renderColor;ctx.lineCap='round';
  ctx.strokeStyle='#080d19';ctx.lineWidth=10;ctx.beginPath();ctx.moveTo(0,headY+headRadius*.72);ctx.lineTo(0,torsoBottom);ctx.stroke();
  ctx.strokeStyle=bodyColor;ctx.lineWidth=5;ctx.stroke();ctx.shadowBlur=0;
  ctx.beginPath();
  if(fighter.id==='volt'){
    const points=[[-headRadius*.9,-headRadius*.45],[-headRadius*.42,-headRadius*.72],[-headRadius*.12,-headRadius*1.25],[headRadius*.18,-headRadius*.78],[headRadius*.72,-headRadius*.98],[headRadius*.6,-headRadius*.42],[headRadius,0],[headRadius*.55,headRadius*.75],[-headRadius*.55,headRadius*.75],[-headRadius,0]];
    points.forEach(([x,y],index)=>index?ctx.lineTo(x,headY+y):ctx.moveTo(x,headY+y));ctx.closePath();
  }else if(fighter.id==='blaze'){
    ctx.moveTo(-headRadius,headY+headRadius*.72);ctx.lineTo(-headRadius,headY-headRadius*.45);ctx.lineTo(-headRadius*.5,headY-headRadius*.78);ctx.lineTo(-headRadius*.22,headY-headRadius*1.3);ctx.lineTo(headRadius*.15,headY-headRadius*.78);ctx.lineTo(headRadius*.65,headY-headRadius*1.12);ctx.lineTo(headRadius,headY-headRadius*.38);ctx.lineTo(headRadius,headY+headRadius*.72);ctx.closePath();
  }else if(fighter.id==='bolt'){
    ctx.arc(0,headY,headRadius,0,Math.PI*2);ctx.moveTo(-headRadius,headY);ctx.lineTo(-headRadius-5,headY-5);ctx.moveTo(headRadius,headY);ctx.lineTo(headRadius+5,headY-5);ctx.moveTo(0,headY-headRadius);ctx.lineTo(0,headY-headRadius-7);ctx.arc(0,headY-headRadius-9,2,0,Math.PI*2);
  }else{
    ctx.moveTo(0,headY-headRadius*1.25);ctx.lineTo(headRadius,headY-headRadius*.2);ctx.lineTo(headRadius*.58,headY+headRadius);ctx.lineTo(0,headY+headRadius*.72);ctx.lineTo(-headRadius*.58,headY+headRadius);ctx.lineTo(-headRadius,headY-headRadius*.2);ctx.closePath();
  }
  ctx.fillStyle='rgba(7,13,25,.9)';ctx.strokeStyle='#080d19';ctx.lineWidth=8;ctx.fill();ctx.stroke();
  ctx.strokeStyle=bodyColor;ctx.lineWidth=4;ctx.stroke();
  ctx.strokeStyle='#f7fbff';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(p.face*1,headY-2);ctx.lineTo(p.face*(headRadius*.55),headY-3);ctx.stroke();
  if (attack && phase === 'active' && p.actionHitbox) {
    const handX = legStrike ? action === 'airBack' ? backFootX : frontFootX : frontX, handY = legStrike ? action === 'airBack' ? backFootY : frontFootY : frontY + bodyCenterY;
    ctx.shadowBlur = 7; ctx.shadowColor = color; ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    if (legStrike) ctx.ellipse(handX,handY,8,5,Math.atan2(handY-hipY,handX-p.face*6),0,Math.PI*2);
    else if (action.startsWith('special')) { ctx.moveTo(handX,handY-7);ctx.lineTo(handX+7*p.face,handY);ctx.lineTo(handX,handY+7);ctx.lineTo(handX-7*p.face,handY);ctx.closePath(); }
    else ctx.arc(handX, handY, action.includes('Side') || action.includes('Forward') || action.includes('Back') ? 6 : 5, 0, Math.PI*2);
    ctx.fill(); ctx.shadowBlur = 0;
  }
  ctx.restore();

  ctx.globalAlpha = 1; ctx.fillStyle = '#fff'; ctx.font = '900 11px Inter'; ctx.textAlign = 'center';
  ctx.fillText(playerTag(p), p.x, p.y - p.height / 2 - 15);
  if (state === 'waiting' && !p.clientId?.startsWith('cpu:')) {
    const lobbyPlayer = room?.players?.find(player => player.clientId === p.clientId || player.index === p.i);
    if (lobbyPlayer) {
      const connected = lobbyPlayer.connected !== false;
      const ready = connected && lobbyPlayer.ready;
      const text = !connected ? '재접속 중' : ready ? '✓ 준비 완료' : '● 준비 필요';
      const badgeColor = !connected ? '#aeb4cc' : ready ? '#67f59b' : '#ffca3a';
      ctx.save();
      ctx.font = '900 9px Inter';
      const badgeW = Math.max(66, ctx.measureText(text).width + 18);
      const badgeX = p.x - badgeW / 2;
      const badgeY = p.y - p.height / 2 - 48;
      if (!ready && connected) ctx.globalAlpha = .82 + Math.sin(performance.now() / 180) * .12;
      ctx.fillStyle = 'rgba(5,8,18,.92)';
      ctx.beginPath();
      ctx.roundRect(badgeX, badgeY, badgeW, 21, 6);
      ctx.fill();
      ctx.strokeStyle = badgeColor;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = badgeColor;
      ctx.textAlign = 'center';
      ctx.fillText(text, p.x, badgeY + 14);
      ctx.restore();
    }
  }
  const label = actionLabel(action);
  if (hitboxes && label && (p.actionFrame || cueAge < 240)) { ctx.fillStyle = color; ctx.font = '900 9px Inter'; ctx.fillText(label, p.x, p.y - p.height / 2 - 28); }
  if (hitboxes) {
    ctx.strokeStyle = '#ffea64'; ctx.fillStyle = 'rgba(255,234,100,.08)'; ctx.lineWidth = 2;
    for (const hurt of p.hurtboxes || []) { ctx.beginPath(); ctx.arc(hurt.x,hurt.y,hurt.radius,0,Math.PI*2);ctx.fill();ctx.stroke(); }
    if (p.actionHitbox) { const box=p.actionHitbox;ctx.strokeStyle='#ff426a';ctx.fillStyle='rgba(255,66,106,.14)';ctx.lineWidth=3;if(box.type==='circle'){ctx.beginPath();ctx.arc(box.x,box.y,box.radius,0,Math.PI*2);ctx.fill();ctx.stroke();}else{ctx.fillRect(box.x-box.w/2,box.y-box.h/2,box.w,box.h);ctx.strokeRect(box.x-box.w/2,box.y-box.h/2,box.w,box.h);} }
  }
}
function drawBattleHUD(){
  const count=Math.max(1,players.length),gap=count===4?8:12,maxCard=count<=2?340:count===3?320:294;
  const cardW=Math.min(maxCard,(WORLD_W-30-gap*(count-1))/count),cardH=96;
  const total=cardW*count+gap*(count-1),startX=(WORLD_W-total)/2,y=WORLD_H-cardH-10;
  const pulse=.72+Math.sin(performance.now()/115)*.28;
  players.forEach((p,index)=>{
    const fighter=FIGHTERS.find(item=>item.id===p.characterId)||FIGHTERS[0];
    const color=fighter.palettes[p.palette%fighter.palettes.length];
    const x=startX+index*(cardW+gap),damage=Math.max(0,Math.round(p.damage)),danger=clamp(p.damage/160,0,1);
    const shield=clamp((p.shield||0)/100,0,1),ultimate=clamp((p.ultimateMeter||0)/100,0,1);
    const damageColor=danger<.48?'#ffffff':danger<.82?'#ffd35d':'#ff496f';
    const barX=x+166,barW=Math.max(72,cardW-178);
    ctx.save();
    ctx.globalAlpha=p.eliminated?.42:1;
    ctx.shadowColor='rgba(0,0,0,.62)';ctx.shadowBlur=18;ctx.shadowOffsetY=7;
    const shell=ctx.createLinearGradient(x,y,x,y+cardH);
    shell.addColorStop(0,'rgba(26,31,47,.96)');shell.addColorStop(.52,'rgba(10,14,27,.96)');shell.addColorStop(1,'rgba(4,7,15,.98)');
    ctx.fillStyle=shell;ctx.beginPath();ctx.moveTo(x+10,y);ctx.lineTo(x+cardW-8,y);ctx.lineTo(x+cardW,y+8);ctx.lineTo(x+cardW,y+cardH-8);ctx.lineTo(x+cardW-9,y+cardH);ctx.lineTo(x,y+cardH);ctx.lineTo(x,y+10);ctx.closePath();ctx.fill();
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.strokeStyle=p.i===myIndex?color:'rgba(255,255,255,.17)';ctx.lineWidth=p.i===myIndex?2.2:1;
    ctx.beginPath();ctx.moveTo(x+10,y);ctx.lineTo(x+cardW-8,y);ctx.lineTo(x+cardW,y+8);ctx.lineTo(x+cardW,y+cardH-8);ctx.lineTo(x+cardW-9,y+cardH);ctx.lineTo(x,y+cardH);ctx.lineTo(x,y+10);ctx.closePath();ctx.stroke();
    ctx.fillStyle=color;ctx.fillRect(x+10,y,x+cardW-18,3);

    const portraitX=x+48,portraitY=y+50;
    ctx.save();ctx.beginPath();ctx.arc(portraitX,portraitY,38,0,Math.PI*2);ctx.clip();
    const portrait=ctx.createRadialGradient(portraitX-9,portraitY-12,5,portraitX,portraitY,42);
    portrait.addColorStop(0,'#ffffff');portrait.addColorStop(.12,color);portrait.addColorStop(1,'rgba(8,11,23,.96)');
    ctx.fillStyle=portrait;ctx.fillRect(portraitX-42,portraitY-42,84,84);
    ctx.globalAlpha=.22;ctx.strokeStyle='#fff';ctx.lineWidth=2;
    for(let stripe=-54;stripe<54;stripe+=12){ctx.beginPath();ctx.moveTo(portraitX+stripe,portraitY+42);ctx.lineTo(portraitX+stripe+54,portraitY-42);ctx.stroke();}
    ctx.globalAlpha=1;ctx.fillStyle='#070c19';ctx.font='900 31px Inter';ctx.textAlign='center';ctx.fillText(fighter.icon,portraitX,portraitY+11);ctx.restore();
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();ctx.arc(portraitX,portraitY,38,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='rgba(3,6,14,.9)';ctx.beginPath();ctx.roundRect(x+16,y+74,65,17,8);ctx.fill();
    ctx.fillStyle='#fff';ctx.font='900 8px Inter';ctx.textAlign='center';ctx.fillText(fighter.name,x+48,y+85);

    ctx.textAlign='left';ctx.fillStyle='#f7f8ff';ctx.font='900 10px Inter';
    const tag=String(playerTag(p)).slice(0,count===4?12:18);ctx.fillText(tag,x+91,y+17);
    if(p.i===myIndex){ctx.fillStyle=color;ctx.font='900 7px Inter';ctx.fillText('YOU',x+91,y+28);}
    ctx.fillStyle=damageColor;ctx.shadowColor=damageColor;ctx.shadowBlur=danger>.8?9*pulse:0;
    ctx.font='900 43px Inter';const damageText=String(damage);ctx.fillText(damageText,x+88,y+66);
    const damageWidth=ctx.measureText(damageText).width;ctx.shadowBlur=0;ctx.font='900 17px Inter';ctx.fillText('%',x+91+damageWidth,y+65);

    ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,.72)';ctx.font='900 7px Inter';ctx.fillText(rules.mode==='time'?'SCORE':'STOCK',x+cardW-12,y+16);
    const lifeDisplay=rules.mode==='training'?'∞':rules.mode==='time'?`${p.score>=0?'+':''}${p.score}`:`×${Math.max(0,p.stocks)}`;
    ctx.fillStyle=color;ctx.font='900 15px Inter';ctx.fillText(lifeDisplay,x+cardW-12,y+31);

    ctx.textAlign='left';ctx.font='900 6px Inter';ctx.fillStyle=shield<.3?'#ff5b78':'#8deeff';ctx.fillText('GUARD',barX,y+47);
    ctx.fillStyle='rgba(255,255,255,.12)';ctx.beginPath();ctx.roundRect(barX,y+51,barW,8,4);ctx.fill();
    const shieldGradient=ctx.createLinearGradient(barX,y+51,barX+barW,y+51);
    shieldGradient.addColorStop(0,shield<.3?'#ff3c65':'#55d9ff');shieldGradient.addColorStop(1,shield<.3?'#ff9a58':'#d8fbff');
    ctx.fillStyle=shieldGradient;if(shield>0){ctx.beginPath();ctx.roundRect(barX,y+51,Math.max(4,barW*shield),8,4);ctx.fill();}
    ctx.textAlign='right';ctx.fillStyle='rgba(255,255,255,.72)';ctx.font='900 6px Inter';ctx.fillText(`${Math.round(shield*100)}`,barX+barW,y+47);

    ctx.textAlign='left';ctx.fillStyle=ultimate>=1?'#fff7ae':color;ctx.font='900 6px Inter';ctx.fillText(ultimate>=1?'FINAL READY':'FINAL',barX,y+70);
    ctx.fillStyle='rgba(255,255,255,.11)';ctx.beginPath();ctx.roundRect(barX,y+74,barW,11,3);ctx.fill();
    if(ultimate>0){
      const finalGradient=ctx.createLinearGradient(barX,y+74,barX+barW,y+74);
      finalGradient.addColorStop(0,color);finalGradient.addColorStop(.72,ultimate>=1?'#fff36b':'#ff6ed5');finalGradient.addColorStop(1,'#ffffff');
      ctx.fillStyle=finalGradient;ctx.shadowColor=ultimate>=1?'#fff36b':color;ctx.shadowBlur=ultimate>=1?14*pulse:5;
      ctx.beginPath();ctx.roundRect(barX,y+74,Math.max(4,barW*ultimate),11,3);ctx.fill();ctx.shadowBlur=0;
    }
    ctx.strokeStyle='rgba(5,8,18,.62)';ctx.lineWidth=1;
    for(let segment=1;segment<4;segment++){const sx=barX+barW*segment/4;ctx.beginPath();ctx.moveTo(sx,y+74);ctx.lineTo(sx,y+85);ctx.stroke();}
    if(ultimate>=1){ctx.fillStyle='#fff';ctx.font='900 7px Inter';ctx.textAlign='right';ctx.fillText('Z + X',barX+barW,y+70);}
    ctx.restore();
  });
  if(state==='playing'){
    ctx.save();ctx.fillStyle='rgba(5,8,18,.88)';ctx.beginPath();ctx.roundRect(520,10,240,38,19);ctx.fill();ctx.strokeStyle='rgba(255,255,255,.16)';ctx.stroke();
    ctx.textAlign='center';ctx.fillStyle='#fff';ctx.font='900 19px Inter';ctx.fillText(formatTime(remainingTicks),640,35);
    ctx.textAlign='left';ctx.fillStyle=stage.color;ctx.font='900 9px Inter';ctx.fillText(stage.name,535,33);
    ctx.textAlign='right';ctx.fillStyle=ping<70?'#67f59b':ping<130?'#ffca3a':'#ff426a';ctx.fillText(`${Math.round(ping)}ms`,744,33);ctx.restore();
  }
}
function drawOffscreen(){for(const p of players){if(p.eliminated||p.respawn>0||p.x>=0&&p.x<=WORLD_W&&p.y>=0&&p.y<=WORLD_H)continue;const x=clamp(p.x,25,WORLD_W-25),y=clamp(p.y,25,WORLD_H-110),fighter=FIGHTERS.find(item=>item.id===p.characterId);ctx.fillStyle=fighter.color;ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.fill();ctx.fillStyle='#080a12';ctx.font='900 9px Inter';ctx.textAlign='center';ctx.fillText(playerTag(p),x,y+3);}}
function drawCameraIndicators(){const zoom=camera.zoom+cameraPunch;for(const p of players){if(p.eliminated||p.respawn>0)continue;const sx=(p.x-camera.x)*zoom+WORLD_W/2,sy=(p.y-camera.y)*zoom+WORLD_H/2;if(sx>25&&sx<WORLD_W-25&&sy>25&&sy<WORLD_H-112)continue;const x=clamp(sx,28,WORLD_W-28),y=clamp(sy,28,WORLD_H-116),fighter=FIGHTERS.find(item=>item.id===p.characterId)||FIGHTERS[0],color=fighter.palettes[p.palette%fighter.palettes.length];ctx.save();ctx.shadowBlur=14;ctx.shadowColor=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y-16);ctx.lineTo(x+15,y+12);ctx.lineTo(x-15,y+12);ctx.closePath();ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='#080a12';ctx.font='900 9px Inter';ctx.textAlign='center';ctx.fillText(playerTag(p),x,y+6);ctx.restore();}}
function burst(x,y,color,count,speed,direction=0,scale=1){for(let i=0;i<count;i++){const forward=i<count*.66,a=direction+(forward?0:Math.PI)+(Math.random()-.5)*(forward?1.8:2.55),s=speed*(.3+Math.random()*.82),duration=.19+Math.random()*.15;particles.push({x:x+(Math.random()-.5)*7,y:y+(Math.random()-.5)*7,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:duration,duration,color:i%4===0?color:'#ffffff',size:(1.8+Math.random()*2.5)*scale,gravity:42+Math.random()*65});}if(particles.length>96)particles.splice(0,particles.length-96);}
function drawParticles(){ctx.save();for(const p of particles){const fade=clamp(p.life/p.duration,0,1),size=Math.max(1.6,p.size*(.48+fade*.52));ctx.globalAlpha=Math.min(1,fade*fade*1.12);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(Math.round(p.x),Math.round(p.y),size*.52,0,Math.PI*2);ctx.fill();}ctx.restore();}
function drawBlastMarks(){for(const mark of blastMarks){const fade=clamp(mark.life/mark.duration,0,1),expand=.72+(1-fade)*.28;ctx.save();ctx.translate(mark.x,mark.y);ctx.globalAlpha=fade*.28;ctx.fillStyle=mark.color;ctx.strokeStyle='#ffffff';ctx.lineWidth=3;ctx.shadowColor=mark.color;ctx.shadowBlur=10;ctx.beginPath();for(let i=0;i<16;i++){const a=-Math.PI/2+i*Math.PI/8,r=mark.radius*expand*(i%2?.84:1);i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.fill();ctx.globalAlpha=fade*.8;ctx.stroke();ctx.restore();}}
function drawImpactRings(){for(const ring of impactRings){const fade=clamp(ring.life/ring.duration,0,1),burst=1-fade,radius=ring.radius*(.62+burst*.9);ctx.save();ctx.translate(ring.x,ring.y);ctx.globalAlpha=fade*.8;ctx.strokeStyle=ring.color;ctx.lineWidth=2.5+fade*4;ctx.shadowBlur=10;ctx.shadowColor=ring.color;ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.globalAlpha*=.45;ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,radius*.58,0,Math.PI*2);ctx.stroke();ctx.restore();}}
function drawTrails(){for(const trail of trails){if(!trail.launch)continue;ctx.save();ctx.translate(trail.x,trail.y);const speed=Math.hypot(trail.vx,trail.vy),length=clamp(speed*(trail.finisher?.19:.14),58,trail.finisher?178:132);ctx.rotate(Math.atan2(trail.vy,trail.vx));const gradient=ctx.createLinearGradient(-length,0,4,0);gradient.addColorStop(0,'rgba(255,255,255,0)');gradient.addColorStop(trail.finisher?.55:.72,trail.color);gradient.addColorStop(1,'rgba(255,255,255,.9)');ctx.globalAlpha=trail.life*(trail.finisher?2.8:2.25);ctx.strokeStyle=gradient;ctx.lineWidth=clamp(speed/(trail.finisher?125:155),trail.finisher?5:3,trail.finisher?9:6);ctx.lineCap='round';ctx.beginPath();ctx.moveTo(-length,0);ctx.lineTo(4,0);ctx.stroke();if(trail.finisher){ctx.globalAlpha*=.75;ctx.strokeStyle='#ffffff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-length*.72,0);ctx.lineTo(5,0);ctx.stroke();}ctx.restore();}}
function updateParticles(dt){for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=(p.gravity||0)*dt;p.vx*=Math.exp(-dt*6.5);p.vy*=Math.exp(-dt*6.5);}particles=particles.filter(p=>p.life>0);for(const ring of impactRings)ring.life-=dt;impactRings=impactRings.filter(ring=>ring.life>0);for(const mark of blastMarks)mark.life-=dt;blastMarks=blastMarks.filter(mark=>mark.life>0);for(const trail of trails)trail.life-=dt;trails=trails.filter(trail=>trail.life>0);trailClock-=dt;if((state==='playing'||state==='waiting')&&trailClock<=0){trailClock=.045;for(const p of players){if(p.eliminated||p.respawn>0)continue;const action=displayedAction(p),speed=Math.hypot(p.vx,p.vy),finisher=(p.criticalFlightFrames||0)>0,launched=(p.tumbling||action==='tumble')&&speed>520;if(launched){const fighter=FIGHTERS.find(item=>item.id===p.characterId)||FIGHTERS[0];trails.push({x:p.x,y:p.y,vx:p.vx,vy:p.vy,launch:true,finisher,color:fighter.palettes[p.palette%fighter.palettes.length],life:finisher?.3:.24});}}}}

function loop(now){requestAnimationFrame(loop);const dt=Math.min(.033,(now-lastFrame)/1000);lastFrame=now;updateParticles(dt);if(state==='playing'||state==='waiting'){sendInput(now);renderNetworkState(dt,now);if(state==='playing')updateTutorialState();}draw(dt);}
requestAnimationFrame(loop);

function showResult(index){state='result';winnerIndex=index;const winner=players.find(player=>player.i===index),fighter=winner?(FIGHTERS.find(item=>item.id===winner.characterId)||FIGHTERS[0]):null,color=fighter?.palettes?.[winner.palette%fighter.palettes.length]||fighter?.color||'#ffffff';document.querySelector('#winner-name').textContent=fighter?.name||'DRAW';document.querySelector('#winner-name').style.color=color;document.querySelector('#winner-avatar').textContent=fighter?.icon||'×';document.querySelector('#winner-avatar').style.color=color;result.classList.remove('hidden');trainingPanel.classList.add('hidden');socket.emit('stats:get',updateStats);}
function returnToWaitingRoom(){result.classList.add('hidden');menu.classList.add('hidden');waitingRoom.classList.remove('hidden');state='waiting';renderLobby();}
document.querySelector('#rematch-button').addEventListener('click',returnToWaitingRoom);
document.querySelector('#menu-button').addEventListener('click',returnToWaitingRoom);

trainingPanel.querySelector('[data-training="reset"]').addEventListener('click',()=>{resetTrainingInputHistory();socket.emit('training:command',{type:'reset'});});
trainingPanel.querySelector('[data-training="pause"]').addEventListener('click',event=>{paused=!paused;event.currentTarget.classList.toggle('active',paused);event.currentTarget.setAttribute('aria-pressed',String(paused));socket.emit('training:command',{type:'pause',value:paused});});
trainingPanel.querySelector('[data-training="hitboxes"]').addEventListener('click',event=>{hitboxes=!hitboxes;event.currentTarget.classList.toggle('active',hitboxes);event.currentTarget.setAttribute('aria-pressed',String(hitboxes));socket.emit('training:command',{type:'hitboxes',value:hitboxes});});
document.querySelector('#cpu-select').addEventListener('change',event=>socket.emit('training:command',{type:'cpu',value:event.target.value}));
trainingFighterSelect.addEventListener('change', event => selectCharacter(event.target.value));
trainingBotSelect.addEventListener('change', event => socket.emit('training:command', { type: 'bot-character', value: event.target.value }));
trainingTutorialToggle.addEventListener('click',()=>tutorialState.active?closeTutorial():openTutorial());
document.querySelector('#tutorial-close').addEventListener('click',closeTutorial);
document.querySelector('#tutorial-restart').addEventListener('click',()=>{socket.emit('training:command',{type:'reset'});beginTutorialStep(0);});
document.querySelector('#tutorial-skip').addEventListener('click',()=>beginTutorialStep(tutorialState.index>=TUTORIAL_STEPS.length?0:tutorialState.index+1));
trainingGuideToggle.addEventListener('click',()=>setTrainingGuideOpen(trainingGuide.classList.contains('collapsed')));
document.querySelector('#training-input-clear').addEventListener('click',resetTrainingInputHistory);
document.querySelector('#training-exit').addEventListener('click', leaveRoomToMenu);

addEventListener('keydown',event=>{
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(event.code))event.preventDefault();
  keys.add(event.code);
  if (!event.repeat && (state === 'playing' || state === 'waiting') && ['KeyZ','KeyX','KeyV','KeyF','KeyG','KeyE'].includes(event.code)) {
    const self = players.find(player => player.i === myIndex);
    const airborne = self && (!self.grounded || self.jumpSquatFrames > 0);
    const up = keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Space'), down = keys.has('KeyS') || keys.has('ArrowDown');
    const side = keys.has('KeyA') || keys.has('KeyD') || keys.has('ArrowLeft') || keys.has('ArrowRight');
    const cueLocked = !self || self.eliminated || self.respawn > 0 || self.hitstop > 0 || self.stun > 0 || self.dodgeFrames > 0 || self.landingLag > 0 || self.shieldStun > 0 || self.shieldDropLag > 0 || self.knockdownFrames > 0 || self.shielding || self.ledge || self.grabbedBy != null || self.grabbing != null || self.actionPhase;
    const specialKey = event.code === 'KeyX' || event.code === 'KeyG';
    const attackKey = event.code === 'KeyZ' || event.code === 'KeyF';
    const ultimateCombo = !cueLocked && (self?.ultimateMeter || 0) >= 100
      && (keys.has('KeyZ') || keys.has('KeyF')) && (keys.has('KeyX') || keys.has('KeyG'));
    if (ultimateCombo) {
      localAttackIntent = null;
      localCue = { name: 'ultimate', variant: self.characterId, started: performance.now(), seq: inputSeq + 1 };
    } else if (attackKey && !airborne && !cueLocked) {
      localAttackIntent = {
        started: performance.now(),
        directional: up || down || side,
        name: up ? 'groundUp' : down ? 'groundDown' : side ? 'groundSide' : 'groundNeutral'
      };
    }
    if (!ultimateCombo && !cueLocked && !(specialKey && up && self.recoveryAvailable === false) && (airborne || !attackKey && !specialKey)) {
      let name = airborne ? 'airDodge' : 'grab';
      if (specialKey) name = up ? 'specialUp' : down ? 'specialDown' : side ? 'specialSide' : 'specialNeutral';
      if (attackKey) name = airborne ? (up ? 'airUp' : down ? 'airDown' : side ? Math.sign(readInput().horizontal || self.face) === self.face ? 'airForward' : 'airBack' : 'airNeutral') : (up ? 'groundUp' : down ? 'groundDown' : side ? 'groundSide' : 'groundNeutral');
      localCue = { name, started: performance.now(), seq: inputSeq + 1 };
    }
    sendInput(performance.now(), true);
  }
  if (!event.repeat && (state === 'playing' || state === 'waiting') && ['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyC','ShiftLeft','ShiftRight'].includes(event.code)) sendInput(performance.now(), true);
  if (event.code === 'Enter' && state === 'waiting') {
    const owner = room?.ownerClientId === identity?.clientId;
    const target = owner ? waitingStart : waitingReady;
    if (!target.disabled) target.click();
  }
});
addEventListener('keyup',event=>{
  const attackKey = event.code === 'KeyZ' || event.code === 'KeyF';
  if (attackKey && localAttackIntent) {
    const heldFrames = (performance.now() - localAttackIntent.started) / (1000 / 60);
    if (heldFrames < 10) localCue = {
      name: localAttackIntent.name,
      variant: localAttackIntent.directional ? 'tilt' : 'normal',
      started: performance.now(),
      seq: inputSeq + 1
    };
    localAttackIntent = null;
  }
  keys.delete(event.code);
  sendInput(performance.now(),true);
});
function releaseAllInputs(){
  localAttackIntent = null;
  keys.clear();
  if(!['playing','waiting'].includes(state))return;
  socket.emit('input:frame',{seq:++inputSeq,clientTime:performance.now(),buttons:0,horizontal:0,vertical:0});
  lastInputSent=performance.now();
}
addEventListener('blur',releaseAllInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAllInputs();});
document.querySelector('#sound-button').addEventListener('click',event=>{muted=!muted;event.currentTarget.textContent=muted?'×':'♪';});
function ensureAudio(){audio||=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();}
function beep(freq,duration,type){if(muted)return;ensureAudio();const oscillator=audio.createOscillator(),gain=audio.createGain();oscillator.type=type;oscillator.frequency.value=freq;gain.gain.setValueAtTime(.035,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+duration);oscillator.connect(gain).connect(audio.destination);oscillator.start();oscillator.stop(audio.currentTime+duration);}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function playerTag(player){
  if(player?.clientId?.startsWith('cpu:'))return 'BOT';
  return player?.nickname||room?.players?.find(slot=>slot.clientId===player?.clientId)?.nickname||`P${player.i+1}`;
}
function formatTime(ticks){if(rules.mode==='training')return '∞';const seconds=Math.max(0,Math.ceil(ticks/60));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
