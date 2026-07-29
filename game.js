const { BUTTONS, FIGHTERS, STAGES, ITEMS, DEFAULT_RULES } = window.NEON_CONTENT;
const SMASH_INPUT_HOLD_FRAMES = 14;
const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
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
const appVersionLabel = document.querySelector('#app-version');
const patchNotes = document.querySelector('#patch-notes');
const patchNotesList = document.querySelector('#patch-notes-list');
const patchNotesButton = document.querySelector('#patch-notes-button');
const patchNotesClose = document.querySelector('#patch-notes-close');
let releaseHistory = null;

function showGameVersion(metadata) {
  if (!appVersionLabel || !metadata?.version) return;
  appVersionLabel.textContent = `v${metadata.version} · P${metadata.protocol || '?'}`;
  appVersionLabel.title = `${metadata.channel || 'unknown'} 채널 · 네트워크 프로토콜 ${metadata.protocol || '?'}`;
}

fetch('/version.json', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(showGameVersion)
  .catch(() => { if (appVersionLabel) appVersionLabel.textContent = 'VERSION 확인 불가'; });

function renderPatchNotes(payload) {
  if (!patchNotesList || !Array.isArray(payload?.releases)) return;
  releaseHistory = payload;
  patchNotesList.innerHTML = payload.releases.map(release => {
    const isCurrent = release.version === payload.current;
    const changes = Array.isArray(release.changes) ? release.changes : [];
    return `
      <article class="release-note${isCurrent ? ' current' : ''}">
        <div class="release-note-head">
          <b>v${escapeHtml(release.version)}</b>
          ${isCurrent ? '<span class="release-current-badge">CURRENT</span>' : ''}
          <time datetime="${escapeHtml(release.date)}">${escapeHtml(release.date)}</time>
        </div>
        <h3>${escapeHtml(release.title)}</h3>
        <p>${escapeHtml(release.summary)}</p>
        <ul>${changes.map(change => `<li>${escapeHtml(change)}</li>`).join('')}</ul>
      </article>`;
  }).join('');
}

function markCurrentReleaseSeen() {
  if (!releaseHistory?.current) return;
  try { localStorage.setItem('neon_seen_release', releaseHistory.current); } catch {}
}

function openPatchNotes() {
  if (!patchNotes) return;
  patchNotes.classList.remove('hidden');
  markCurrentReleaseSeen();
  patchNotesClose?.focus();
}

function closePatchNotes() {
  if (!patchNotes) return;
  patchNotes.classList.add('hidden');
  patchNotesButton?.focus();
}

patchNotesButton?.addEventListener('click', openPatchNotes);
patchNotesClose?.addEventListener('click', closePatchNotes);
patchNotes?.addEventListener('click', event => {
  if (event.target === patchNotes) closePatchNotes();
});
addEventListener('keydown', event => {
  if (event.key === 'Escape' && patchNotes && !patchNotes.classList.contains('hidden')) closePatchNotes();
});

fetch('/releases.json', { cache: 'no-store' })
  .then(response => response.ok ? response.json() : null)
  .then(payload => {
    if (!payload) return;
    renderPatchNotes(payload);
    let seenVersion = null;
    try { seenVersion = localStorage.getItem('neon_seen_release'); } catch {}
    if (seenVersion !== payload.current) setTimeout(openPatchNotes, 250);
  })
  .catch(() => {
    if (patchNotesList) patchNotesList.innerHTML = '<p>패치 기록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
  });

const WORLD_W = 1280, WORLD_H = 720, SHIELD_MAX = 50;
let dpr = 1, viewScale = 1, viewOffsetX = 0, viewOffsetY = 0;
let camera = { x: 640, y: 355, zoom: 1 }, screenShake = 0, cameraPunch = 0, criticalFlash = 0, impactRings = [], blastMarks = [], shieldBreakEffects = [], dashAfterimages = [];
let ultimateCinematic = null, koCinematics = [];
let state = 'menu', room = null, myIndex = -1, identity = null;
let selectedCharacter = localStorage.getItem('neon_character') || 'volt';
let selectedPalette = Number(localStorage.getItem('neon_palette') || 0);
let players = [], platforms = [], entities = [], items = [], stage = STAGES[0], rules = { ...DEFAULT_RULES };
let snapshots = [], latestSnapshot = null, keys = new Set(), particles = [], trails = [], lastEvents = new Set(), trailClock = 0, effectQuality = 1;
let lastFrame = performance.now(), inputSeq = 0, lastInputSent = 0;
let pingSamples = [], snapshotIntervals = [], snapshotTickRates = [], lastSnapshotArrival = 0, lastSnapshotTick = null, ping = 0, networkJitter = 0, adaptiveDelay = 90, targetAdaptiveDelay = 90, remainingTicks = 0, winnerIndex = null;
let paused = false, hitboxes = false, localCue = null, localAttackIntent = null;
let trainingInputHistory = [], trainingInputSignature = '', trainingInputSequence = 0, trainingInputLastRender = 0;
let backgroundCache = null, backgroundCacheStage = '';
const platformTextureCache = new Map();
const renderOlderByIndex = new Map(), renderLatestByIndex = new Map(), renderDisplayByClient = new Map(), renderActiveClientIds = new Set();
let tutorialState = { active: false, index: 0, lastButtons: 0, startX: 0, advancing: false, advanceTimer: null };
let roomNoticeTimer = null;
const runtimeMetrics = window.__NEON_METRICS__ = {
  fps: 0, frameMs: 0, snapshotHz: 0, interpolationMs: adaptiveDelay,
  particles: 0, trails: 0, players: 0, heapMb: 0, slowFrames: 0,
  inputAckMs: 0, correctionPx: 0, correctionPeakPx: 0, hardCorrections: 0, emergencyCorrections: 0,
  reliableInputs: 0, volatileInputs: 0
};
const networkQuality = new window.NEON_NETWORK.NetworkQualityTracker(runtimeMetrics);
const keyboardIntent = new window.NEON_INPUT.KeyboardIntentTracker();
const inputTransport = new window.NEON_INPUT.InputTransportPolicy(runtimeMetrics);
const audioFeedback = new window.NEON_AUDIO.AudioFeedback();
const runtimeMonitor = new window.NEON_RUNTIME_MONITOR.RuntimeMonitor(performance.now());
let visualFixtureActive = false;
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
    ['←/→ + X', '블링크 슬래시', 'X를 홀드한 시간에 따라 순간이동 거리 증가'],
    ['↑ + X', '워프 라이즈', 'X 홀드로 복귀 거리 증가 · 오래 모을수록 더 멀리 워프'],
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
  { id: 'move', category: '이동 기초', title: '좌우로 이동', command: '← / →', goal: '좌우로 100px 이동', description: '방향키를 눌러 거리를 벌렸다가 다시 접근하세요.', tip: 'Ctrl을 함께 누르면 계속 정밀 걷기, 방향을 유지하면 달리기, 빠르게 두 번 입력하면 대시입니다.' },
  { id: 'dash', category: '이동 기초', title: '대시', command: '→ →', goal: '대시 상태 만들기', description: '같은 방향을 빠르게 두 번 입력해 대시하세요.', tip: '대시는 접근과 거리 조절의 핵심입니다.' },
  { id: 'jump', category: '공중 이동', title: '점프', command: '↑', goal: '지상에서 점프', description: '위 방향키로 점프하세요. 짧게 놓으면 숏홉이 됩니다.', tip: '공격과 동시에 누르면 숏홉 공중기가 바로 나갑니다.' },
  { id: 'double-jump', category: '공중 이동', title: '2단 점프', command: '공중 ↑', goal: '공중에서 다시 점프', description: '첫 점프가 끝나기 전에 위 방향키를 다시 누르세요.', tip: '복귀할 때 바로 소비하지 말고 필요한 높이에서 사용하세요.' },
  { id: 'basic-hit', category: '공격 기초', title: '기본 공격 적중', command: 'Z', goal: '더미에게 공격 적중', description: '더미 가까이에서 Z로 기본 공격을 맞히세요.', tip: 'Z를 연속 입력하면 3단 잽으로 이어집니다.' },
  { id: 'tilt', category: '공격 기초', title: '틸트 공격', command: '방향 → Z', goal: '틸트 공격 발동', description: '방향을 먼저 누른 상태에서 Z를 누르세요.', tip: '빠르고 후딜이 짧아 콤보와 견제에 유리합니다.' },
  { id: 'smash', category: '공격 기초', title: '스매시 공격', command: 'Z 길게 홀드', goal: '스매시 공격 발동', description: '지상에서 Z를 14프레임 이상 확실히 유지하면 스매시를 충전합니다. 방향 없이 모으면 앞 스매시, 모으는 동안 방향을 잡으면 해당 방향 스매시가 나갑니다.', tip: 'Z를 짧게 놓으면 중립은 잽, 방향 입력 중에는 틸트가 나갑니다. 공중 Z·대시 Z는 즉시 발동합니다.' },
  { id: 'shield', category: '방어 기초', title: '실드', command: 'C 유지', goal: '실드 펼치기', description: 'C를 유지해 공격을 막는 실드를 펼치세요.', tip: '실드가 깨지면 긴 시간 무방비 상태가 됩니다.' },
  { id: 'parry', category: '방어 기초', title: '패링', command: 'C 유지 → 피격 직전 해제', goal: '패링 성공', description: 'C로 실드를 잠깐 유지한 뒤 상대 공격이 닿기 직전에 놓으세요. 해제 직후 6프레임이 패링 판정입니다.', tip: '성공하면 상대가 20프레임 정지합니다. 바로 Z나 X를 선입력해 반격하세요.' },
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
  const step = TUTORIAL_STEPS[tutorialState.index];
  const tutorialCpu = step?.id === 'parry' ? 'easy' : 'dummy';
  document.querySelector('#cpu-select').value = tutorialCpu;
  socket.emit('training:command', { type: 'cpu', value: tutorialCpu });
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
  else if (step.id === 'dash' && (self.movementState === 'dash' || self.movementState === 'pivot')) completeTutorialStep();
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
  trainingInputLastRender = 0;
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
    const now = performance.now();
    if (now - trainingInputLastRender < 120) return;
    trainingInputLastRender = now;
  } else {
    trainingInputSignature = signature;
    trainingInputHistory.push({ sequence: ++trainingInputSequence, direction, buttons, frames: 1 });
    if (trainingInputHistory.length > 14) trainingInputHistory.shift();
    trainingInputLastRender = performance.now();
  }
  renderTrainingInputHistory();
}

function resize() {
  const width = innerWidth, height = innerHeight;
  // Canvas fill-rate dominates on high-DPI monitors. Keep enough physical
  // pixels for clean silhouettes without rendering 4K-sized frames at 1080p.
  const pixelBudgetDpr = Math.sqrt(2800000 / Math.max(1, width * height));
  dpr = Math.max(.72, Math.min(devicePixelRatio || 1, 1.35, pixelBudgetDpr));
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
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
  showGameVersion({ version: response.version, protocol: response.protocol, channel: response.version?.includes('-') ? 'beta' : 'stable' });
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
  snapshots = []; latestSnapshot = null; players = []; particles = []; trails = []; impactRings = []; blastMarks = []; shieldBreakEffects = []; localCue = null; ultimateCinematic = null; lastEvents.clear();
  receiveSnapshot(snapshot);
}

async function leaveRoomToMenu() {
  saveSession(null);
  releaseAllInputs();
  await emitAck('room:leave');
  state = 'menu'; room = null; myIndex = -1;
  players = []; snapshots = []; latestSnapshot = null; localCue = null; ultimateCinematic = null;
  particles = []; trails = []; impactRings = []; blastMarks = []; shieldBreakEffects = [];
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
socket.on('match:start', payload => { room = payload.room; rules = room.rules; if (room.demo) myIndex = -1; waitingRoom.classList.add('hidden'); beginMatch(payload.snapshot); });
socket.on('state:snapshot', receiveSnapshot);
socket.on('match:end', payload => { receiveSnapshot(payload.snapshot); showResult(payload.winner); });

function enterRoom(nextRoom, warmupSnapshot = null) {
  room = nextRoom; rules = room.rules; state = room.playing ? 'playing' : 'waiting';
  mountWaitingUi();
  menu.classList.add('hidden'); waitingRoom.classList.toggle('hidden', room.playing); result.classList.add('hidden'); trainingPanel.classList.add('hidden'); countdown.classList.add('hidden');
  lobbyActions.classList.add('hidden'); roomBrowser.classList.add('hidden'); queueBar.classList.add('hidden'); roomBar.classList.remove('hidden'); playerList.classList.remove('hidden');
  roomSettings.classList.toggle('hidden', room.quick || room.botMatch || room.demo);
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
document.querySelector('#bot-match-button').addEventListener('click', async () => {
  setError('');
  const response = await emitAck('room:create', {
    characterId: selectedCharacter,
    palette: selectedPalette,
    botMatch: true,
    botDifficulty: 'normal',
    rules: { ...currentSettings(), mode: 'stock', stocks: 3, timeSeconds: 420, items: false, hazards: false }
  });
  if (!response?.ok) return setError(response?.error || 'BOT 대전을 시작할 수 없습니다.');
  myIndex = response.index;
  saveSession({ code: response.code, resumeToken: response.resumeToken });
  enterRoom(response.room, response.snapshot);
  const started = await emitAck('room:start');
  if (!started?.ok) setError(started?.error || 'BOT 대전을 시작할 수 없습니다.');
});
document.querySelector('#demo-button').addEventListener('click', async () => {
  setError('');
  const response = await emitAck('room:create', {
    demo: true,
    rules: { ...currentSettings(), mode: 'stock', stocks: 3, timeSeconds: 420, items: false, hazards: false }
  });
  if (!response?.ok) return setError(response?.error || 'BOT 데모를 시작할 수 없습니다.');
  saveSession({ code: response.code, resumeToken: response.resumeToken });
  enterRoom(response.room, response.snapshot);
  myIndex = -1;
  const started = await emitAck('room:start');
  if (!started?.ok) setError(started?.error || 'BOT 데모를 시작할 수 없습니다.');
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
  networkQuality.reset();
  runtimeMonitor.reset(performance.now());
  runtimeMetrics.fps = 0;
  runtimeMetrics.frameMs = 0;
  runtimeMetrics.slowFrames = 0;
  snapshotIntervals = [];
  snapshotTickRates = [];
  lastSnapshotArrival = 0;
  lastSnapshotTick = null;
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
  snapshots = []; latestSnapshot = null; players = []; particles = []; trails = []; impactRings = []; blastMarks = []; shieldBreakEffects = []; localCue = null; ultimateCinematic = null; lastEvents.clear();
  receiveSnapshot(snapshot);
}

function receiveSnapshot(snapshot) {
  if (!snapshot) return;
  const receivedAt = performance.now();
  if (myIndex >= 0 && snapshot.ackSeq) {
    const ack = Number(snapshot.ackSeq[myIndex]) || 0;
    inputSeq = Math.max(inputSeq, ack);
    networkQuality.acknowledged(ack, receivedAt);
  }
  if (lastSnapshotArrival > 0) {
    const interval = receivedAt - lastSnapshotArrival;
    if (interval < 500) {
      snapshotIntervals.push(interval);
      if (snapshotIntervals.length > 24) snapshotIntervals.shift();
      const mean = snapshotIntervals.reduce((sum, value) => sum + value, 0) / snapshotIntervals.length;
      networkJitter = snapshotIntervals.reduce((sum, value) => sum + Math.abs(value - mean), 0) / snapshotIntervals.length;
    }
  }
  if (Number.isFinite(snapshot.tick) && Number.isFinite(lastSnapshotTick)) {
    const tickDelta = snapshot.tick - lastSnapshotTick;
    if (tickDelta > 0 && tickDelta <= 12) {
      snapshotTickRates.push(60 / tickDelta);
      if (snapshotTickRates.length > 24) snapshotTickRates.shift();
      const orderedRates = [...snapshotTickRates].sort((a, b) => a - b);
      runtimeMetrics.snapshotHz = +orderedRates[Math.floor(orderedRates.length / 2)].toFixed(1);
    }
  }
  if (Number.isFinite(snapshot.tick)) lastSnapshotTick = snapshot.tick;
  lastSnapshotArrival = receivedAt;
  runtimeMonitor.snapshot();
  const buffered = { receivedAt, data: snapshot };
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
        const particleCount = ultimate ? 28 : event.type === 'parry' ? 18 : critical ? 22 : sweet ? 16 : event.type === 'shield-hit' ? 9 : pummel ? 7 : 12;
        const particleSpeed = ultimate ? 520 : 145 + impactStrength * (critical ? 215 : 135);
        burst(hitX, hitY, impactColor, particleCount, particleSpeed, impactAngle, ultimate ? 2.05 : critical ? 1.8 : sweet ? 1.45 : pummel ? .88 : 1.22);
        if (ultimate) burst(hitX, hitY, '#ffffff', 12, 370, impactAngle + Math.PI, 1.45);
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
      if (player) {
        const visualDuration = event.type === 'parry' ? 190 : critical || ultimate ? 170 : sweet ? 125 : pummel ? 70 : 92;
        player.flashUntil = performance.now() + (event.type === 'parry' ? 190 : critical ? 240 : sweet ? 180 : pummel ? 100 : 145);
        player.impactVisualUntil = performance.now() + visualDuration;
        player.impactVisualStrength = impactStrength;
        player.impactVisualAngle = impactAngle;
      }
      screenShake = Math.max(screenShake, ultimate ? 22 : event.type === 'parry' ? 12 : critical ? 17 : 3 + impactStrength * 4.5 + (sweet ? 2 : 0));
      cameraPunch = Math.max(cameraPunch, ultimate ? .145 : event.type === 'parry' ? .075 : critical ? .12 : Math.min(.078, .012 + impactStrength * .045));
      if (critical || ultimate) criticalFlash = 1;
      if (event.type === 'parry') beep(620, .075, 'square');
      else impactSound(impactStrength, { critical: critical || ultimate, sweet, pummel, shield: event.type === 'shield-hit' });
    }
    if (event.type === 'counter') {
      const defender = players.find(item => item.i === event.player);
      const attacker = players.find(item => item.i === event.attacker);
      const x = event.x ?? (defender && attacker ? (defender.x + attacker.x) / 2 : defender?.x);
      const y = event.y ?? (defender && attacker ? (defender.y + attacker.y) / 2 : defender?.y);
      const angle = event.direction < 0 ? Math.PI : 0;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        burst(x, y, '#fff4dc', 18, 330, angle, 1.6);
        burst(x, y, '#ff4d6d', 8, 230, angle, 1.25);
      }
      if (defender) defender.flashUntil = performance.now() + 260;
      screenShake = Math.max(screenShake, 14);
      cameraPunch = Math.max(cameraPunch, .095);
      criticalFlash = Math.max(criticalFlash, .7);
      beep(72, .12, 'square');
    }
    if (event.type === 'shield-break') {
      const player = players.find(item => item.i === event.player);
      const fighter = player && (FIGHTERS.find(item => item.id === player.characterId) || FIGHTERS[0]);
      const color = event.color || (player && fighter?.palettes?.[player.palette % fighter.palettes.length]) || '#7ce8ff';
      const x = Number.isFinite(event.x) ? event.x : player?.x;
      const y = Number.isFinite(event.y) ? event.y : player?.y;
      const radius = clamp(
        Number(event.radius) || Math.max((player?.width || 50) * .9 + 15, (player?.height || 70) * .75 + 12),
        54,
        96
      );
      if (Number.isFinite(x) && Number.isFinite(y)) {
        const duration = .66;
        shieldBreakEffects.push({ x, y, radius, color, life: duration, duration });
        if (shieldBreakEffects.length > 5) shieldBreakEffects.shift();
        burst(x, y, color, 16, 285, -Math.PI / 2, 1.5);
        burst(x, y, '#ffffff', 7, 210, Math.PI / 2, 1.15);
      }
      if (player) player.flashUntil = performance.now() + 260;
      screenShake = Math.max(screenShake, 13);
      cameraPunch = Math.max(cameraPunch, .085);
      criticalFlash = Math.max(criticalFlash, .42);
      beep(54, .16, 'sawtooth');
      beep(760, .07, 'square');
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
    if (event.type === 'ko') {
      screenShake = 18;
      cameraPunch = .11;
      beep(event.style === 'star' ? 420 : event.style === 'screen' ? 82 : 60, event.style === 'blast' ? .2 : .32, 'sawtooth');
      if (event.style === 'star' || event.style === 'screen') {
        koCinematics.push({
          style: event.style,
          characterId: event.characterId,
          palette: event.palette || 0,
          life: event.style === 'star' ? 1.75 : 1.45,
          duration: event.style === 'star' ? 1.75 : 1.45
        });
        if (koCinematics.length > 4) koCinematics.shift();
      }
    }
    if (event.type === 'land') { screenShake = Math.max(screenShake, 1); beep(72, .025, 'sine'); }
    if (event.type === 'tech') {
      if (Number.isFinite(event.x) && Number.isFinite(event.y)) burst(event.x, event.y, '#55bfff', 10, 135, -Math.PI / 2, .8);
      beep(720, .055, 'square');
    }
    if (event.type === 'knockdown') {
      if (Number.isFinite(event.x) && Number.isFinite(event.y)) burst(event.x, event.y, event.techable === false ? '#ff4d5f' : '#55bfff', 12, 155, -Math.PI / 2, .9);
      screenShake = Math.max(screenShake, 3); beep(85, .04, 'sine');
    }
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
    if (event.type === 'footstool') {
      const target = players.find(item => item.i === event.target);
      const x = event.x ?? target?.x, y = event.y ?? target?.y;
      if (Number.isFinite(x) && Number.isFinite(y)) burst(x, y, '#eaffff', 12, 170, -Math.PI / 2, .9);
      beep(520, .045, 'square');
    }
    if (event.type === 'ledge-trump') {
      const player = players.find(item => item.i === event.player);
      const x = event.x ?? player?.x, y = event.y ?? player?.y;
      if (Number.isFinite(x) && Number.isFinite(y)) burst(x, y, '#80efff', 10, 140, 0, .82);
      beep(260, .04, 'square');
    }
    if (event.type === 'fast-fall') {
      if (Number.isFinite(event.x) && Number.isFinite(event.y)) {
        burst(event.x, event.y, '#ffffff', 8, 105, -Math.PI / 2, .72);
      }
      beep(680, .025, 'sine');
    }
    if (event.type === 'explosion') {
      screenShake = Math.max(screenShake, 11); cameraPunch = Math.max(cameraPunch, .07);
      if (Number.isFinite(event.x) && Number.isFinite(event.y) && Number.isFinite(event.radius)) blastMarks.push({ x:event.x, y:event.y, radius:event.radius, color:event.color || '#ffcf6b', life:.2, duration:.2 });
      beep(75, .13, 'sawtooth');
    }
  }
}

function copyState(target, source) {
  for (const key of ['clientId','nickname','vx','vy','face','grounded','jumps','doubleJumpSerial','damage','stocks','score','shield','shielding','parryFrames','shieldStun','shieldDropLag','shieldOffsetX','shieldOffsetY','invincible','dodgeFrames','dodgeTotalFrames','dodgeElapsed','dodgeSerial','dodgeStartVx','dodgeStartVy','dodgeInitialVx','dodgeInitialVy','dodgeWindupFrames','dodgeNeutral','airDodgeAvailable','recoveryAvailable','ledge','ledgeGrabs','ledgeTransition','ledgeTransitionFrames','ledgeTransitionTotal','grabbedBy','grabbing','grabFrames','grabEscape','grabPummelCooldown','comboCount','jabStep','jabTimer','actionName','actionFrame','actionPhase','actionVariant','actionMotion','actionAngleShift','actionTiming','phaseProgress','actionHitbox','strikePoints','hurtboxes','chargeFrames','chargeScale','projectileCooldown','projectileCooldownMax','ultimateMeter','stun','dizzyFrames','footstoolCooldown','fastFalling','fastFallFlashFrames','horizontalHoldFrames','landingLag','tumbling','tumbleRecoverFrames','freefall','techWindow','knockdownFrames','criticalFlightFrames','dodgeFatigue','movementState','dashFrames','dashAge','dashDirection','dashBrakeFrames','jumpSquatDash','jumpSquatFrames','eliminated','respawn','respawnPlatformFrames','ackSeq','heldItem','team','characterId','palette','width','height']) target[key] = source[key];
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
  adaptiveDelay = lerp(adaptiveDelay, targetAdaptiveDelay, 1 - Math.exp(-Math.max(.001, dt) * 3.4));
  const renderAt = now - adaptiveDelay;
  while (snapshots.length > 2 && snapshots[1].receivedAt <= renderAt) snapshots.shift();
  const older = snapshots[0] || latestSnapshot, newer = snapshots[1] || older;
  const mix = clamp((renderAt - older.receivedAt) / Math.max(1, newer.receivedAt - older.receivedAt), 0, 1);
  platforms = newer.data.platforms || [];
  entities = newer.data.entities || []; items = newer.data.items || [];
  const newerPlayers = newer.data.players || [];
  renderOlderByIndex.clear(); renderLatestByIndex.clear(); renderDisplayByClient.clear(); renderActiveClientIds.clear();
  for (const player of older.data.players || []) renderOlderByIndex.set(player.i, player);
  for (const player of latestSnapshot.data.players || []) renderLatestByIndex.set(player.i, player);
  for (const player of players) renderDisplayByClient.set(player.clientId, player);
  for (const player of newerPlayers) renderActiveClientIds.add(player.clientId);
  players = players.filter(player => renderActiveClientIds.has(player.clientId));
  for (const source of newerPlayers) {
    let display = renderDisplayByClient.get(source.clientId);
    if (!display) {
      display = { ...source, x: source.x, y: source.y };
      players.push(display);
      renderDisplayByClient.set(source.clientId, display);
    }
    const from = renderOlderByIndex.get(source.i) || source;
    if (source.i === myIndex) {
      const localSource = renderLatestByIndex.get(source.i) || source;
      const snapshotAge = Math.min(.1, Math.max(0, (now - latestSnapshot.receivedAt) / 1000));
      const inputLead = Math.min(.07, Math.max(0, Number(runtimeMetrics.inputAckMs) || 0) / 2000);
      const predictionLead = Math.min(.12, snapshotAge + inputLead);
      const local = readInput(); const fighter = FIGHTERS.find(item => item.id === localSource.characterId);
      const actionName = localSource.actionName || '';
      const aerialDrift = /^air(Neutral|Forward|Back|Up|Down)$/.test(actionName);
      const locked = !aerialDrift && /ground|air|special|item|grab|throw|landing|hit|tech|roll|dodge|knockdown|getup|dashAttack|jumpSquat/.test(actionName);
      const dashState = localSource.dashFrames > 0 && (localSource.movementState === 'dash' || localSource.movementState === 'pivot');
      const groundPredictionSpeed = dashState
        ? (localSource.movementState === 'pivot' ? fighter.pivotDashSpeed : fighter.dashSpeed)
        : localSource.movementState === 'run' ? fighter.runSpeed : fighter.walkSpeed;
      const targetVx = locked ? localSource.vx : local.horizontal * (localSource.grounded ? groundPredictionSpeed * fighter.speed : 345 * fighter.air);
      const predictedVx = lerp(localSource.vx, targetVx, clamp(predictionLead * (localSource.grounded ? 25 : 14), 0, 1));
      const predictedX = localSource.x + (localSource.vx + predictedVx) * .5 * predictionLead;
      const predictedY = localSource.y + (localSource.grounded ? 0 : localSource.vy * predictionLead + 720 * predictionLead * predictionLead);
      const lifecycleJump = localSource.respawn > 0 || display.respawn > 0
        || !!localSource.eliminated !== !!display.eliminated;
      if (lifecycleJump) {
        // KO and respawn deliberately cross the stage in one server update.
        // Snap that authored lifecycle transition without reporting it as a
        // network prediction failure or polluting correction telemetry.
        display.x = localSource.x;
        display.y = localSource.y;
      } else {
        const correctionError = Math.hypot(predictedX - display.x, predictedY - display.y);
        const correction = networkQuality.correction(correctionError, now, runtimeMetrics.inputAckMs);
        if (correction > 0) {
          display.x = lerp(display.x, predictedX, correction);
          display.y = lerp(display.y, predictedY, correction);
        }
      }
      copyState(display, localSource);
      display.actionFrame = (Number(localSource.actionFrame) || 0) + (localSource.hitstop > 0 ? 0 : snapshotAge * 60);
      display.phaseProgress = extrapolatedPhaseProgress(localSource, snapshotAge);
      if (localCue && localSource.ackSeq >= localCue.seq) localCue = null;
    } else {
      const extrapolation = mix >= 1 ? clamp((renderAt - newer.receivedAt) / 1000, 0, .08) : 0;
      display.x = lerp(from.x, source.x, mix) + (Number(source.vx) || 0) * extrapolation;
      display.y = lerp(from.y, source.y, mix) + (Number(source.vy) || 0) * extrapolation;
      copyState(display, mix < .5 ? from : source);
      if (from.actionName === source.actionName && from.actionPhase === source.actionPhase) {
        display.actionFrame = lerp(Number(from.actionFrame) || 0, Number(source.actionFrame) || 0, mix);
        display.phaseProgress = lerp(Number(from.phaseProgress) || 0, Number(source.phaseProgress) || 0, mix);
        if (extrapolation > 0 && source.hitstop <= 0) {
          display.actionFrame += extrapolation * 60;
          display.phaseProgress = extrapolatedPhaseProgress(source, extrapolation);
        }
      }
    }
  }
}

function readInput() {
  const gp = navigator.getGamepads?.()[0];
  const keyboardHorizontal = keyboardIntent.horizontal(keys, performance.now());
  const horizontal = keyboardHorizontal || (Math.abs(gp?.axes?.[0] || 0) > .2 ? gp.axes[0] : 0);
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
  const input = readInput(), clientTime = performance.now(), seq = ++inputSeq;
  recordTrainingInput(input); updateTutorialInput(input);
  networkQuality.sent(seq, clientTime);
  const payload = { seq, clientTime, ...input };
  // Button/direction edges must arrive: losing a press or release feels like a
  // broken controller. Repeated held-state frames are replaceable and stay
  // volatile so congestion cannot build a stale movement queue.
  if (inputTransport.channel(input, force) === 'reliable') socket.emit('input:frame', payload);
  else socket.volatile.emit('input:frame', payload);
  lastInputSent = now;
}

setInterval(() => {
  if (!socket.connected) return;
  const sent = performance.now(); socket.emit('latency:ping', sent, response => {
    if (!response || !Number.isFinite(response.clientTime)) return;
    const sample = performance.now() - response.clientTime; pingSamples.push(sample); if (pingSamples.length > 9) pingSamples.shift();
    ping = [...pingSamples].sort((a,b) => a-b)[Math.floor(pingSamples.length / 2)] || 0;
    targetAdaptiveDelay = clamp(62 + ping * .36 + networkJitter * 1.35, 65, 145);
  });
}, 1500);

document.addEventListener('visibilitychange', () => {
  if (document.hidden || !latestSnapshot) return;
  snapshots = [latestSnapshot];
  localCue = null;
  lastFrame = performance.now();
  sendInput(lastFrame, true);
});

function updateCamera(dt) {
  let visibleCount = 0, minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const player of players) {
    if (player.eliminated || player.respawn !== 0 || player.x <= -370 || player.x >= WORLD_W + 370 || player.y <= -310 || player.y >= WORLD_H + 270) continue;
    visibleCount++;
    minX = Math.min(minX, player.x); maxX = Math.max(maxX, player.x);
    minY = Math.min(minY, player.y); maxY = Math.max(maxY, player.y);
  }
  if (visibleCount) {
    const targetX = clamp((minX + maxX) / 2, 260, 1020);
    const targetY = clamp((minY + maxY) / 2 - 35, 220, 475);
    const spanX = Math.max(430, maxX - minX + 380), spanY = Math.max(330, maxY - minY + 300);
    const targetZoom = clamp(Math.min(1120 / spanX, 590 / spanY), .68, visibleCount <= 2 ? 1.24 : 1.12);
    const follow = 1 - Math.exp(-dt * 5.5);
    camera.x = lerp(camera.x, targetX, follow); camera.y = lerp(camera.y, targetY, follow);
    camera.zoom = lerp(camera.zoom, targetZoom, 1 - Math.exp(-dt * 3.5));
  }
  screenShake = Math.max(0, screenShake - dt * 42);
  cameraPunch = Math.max(0, cameraPunch - dt * .35);
  criticalFlash = Math.max(0, criticalFlash - dt * 7);
}

function draw(dt) {
  // Shed decorative detail immediately on a slow frame, then restore it
  // gradually. Core silhouettes, hit markers, and gameplay geometry remain.
  if (dt > .024) effectQuality = Math.max(.5, effectQuality - .18);
  else if (dt > .019) effectQuality = Math.max(.68, effectQuality - .06);
  else effectQuality = Math.min(1, effectQuality + dt * .55);
  if (!visualFixtureActive) updateCamera(dt);
  ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = '#080a12'; ctx.fillRect(0,0,canvas.width,canvas.height);
  const assetBackgroundDrawn = window.NEON_ART?.drawStageBackground(ctx, stage, {
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height
  }) || false;
  ctx.setTransform(dpr*viewScale,0,0,dpr*viewScale,viewOffsetX*dpr,viewOffsetY*dpr);
  const shakeX = (Math.random() - .5) * screenShake, shakeY = (Math.random() - .5) * screenShake;
  ctx.translate(WORLD_W / 2 + shakeX, WORLD_H / 2 + shakeY);
  ctx.scale(camera.zoom + cameraPunch, camera.zoom + cameraPunch);
  ctx.translate(-camera.x, -camera.y);
  drawBackground(assetBackgroundDrawn); drawBlastZone(); drawPlatforms(); drawEntities(); drawRespawnPlatforms();
  drawTrails();
  drawDashAfterimages();
  for (const player of window.NEON_READABILITY.layerOrder(players, myIndex)) drawPlayer(player, dt);
  drawBlastMarks();
  drawShieldBreakEffects();
  drawParticles();
  drawImpactRings();
  ctx.setTransform(dpr*viewScale,0,0,dpr*viewScale,viewOffsetX*dpr,viewOffsetY*dpr);
  drawCameraIndicators();
  drawKoCinematics();
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
  ctx.globalAlpha = alpha * .2;ctx.fillStyle = ultimateCinematic.color;
  for(let index=0;index<6;index++){
    const shardX=610+index*72+slide*.18,shardW=82-index*6;
    ctx.beginPath();ctx.moveTo(shardX,54);ctx.lineTo(shardX+shardW,54);ctx.lineTo(shardX+shardW-58,132);ctx.lineTo(shardX-58,132);ctx.closePath();ctx.fill();
  }
  ctx.globalAlpha=alpha*.3;ctx.fillStyle='#ffffff';
  for(let index=0;index<4;index++){
    const notchX=52+index*108-slide*.2;
    ctx.beginPath();ctx.moveTo(notchX,64);ctx.lineTo(notchX+58,64);ctx.lineTo(notchX+48,68);ctx.lineTo(notchX,68);ctx.closePath();ctx.fill();
  }
  ctx.globalAlpha = alpha;
  ctx.textAlign='left';ctx.fillStyle='#ffffff';ctx.font='900 31px Inter';ctx.fillText(english,42-slide*.18,92);
  ctx.fillStyle=ultimateCinematic.color;ctx.font='900 13px Inter';ctx.fillText(`${fighter.name}  //  ${korean}`,44-slide*.12,117);
  ctx.restore();
}

function paintBackground(target, stageDefinition) {
  const ctx = target, stage = stageDefinition;
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
    ctx.save(); ctx.translate(640, 485); ctx.shadowBlur = 16; ctx.shadowColor = '#ff335f';
    for (let i = 5; i > 0; i--) { ctx.strokeStyle = `rgba(255,51,95,${.05 + i * .035})`; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, 40 + i * 32, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#ff335f'; ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.055)'; ctx.lineWidth = 12; for (const x of [120, 1160]) { ctx.beginPath(); ctx.moveTo(x, 80); ctx.lineTo(x + (x < 640 ? 180 : -180), 570); ctx.stroke(); }
  }
  const horizon = 520; ctx.strokeStyle = 'rgba(112,190,255,.07)'; ctx.lineWidth = 1;
  for (let y = horizon; y < 760; y += 24) { ctx.beginPath(); ctx.moveTo(-220, y); ctx.lineTo(1500, y); ctx.stroke(); }
  for (let x = -200; x <= 1480; x += 80) { ctx.beginPath(); ctx.moveTo(640, horizon); ctx.lineTo(x, 760); ctx.stroke(); }
  ctx.fillStyle = 'rgba(255,255,255,.014)'; for (let y = -100; y < 820; y += 6) ctx.fillRect(-240, y, 1760, 1);
}
function drawBackground(assetBackgroundDrawn = false) {
  if (assetBackgroundDrawn) return;
  const bounds = { x: -430, y: -330, width: WORLD_W + 860, height: WORLD_H + 620 };
  if (!backgroundCache || backgroundCacheStage !== stage.id) {
    const left = bounds.x, top = bounds.y, width = bounds.width, height = bounds.height;
    const texture = document.createElement('canvas');
    texture.width = width; texture.height = height;
    const backgroundContext = texture.getContext('2d', { alpha: false });
    backgroundContext.translate(-left, -top);
    paintBackground(backgroundContext, stage);
    backgroundCache = texture;
    backgroundCacheStage = stage.id;
  }
  ctx.drawImage(backgroundCache, bounds.x, bounds.y);
}
function drawBlastZone(){ctx.save();ctx.strokeStyle='rgba(255,51,95,.32)';ctx.lineWidth=5;ctx.shadowBlur=7;ctx.shadowColor='#ff335f';ctx.setLineDash([14,18]);ctx.strokeRect(-360,-300,WORLD_W+720,WORLD_H+560);ctx.setLineDash([]);ctx.restore();}
function paintPlatform(ctx, p, stageColor) {
    ctx.save();
    ctx.shadowBlur = p.passThrough ? 5 : 9;
    ctx.shadowColor = stageColor;
    const top = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y);
    top.addColorStop(0, stageColor);
    top.addColorStop(.18, '#f3fdff');
    top.addColorStop(.82, '#f3fdff');
    top.addColorStop(1, stageColor);
    ctx.fillStyle = top;
    ctx.fillRect(p.x, p.y, p.w, p.passThrough ? 6 : 9);
    ctx.shadowBlur = 0;
    if (p.passThrough) {
      ctx.fillStyle = 'rgba(255,255,255,.13)';
      for (let x = p.x + 8; x < p.x + p.w - 8; x += 22) ctx.fillRect(x, p.y + 8, 12, 2);
    } else if (p.ground) {
      const depth = p.groundDepth || 320;
      const ground = ctx.createLinearGradient(0, p.y, 0, p.y + depth);
      ground.addColorStop(0, '#1c2b43');
      ground.addColorStop(.22, '#101b2d');
      ground.addColorStop(1, '#050811');
      ctx.fillStyle = ground;
      ctx.fillRect(p.x, p.y + 8, p.w, depth);
      ctx.fillStyle = 'rgba(3,7,14,.78)';
      ctx.fillRect(p.x + 13, p.y + 25, p.w - 26, depth - 25);
      ctx.strokeStyle = 'rgba(38,217,255,.5)';
      ctx.lineWidth = 4;
      ctx.strokeRect(p.x + 2, p.y + 10, p.w - 4, depth - 2);
      ctx.fillStyle = 'rgba(38,217,255,.24)';
      ctx.fillRect(p.x + 3, p.y + 13, 8, depth - 8);
      ctx.fillRect(p.x + p.w - 11, p.y + 13, 8, depth - 8);
      ctx.strokeStyle = 'rgba(116,151,188,.18)';
      ctx.lineWidth = 2;
      for (let y = p.y + 56; y < p.y + depth; y += 58) {
        ctx.beginPath(); ctx.moveTo(p.x + 14, y); ctx.lineTo(p.x + p.w - 14, y); ctx.stroke();
      }
      for (let x = p.x + 118; x < p.x + p.w; x += 118) {
        ctx.beginPath(); ctx.moveTo(x, p.y + 26); ctx.lineTo(x, p.y + depth); ctx.stroke();
      }
      ctx.fillStyle = 'rgba(205,239,255,.42)';
      for (let x = p.x + 34; x < p.x + p.w - 20; x += 118) {
        for (let y = p.y + 42; y < p.y + depth; y += 58) {
          ctx.fillRect(x, y, 4, 4);
          ctx.fillRect(x + 72, y, 4, 4);
        }
      }
      const rim = ctx.createLinearGradient(p.x, 0, p.x + p.w, 0);
      rim.addColorStop(0, '#26d9ff');
      rim.addColorStop(.16, '#f3fdff');
      rim.addColorStop(.5, '#8ceeff');
      rim.addColorStop(.84, '#f3fdff');
      rim.addColorStop(1, '#26d9ff');
      ctx.fillStyle = rim;
      ctx.fillRect(p.x, p.y + 8, p.w, 8);
      ctx.fillStyle = '#0a1220';
      ctx.fillRect(p.x + 14, p.y + 16, p.w - 28, 8);
    } else {
      const g = ctx.createLinearGradient(0, p.y, 0, p.y + 78);
      g.addColorStop(0, 'rgba(44,54,82,.98)');
      g.addColorStop(.55, 'rgba(17,22,40,.92)');
      g.addColorStop(1, 'rgba(7,9,18,.05)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + 8);
      ctx.lineTo(p.x + p.w, p.y + 8);
      ctx.lineTo(p.x + p.w - 62, p.y + 72);
      ctx.lineTo(p.x + 62, p.y + 72);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.09)';
      ctx.lineWidth = 2;
      for (let x = p.x + 80; x < p.x + p.w - 60; x += 95) {
        ctx.beginPath(); ctx.moveTo(x, p.y + 13); ctx.lineTo(x + 25, p.y + 48); ctx.stroke();
      }
    }
    ctx.restore();
}
function drawPlatforms() {
  const padding = 30;
  for (const p of platforms) {
    const depth = p.ground ? (p.groundDepth || 320) : (p.passThrough ? 18 : 78);
    const moving = !!(p.moving || p.moveAxis || p.range || p.speed || p.baseX != null || p.baseY != null);
    let assetDrawn = false;
    if (p.ground) {
      assetDrawn = window.NEON_ART?.drawTerrain(ctx, stage.id, 'cliff', {
        x: p.x, y: p.y, width: p.w, height: depth
      }) || false;
      window.NEON_ART?.drawTerrain(ctx, stage.id, 'main-floor', {
        x: p.x, y: p.y, width: p.w, height: Math.min(86, depth)
      });
    } else {
      const kind = p.passThrough ? (moving ? 'moving' : 'pass-through') : 'main-floor';
      assetDrawn = window.NEON_ART?.drawTerrain(ctx, stage.id, kind, {
        x: p.x,
        y: p.y,
        width: p.w,
        height: p.passThrough ? (moving ? 34 : 22) : depth
      }) || false;
    }
    if (assetDrawn) continue;
    const key = `${stage.id}|${stage.color}|${p.w}|${p.h || 0}|${depth}|${p.passThrough ? 1 : 0}|${p.ground ? 1 : 0}`;
    let texture = platformTextureCache.get(key);
    if (!texture) {
      const platformCanvas = document.createElement('canvas');
      platformCanvas.width = Math.ceil(p.w + padding * 2);
      platformCanvas.height = Math.ceil(depth + padding * 2);
      const platformContext = platformCanvas.getContext('2d');
      paintPlatform(platformContext, { ...p, x: padding, y: padding }, stage.color);
      texture = platformCanvas;
      platformTextureCache.set(key, texture);
    }
    ctx.drawImage(texture, p.x - padding, p.y - padding);
  }
}
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
    ctx.shadowBlur = 8; ctx.shadowColor = def.color;
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
  const reduced=effectQuality<.78||entities.length>4||particles.length>42;
  for(const e of entities){
    const color=e.color||'#fff',spin=now/180*(e.returning?-1:1);ctx.save();ctx.translate(e.x,e.y);ctx.shadowBlur=reduced?0:7;ctx.shadowColor=color;ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineCap='round';
    if(e.kind==='ultimateVolt'){
      const armed=e.arm<=0,r=e.radius||86,flicker=.82+Math.sin(now*.09)*.18;ctx.globalAlpha=armed?.98:.34*flicker;
      if(armed){
        const boltRange=reduced?1:2;for(let bolt=-boltRange;bolt<=boltRange;bolt++){ctx.strokeStyle=bolt===0?'#ffffff':color;ctx.lineWidth=bolt===0?13:5;ctx.beginPath();ctx.moveTo(bolt*17,-300);ctx.lineTo(bolt*7-12,-220);ctx.lineTo(bolt*13+9,-142);ctx.lineTo(bolt*4-7,-62);ctx.lineTo(bolt*11,38);ctx.stroke();}
        const sparkRange=reduced?2:3;ctx.globalAlpha=.82;ctx.lineWidth=4;for(let spark=-sparkRange;spark<=sparkRange;spark++){ctx.beginPath();ctx.moveTo(0,35);ctx.lineTo(spark*28,52+Math.abs(spark)*7);ctx.stroke();}
      }else{
        ctx.setLineDash([13,11]);ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(-r*.48,-245);ctx.lineTo(-r*.48,47);ctx.moveTo(r*.48,-245);ctx.lineTo(r*.48,47);ctx.stroke();ctx.setLineDash([]);
        const bracket=24;ctx.lineWidth=4;for(const sx of [-1,1])for(const sy of [-1,1]){ctx.beginPath();ctx.moveTo(sx*r,34+sy*r*.22);ctx.lineTo(sx*(r-bracket),34+sy*r*.22);ctx.moveTo(sx*r,34+sy*r*.22);ctx.lineTo(sx*r,34+sy*(r*.22-bracket*.35));ctx.stroke();}
        ctx.globalAlpha=.72*flicker;ctx.strokeStyle='#ffffff';ctx.lineWidth=4;ctx.beginPath();
        ctx.moveTo(-11,-190);ctx.lineTo(8,-148);ctx.lineTo(-7,-103);ctx.lineTo(10,-58);ctx.lineTo(-5,-12);ctx.lineTo(6,36);ctx.stroke();
      }
    }else if(e.kind==='ultimateNova'){
      const armed=e.arm<=0,r=e.radius||165,collapse=armed?.12:clamp((e.arm||0)/24,0,1);ctx.globalAlpha=armed?.96:.42;ctx.lineWidth=armed?6:2.5;
      const spokeCount=reduced?6:8;for(let spoke=0;spoke<spokeCount;spoke++){const a=spoke*Math.PI*2/spokeCount+now*.00018,outer=r*(.78+.12*Math.sin(now*.002+spoke)),inner=18+collapse*38;ctx.beginPath();ctx.moveTo(Math.cos(a)*outer,Math.sin(a)*outer);ctx.lineTo(Math.cos(a+.11)*inner,Math.sin(a+.11)*inner);ctx.stroke();}
      const moteCount=reduced?6:10;for(let mote=0;mote<moteCount;mote++){const a=mote*2.399+now*.00012,travel=((now*.00055+mote*.11)%1),distance=18+(r-18)*(1-travel);ctx.globalAlpha=(armed?.9:.55)*(1-travel*.45);ctx.fillStyle=mote%4===0?'#ffffff':color;ctx.fillRect(Math.cos(a)*distance-2,Math.sin(a)*distance-2,4,4);}
      ctx.rotate(now*.0012);ctx.globalAlpha=armed?1:.75;ctx.fillStyle=armed?'#ffffff':'#05030d';ctx.strokeStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,-24);ctx.lineTo(24,0);ctx.lineTo(0,24);ctx.lineTo(-24,0);ctx.closePath();ctx.fill();ctx.stroke();
    }else if(e.kind==='ultimateBolt'){
      const r=e.radius||42;ctx.rotate(Math.atan2(e.vy||0,e.vx||1));
      for(let streak=0;streak<5;streak++){const y=(streak-2)*8,tail=-r*(4.9-streak*.56),tip=r*.42,w=2+streak*1.15;ctx.globalAlpha=.13+streak*.1;ctx.fillStyle=streak===4?'#ffffff':color;ctx.beginPath();ctx.moveTo(tail,y-w*.35);ctx.lineTo(tip,y-w);ctx.lineTo(tip+r*.2,y);ctx.lineTo(tip,y+w);ctx.lineTo(tail,y+w*.35);ctx.closePath();ctx.fill();}
      ctx.rotate(spin*1.8);ctx.globalAlpha=.9;for(let blade=0;blade<4;blade++){ctx.rotate(Math.PI/2);ctx.fillStyle=blade%2?'#ffffff':color;ctx.beginPath();ctx.moveTo(8,-7);ctx.lineTo(r*1.18,0);ctx.lineTo(8,7);ctx.closePath();ctx.fill();}
      ctx.fillStyle='#07101a';ctx.fillRect(-9,-9,18,18);
    }else if(e.kind==='gravity'){
      const radius=e.radius||105,pulse=.96+Math.sin(now/140)*.04;
      ctx.globalAlpha=.13;ctx.fillStyle=color;ctx.beginPath();ctx.arc(0,0,radius*pulse,0,Math.PI*2);ctx.fill();
      ctx.globalAlpha=.48;ctx.lineWidth=2;ctx.setLineDash([8,7]);ctx.beginPath();ctx.arc(0,0,radius,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
      ctx.globalAlpha=.82;ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,18,0,Math.PI*2);ctx.stroke();
      const arrows=reduced?4:6;for(let i=0;i<arrows;i++){const angle=i*Math.PI*2/arrows+now*.00015,outer=radius*.72,inner=radius*.42;ctx.globalAlpha=.4;ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(Math.cos(angle)*outer,Math.sin(angle)*outer);ctx.lineTo(Math.cos(angle)*inner,Math.sin(angle)*inner);ctx.stroke();ctx.fillStyle=color;ctx.beginPath();ctx.arc(Math.cos(angle)*inner,Math.sin(angle)*inner,2.5,0,Math.PI*2);ctx.fill();}
    }else if(e.kind==='static'){
      ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-16,10);ctx.lineTo(-8,-8);ctx.lineTo(0,8);ctx.lineTo(9,-11);ctx.lineTo(17,9);ctx.stroke();ctx.globalAlpha=e.arm>0?.24:.72;
      const spikeCount=reduced?4:6;for(let i=0;i<spikeCount;i++){const a=i*Math.PI*2/spikeCount+Math.sin(now/260)*.04,r=(e.radius||78);ctx.beginPath();ctx.moveTo(Math.cos(a)*r*.82,Math.sin(a)*r*.82);ctx.lineTo(Math.cos(a-.08)*r,Math.sin(a-.08)*r);ctx.lineTo(Math.cos(a+.05)*r*.9,Math.sin(a+.05)*r*.9);ctx.stroke();}
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

function blendKeyPose(from, to, amount) {
  if (!to) return null;
  if (!from) return { ...to };
  const mix = clamp(amount, 0, 1);
  const pose = {};
  for (const key of Object.keys(BASE_KEY_POSE)) {
    const start = Number.isFinite(from[key]) ? from[key] : BASE_KEY_POSE[key];
    const end = Number.isFinite(to[key]) ? to[key] : BASE_KEY_POSE[key];
    pose[key] = lerp(start, end, mix);
  }
  return pose;
}

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
  dash: [
    { t: 0, bodyX: -5, bodyY: 10, rotation: .14, scaleX: 1.2, scaleY: .74, frontHandX: -31, frontHandY: 5, backHandX: -20, backHandY: -8, frontFootX: 29, frontFootLift: 0, backFootX: -25, backFootLift: 3 },
    { t: .22, bodyX: 11, bodyY: 7, rotation: -.25, scaleX: 1.27, scaleY: .7, frontHandX: -33, frontHandY: -2, backHandX: -25, backHandY: -13, frontFootX: 42, frontFootLift: 1, backFootX: -31, backFootLift: 11 },
    { t: .52, bodyX: 8, bodyY: 1, rotation: -.17, scaleX: 1.12, scaleY: .87, frontHandX: -26, frontHandY: -4, backHandX: 18, backHandY: -15, frontFootX: 34, frontFootLift: 0, backFootX: -25, backFootLift: 7 },
    { t: .76, bodyX: 4, bodyY: -3, rotation: -.1, scaleX: 1.04, scaleY: .97, frontHandX: 9, frontHandY: -10, backHandX: -18, backHandY: -4, frontFootX: 8, frontFootLift: 4, backFootX: -12, backFootLift: 13 },
    { t: 1, bodyX: 3, bodyY: 1, rotation: .11, frontHandX: -25, frontHandY: 1, backHandX: 23, backHandY: -14, frontFootX: 31, frontFootLift: 0, backFootX: -26, backFootLift: 0 }
  ],
  pivot: [
    { t: 0, bodyX: 8, bodyY: 5, rotation: -.2, scaleX: 1.18, scaleY: .78, frontHandX: -30, frontHandY: 2, backHandX: 18, backHandY: -14, frontFootX: 32, backFootX: -29 },
    { t: .5, bodyX: -4, bodyY: 11, rotation: .27, scaleX: 1.3, scaleY: .68, frontHandX: 27, frontHandY: -3, backHandX: 18, backHandY: 8, frontFootX: 36, backFootX: -34 },
    { t: 1, bodyX: 10, bodyY: 6, rotation: -.24, scaleX: 1.24, scaleY: .72, frontHandX: -32, frontHandY: -1, backHandX: -23, backHandY: -12, frontFootX: 41, backFootX: -30 }
  ],
  brake: [
    { t: 0, bodyX: 8, bodyY: 2, rotation: -.16, scaleX: 1.12, scaleY: .9, frontHandX: 30, frontHandY: -9, backHandX: -24, backHandY: 4, frontFootX: 34, backFootX: -30 },
    { t: .55, bodyX: -8, bodyY: 9, rotation: .25, scaleX: 1.25, scaleY: .72, frontHandX: 39, frontHandY: -3, backHandX: -31, backHandY: 9, frontFootX: 38, backFootX: -39 },
    { t: 1, bodyX: -2, bodyY: 3, rotation: .08, scaleX: 1.08, scaleY: .92, frontHandX: 27, frontHandY: -7, backHandX: -21, backHandY: 3, frontFootX: 22, backFootX: -24 }
  ],
  jumpSquat: [
    { t: 0, bodyY: 0 },
    { t: .55, bodyX: -2, bodyY: 10, rotation: .035, scaleX: 1.2, scaleY: .74, frontHandX: -24, frontHandY: 9, backHandX: -18, backHandY: 5, frontFootX: 19, backFootX: -20 },
    { t: 1, bodyX: 1, bodyY: 5, rotation: -.025, scaleX: 1.08, scaleY: .88, frontHandX: 26, frontHandY: -13, backHandX: -20, backHandY: -7, frontFootX: 14, backFootX: -13 }
  ],
  jump: [
    { t: 0, bodyX: -2, bodyY: 6, rotation: .045, scaleX: 1.13, scaleY: .84, frontHandX: -17, frontHandY: 5, backHandX: -24, backHandY: 8, frontFootX: 18, frontFootLift: 1, backFootX: -17, backFootLift: 3 },
    { t: .18, bodyX: 3, bodyY: -8, rotation: -.075, scaleX: .86, scaleY: 1.2, frontHandX: 31, frontHandY: -23, backHandX: -25, backHandY: -16, frontFootX: 12, frontFootLift: 12, backFootX: -9, backFootLift: 17 },
    { t: .52, bodyX: 2, bodyY: -5, rotation: -.035, scaleX: .94, scaleY: 1.09, frontHandX: 28, frontHandY: -17, backHandX: -23, backHandY: -11, frontFootX: 8, frontFootLift: 17, backFootX: -7, backFootLift: 21 },
    { t: .78, bodyX: 1, bodyY: -1, rotation: .015, scaleX: 1.01, scaleY: .99, frontHandX: 24, frontHandY: -8, backHandX: -21, backHandY: -4, frontFootX: 13, frontFootLift: 10, backFootX: -11, backFootLift: 13 },
    { t: 1, bodyX: 0, bodyY: 1, rotation: .025, scaleX: 1.04, scaleY: .96, frontHandX: 27, frontHandY: -3, backHandX: -24, backHandY: 1, frontFootX: 16, frontFootLift: 5, backFootX: -14, backFootLift: 8 }
  ],
  fall: [
    { t: 0, bodyY: 0, rotation: .02, scaleX: 1.02, scaleY: .98, frontHandX: 25, frontHandY: -5, backHandX: -22, backHandY: -1, frontFootX: 14, frontFootLift: 8, backFootX: -12, backFootLift: 11 },
    { t: .38, bodyY: 3, rotation: .055, scaleX: 1.08, scaleY: .93, frontHandX: 34, frontHandY: 3, backHandX: -31, backHandY: 6, frontFootX: 19, frontFootLift: 2, backFootX: -17, backFootLift: 6 },
    { t: .7, bodyY: 4, rotation: .035, scaleX: 1.1, scaleY: .91, frontHandX: 37, frontHandY: 6, backHandX: -34, backHandY: 8, frontFootX: 22, frontFootLift: 0, backFootX: -20, backFootLift: 3 },
    { t: 1, bodyY: 1, rotation: .015, scaleX: 1.04, scaleY: .96, frontHandX: 28, frontHandY: -2, backHandX: -25, backHandY: 2, frontFootX: 16, frontFootLift: 5, backFootX: -14, backFootLift: 8 }
  ],
  landing: [
    { t: 0, bodyX: 4, bodyY: 13, rotation: -.07, scaleX: 1.3, scaleY: .66, frontHandX: 36, frontHandY: 11, backHandX: -33, backHandY: 10, frontFootX: 27, backFootX: -28 },
    { t: .18, bodyX: 1, bodyY: 15, rotation: .025, scaleX: 1.34, scaleY: .62, frontHandX: 29, frontHandY: 13, backHandX: -27, backHandY: 12, frontFootX: 29, backFootX: -30 },
    { t: .48, bodyX: -1, bodyY: 8, rotation: .045, scaleX: 1.15, scaleY: .82, frontHandX: 18, frontHandY: 1, backHandX: -14, backHandY: 5, frontFootX: 23, backFootX: -24 },
    { t: .76, bodyX: 1, bodyY: -2, rotation: -.025, scaleX: .94, scaleY: 1.08, frontHandX: 26, frontHandY: -12, backHandX: -20, backHandY: -5, frontFootX: 17, backFootX: -18 },
    { t: 1, bodyX: 0, bodyY: 0, rotation: .018, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  ledgeHang: [
    { t: 0, bodyX: 0, bodyY: 5, rotation: -.05, scaleX: .92, scaleY: 1.05, frontHandX: 23, frontHandY: -34, backHandX: -7, backHandY: -31, frontFootX: 9, frontFootLift: 3, backFootX: -12, backFootLift: 0 },
    { t: .5, bodyX: 1, bodyY: 7, rotation: -.03, scaleX: .94, scaleY: 1.03, frontHandX: 24, frontHandY: -35, backHandX: -5, backHandY: -32, frontFootX: 11, frontFootLift: 1, backFootX: -13, backFootLift: 0 },
    { t: 1, bodyX: 0, bodyY: 5, rotation: -.05, scaleX: .92, scaleY: 1.05, frontHandX: 23, frontHandY: -34, backHandX: -7, backHandY: -31, frontFootX: 9, frontFootLift: 3, backFootX: -12, backFootLift: 0 }
  ],
  ledgeClimb: [
    { t: 0, bodyX: 0, bodyY: 6, rotation: -.06, scaleX: .92, scaleY: 1.05, frontHandX: 23, frontHandY: -34, backHandX: -7, backHandY: -31, frontFootX: 9, backFootX: -12 },
    { t: .38, bodyX: 5, bodyY: 10, rotation: -.18, scaleX: 1.14, scaleY: .8, frontHandX: 30, frontHandY: -24, backHandX: 11, backHandY: -27, frontFootX: 19, frontFootLift: 12, backFootX: -7, backFootLift: 5 },
    { t: .72, bodyX: 8, bodyY: 6, rotation: -.08, scaleX: 1.08, scaleY: .9, frontHandX: 28, frontHandY: -10, backHandX: 8, backHandY: -16, frontFootX: 25, frontFootLift: 5, backFootX: -15, backFootLift: 2 },
    { t: 1, bodyX: 0, bodyY: 0, rotation: .018, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  ledgeJumpClimb: [
    { t: 0, bodyX: 0, bodyY: 6, rotation: -.05, scaleX: .92, scaleY: 1.05, frontHandX: 23, frontHandY: -34, backHandX: -7, backHandY: -31, frontFootX: 9, backFootX: -12 },
    { t: .48, bodyX: 4, bodyY: 11, rotation: -.16, scaleX: 1.2, scaleY: .76, frontHandX: 29, frontHandY: -23, backHandX: 7, backHandY: -25, frontFootX: 20, frontFootLift: 11, backFootX: -8, backFootLift: 8 },
    { t: 1, bodyX: 3, bodyY: -5, rotation: .05, scaleX: .88, scaleY: 1.14, frontHandX: 27, frontHandY: -18, backHandX: -19, backHandY: -12, frontFootX: 12, frontFootLift: 15, backFootX: -10, backFootLift: 18 }
  ],
  hit: [
    { t: 0, bodyX: 12, bodyY: -8, rotation: .38, scaleX: .7, scaleY: 1.25, frontHandX: -39, frontHandY: -20, backHandX: -31, backHandY: 20, frontFootX: 27, frontFootLift: 5, backFootX: -20, backFootLift: 16 },
    { t: .2, bodyX: 10, bodyY: -10, rotation: .43, scaleX: .76, scaleY: 1.19, frontHandX: -37, frontHandY: -23, backHandX: -29, backHandY: 18, frontFootX: 25, frontFootLift: 7, backFootX: -18, backFootLift: 17 },
    { t: .58, bodyX: 5, bodyY: -3, rotation: .2, scaleX: .88, scaleY: 1.08, frontHandX: -29, frontHandY: -10, backHandX: -22, backHandY: 13, frontFootX: 19, frontFootLift: 4, backFootX: -14, backFootLift: 9 },
    { t: 1, bodyX: 1, bodyY: 0, rotation: .06, scaleX: .97, scaleY: 1.01, frontHandX: -19, frontHandY: -3, backHandX: -14, backHandY: 7, frontFootX: 15, frontFootLift: 2, backFootX: -13, backFootLift: 5 }
  ],
  groundHit: [
    { t: 0, bodyX: 10, bodyY: 13, rotation: .3, scaleX: 1.3, scaleY: .64, frontHandX: -40, frontHandY: -12, backHandX: -31, backHandY: 16, frontFootX: 34, backFootX: -31 },
    { t: .22, bodyX: 8, bodyY: 15, rotation: .34, scaleX: 1.35, scaleY: .6, frontHandX: -38, frontHandY: -9, backHandX: -30, backHandY: 18, frontFootX: 35, backFootX: -33 },
    { t: .62, bodyX: 3, bodyY: 8, rotation: .12, scaleX: 1.14, scaleY: .81, frontHandX: -27, frontHandY: -5, backHandX: -21, backHandY: 11, frontFootX: 24, backFootX: -23 },
    { t: 1, bodyX: 0, bodyY: 3, rotation: .025, scaleX: 1.03, scaleY: .95, frontHandX: -18, frontHandY: -2, backHandX: -14, backHandY: 7, frontFootX: 17, backFootX: -17 }
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
    { t: 0, bodyX: -3, bodyY: 7, rotation: -.12, scaleX: 1.16, scaleY: .79, frontHandX: 19, frontHandY: 7, backHandX: -18, backHandY: 8, frontFootX: 22, backFootX: -24 },
    { t: .14, bodyX: 5, bodyY: 12, rotation: .48, scaleX: 1.24, scaleY: .67, frontHandX: 14, frontHandY: 13, backHandX: -10, backHandY: 11, frontFootX: 15, frontFootLift: 7, backFootX: -11, backFootLift: 5 },
    { t: .36, bodyX: 7, bodyY: 16, rotation: 2.15, scaleX: 1.18, scaleY: .62, frontHandX: 7, frontHandY: 12, backHandX: -7, backHandY: 12, frontFootX: 7, frontFootLift: 10, backFootX: -7, backFootLift: 10 },
    { t: .62, bodyX: 6, bodyY: 15, rotation: 4.15, scaleX: 1.18, scaleY: .63, frontHandX: 7, frontHandY: 12, backHandX: -7, backHandY: 12, frontFootX: 7, frontFootLift: 10, backFootX: -7, backFootLift: 10 },
    { t: .84, bodyX: 3, bodyY: 9, rotation: 5.75, scaleX: 1.15, scaleY: .76, frontHandX: 20, frontHandY: 4, backHandX: -14, backHandY: 8, frontFootX: 26, backFootX: -21 },
    { t: 1, bodyX: 0, bodyY: 1, rotation: 6.28, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
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
    { t: 0, bodyX: 0, bodyY: 1, rotation: .02, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 17, backFootX: -17 },
    { t: .18, bodyX: -7, bodyY: 8, rotation: .16, scaleX: 1.13, scaleY: .8, frontHandX: 12, frontHandY: -14, backHandX: -24, backHandY: 3, frontFootX: 23, backFootX: -25 },
    { t: .4, bodyX: -15, bodyY: -4, rotation: -.24, scaleX: .83, scaleY: 1.13, frontHandX: 13, frontHandY: -18, backHandX: -9, backHandY: -13, frontFootX: 20, backFootX: -22 },
    { t: .68, bodyX: -9, bodyY: -2, rotation: -.13, scaleX: .9, scaleY: 1.07, frontHandX: 18, frontHandY: -12, backHandX: -12, backHandY: -6, frontFootX: 19, backFootX: -20 },
    { t: .86, bodyX: 2, bodyY: 5, rotation: .08, scaleX: 1.09, scaleY: .86, frontHandX: 27, frontHandY: -3, backHandX: -20, backHandY: 5, frontFootX: 22, backFootX: -23 },
    { t: 1, bodyX: 0, bodyY: 0, rotation: .018, scaleX: 1, scaleY: 1, frontHandX: 24, frontHandY: -7, backHandX: -17, backHandY: 1, frontFootX: 15, backFootX: -15 }
  ],
  airDodge: [
    { t: 0, bodyY: 1, rotation: .02, frontHandX: 27, frontHandY: -4, backHandX: -24, backHandY: 0, frontFootX: 15, frontFootLift: 6, backFootX: -13, backFootLift: 9 },
    { t: .16, bodyY: -2, rotation: -.08, scaleX: .92, scaleY: 1.06, frontHandX: 18, frontHandY: -10, backHandX: -17, backHandY: -7, frontFootX: 11, frontFootLift: 11, backFootX: -10, backFootLift: 13 },
    { t: .38, bodyY: -7, rotation: -.18, scaleX: .7, scaleY: 1.2, frontHandX: 7, frontHandY: 8, backHandX: -7, backHandY: 8, frontFootX: 6, frontFootLift: 16, backFootX: -6, backFootLift: 16 },
    { t: .65, bodyY: -5, rotation: .09, scaleX: .82, scaleY: 1.11, frontHandX: 12, frontHandY: 3, backHandX: -12, backHandY: 4, frontFootX: 8, frontFootLift: 13, backFootX: -8, backFootLift: 14 },
    { t: .84, bodyY: 0, rotation: .04, scaleX: 1.04, scaleY: .96, frontHandX: 30, frontHandY: 0, backHandX: -27, backHandY: 3, frontFootX: 17, frontFootLift: 6, backFootX: -15, backFootLift: 8 },
    { t: 1, bodyY: 1, rotation: .015, frontHandX: 26, frontHandY: -5, backHandX: -23, backHandY: -1, frontFootX: 14, frontFootLift: 7, backFootX: -12, backFootLift: 10 }
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
    startup: [{ t: 0 }, { t: 1, bodyY: -4, rotation: .09, scaleX: .88, scaleY: 1.08, frontHandX: 11, frontHandY: -17, backHandX: -20, backHandY: 1, frontFootX: 7, frontFootLift: 17, backFootX: -13, backFootLift: 20 }],
    active: [{ t: 0, bodyY: -4, rotation: .09, scaleX: .88, scaleY: 1.08 }, { t: .35, bodyY: 1, rotation: -.12, scaleX: 1.08, scaleY: .9, frontHandX: 36, frontHandY: -15, backHandX: -22, backHandY: 8, frontFootX: 48, frontFootLift: 5, backFootX: -22, backFootLift: 18 }, { t: 1, bodyY: 0, rotation: -.07, scaleX: 1.04, scaleY: .94, frontHandX: 31, frontHandY: -12, backHandX: -20, backHandY: 5, frontFootX: 40, frontFootLift: 7, backFootX: -18, backFootLift: 16 }],
    recovery: [{ t: 0, bodyY: 0, rotation: -.07, scaleX: 1.04, scaleY: .94, frontHandX: 31, frontHandY: -12, backHandX: -20, backHandY: 5, frontFootX: 40, frontFootLift: 7, backFootX: -18, backFootLift: 16 }, { t: 1, bodyY: -1, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
  },
  airDown: {
    startup: [{ t: 0 }, { t: 1, bodyY: -6, rotation: -.12, scaleX: .91, scaleY: 1.08, frontHandX: 21, frontHandY: -25, backHandX: -20, backHandY: -18, frontFootX: 5, frontFootLift: 17, backFootX: -15, backFootLift: 9 }],
    active: [{ t: 0, bodyY: -6, rotation: -.12, frontHandX: 21, frontHandY: -25, backHandX: -20, backHandY: -18 }, { t: .3, bodyY: 4, rotation: .08, scaleX: .94, scaleY: 1.22, frontHandX: 17, frontHandY: -23, backHandX: -22, backHandY: -16, frontFootX: 5, frontFootLift: -31, backFootX: -15, backFootLift: -9 }, { t: 1, bodyY: 3, rotation: .055, scaleX: .96, scaleY: 1.14, frontHandX: 19, frontHandY: -19, backHandX: -21, backHandY: -13, frontFootX: 6, frontFootLift: -25, backFootX: -14, backFootLift: -7 }],
    recovery: [{ t: 0, bodyY: 3, rotation: .055, scaleX: .96, scaleY: 1.14, frontHandX: 19, frontHandY: -19, backHandX: -21, backHandY: -13, frontFootX: 6, frontFootLift: -25, backFootX: -14, backFootLift: -7 }, { t: 1, bodyY: -1, rotation: .01, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
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
    startup: [{ t: 0 }, { t: 1, bodyX: -3, bodyY: 8, rotation: .08, scaleX: 1.16, scaleY: .82, frontHandX: -7, frontHandY: 5, backHandX: -20, backHandY: 8, frontFootX: 22, frontFootLift: 2, backFootX: -18, backFootLift: 9 }],
    active: [{ t: 0, bodyX: -3, bodyY: 8, rotation: .08, frontHandX: -7, frontHandY: 5, backHandX: -20, backHandY: 8 }, { t: .25, bodyX: 4, bodyY: -18, rotation: -.09, scaleX: .82, scaleY: 1.26, frontHandX: 14, frontHandY: -55, backHandX: -20, backHandY: -24, frontFootX: 13, frontFootLift: 17, backFootX: -15, backFootLift: 26 }, { t: 1, bodyX: 3, bodyY: -12, rotation: -.045, scaleX: .88, scaleY: 1.18, frontHandX: 15, frontHandY: -47, backHandX: -19, backHandY: -20, frontFootX: 14, frontFootLift: 13, backFootX: -15, backFootLift: 21 }],
    recovery: [{ t: 0, bodyX: 3, bodyY: -12, rotation: -.045, scaleX: .88, scaleY: 1.18, frontHandX: 15, frontHandY: -47, backHandX: -19, backHandY: -20, frontFootX: 14, frontFootLift: 13, backFootX: -15, backFootLift: 21 }, { t: 1, bodyX: 0, bodyY: -1, rotation: .01, scaleX: 1, scaleY: 1, frontHandX: 25, frontHandY: -7, backHandX: -22, backHandY: -3, frontFootX: 13, frontFootLift: 8, backFootX: -11, backFootLift: 11 }]
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

function applyPoseDelta(pose, delta, amount = 1) {
  const next = { ...pose };
  for (const key of ['bodyX','bodyY','rotation','frontHandX','frontHandY','backHandX','backHandY','frontFootX','frontFootLift','backFootX','backFootLift']) {
    if (Number.isFinite(delta[key])) next[key] += delta[key] * amount;
  }
  if (Number.isFinite(delta.scaleX)) next.scaleX *= 1 + delta.scaleX * amount;
  if (Number.isFinite(delta.scaleY)) next.scaleY *= 1 + delta.scaleY * amount;
  return next;
}

function fighterStatePose(player, pose, action, progress, age) {
  const t = clamp(progress, 0, 1);
  const stride = Math.sin(t * Math.PI * 2);
  let styled = { ...pose };
  if (player.characterId === 'volt') {
    const forward = action === 'walk' ? 1.4 : action === 'run' || action === 'dash' ? 3.5 : 0;
    styled = applyPoseDelta(styled, {
      bodyX: forward, rotation: forward * -.012,
      frontHandX: action === 'run' ? 4 : 0, backFootX: action === 'run' ? -3 : 0
    });
    if (action === 'landing') styled = applyPoseDelta(styled, { bodyX: 4 * (1-t), rotation: -.08 * (1-t), frontFootX: 5 * (1-t) });
  } else if (player.characterId === 'blaze') {
    const planted = ['idle','walk','run','landing','groundHit','shield'].includes(action) ? 1 : .5;
    styled = applyPoseDelta(styled, {
      bodyY: 2.5 * planted, scaleX: .08 * planted, scaleY: -.055 * planted,
      frontFootX: 5 * planted, backFootX: -7 * planted,
      frontHandY: 2 * planted, backHandY: 3 * planted
    });
    if (action === 'walk' || action === 'run') styled.bodyY += Math.abs(stride) * 2;
    if (action === 'landing') styled = applyPoseDelta(styled, { bodyY: 3 * (1-t), frontFootX: 5, backFootX: -5 });
  } else if (player.characterId === 'bolt') {
    const spring = ['walk','run','jump','fall','landing'].includes(action) ? 1 : .45;
    styled = applyPoseDelta(styled, {
      rotation: stride * .035 * spring, bodyY: -Math.abs(stride) * 1.5 * spring,
      frontHandY: -stride * 3 * spring, backHandY: stride * 3 * spring,
      frontFootLift: Math.max(0, stride) * 2 * spring, backFootLift: Math.max(0, -stride) * 2 * spring
    });
    if (action === 'landing') styled = applyPoseDelta(styled, { rotation: .1 * (1-t), bodyX: -3 * (1-t) });
  } else if (player.characterId === 'nova') {
    const aerial = ['jump','fall','airDodge','airRecover'].includes(action) ? 1 : .45;
    styled = applyPoseDelta(styled, {
      bodyY: -2 * aerial, scaleX: -.045 * aerial, scaleY: .065 * aerial,
      frontHandY: -5 * aerial, backHandY: -3 * aerial,
      frontFootX: 3 * aerial, backFootX: -4 * aerial
    });
    if (action === 'landing') styled = applyPoseDelta(styled, { bodyY: -2 * t, scaleX: -.04 * t, scaleY: .05 * t });
  }

  if (action === 'hit' || action === 'airRecover') {
    const vertical = clamp((player.vy || 0) / 520, -1, 1);
    styled.rotation += vertical * -.16;
    styled.bodyY += vertical * 4;
    styled.frontHandY -= vertical * 7;
    styled.backFootLift += Math.max(0, -vertical) * 6;
  } else if (action === 'groundHit') {
    const force = clamp(Math.abs(player.vx || 0) / 480, 0, 1);
    styled.bodyX += force * 4;
    styled.frontFootX += force * 5;
    styled.backFootX -= force * 6;
  } else if (action === 'airDodge' && !player.dodgeNeutral) {
    const dodgeX = clamp((player.dodgeStartVx || 0) / 390, -1, 1) * player.face;
    const dodgeY = clamp((player.dodgeStartVy || 0) / 360, -1, 1);
    const burst = Math.sin(t * Math.PI);
    styled.rotation += (-dodgeX * .18 + dodgeY * .12) * burst;
    styled.bodyX += dodgeX * 6 * burst;
    styled.bodyY += dodgeY * 5 * burst;
  }
  return styled;
}

function fighterAttackPose(player, pose, action, motion, phase, progress) {
  const styled = { ...pose };
  const t = clamp(progress, 0, 1);
  const phaseWeight = phase === 'active' ? 1 : phase === 'startup' || phase === 'charge' ? .68 : .42 * (1-t);
  const windup = phase === 'startup' || phase === 'charge' ? t : 0;
  const active = phase === 'active' ? Math.sin((.18 + t * .82) * Math.PI / 2) : 0;
  const recoil = phase === 'recovery' ? 1-t : 0;
  if (player.characterId === 'volt') {
    styled.bodyX += -4 * windup + 8 * active + 3 * recoil;
    styled.bodyY += 2 * windup - 2 * active;
    styled.rotation += .09 * windup - .13 * active;
    styled.frontHandX += 9 * phaseWeight;
    styled.frontFootX += 7 * phaseWeight;
    styled.backFootX -= 6 * phaseWeight;
    if (action === 'groundDown' || action === 'airDown') {
      styled.bodyY += 4 * phaseWeight; styled.frontFootX += 8 * phaseWeight; styled.backHandX -= 7 * phaseWeight;
    } else if (action === 'groundUp' || action === 'airUp') {
      styled.frontHandY -= 9 * phaseWeight; styled.backHandY -= 5 * phaseWeight; styled.scaleY *= 1 + .06 * phaseWeight;
    } else if (action === 'airNeutral') {
      // VOLT leads with a long single-leg kick while the rear side stays
      // tucked. This keeps its silhouette directional instead of becoming
      // the shared two-sided aerial pose.
      styled.frontFootX += 13 * active;
      styled.frontFootLift -= 4 * active;
      styled.backFootX += 8 * active;
      styled.backFootLift += 8 * active;
      styled.frontHandY -= 8 * active;
      styled.backHandY += 7 * active;
      styled.rotation += .16 * active;
    } else if (action === 'specialUp') {
      styled.frontHandX += 8 * active;
      styled.frontHandY -= 9 * phaseWeight;
      styled.backHandX -= 7 * active;
      styled.frontFootLift += 5 * active;
      styled.rotation -= .08 * active;
    }
  } else if (player.characterId === 'blaze') {
    styled.bodyX += -7 * windup + 10 * active;
    styled.bodyY += 5 * phaseWeight;
    styled.rotation += .11 * windup - .1 * active;
    styled.scaleX *= 1 + .14 * phaseWeight;
    styled.scaleY *= 1 - .1 * phaseWeight;
    styled.frontFootX += 9 * phaseWeight;
    styled.backFootX -= 12 * phaseWeight;
    styled.backHandX -= 7 * phaseWeight;
    if (['hammer','heavyJab','bodyCheck','shoulder','cannon'].includes(motion)) {
      styled.frontHandX += 11 * phaseWeight;
      styled.backHandX += 7 * active;
      styled.backHandY = lerp(styled.backHandY, styled.frontHandY + 7, active * .72);
    }
    if (action === 'airNeutral') {
      // BLAZE uses a compact armored body-check: shoulders and forearms are
      // the readable contact shape while both knees remain under its weight.
      styled.frontHandX += 15 * phaseWeight;
      styled.backHandX += 22 * active;
      styled.frontHandY += 8 * active;
      styled.backHandY += 12 * active;
      styled.frontFootX -= 27 * active;
      styled.backFootX += 17 * active;
      styled.frontFootLift += 14 * active;
      styled.backFootLift += 11 * active;
      styled.rotation -= .08 * active;
    } else if (action === 'airDown') {
      styled.frontHandX += 5 * phaseWeight; styled.backHandX -= 5 * phaseWeight; styled.scaleY *= 1 + .1 * active;
    } else if (action === 'specialUp') {
      styled.frontHandY += 18 * active;
      styled.backHandY += 13 * active;
      styled.frontFootLift += 10 * active;
      styled.backFootLift += 8 * active;
      styled.scaleX *= 1 + .12 * active;
      styled.scaleY *= 1 - .12 * active;
    }
  } else if (player.characterId === 'bolt') {
    const twist = phase === 'active' ? Math.sin(t * Math.PI) : windup * -.5;
    styled.bodyY += 3 * phaseWeight - 3 * active;
    styled.rotation += .16 * twist;
    styled.scaleX *= 1 + .08 * phaseWeight;
    styled.scaleY *= 1 - .05 * phaseWeight;
    styled.frontFootX += 10 * phaseWeight;
    styled.backFootX -= 8 * phaseWeight;
    styled.frontHandY += 7 * twist;
    styled.backHandY -= 8 * twist;
    if (['wheelSpin','wheelSweep','wheelDrop','roll','quake'].includes(motion)) {
      styled.frontHandX += 8 * twist;
      styled.backHandX -= 9 * twist;
      styled.frontFootLift += 5 * Math.max(0, twist);
      styled.backFootLift += 5 * Math.max(0, -twist);
    }
    if (action === 'airNeutral') {
      // BOLT curls into a compact wheel. The body rotation and tucked knees
      // distinguish it from the long-limbed kicks without adding effects.
      styled.frontHandX -= 17 * active;
      styled.backHandX += 15 * active;
      styled.frontFootX -= 26 * active;
      styled.backFootX += 17 * active;
      styled.frontFootLift += 17 * active;
      styled.backFootLift += 18 * active;
      styled.rotation += .34 * active;
      styled.scaleX *= 1 - .12 * active;
      styled.scaleY *= 1 + .08 * active;
    } else if (action === 'groundDown' || action === 'specialDown') {
      styled.bodyY += 5 * active; styled.frontFootX += 7 * active; styled.backFootX -= 7 * active;
    } else if (action === 'specialUp') {
      styled.rotation += .22 * active;
      styled.frontHandY += 9 * active;
      styled.backHandY -= 4 * active;
      styled.frontFootLift += 13 * active;
      styled.backFootLift += 15 * active;
      styled.scaleX *= 1 + .08 * active;
      styled.scaleY *= 1 - .08 * active;
    }
  } else if (player.characterId === 'nova') {
    styled.bodyX += -3 * windup + 5 * active;
    styled.bodyY -= 4 * phaseWeight;
    styled.rotation += -.06 * windup + .08 * active;
    styled.scaleX *= 1 - .07 * phaseWeight;
    styled.scaleY *= 1 + .1 * phaseWeight;
    styled.frontHandY -= 10 * phaseWeight;
    styled.backHandX -= 9 * phaseWeight;
    styled.backHandY += 5 * phaseWeight;
    styled.frontFootX += 6 * phaseWeight;
    styled.backFootX -= 10 * phaseWeight;
    if (action === 'groundSide' || action === 'airForward' || motion === 'blink') {
      styled.frontHandX += 10 * active; styled.backHandX -= 8 * active; styled.frontFootLift += 5 * active;
    } else if (action === 'groundUp' || action === 'airUp' || motion === 'warp') {
      styled.frontHandY -= 12 * phaseWeight; styled.backHandY -= 8 * phaseWeight; styled.frontFootX += 3 * active; styled.backFootX -= 3 * active;
      if (action === 'specialUp') {
        styled.frontHandX += 10 * active;
        styled.backHandX -= 12 * active;
        styled.backFootLift += 10 * active;
        styled.rotation -= .12 * active;
      }
    } else if (action === 'airDown') {
      styled.frontHandX += 8 * phaseWeight; styled.backHandX -= 8 * phaseWeight; styled.scaleX *= 1 + .08 * active;
    } else if (action === 'airNeutral') {
      // NOVA opens into a diagonal star rather than a horizontal split. Its
      // limbs point to four quadrants so it remains readable in a crowded air
      // scramble without relying on particles.
      styled.frontHandY -= 16 * active;
      styled.backHandY += 17 * active;
      styled.frontHandX += 8 * active;
      styled.backHandX -= 9 * active;
      styled.frontFootX -= 10 * active;
      styled.backFootX -= 10 * active;
      styled.frontFootLift += 12 * active;
      styled.backFootLift -= 5 * active;
      styled.rotation -= .13 * active;
    } else if (motion === 'gravity') {
      styled.frontHandX += 9 * active; styled.backHandX -= 9 * active; styled.frontHandY += 9 * active; styled.backHandY += 9 * active;
    }
  }
  const authored = window.NEON_MOTION?.profileFor(player.characterId, action);
  if (!authored) return styled;
  if (phase === 'startup' || phase === 'charge') {
    const anticipation = Math.sin(t * Math.PI * .5);
    return applyPoseDelta(styled, authored.windup, anticipation * .68);
  }
  if (phase === 'active') {
    const contact = 1 - Math.abs(t - .28) / .72;
    return applyPoseDelta(styled, authored.active, clamp(contact, .42, 1) * .56);
  }
  if (phase === 'recovery') {
    return applyPoseDelta(styled, authored.recovery, (1 - t) * .5);
  }
  return styled;
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
      const authoredPose = fighterAttackPose(player, sampleKeyframes(frames, poseProgress), action, motion, phase, poseProgress);
      const spinning = ['wheelSpin', 'voltSpin', 'ironSpin', 'starOrbit', 'backRoll', 'roll'].includes(motion);
      const aerial = action.startsWith('air') || action === 'specialUp';
      return window.NEON_MOTION_CONSTRAINTS?.constrainPose(authoredPose, { spinning, aerial }) || authoredPose;
    }
  }
  const statePose = (frames, value) => fighterStatePose(player, sampleKeyframes(frames, value), action, value, age);
  if (action === 'shieldHit') return statePose(ONESHOT_KEYFRAMES.shieldHit, clamp(age / .22, 0, 1));
  if (action === 'parrySuccess') return statePose(ONESHOT_KEYFRAMES.parry, clamp(age / .24, 0, 1));
  if (action === 'dash') return statePose(ONESHOT_KEYFRAMES.dash, clamp((player.dashAge || 0) / 16, 0, 1));
  if (action === 'pivot') return statePose(ONESHOT_KEYFRAMES.pivot, clamp((player.dashAge || 0) / 4, 0, 1));
  if (action === 'brake' || action === 'skid') return statePose(ONESHOT_KEYFRAMES.brake, clamp(1 - (player.dashBrakeFrames || 0) / 5, 0, 1));
  if (action === 'ledgeCatch') return sampleKeyframes(ONESHOT_KEYFRAMES.ledgeHang, (age / .72) % 1);
  if (['ledgeGetup','ledgeAttackClimb','ledgeRollClimb'].includes(action)) {
    const total = Math.max(1, player.ledgeTransitionTotal || 1);
    return sampleKeyframes(ONESHOT_KEYFRAMES.ledgeClimb, clamp(1 - (player.ledgeTransitionFrames || 0) / total, 0, 1));
  }
  if (action === 'ledgeJumpClimb') {
    const total = Math.max(1, player.ledgeTransitionTotal || 1);
    return sampleKeyframes(ONESHOT_KEYFRAMES.ledgeJumpClimb, clamp(1 - (player.ledgeTransitionFrames || 0) / total, 0, 1));
  }
  if (action === 'ledgeJump') return sampleKeyframes(ONESHOT_KEYFRAMES.jump, clamp(age / .2, 0, 1));
  if (action === 'roll' || action === 'techRoll' || action === 'getupRoll' || action === 'ledgeRoll') {
    const total = Math.max(1, player.dodgeTotalFrames || 22);
    return statePose(ONESHOT_KEYFRAMES.roll, clamp((player.dodgeElapsed || 0) / total, 0, 1));
  }
  if (player.shielding || action === 'shield') return statePose(LOOP_KEYFRAMES.shield, (age / .8) % 1);
  if (action === 'walk') return statePose(LOOP_KEYFRAMES.walk, (age / .72) % 1);
  if (action === 'run') return statePose(LOOP_KEYFRAMES.run, (age / .46) % 1);
  if (action === 'idle') return statePose(LOOP_KEYFRAMES.idle, (age / 1.4) % 1);
  if (action === 'jumpSquat') return statePose(ONESHOT_KEYFRAMES.jumpSquat, clamp(age / .09, 0, 1));
  if (action === 'jump') return statePose(ONESHOT_KEYFRAMES.jump, clamp(age / .24, 0, 1));
  if (action === 'fall' || action === 'freefall') return statePose(ONESHOT_KEYFRAMES.fall, (age / .8) % 1);
  if (action === 'landing') return statePose(ONESHOT_KEYFRAMES.landing, clamp(age / .2, 0, 1));
  if (action === 'groundHit') return statePose(ONESHOT_KEYFRAMES.groundHit, clamp(age / .24, 0, 1));
  if (action === 'hit' || action === 'airRecover') return statePose(ONESHOT_KEYFRAMES.hit, clamp(age / .28, 0, 1));
  if (action === 'tumble') return statePose(LOOP_KEYFRAMES.tumble, (age / .42) % 1);
  if (action === 'crawl') {
    const pose = sampleKeyframes(ONESHOT_KEYFRAMES.crouch, 1);
    const stride = Math.sin(age / .34 * Math.PI * 2);
    pose.bodyX = stride * 1.5;
    pose.frontHandX += stride * 7;
    pose.backHandX += stride * 6;
    pose.frontFootX -= stride * 8;
    pose.backFootX -= stride * 7;
    return pose;
  }
  if (action === 'crouch') return statePose(ONESHOT_KEYFRAMES.crouch, clamp(age / .12, 0, 1));
  if (action === 'spotDodge') return statePose(ONESHOT_KEYFRAMES.spotDodge, clamp((player.dodgeElapsed || 0) / Math.max(1, player.dodgeTotalFrames || 24), 0, 1));
  if (action === 'airDodge') return statePose(ONESHOT_KEYFRAMES.airDodge, clamp((player.dodgeElapsed || 0) / Math.max(1, player.dodgeTotalFrames || 44), 0, 1));
  if (action === 'knockdown') return statePose(ONESHOT_KEYFRAMES.knockdown, 1);
  if (action === 'getup' || action === 'tech') return statePose(ONESHOT_KEYFRAMES.getup, clamp(age / .3, 0, 1));
  if (action === 'grabHold') return sampleKeyframes(ONESHOT_KEYFRAMES.grabHold, (age / .55) % 1);
  if (action === 'grabbed' || action === 'grabbedHit') return sampleKeyframes(ONESHOT_KEYFRAMES.grabbed, (age / .42) % 1);
  if (action === 'grabEscape') return sampleKeyframes(ONESHOT_KEYFRAMES.grabEscape, clamp(age / .2, 0, 1));
  return null;
}

function drawOutlinedLimb(points, color, alpha = 1, width = 7, outlineExtra = 4) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let index = 1; index < points.length; index++) ctx.lineTo(points[index][0], points[index][1]);
  ctx.strokeStyle = '#080d19'; ctx.lineWidth = width + outlineExtra; ctx.stroke();
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
        const pulse = .72 + Math.sin(performance.now() / 72) * .28;
        ctx.globalAlpha = .2 + brace * .34;
        ctx.fillStyle = '#ff5b45';
        ctx.beginPath();
        ctx.moveTo(direction * 5, -player.height * .34);
        ctx.lineTo(guardX + direction * 13, -player.height * .23);
        ctx.lineTo(guardX + direction * 7, player.height * .23);
        ctx.lineTo(direction * 5, player.height * .34);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = .42 + brace * .4 * pulse;
        ctx.strokeStyle = '#ffd09a';
        ctx.shadowColor = '#ff6a3d';
        ctx.shadowBlur = 12 + brace * 8;
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(guardX + direction * 7, -player.height * .3);
        ctx.lineTo(guardX, -player.height * .17);
        ctx.lineTo(guardX, player.height * .17);
        ctx.lineTo(guardX + direction * 7, player.height * .3);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (const vertical of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(-direction * (9 + brace * 3), vertical * player.height * .22);
          ctx.lineTo(direction * (4 + brace * 4), vertical * player.height * .12);
          ctx.stroke();
        }
        ctx.shadowBlur = 0;
        const emberClock = performance.now() / 150;
        for (let ember = 0; ember < 4; ember++) {
          const rise = (emberClock + ember * .27) % 1;
          const emberX = direction * (8 + ember * 7) - direction * rise * 5;
          const emberY = player.height * .34 - rise * player.height * .7;
          const size = 2 + (1 - rise) * 2;
          ctx.globalAlpha = (.22 + brace * .56) * (1 - rise * .65);
          ctx.fillStyle = ember % 2 ? '#fff0c6' : '#ff6748';
          ctx.fillRect(emberX - size / 2, emberY - size / 2, size, size);
        }
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

function drawSmashChargeEffect(player, action, color, strikeAnchor = null) {
  const charge = clamp(((player.chargeFrames || 1) - 1) / 89, 0, 1);
  const clock = performance.now();
  const pulse = .9 + Math.sin(clock / (170 - charge * 55)) * .1;
  const isUp = action.includes('Up');
  const isDown = action.includes('Down');
  const targetX = Number.isFinite(strikeAnchor?.x)
    ? strikeAnchor.x
    : isUp ? player.face * 6 : isDown ? player.face * 25 : player.face * (player.width * .52 + 17);
  const targetY = Number.isFinite(strikeAnchor?.y)
    ? strikeAnchor.y
    : isUp ? -player.height * .58 : isDown ? player.height * .3 : -player.height * .06;

  ctx.save();
  ctx.translate(targetX, targetY);
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = color;
  ctx.shadowBlur = effectQuality < .78 ? 0 : 3 + charge * 3;
  ctx.lineCap = 'round';

  // Three curved streams spiral into the actual striking hand or foot. The
  // charge is conveyed by their reach, rotation, and brighter core—not by
  // bars, notches, or geometry that resembles an attack hitbox.
  const spin = clock / (760 - charge * 260);
  for (let stream = 0; stream < 3; stream++) {
    const startAngle = spin + stream * Math.PI * 2 / 3;
    const radius = 28 + charge * 14 + stream * 3;
    const point = (r, angle) => [Math.cos(angle) * r, Math.sin(angle) * r];
    const start = point(radius, startAngle);
    const controlA = point(radius * .92, startAngle + .5);
    const controlB = point(radius * .44, startAngle + 1.25);
    const end = point(7 + charge * 2, startAngle + 1.9);
    ctx.globalAlpha = (.38 + charge * .42) * (stream === 1 ? .82 : 1);
    ctx.strokeStyle = stream === 0 && charge > .86 ? '#ffffff' : color;
    ctx.lineWidth = 2.1 + charge * 1.5;
    ctx.beginPath();
    ctx.moveTo(start[0], start[1]);
    ctx.bezierCurveTo(controlA[0], controlA[1], controlB[0], controlB[1], end[0], end[1]);
    ctx.stroke();
  }

  const coreRadius = (5 + charge * 3.5) * pulse;
  ctx.globalAlpha = .42 + charge * .45;
  ctx.fillStyle = color;
  ctx.beginPath();ctx.arc(0,0,coreRadius,0,Math.PI*2);ctx.fill();
  ctx.globalAlpha = .75 + charge * .2;
  ctx.fillStyle = charge > .9 ? '#ffffff' : 'rgba(255,255,255,.9)';
  ctx.beginPath();ctx.arc(0,0,Math.max(2,coreRadius*.38),0,Math.PI*2);ctx.fill();
  ctx.globalAlpha = .42 + charge * .38;
  ctx.strokeStyle = charge > .9 ? '#ffffff' : color;
  ctx.lineWidth = 1.5 + charge;
  ctx.beginPath();ctx.arc(0,0,coreRadius+4+charge*3,0,Math.PI*2);ctx.stroke();
  ctx.restore();
}

function drawReadableSpecialEffect(player, fighter, action, motion, phase, progress, color) {
  if (!phase || motion !== 'counter' || phase === 'active' || phase === 'recovery') return;
  const strength = clamp(progress, .08, 1);
  const pulse = .9 + Math.sin(performance.now() / 85) * .1;
  const horizontal = (19 + strength * 24) * pulse;
  const vertical = (16 + strength * 22) * pulse;
  const waist = 3 + strength * 2;
  ctx.save();
  ctx.translate(player.face * 2, -12);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = .4 + strength * .55;
  ctx.fillStyle = '#ffd83d';
  ctx.strokeStyle = '#fff7b2';
  ctx.lineWidth = 1.4 + strength * .8;
  ctx.shadowColor = '#ffd83d';
  ctx.shadowBlur = effectQuality < .78 ? 0 : 4 + strength * 4;
  ctx.beginPath();
  ctx.moveTo(0, -vertical);
  ctx.lineTo(waist, -waist);
  ctx.lineTo(horizontal, 0);
  ctx.lineTo(waist, waist);
  ctx.lineTo(0, vertical);
  ctx.lineTo(-waist, waist);
  ctx.lineTo(-horizontal, 0);
  ctx.lineTo(-waist, -waist);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.globalAlpha = .7 + strength * .25;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, 2.2 + strength * 1.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawUltimateFighterEffect(player, fighter, color, phase, progress) {
  if (!phase || phase === 'recovery') return;
  const active = phase === 'active';
  const energy = active ? 1 : clamp(progress, .04, 1);
  const clock = performance.now();
  const pulse = .76 + Math.sin(clock / (105 - energy * 35)) * .24;
  const front = player.face;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.shadowColor = color;
  ctx.shadowBlur = 11 + energy * 16;

  // A compact common wind-up language: tapered fragments close around the
  // fighter instead of covering the stage with an unrelated full-screen aura.
  if (!active) {
    for (let shard = 0; shard < 7; shard++) {
      const cycle = (clock / 360 + shard / 7) % 1;
      const side = shard % 2 ? 1 : -1;
      const startX = side * (54 - energy * 17) + front * (shard % 3) * 5;
      const startY = -player.height * .48 + shard * player.height * .16;
      const endX = front * (8 + energy * 10);
      const endY = startY * .3;
      const t = cycle * cycle;
      const x = lerp(startX, endX, t), y = lerp(startY, endY, t);
      const length = 8 + energy * 8;
      ctx.globalAlpha = (.16 + energy * .34) * (1 - cycle * .5);
      ctx.fillStyle = shard % 3 === 0 ? '#ffffff' : color;
      ctx.beginPath();
      ctx.moveTo(x - side * length, y - 2);
      ctx.lineTo(x + side * 3, y - 4);
      ctx.lineTo(x + side * 8, y);
      ctx.lineTo(x + side * 3, y + 4);
      ctx.lineTo(x - side * length, y + 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  if (fighter.id === 'volt') {
    ctx.globalAlpha = .34 + energy * .55;
    ctx.strokeStyle = active ? '#ffffff' : color;
    ctx.lineWidth = 2.5 + energy * 3;
    for (const offset of [-20, 18]) {
      ctx.beginPath();
      ctx.moveTo(offset - front * 8, -player.height * (.62 + energy * .12));
      ctx.lineTo(offset + front * 7, -player.height * .28);
      ctx.lineTo(offset - front * 5, 0);
      ctx.lineTo(offset + front * 8, player.height * .3);
      ctx.stroke();
    }
  } else if (fighter.id === 'blaze') {
    for (let flame = 0; flame < 4; flame++) {
      const y = (flame - 1.5) * 13;
      const reach = (active ? 102 : 38 + energy * 30) - flame * 7;
      ctx.globalAlpha = (active ? .3 : .12 + energy * .22) * (1 - flame * .1);
      ctx.fillStyle = flame === 0 && active ? '#ffffff' : color;
      ctx.beginPath();
      ctx.moveTo(-front * 20, y - 4);
      ctx.lineTo(front * reach, y - 8);
      ctx.lineTo(front * (reach + 18), y);
      ctx.lineTo(front * reach, y + 8);
      ctx.lineTo(-front * 20, y + 4);
      ctx.closePath();
      ctx.fill();
    }
  } else if (fighter.id === 'bolt') {
    ctx.rotate(clock * .0018);
    for (let plate = 0; plate < 4; plate++) {
      ctx.rotate(Math.PI / 2);
      const distance = active ? 28 : 48 - energy * 20;
      ctx.globalAlpha = .22 + energy * .48;
      ctx.fillStyle = plate === 0 && active ? '#ffffff' : color;
      ctx.beginPath();
      ctx.moveTo(distance, 0);
      ctx.lineTo(distance + 15, -7);
      ctx.lineTo(distance + 25, 0);
      ctx.lineTo(distance + 15, 7);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    for (let mote = 0; mote < 10; mote++) {
      const angle = mote * 2.399 + clock * .001;
      const cycle = (clock / 460 + mote * .083) % 1;
      const distance = (66 - energy * 25) * (1 - cycle * .7);
      const size = 3 + energy * 3;
      ctx.globalAlpha = (.2 + energy * .48) * (1 - cycle * .45);
      ctx.fillStyle = mote % 4 === 0 ? '#ffffff' : color;
      ctx.fillRect(Math.cos(angle) * distance - size / 2, Math.sin(angle) * distance - size / 2, size, size);
    }
  }

  if (active) {
    const size = 9 + pulse * 6;
    ctx.globalAlpha = .72 + pulse * .22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(front * size * 1.5, 0);
    ctx.lineTo(0, size * .68);
    ctx.lineTo(-front * size * .8, 0);
    ctx.lineTo(0, -size * .68);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawNovaChargeStar(player, color, progress) {
  const size = 18 + clamp(progress, 0, 1) * 5;
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(-Math.PI / 2 + progress * .28);
  ctx.fillStyle = color;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.4;
  ctx.shadowColor = color;
  ctx.shadowBlur = 7;
  ctx.beginPath();
  for (let point = 0; point < 10; point++) {
    const angle = point * Math.PI / 5;
    const radius = point % 2 === 0 ? size : size * .43;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    if (point === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
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
    drawSmashChargeEffect(player, action, color);
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
  if (player.chargeFrames) drawSpecialCue(player, fighter, action, color, 'charge', player.phaseProgress || 0);
  else if (action.startsWith('special') && !player.actionHitbox) drawSpecialCue(player, fighter, action, color, phase, progress);
  if (phase === 'active' && player.actionHitbox) drawAlignedStrike(player, action, color, progress, fighter);
}

function traceAfterimageHead(image) {
  const r = image.headRadius, y = image.headY;
  ctx.beginPath();
  if (image.fighterId === 'volt') {
    const points=[[-r*.9,-r*.45],[-r*.42,-r*.72],[-r*.12,-r*1.25],[r*.18,-r*.78],[r*.72,-r*.98],[r*.6,-r*.42],[r,0],[r*.55,r*.75],[-r*.55,r*.75],[-r,0]];
    points.forEach(([x,offsetY],index)=>index?ctx.lineTo(x,y+offsetY):ctx.moveTo(x,y+offsetY));ctx.closePath();
  } else if (image.fighterId === 'blaze') {
    ctx.moveTo(-r,y+r*.72);ctx.lineTo(-r,y-r*.45);ctx.lineTo(-r*.5,y-r*.78);ctx.lineTo(-r*.22,y-r*1.3);ctx.lineTo(r*.15,y-r*.78);ctx.lineTo(r*.65,y-r*1.12);ctx.lineTo(r,y-r*.38);ctx.lineTo(r,y+r*.72);ctx.closePath();
  } else if (image.fighterId === 'bolt') {
    ctx.arc(0,y,r,0,Math.PI*2);ctx.moveTo(-r,y);ctx.lineTo(-r-5,y-5);ctx.moveTo(r,y);ctx.lineTo(r+5,y-5);ctx.moveTo(0,y-r);ctx.lineTo(0,y-r-7);
  } else {
    ctx.moveTo(0,y-r*1.25);ctx.lineTo(r,y-r*.2);ctx.lineTo(r*.58,y+r);ctx.lineTo(0,y+r*.72);ctx.lineTo(-r*.58,y+r);ctx.lineTo(-r,y-r*.2);ctx.closePath();
  }
}

function drawDashAfterimages() {
  for (const image of dashAfterimages) {
    const fade = clamp(image.life / image.duration, 0, 1);
    ctx.save();
    ctx.translate(image.x, image.y);
    ctx.translate(image.bodyX, image.bodyY);
    ctx.rotate(image.rotation);
    ctx.scale(image.scaleX, image.scaleY);
    ctx.globalAlpha = image.alpha * fade * fade;
    ctx.strokeStyle = image.color;
    ctx.fillStyle = image.color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(image.backShoulder[0],image.backShoulder[1]);ctx.lineTo(image.backElbow[0],image.backElbow[1]);ctx.lineTo(image.backHand[0],image.backHand[1]);
    ctx.moveTo(image.frontShoulder[0],image.frontShoulder[1]);ctx.lineTo(image.frontElbow[0],image.frontElbow[1]);ctx.lineTo(image.frontHand[0],image.frontHand[1]);
    ctx.moveTo(image.backHip[0],image.backHip[1]);ctx.lineTo(image.backKnee[0],image.backKnee[1]);ctx.lineTo(image.backFoot[0],image.backFoot[1]);
    ctx.moveTo(image.frontHip[0],image.frontHip[1]);ctx.lineTo(image.frontKnee[0],image.frontKnee[1]);ctx.lineTo(image.frontFoot[0],image.frontFoot[1]);
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.beginPath();ctx.moveTo(0,image.headY+image.headRadius*.72);ctx.lineTo(0,image.torsoBottom);ctx.stroke();
    ctx.globalAlpha *= .72;
    traceAfterimageHead(image);
    ctx.fill();
    ctx.restore();
  }
}

function drawPlayer(p, dt) {
  if (p.eliminated || p.respawn > 0) return;
  const fighter = FIGHTERS.find(item => item.id === p.characterId) || FIGHTERS[0];
  const color = fighter.palettes[p.palette % fighter.palettes.length];
  const hitFlash = p.flashUntil > performance.now();
  const impactCue = p.impactVisualUntil > performance.now();
  const invincibleFlash = p.invincible > 0 && Math.floor(p.invincible / 3) % 2;
  const fullBodyFlash = invincibleFlash;
  const renderColor = fullBodyFlash ? '#ffffff' : color;
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
  const rolling = action === 'techRoll' || action === 'getupRoll' || action === 'roll' || action === 'ledgeRoll';
  const dodgeSerial = Number(p.dodgeSerial) || 0;
  const dodgeRestarted = rolling && p.visualDodgeSerial != null && p.visualDodgeSerial !== dodgeSerial;
  if (p.visualDodgeSerial !== dodgeSerial) {
    p.visualDodgeSerial = dodgeSerial;
    if (rolling) p.keyframeAge = 0;
  }
  let keyPose = keyframePoseFor(p, action, moveMotion, phase, progress, attack, p.keyframeAge || 0, visualVariant);
  const keyPoseFacing = action === 'hit' || action === 'groundHit'
    ? Math.sign(p.vx || p.face) || 1
    : rolling ? Math.sign(p.dodgeStartVx || p.vx || p.face) || 1 : p.face;
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
  if (doubleJumpActive) keyPose = fighterStatePose(p, sampleKeyframes(ONESHOT_KEYFRAMES.doubleJump, doubleJumpProgress), 'jump', doubleJumpProgress, p.visualDoubleJumpAge);
  const poseTransitionKey = `${action}:${phase || 'none'}:${visualVariant || 'base'}:${doubleJumpActive ? 'double' : 'normal'}`;
  if (p.poseTransitionKey !== poseTransitionKey) {
    p.poseTransitionKey = poseTransitionKey;
    p.poseTransitionFrom = p.displayedKeyPose ? { ...p.displayedKeyPose } : null;
    p.poseTransitionAge = 0;
  } else if (p.hitstop <= 0) {
    p.poseTransitionAge = (p.poseTransitionAge || 0) + dt * 1000;
  }
  if (keyPose) {
    const style = window.NEON_MOTION?.styleFor(fighter.id) || { entryMs: 48, phaseMs: 26, activeMs: 18 };
    const changingAction = p.poseTransitionKey?.split(':', 1)[0] !== p.previousPoseAction;
    const duration = phase === 'active' ? style.activeMs : changingAction ? style.entryMs : style.phaseMs;
    const linearMix = duration > 0 ? clamp((p.poseTransitionAge || 0) / duration, 0, 1) : 1;
    if (linearMix < 1 && p.poseTransitionFrom) {
      const smoothMix = linearMix * linearMix * (3 - 2 * linearMix);
      keyPose = blendKeyPose(p.poseTransitionFrom, keyPose, smoothMix);
    } else {
      p.poseTransitionFrom = null;
    }
    p.displayedKeyPose = keyPose;
  } else {
    p.displayedKeyPose = null;
  }
  p.previousPoseAction = action;
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
  if (action === 'run' || action === 'dash' || action === 'pivot' || action === 'dashAttack') rotation = p.face * .07;
  if (action === 'brake' || action === 'skid') rotation = -p.face * .1;
  if (action === 'walk') rotation = p.face * .025;
  if (action === 'crouch' || action === 'crawl') { scaleX = 1.16; scaleY = .72; bodyY = 10; }
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
  const rollDuration = Math.max(1, p.dodgeTotalFrames || (action === 'techRoll' ? 16 : action === 'getupRoll' ? 20 : action === 'ledgeRoll' ? 18 : 22));
  const rollProgress = rolling ? clamp((p.dodgeElapsed ?? (rollDuration - (p.dodgeFrames || 0))) / rollDuration, 0, 1) : 0;
  const rollEase = rollProgress * rollProgress * (3 - 2 * rollProgress);
  const rollTuck = rolling ? Math.sin(rollProgress * Math.PI) : 0;
  const rollDirection = rolling ? (Math.sign(p.dodgeStartVx || p.vx || p.face) || 1) : p.face;
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
  if (impactCue && (action === 'hit' || action === 'groundHit' || action === 'grabbedHit')) {
    const strength = clamp(Number(p.impactVisualStrength) || .5, .35, 1.55);
    const direction = Math.cos(Number(p.impactVisualAngle) || 0);
    scaleX *= 1 + .065 * strength;
    scaleY *= 1 - .045 * strength;
    bodyX += direction * 4.5 * strength;
    rotation += direction * .055 * strength;
  }
  if (p.grounded) bodyY += p.height / 2 * (1 - scaleY);
  const targetPose={scaleX,scaleY,rotation,bodyX,bodyY};
  const pose=p.visualPose||={...targetPose};
  if (dodgeRestarted) Object.assign(pose, targetPose);
  const doubleJumpEnded = !doubleJumpActive && p.visualDoubleJumpWasActive;
  if (p.visualAction !== action) {
    if (Math.abs(pose.rotation) > Math.PI) pose.rotation = 0;
    p.visualAction = action;
    p.visualActionAge = 0;
  } else p.visualActionAge = (p.visualActionAge || 0) + dt;
  const poseRate=p.hitstop>0?96:enteredActive?110:phase==='active'?76:phase==='startup'||phase==='charge'?32:phase==='recovery'?25:action==='groundHit'||action==='hit'?72:doubleJumpActive?58:spinning?38:rolling?48:keyPose?42:attack?26:22,poseMix=1-Math.exp(-Math.max(.001,dt)*poseRate);
  for(const key of Object.keys(targetPose))pose[key]=lerp(pose[key],targetPose[key],poseMix);
  if (doubleJumpActive) pose.rotation = rotation;
  else if (doubleJumpEnded) pose.rotation = 0;
  p.visualDoubleJumpWasActive = doubleJumpActive;
  ({scaleX,scaleY,rotation,bodyX,bodyY}=pose);

  ctx.save(); ctx.translate(p.x, p.y);
  if (players.length >= 3) {
    const activeAttack = attack && phase === 'active';
    const floorY = p.height * .52;
    ctx.save();
    ctx.globalAlpha = p.i === myIndex ? .9 : activeAttack ? .76 : .38;
    ctx.strokeStyle = p.i === myIndex ? '#ffffff' : color;
    ctx.lineWidth = p.i === myIndex ? 3 : 2;
    ctx.beginPath();ctx.ellipse(0,floorY,p.width*.52,5.5,0,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = activeAttack ? .9 : .62;
    ctx.beginPath();
    ctx.moveTo(p.face*(p.width*.62+(activeAttack?9:3)),floorY);
    ctx.lineTo(p.face*p.width*.42,floorY-5);
    ctx.lineTo(p.face*p.width*.42,floorY+5);
    ctx.closePath();ctx.fill();
    ctx.restore();
  }
  const novaWarpMove = fighter.id === 'nova'
    && (action === 'specialSide' && moveMotion === 'blink' || action === 'specialUp' && moveMotion === 'warp');
  const novaWarpCharging = novaWarpMove && phase === 'charge' && p.chargeFrames > 0;
  // Freefall is already readable from its dedicated pose. A canvas filter here
  // forces every limb, shadow, and effect through an offscreen filter pass and
  // caused NOVA's post-warp frames to hitch on some browsers.
  if (action === 'dash' || action === 'pivot' || action === 'dashAttack') {
    const direction = action === 'pivot' ? Math.sign(p.vx || p.face) || p.face : p.face;
    const burst = action === 'dashAttack';
    const speedRatio = clamp(Math.abs(p.vx || 0) / Math.max(1, fighter.dashSpeed || 500), .25, 1.35);
    const dashFade = action === 'dash' ? 1 - clamp((p.dashAge || 0) / 16, 0, 1) * .62 : action === 'pivot' ? .8 : 1;
    ctx.save();
    ctx.fillStyle = color;

    if (p.grounded) {
      // The strongest cue belongs at the planted foot. Its length follows
      // actual velocity and tapers into the floor instead of floating mid-body.
      const floorY = p.height * .49;
      const near = -direction * (p.width * .08);
      const far = near - direction * (16 + speedRatio * (burst ? 38 : 25));
      ctx.globalAlpha = (burst ? .25 : .18) * dashFade;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(near, floorY - 2.5);
      ctx.lineTo(far, floorY - 1);
      ctx.lineTo(far - direction * 7, floorY);
      ctx.lineTo(far, floorY + 1);
      ctx.lineTo(near, floorY + 2.5);
      ctx.closePath();
      ctx.fill();
      if ((p.dashAge || 0) < 9 || burst) {
        ctx.globalAlpha *= .72;
        for (let mote = 0; mote < 2; mote++) {
          const distance = p.width * .22 + mote * 11 + speedRatio * 4;
          const size = 3 - mote * .8;
          ctx.fillRect(-direction * distance - size / 2, floorY - 5 - mote * 4, size, size);
        }
      }
    }
    ctx.restore();
  }
  if (action === 'airRecover') {
    const recoverAge=clamp((p.visualActionAge||0)/.14,0,1);
    ctx.save();ctx.globalAlpha=(1-recoverAge)*.72;ctx.strokeStyle='#b9fbff';ctx.lineWidth=3;ctx.shadowBlur=12;ctx.shadowColor='#65ecff';
    ctx.beginPath();ctx.arc(0,0,p.width*.55+recoverAge*16,-Math.PI*.85,Math.PI*.7);ctx.stroke();ctx.restore();
  }
  ctx.globalAlpha = invincibleFlash ? .42 : 1;
  if (p.invincible > 0) {
    ctx.shadowBlur = 13;
    ctx.shadowColor = '#ffffff';
  }
  if (p.shielding) {
    ctx.save();ctx.translate(p.shieldOffsetX||0,p.shieldOffsetY||0);
    const shieldRatio = clamp((p.shield || 0) / SHIELD_MAX, 0, 1);
    const shieldScale = .58 + .42 * shieldRatio;
    const shieldRadius = Math.max(p.width * .9 + 15, p.height * .75 + 12) * shieldScale;
    const shieldHit = action === 'shieldHit';
    const shieldCritical = shieldRatio < .24;
    const shieldWarning = shieldRatio < .5;
    const shieldPulse = shieldCritical ? .68 + Math.sin(performance.now() / (shieldRatio < .12 ? 62 : 92)) * .22 : 1;
    ctx.globalAlpha *= shieldPulse;
    ctx.fillStyle = shieldHit
      ? 'rgba(255,174,82,.34)'
      : shieldCritical ? 'rgba(255,45,82,.38)' : shieldWarning ? 'rgba(255,178,58,.34)' : 'rgba(80,218,255,.3)';
    ctx.strokeStyle = shieldHit
      ? '#fff0a8' : p.parryFrames > 0 ? '#fff36b' : shieldCritical ? '#ff355f' : shieldWarning ? '#ffc34f' : '#d9fbff';
    ctx.lineWidth = shieldHit ? 6 : p.parryFrames > 0 ? 5 : shieldCritical ? 5 : 4;
    ctx.shadowBlur=shieldHit?10:6;ctx.shadowColor=ctx.strokeStyle;
    ctx.beginPath(); ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur=0;ctx.globalAlpha*=.72;ctx.beginPath();ctx.moveTo(-12,-3);ctx.lineTo(0,10);ctx.lineTo(12,-3);ctx.stroke();
    ctx.globalAlpha*=.65;ctx.lineWidth=2;ctx.beginPath();
    ctx.arc(p.face * shieldRadius * .16, 0, shieldRadius * .62, -Math.PI * .68, Math.PI * .68);
    ctx.stroke();
    if (shieldRatio < .42) {
      const crack = shieldRadius * .46;
      ctx.globalAlpha=.82;ctx.strokeStyle='#ffcf78';ctx.beginPath();
      ctx.moveTo(-crack*.18,-crack);ctx.lineTo(crack*.06,-crack*.42);ctx.lineTo(-crack*.14,-crack*.05);
      ctx.lineTo(crack*.16,crack*.34);ctx.lineTo(crack*.05,crack*.82);ctx.stroke();
    }
    ctx.globalAlpha=1;ctx.restore();
  }
  if (p.parryFrames > 0 && !p.shielding) {
    ctx.strokeStyle = '#fff36b'; ctx.lineWidth = 5; ctx.globalAlpha *= .45 + p.parryFrames * .12;
    ctx.beginPath(); ctx.arc(0, 0, p.width + (6 - p.parryFrames) * 8, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  }
  ctx.translate(bodyX, bodyY);
  if (novaWarpCharging) ctx.scale(0, 0);
  ctx.rotate(rotation); ctx.scale(scaleX, scaleY);
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
    const legReach = fighter.id === 'blaze' ? 62 : fighter.id === 'bolt' ? 59 : 57;
    const primary = limitLimb(primaryHipX, hipY, localStrikePoint(p.strikePoints[0]), legReach);
    if (action === 'airBack') { backFootX = primary.x; backFootY = primary.y; }
    else { frontFootX = primary.x; frontFootY = primary.y; }
    if (p.strikePoints[1]) {
      const secondary = limitLimb(-p.face * 6, hipY, localStrikePoint(p.strikePoints[1]), legReach);
      backFootX = secondary.x; backFootY = secondary.y;
    }
  }
  const feetRate=p.hitstop>0||action==='groundHit'?94:enteredActive?114:phase==='active'?76:phase==='startup'||phase==='charge'?34:phase==='recovery'?27:rolling?52:keyPose?48:22;
  const targetFeet={frontFootX,frontFootY,backFootX,backFootY},feet=p.visualFeet||={...targetFeet},feetMix=1-Math.exp(-Math.max(.001,dt)*feetRate);
  for(const key of Object.keys(targetFeet))feet[key]=lerp(feet[key],targetFeet[key],feetMix);
  ({frontFootX,frontFootY,backFootX,backFootY}=feet);
  let frontKnee=[(p.face*6+frontFootX)*.5+p.face*4,(hipY+frontFootY)*.5];
  let backKnee=[(-p.face*6+backFootX)*.5-p.face*4,(hipY+backFootY)*.5];
  const authoredJoints = attack ? window.NEON_MOTION?.jointFor(fighter.id, action) : null;
  const jointWeight = !authoredJoints ? 0
    : phase === 'active' ? 1
      : phase === 'startup' || phase === 'charge' ? progress * .48
        : phase === 'recovery' ? (1-progress) * .52 : 0;
  if (jointWeight) {
    frontKnee[0] += p.face * (authoredJoints.frontKneeX || 0) * jointWeight;
    frontKnee[1] += (authoredJoints.frontKneeY || 0) * jointWeight;
    backKnee[0] += p.face * (authoredJoints.backKneeX || 0) * jointWeight;
    backKnee[1] += (authoredJoints.backKneeY || 0) * jointWeight;
  }
  const crowding = window.NEON_READABILITY?.crowding(p, players) || 0;
  const silhouetteExtra = 4 + (crowding >= 2 ? 2 : crowding);
  drawOutlinedLimb([[-p.face*4,hipY],backKnee,[backFootX,backFootY]],renderColor,.58,4,silhouetteExtra);
  drawOutlinedLimb([[p.face*4,hipY],frontKnee,[frontFootX,frontFootY]],renderColor,1,5,silhouetteExtra);
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
    const armReach = fighter.id === 'blaze' ? 56 : fighter.id === 'nova' ? 52 : 50;
    const primary = limitLimb(p.face * 6, shoulderY, localStrikePoint(p.strikePoints[0]), armReach);
    frontX = primary.x; frontY = primary.y - bodyCenterY;
    if (p.strikePoints[1]) {
      const secondary = limitLimb(-p.face * 6, shoulderY, localStrikePoint(p.strikePoints[1]), armReach);
      backX = secondary.x; backY = secondary.y - bodyCenterY;
    }
  }
  const armRate=p.hitstop>0||action==='groundHit'?100:enteredActive?120:phase==='active'?82:phase==='startup'||phase==='charge'?36:phase==='recovery'?28:rolling?54:keyPose?50:23;
  const targetArms={frontX,frontY,backX,backY},arms=p.visualArms||={...targetArms},armMix=1-Math.exp(-Math.max(.001,dt)*armRate);
  for(const key of Object.keys(targetArms))arms[key]=lerp(arms[key],targetArms[key],armMix);
  ({frontX,frontY,backX,backY}=arms);
  if (p.chargeFrames > 0) {
    const chargeAnchor = legStrike
      ? { x: frontFootX, y: frontFootY }
      : { x: frontX, y: frontY + bodyCenterY };
    drawSmashChargeEffect(p, action, color, chargeAnchor);
  }
  const frontElbow=[(p.face*7+frontX)*.52+p.face*4,(bodyCenterY-7+frontY+bodyCenterY)*.5];
  const backElbow=[(-p.face*6+backX)*.52-p.face*3,(bodyCenterY-4+backY+bodyCenterY)*.5];
  if (jointWeight) {
    frontElbow[0] += p.face * (authoredJoints.frontElbowX || 0) * jointWeight;
    frontElbow[1] += (authoredJoints.frontElbowY || 0) * jointWeight;
    backElbow[0] += p.face * (authoredJoints.backElbowX || 0) * jointWeight;
    backElbow[1] += (authoredJoints.backElbowY || 0) * jointWeight;
  }
  drawOutlinedLimb([[-p.face*4,bodyCenterY-4],backElbow,[backX,backY+bodyCenterY]],renderColor,.58,4,silhouetteExtra);
  drawOutlinedLimb([[p.face*4,bodyCenterY-6],frontElbow,[frontX,frontY+bodyCenterY]],renderColor,1,5,silhouetteExtra);

  const bodyColor = renderColor;
  const headY=bodyCenterY-bodyHeight*.33,headRadius=fighter.id==='blaze'?13:12,torsoBottom=bodyCenterY+bodyHeight*.43;
  ctx.shadowBlur=hitFlash?8:0;ctx.shadowColor=renderColor;ctx.lineCap='round';
  ctx.strokeStyle='#080d19';ctx.lineWidth=10+(silhouetteExtra-4);ctx.beginPath();ctx.moveTo(0,headY+headRadius*.72);ctx.lineTo(0,torsoBottom);ctx.stroke();
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
  ctx.fillStyle=fullBodyFlash?'rgba(255,255,255,.94)':'rgba(7,13,25,.9)';ctx.strokeStyle='#080d19';ctx.lineWidth=8+(silhouetteExtra-4);ctx.fill();ctx.stroke();
  ctx.strokeStyle=bodyColor;ctx.lineWidth=4;ctx.stroke();
  ctx.strokeStyle=fullBodyFlash?'#101522':action==='parrySuccess'?'#fff36b':'#f7fbff';ctx.shadowBlur=action==='parrySuccess'?12:0;ctx.shadowColor='#fff36b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(p.face*1,headY-2);ctx.lineTo(p.face*(headRadius*.55),headY-3);ctx.stroke();ctx.shadowBlur=0;
  if (action === 'dash' || action === 'pivot' || action === 'dashAttack') {
    const now = performance.now();
    const burst = action === 'dashAttack';
    const cadence = burst ? 34 : 48;
    const moved = Math.hypot(p.x - (p.visualAfterimageX ?? p.x - p.vx / 60), p.y - (p.visualAfterimageY ?? p.y));
    if (now - (p.visualAfterimageAt || 0) >= cadence && moved >= (burst ? 5 : 7)) {
      p.visualAfterimageAt = now;
      p.visualAfterimageX = p.x;
      p.visualAfterimageY = p.y;
      dashAfterimages.push({
        x:p.x,y:p.y,bodyX,bodyY,rotation,scaleX,scaleY,
        fighterId:fighter.id,color,headY,headRadius,torsoBottom,
        backShoulder:[-p.face*4,bodyCenterY-4],backElbow:[...backElbow],backHand:[backX,backY+bodyCenterY],
        frontShoulder:[p.face*4,bodyCenterY-6],frontElbow:[...frontElbow],frontHand:[frontX,frontY+bodyCenterY],
        backHip:[-p.face*4,hipY],backKnee:[...backKnee],backFoot:[backFootX,backFootY],
        frontHip:[p.face*4,hipY],frontKnee:[...frontKnee],frontFoot:[frontFootX,frontFootY],
        alpha:burst?.3:.22,life:burst?.19:.145,duration:burst?.19:.145
      });
      if (dashAfterimages.length > 18) dashAfterimages.splice(0,dashAfterimages.length-18);
    }
  } else {
    p.visualAfterimageAt = 0;
    p.visualAfterimageX = p.x;
    p.visualAfterimageY = p.y;
  }
  if (action.startsWith('special')) drawReadableSpecialEffect(p, fighter, action, moveMotion, phase, progress, color);
  ctx.restore();
  if (novaWarpCharging) drawNovaChargeStar(p, color, progress);
  p.visualLastX = p.x;
  p.visualLastY = p.y;

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
      const badgeY = p.y - p.height / 2 - 29;
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
function drawHudFighterPortrait(fighter,color,x,y,r){
  ctx.save();ctx.translate(x,y);
  const portrait=ctx.createRadialGradient(-r*.26,-r*.32,r*.08,0,0,r);
  portrait.addColorStop(0,'rgba(255,255,255,.98)');portrait.addColorStop(.18,color);portrait.addColorStop(1,'rgba(5,7,14,.98)');
  ctx.fillStyle=portrait;ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.fill();
  ctx.save();ctx.beginPath();ctx.arc(0,0,r-2,0,Math.PI*2);ctx.clip();
  const headR=r*.52,headY=r*.08;
  ctx.beginPath();
  if(fighter.id==='volt'){
    const points=[[-.9,-.45],[-.42,-.72],[-.12,-1.25],[.18,-.78],[.72,-.98],[.6,-.42],[1,0],[.55,.75],[-.55,.75],[-1,0]];
    points.forEach(([px,py],index)=>index?ctx.lineTo(px*headR,headY+py*headR):ctx.moveTo(px*headR,headY+py*headR));ctx.closePath();
  }else if(fighter.id==='blaze'){
    ctx.moveTo(-headR,headY+headR*.72);ctx.lineTo(-headR,headY-headR*.45);ctx.lineTo(-headR*.5,headY-headR*.78);ctx.lineTo(-headR*.22,headY-headR*1.3);ctx.lineTo(headR*.15,headY-headR*.78);ctx.lineTo(headR*.65,headY-headR*1.12);ctx.lineTo(headR,headY-headR*.38);ctx.lineTo(headR,headY+headR*.72);ctx.closePath();
  }else if(fighter.id==='bolt'){
    ctx.arc(0,headY,headR,0,Math.PI*2);ctx.moveTo(-headR,headY);ctx.lineTo(-headR-4,headY-4);ctx.moveTo(headR,headY);ctx.lineTo(headR+4,headY-4);ctx.moveTo(0,headY-headR);ctx.lineTo(0,headY-headR-r*.2);ctx.arc(0,headY-headR-r*.24,r*.07,0,Math.PI*2);
  }else{
    ctx.moveTo(0,headY-headR*1.25);ctx.lineTo(headR,headY-headR*.2);ctx.lineTo(headR*.58,headY+headR);ctx.lineTo(0,headY+headR*.72);ctx.lineTo(-headR*.58,headY+headR);ctx.lineTo(-headR,headY-headR*.2);ctx.closePath();
  }
  ctx.fillStyle='rgba(7,11,20,.92)';ctx.strokeStyle='#050811';ctx.lineWidth=Math.max(2,r*.15);ctx.fill();ctx.stroke();
  ctx.strokeStyle=color;ctx.lineWidth=Math.max(1.5,r*.07);ctx.stroke();
  ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(1.2,r*.065);ctx.beginPath();ctx.moveTo(r*.03,headY-r*.05);ctx.lineTo(r*.29,headY-r*.08);ctx.stroke();
  ctx.restore();ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=Math.max(1,r*.05);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.stroke();ctx.restore();
}
function drawBattleHUD(){
  const count=Math.max(1,players.length),gap=count===4?8:16,maxSlot=count<=2?240:count===3?245:250;
  const slotW=Math.min(maxSlot,(WORLD_W-28-gap*(count-1))/count),slotH=92;
  const total=slotW*count+gap*(count-1),startX=(WORLD_W-total)/2,y=WORLD_H-slotH-14;
  const pulse=.74+Math.sin(performance.now()/120)*.26;
  players.forEach((p,index)=>{
    const fighter=FIGHTERS.find(item=>item.id===p.characterId)||FIGHTERS[0];
    const color=fighter.palettes[p.palette%fighter.palettes.length];
    const x=startX+index*(slotW+gap),damage=Math.min(999,Math.max(0,Math.round(p.damage))),danger=clamp(p.damage/160,0,1);
    const shield=clamp((p.shield||0)/SHIELD_MAX,0,1),ultimate=clamp((p.ultimateMeter||0)/100,0,1);
    const damageColor=danger<.42?'#ffffff':danger<.72?'#ffd65a':danger<.9?'#ff8b47':'#ff375f';
    const portraitX=x+47,portraitY=y+55,portraitRadius=34;
    ctx.save();
    ctx.globalAlpha=p.eliminated?.42:1;
    drawHudFighterPortrait(fighter,color,portraitX,portraitY,portraitRadius);
    ctx.strokeStyle='rgba(255,255,255,.13)';ctx.lineWidth=4;ctx.beginPath();ctx.arc(portraitX,portraitY,39,-Math.PI*.72,Math.PI*.72);ctx.stroke();
    if(ultimate>0){
      ctx.strokeStyle=ultimate>=1?'#fff36b':color;ctx.lineCap='round';ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=ultimate>=1?16*pulse:5;ctx.lineWidth=4;
      ctx.beginPath();ctx.arc(portraitX,portraitY,39,-Math.PI*.72,-Math.PI*.72+Math.PI*1.44*ultimate);ctx.stroke();ctx.shadowBlur=0;ctx.lineCap='butt';
    }
    ctx.fillStyle=color;ctx.beginPath();ctx.roundRect(x+58,y+16,27,14,3);ctx.fill();
    ctx.fillStyle='#080b13';ctx.textAlign='center';ctx.font='900 8px Inter';ctx.fillText(`P${index+1}`,x+71.5,y+26);
    if(p.i===myIndex){ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x+82,y+18,2.2,0,Math.PI*2);ctx.fill();}
    const textX=x+94;
    ctx.textAlign='left';ctx.fillStyle='#fff';ctx.strokeStyle='rgba(0,0,0,.9)';ctx.lineJoin='round';ctx.font='900 10px Inter';
    const tag=String(playerTag(p)).slice(0,count===4?12:16);ctx.lineWidth=3;ctx.strokeText(tag,textX,y+35);ctx.fillText(tag,textX,y+35);
    ctx.fillStyle=damageColor;ctx.shadowColor=damageColor;ctx.shadowBlur=danger>.82?11*pulse:0;
    ctx.font=`900 ${damage>=100?46:50}px "Arial Narrow", Inter`;const damageText=String(damage);
    ctx.lineWidth=6;ctx.strokeStyle='rgba(0,0,0,.94)';ctx.strokeText(damageText,textX-3,y+76);ctx.fillText(damageText,textX-3,y+76);
    const damageWidth=ctx.measureText(damageText).width;ctx.shadowBlur=0;ctx.font='900 18px Inter';ctx.lineWidth=4;ctx.strokeText('%',textX+damageWidth,y+74);ctx.fillText('%',textX+damageWidth,y+74);
    ctx.fillStyle='rgba(255,255,255,.78)';ctx.font='800 7px Inter';ctx.lineWidth=2.5;ctx.strokeText(fighter.name,textX,y+89);ctx.fillText(fighter.name,textX,y+89);

    const lifeX=textX+46,lifeY=y+87;
    ctx.textAlign='left';
    if(rules.mode==='training'){
      ctx.fillStyle=color;ctx.strokeStyle='rgba(0,0,0,.9)';ctx.font='900 13px Inter';ctx.lineWidth=3;ctx.strokeText('∞',lifeX,lifeY+3);ctx.fillText('∞',lifeX,lifeY+3);
    }else if(rules.mode==='time'){
      const scoreText=`${p.score>=0?'+':''}${p.score}`;
      ctx.fillStyle=color;ctx.strokeStyle='rgba(0,0,0,.9)';ctx.font='900 11px Inter';ctx.lineWidth=3;ctx.strokeText(scoreText,lifeX,lifeY+2);ctx.fillText(scoreText,lifeX,lifeY+2);
    }else{
      const stockCount=Math.max(0,p.stocks),visibleStocks=Math.min(stockCount,5),stockGap=13;
      for(let stock=0;stock<visibleStocks;stock++)drawHudFighterPortrait(fighter,color,lifeX+stock*stockGap,lifeY,5);
      if(stockCount>5){ctx.fillStyle='#fff';ctx.strokeStyle='rgba(0,0,0,.9)';ctx.font='900 7px Inter';ctx.lineWidth=2.5;ctx.strokeText(`×${stockCount}`,lifeX+visibleStocks*stockGap,lifeY+3);ctx.fillText(`×${stockCount}`,lifeX+visibleStocks*stockGap,lifeY+3);}
    }
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
function drawRespawnPlatforms(){
  for(const p of players){
    if(!p.respawnPlatformFrames)continue;
    const fighter=FIGHTERS.find(item=>item.id===p.characterId)||FIGHTERS[0],color=fighter.palettes[p.palette%fighter.palettes.length];
    const fade=clamp(p.respawnPlatformFrames/18,0,1),y=p.y+p.height/2+9;
    ctx.save();ctx.globalAlpha=.38+.5*fade;ctx.shadowColor=color;ctx.shadowBlur=20;ctx.fillStyle='rgba(225,250,255,.2)';ctx.strokeStyle=color;ctx.lineWidth=3;
    ctx.beginPath();ctx.ellipse(p.x,y,54,10,0,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.globalAlpha*=.42;ctx.beginPath();ctx.ellipse(p.x,y+4,39,5,0,0,Math.PI*2);ctx.stroke();ctx.restore();
  }
}
function drawKoCinematics(){
  for(const effect of koCinematics){
    const progress=1-clamp(effect.life/effect.duration,0,1),fighter=FIGHTERS.find(item=>item.id===effect.characterId)||FIGHTERS[0],color=fighter.palettes[effect.palette%fighter.palettes.length];
    ctx.save();ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='900 26px Inter';ctx.shadowColor=color;ctx.shadowBlur=18;
    if(effect.style==='star'){
      const x=WORLD_W*.5+Math.sin(progress*Math.PI*5)*72*(1-progress),y=WORLD_H*.43-progress*WORLD_H*.54,scale=lerp(1.25,.16,progress);
      ctx.translate(x,y);ctx.rotate(progress*Math.PI*4);ctx.scale(scale,scale);ctx.fillStyle='#fff';ctx.fillText(fighter.icon,0,0);
      ctx.strokeStyle=color;ctx.lineWidth=3;ctx.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?13:28;i?ctx.lineTo(Math.cos(a)*r,Math.sin(a)*r):ctx.moveTo(Math.cos(a)*r,Math.sin(a)*r);}ctx.closePath();ctx.stroke();
    }else{
      const scale=lerp(.18,4.2,Math.pow(progress,1.65)),alpha=clamp(1-Math.max(0,progress-.72)/.28,0,1);
      ctx.globalAlpha=alpha;ctx.translate(WORLD_W/2,WORLD_H*.43);ctx.rotate(Math.sin(progress*Math.PI)*-.18);ctx.scale(scale,scale);ctx.fillStyle=color;ctx.fillText(fighter.icon,0,0);
    }
    ctx.restore();
  }
}
function burst(x,y,color,count,speed,direction=0,scale=1){const densityScale=particles.length>48?.36:particles.length>30?.64:1,drawCount=Math.max(2,Math.ceil(count*effectQuality*densityScale));for(let i=0;i<drawCount;i++){const forward=i<drawCount*.66,a=direction+(forward?0:Math.PI)+(Math.random()-.5)*(forward?1.8:2.55),s=speed*(.3+Math.random()*.82),duration=.19+Math.random()*.15;particles.push({x:x+(Math.random()-.5)*7,y:y+(Math.random()-.5)*7,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:duration,duration,color:i%4===0?color:'#ffffff',size:(1.8+Math.random()*2.5)*scale,gravity:42+Math.random()*65});}if(particles.length>64)particles.splice(0,particles.length-64);}
function drawParticles(){window.NEON_RENDER_EFFECTS.particles(ctx,particles);}
function drawBlastMarks(){window.NEON_RENDER_EFFECTS.blastMarks(ctx,blastMarks);}
function drawShieldBreakEffects(){window.NEON_RENDER_EFFECTS.shieldBreaks(ctx,shieldBreakEffects,effectQuality);}
function drawImpactRings(){window.NEON_RENDER_EFFECTS.impactRings(ctx,impactRings,effectQuality);}
function drawTrails(){window.NEON_RENDER_EFFECTS.launchTrails(ctx,trails);}
function updateParticles(dt){for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=(p.gravity||0)*dt;p.vx*=Math.exp(-dt*6.5);p.vy*=Math.exp(-dt*6.5);}particles=particles.filter(p=>p.life>0);for(const ring of impactRings)ring.life-=dt;impactRings=impactRings.filter(ring=>ring.life>0);for(const mark of blastMarks)mark.life-=dt;blastMarks=blastMarks.filter(mark=>mark.life>0);for(const effect of shieldBreakEffects)effect.life-=dt;shieldBreakEffects=shieldBreakEffects.filter(effect=>effect.life>0);for(const image of dashAfterimages)image.life-=dt;dashAfterimages=dashAfterimages.filter(image=>image.life>0);for(const effect of koCinematics)effect.life-=dt;koCinematics=koCinematics.filter(effect=>effect.life>0);for(const trail of trails)trail.life-=dt;trails=trails.filter(trail=>trail.life>0);trailClock-=dt;if((state==='playing'||state==='waiting')&&trailClock<=0){trailClock=.045;for(const p of players){if(p.eliminated||p.respawn>0)continue;const action=displayedAction(p),speed=Math.hypot(p.vx,p.vy),finisher=(p.criticalFlightFrames||0)>0,launched=(p.tumbling||action==='tumble')&&speed>520;if(launched){const fighter=FIGHTERS.find(item=>item.id===p.characterId)||FIGHTERS[0];trails.push({x:p.x,y:p.y,vx:p.vx,vy:p.vy,launch:true,finisher,color:fighter.palettes[p.palette%fighter.palettes.length],life:finisher?.3:.24});}}}}

function loop(now){
  requestAnimationFrame(loop);
  const frameMs=Math.min(33,now-lastFrame),dt=frameMs/1000;lastFrame=now;
  const metricSample=runtimeMonitor.frame(now,frameMs,{
    interpolationMs:+adaptiveDelay.toFixed(1),
    particles:particles.length,trails:trails.length,players:players.length,
    heapMb:performance.memory?+(performance.memory.usedJSHeapSize/1048576).toFixed(1):0
  });
  if(metricSample){
    if(snapshotTickRates.length)metricSample.snapshotHz=runtimeMetrics.snapshotHz;
    if(runtimeMetrics.fps>0){
      metricSample.fps=+(runtimeMetrics.fps*.7+metricSample.fps*.3).toFixed(1);
      metricSample.frameMs=+(runtimeMetrics.frameMs*.7+metricSample.frameMs*.3).toFixed(2);
    }
    Object.assign(runtimeMetrics,metricSample);
  }
  updateParticles(dt);
  if(state==='playing'||state==='waiting'){sendInput(now);renderNetworkState(dt,now);if(state==='playing')updateTutorialState();}
  draw(dt);
}
requestAnimationFrame(loop);

function showResult(index){state='result';winnerIndex=index;const winner=players.find(player=>player.i===index),fighter=winner?(FIGHTERS.find(item=>item.id===winner.characterId)||FIGHTERS[0]):null,color=fighter?.palettes?.[winner.palette%fighter.palettes.length]||fighter?.color||'#ffffff';document.querySelector('#winner-name').textContent=fighter?.name||'DRAW';document.querySelector('#winner-name').style.color=color;document.querySelector('#winner-avatar').textContent=fighter?.icon||'×';document.querySelector('#winner-avatar').style.color=color;result.classList.remove('hidden');trainingPanel.classList.add('hidden');socket.emit('stats:get',updateStats);}
function returnToWaitingRoom(){result.classList.add('hidden');menu.classList.add('hidden');waitingRoom.classList.remove('hidden');state='waiting';renderLobby();}
document.querySelector('#rematch-button').addEventListener('click', async () => {
  if (!room?.botMatch && !room?.demo) return returnToWaitingRoom();
  const mine = room.players.find(player => player.clientId === identity?.clientId);
  const ready = await emitAck('player:select', {
    characterId: selectedCharacter, palette: selectedPalette, team: mine?.team || 0, ready: true
  });
  if (!ready?.ok) return setError('재대전을 준비할 수 없습니다.');
  const started = await emitAck('room:start');
  if (!started?.ok) setError(started?.error || '재대전을 시작할 수 없습니다.');
});
document.querySelector('#menu-button').addEventListener('click', () => {
  if (room?.botMatch || room?.demo) leaveRoomToMenu();
  else returnToWaitingRoom();
});

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
  if (!event.repeat) keyboardIntent.keyDown(event.code, performance.now());
  keys.add(event.code);
  if (!event.repeat && (state === 'playing' || state === 'waiting') && ['KeyZ','KeyX','KeyV','KeyF','KeyG','KeyE'].includes(event.code)) {
    const self = players.find(player => player.i === myIndex);
    const airborne = self && (!self.grounded || self.jumpSquatFrames > 0);
    const up = keys.has('KeyW') || keys.has('ArrowUp') || keys.has('Space'), down = keys.has('KeyS') || keys.has('ArrowDown');
    const side = keys.has('KeyA') || keys.has('KeyD') || keys.has('ArrowLeft') || keys.has('ArrowRight');
    const cueLocked = !self || self.eliminated || self.respawn > 0 || self.hitstop > 0 || self.stun > 0 || self.freefall || self.dodgeFrames > 0 || self.ledgeTransitionFrames > 0 || self.landingLag > 0 || self.shieldStun > 0 || self.shieldDropLag > 0 || self.knockdownFrames > 0 || self.shielding || self.ledge || self.grabbedBy != null || self.grabbing != null || self.actionPhase;
    const specialKey = event.code === 'KeyX' || event.code === 'KeyG';
    const attackKey = event.code === 'KeyZ' || event.code === 'KeyF';
    const ultimateCombo = !airborne && !cueLocked && (self?.ultimateMeter || 0) >= 100
      && (keys.has('KeyZ') || keys.has('KeyF')) && (keys.has('KeyX') || keys.has('KeyG'));
    if (ultimateCombo) {
      localAttackIntent = null;
      localCue = { name: 'ultimate', variant: self.characterId, started: performance.now(), seq: inputSeq + 1 };
    } else if (attackKey && !airborne && !cueLocked) {
      const dashAttack = side && (
        self?.movementState === 'run'
        || (self?.dashFrames || 0) > 0 && (self?.movementState === 'dash' || self?.movementState === 'pivot')
      );
      const directional = up || down || side;
      const name = dashAttack ? 'dashAttack' : up ? 'groundUp' : down ? 'groundDown' : side ? 'groundSide' : 'groundNeutral';
      if (!dashAttack) {
        localAttackIntent = { started: performance.now(), directional, name };
      } else {
        localAttackIntent = null;
        localCue = { name, variant: 'normal', started: performance.now(), seq: inputSeq + 1 };
      }
    }
    if (!ultimateCombo && !cueLocked && !(specialKey && up && self.recoveryAvailable === false) && (airborne || !attackKey && !specialKey)) {
      let name = airborne ? 'airDodge' : 'grab';
      if (specialKey) name = up ? 'specialUp' : down ? 'specialDown' : side ? 'specialSide' : 'specialNeutral';
      if (attackKey) name = airborne ? (up ? 'airUp' : down ? 'airDown' : side ? Math.sign(readInput().horizontal || self.face) === self.face ? 'airForward' : 'airBack' : 'airNeutral') : (up ? 'groundUp' : down ? 'groundDown' : side ? 'groundSide' : 'groundNeutral');
      localCue = { name, started: performance.now(), seq: inputSeq + 1 };
    }
    sendInput(performance.now(), true);
  }
  if (!event.repeat && (state === 'playing' || state === 'waiting') && ['KeyW','KeyA','KeyS','KeyD','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyC','ShiftLeft','ShiftRight','ControlLeft','ControlRight'].includes(event.code)) sendInput(performance.now(), true);
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
    if (heldFrames < SMASH_INPUT_HOLD_FRAMES) localCue = {
      name: localAttackIntent.name,
      variant: localAttackIntent.directional ? 'tilt' : 'normal',
      started: performance.now(),
      seq: inputSeq + 1
    };
    localAttackIntent = null;
  }
  keyboardIntent.keyUp(event.code, performance.now());
  keys.delete(event.code);
  sendInput(performance.now(),true);
});
function releaseAllInputs(){
  localAttackIntent = null;
  keyboardIntent.reset();
  inputTransport.reset();
  keys.clear();
  if(!['playing','waiting'].includes(state))return;
  socket.emit('input:frame',{seq:++inputSeq,clientTime:performance.now(),buttons:0,horizontal:0,vertical:0});
  lastInputSent=performance.now();
}
addEventListener('blur',releaseAllInputs);
document.addEventListener('visibilitychange',()=>{if(document.hidden)releaseAllInputs();});
document.querySelector('#sound-button').addEventListener('click',event=>{const muted=audioFeedback.setMuted(!audioFeedback.muted);event.currentTarget.textContent=muted?'×':'♪';});
function beep(freq,duration,type){audioFeedback.tone(freq,duration,type);}
function impactSound(strength, options = {}) {
  audioFeedback.impact(strength, options);
}
function clamp(value,min,max){return Math.max(min,Math.min(max,value));}
function playerTag(player){
  if(player?.clientId?.startsWith('cpu:'))return player.nickname||'BOT';
  return player?.nickname||room?.players?.find(slot=>slot.clientId===player?.clientId)?.nickname||`P${player.i+1}`;
}
function formatTime(ticks){if(rules.mode==='training')return '∞';const seconds=Math.max(0,Math.ceil(ticks/60));return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`;}

if (new URLSearchParams(location.search).get('visualTest') === '1') {
  window.__NEON_SET_VISUAL_FIXTURE__ = (fixture = 'motion-grid') => {
    const built = window.NEON_VISUAL_FIXTURES.build(fixture, {
      fighters: FIGHTERS, stages: STAGES, defaultRules: DEFAULT_RULES, shieldMax: SHIELD_MAX
    });
    visualFixtureActive = true;
    state = 'fixture'; rules = built.rules;
    stage = built.stage; platforms = built.platforms;
    entities = []; items = []; particles = []; trails = []; impactRings = []; blastMarks = []; shieldBreakEffects = [];
    camera = built.camera;
    menu.classList.add('hidden'); waitingRoom.classList.add('hidden'); result.classList.add('hidden');
    countdown.classList.add('hidden'); trainingPanel.classList.add('hidden'); game.classList.remove('hidden');
    players = built.players;
    return { fixture, players: players.length };
  };
  const requestedFixture = new URLSearchParams(location.search).get('visualFixture');
  if (requestedFixture) window.__NEON_SET_VISUAL_FIXTURE__(requestedFixture);
}
function escapeHtml(value){return String(value).replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
