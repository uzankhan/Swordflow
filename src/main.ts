import './styles.css';
import { SwordWorld } from './scene/SwordWorld';
import type { Formation, HandSignal, Pose } from './hand/gesture';

type Q<T extends HTMLElement> = T;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as Q<T>;

const world = new SwordWorld(el<HTMLCanvasElement>('world'), fps => {
  el('fps-label').textContent = `${fps} FPS`;
  el('fps-label').classList.toggle('fps-low', fps < 28);
});
const video = el<HTMLVideoElement>('camera-feed');
const overlay = el<HTMLCanvasElement>('hand-overlay');
const statusLabel = el('status-label');
const statusLed = el('status-led');
const intro = el('intro-panel');
const livePanel = el('live-panel');
const cameraToggle = el<HTMLButtonElement>('camera-toggle');
const startCameraButton = el<HTMLButtonElement>('start-camera');
const sensitivity = el<HTMLInputElement>('sensitivity');
const handSelect = el<HTMLSelectElement>('hand-select');
const confidenceMeter = el<HTMLElement>('confidence-meter');
const confidenceValue = el('confidence-value');
const poseLabel = el('pose-label');
const formationCaption = el('formation-caption');
const introCopy = el('intro-copy');
const resetButton = el<HTMLButtonElement>('reset-button');
const toastEl = el('toast');

let activeMode: 'idle' | 'mouse' | 'hand' = 'idle';
let flightMode: 'swarm' | 'dragon' = 'swarm';
let priorPose: Pose = 'lost';
let toastTimer = 0;
let pointer = { x: .5, y: .5 };
let cameraStartToken = 0;
let cameraStarting = false;
let tracker: import('./hand/HandTracker').HandTracker | null = null;

const formationNames: Formation[] = ['orbit', 'halo', 'spiral', 'shield', 'spearhead'];
const formationTitle: Record<Formation, string> = { orbit: 'ORBIT', halo: 'HALO', spiral: 'SPIRAL', shield: 'SHIELD', spearhead: 'SPEARHEAD' };
const poseTitle: Record<Pose, string> = {
  open: 'OPEN PALM · GATHER', fist: 'FIST · GUARD', pinch: 'PINCH · CHARGING',
  peace: 'V SIGN · FORMATION', flow: 'HAND LINKED', lost: 'WAITING FOR HAND',
};

function setStatus(text: string, kind: 'idle' | 'linking' | 'live' | 'lost' | 'error' = 'idle') {
  statusLabel.textContent = text;
  statusLed.className = `status-led${kind === 'live' ? ' is-live' : kind === 'linking' ? ' is-linking' : kind === 'lost' ? ' is-lost' : kind === 'error' ? ' is-error' : ''}`;
}
function showToast(message: string, accent = false) {
  toastEl.textContent = message;
  toastEl.classList.toggle('toast-accent', accent);
  toastEl.classList.add('is-visible');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('is-visible'), 2400);
}
function flashImpact() {
  el('app').classList.add('impact-flash');
  window.setTimeout(() => el('app').classList.remove('impact-flash'), 180);
}
world.setImpactHandler(hit => {
  if (hit) {
    showToast('GATE IMPACT · BLADES RETURNING', true);
    flashImpact();
  } else {
    showToast('GATES MISSED · BLADES RETURNING');
  }
});
function setFormation(value: Formation, notify = false) {
  world.setFormation(value);
  formationCaption.textContent = flightMode === 'dragon' ? 'DRAGON FLIGHT · FORGE WING' : `FORMATION · ${formationTitle[value]}`;
  document.querySelectorAll<HTMLButtonElement>('.formation-button').forEach(button => {
    button.classList.toggle('is-selected', button.dataset.formation === value);
  });
  if (notify) showToast(`FORMATION LOCKED · ${formationTitle[value]}`, true);
}
function setFlightMode(value: 'swarm' | 'dragon', notify = false) {
  const changed = flightMode !== value;
  flightMode = value;
  world.setFlightMode(value);
  const dragon = value === 'dragon';
  el('app').classList.toggle('is-dragon-mode', dragon);
  el<HTMLButtonElement>('swarm-mode').setAttribute('aria-pressed', String(!dragon));
  el<HTMLButtonElement>('dragon-mode').setAttribute('aria-pressed', String(dragon));
  el<HTMLButtonElement>('swarm-mode').classList.toggle('is-selected', !dragon);
  el<HTMLButtonElement>('dragon-mode').classList.toggle('is-selected', dragon);
  formationCaption.textContent = dragon ? 'DRAGON FLIGHT · FORGE WING' : `FORMATION · ${formationTitle[world.getFormation()]}`;
  introCopy.textContent = dragon
    ? 'A dark-winged forge dragon, guided by your hand. Steer the flight, then swipe to breathe fire.'
    : 'A living blade constellation, guided by your motion. No controller. No gloves. Just you and the swarm.';
  resetButton.innerHTML = dragon ? '↺ &nbsp; RECENTER' : '↺ &nbsp; RECALL';
  if (notify && changed) showToast(dragon ? 'DRAGON FLIGHT · FORGE WING' : 'BLADE SWARM RESTORED', true);
}
function nextFormation() {
  const index = formationNames.indexOf(world.getFormation());
  setFormation(formationNames[(index + 1) % formationNames.length], true);
}
function setIntroVisible(visible: boolean) {
  intro.classList.toggle('is-dismissed', !visible);
}
function activateLive(mode: 'mouse' | 'hand') {
  activeMode = mode;
  world.setMode(mode);
  setIntroVisible(false);
  livePanel.classList.toggle('is-visible', mode === 'hand');
  cameraToggle.hidden = mode !== 'hand';
  cameraToggle.textContent = 'CAMERA OFF';
  el('live-mode-label').textContent = mode === 'hand' ? 'HAND LINK' : 'MOUSE LINK';
  setStatus(mode === 'hand' ? 'HAND LINK ACTIVE' : 'MOUSE LINK ACTIVE', 'live');
}

async function ensureTracker() {
  if (tracker) return tracker;
  const { HandTracker } = await import('./hand/HandTracker');
  tracker = new HandTracker({
    video,
    overlay,
    onSignal: (signal: HandSignal | null) => {
      world.setHand(signal);
      if (!signal) {
        poseLabel.textContent = 'MOVE HAND INTO FRAME';
        priorPose = 'lost';
        return;
      }
      poseLabel.textContent = poseTitle[signal.pose];
      poseLabel.classList.toggle('pose-charge', signal.pose === 'pinch');
      if (signal.pose === 'peace' && priorPose !== 'peace' && flightMode === 'swarm' && !world.getPaused()) nextFormation();
      if (signal.swipe) {
        if (world.getPaused()) {
          showToast('SIMULATION PAUSED · RESUME TO COMMAND');
        } else if (flightMode === 'dragon') {
          world.triggerDragonBreath();
          showToast('FORGE FLAME RELEASED', true);
        } else {
          const volley = world.launch(signal.swipe);
          showToast(volley ? 'VOLLEY RELEASED · GATE ACQUIRED' : 'BLADES RETURNING · WAIT FOR THE SWARM', Boolean(volley));
        }
      }
      priorPose = signal.pose;
    },
    onStatus: (status, message) => {
      if (status === 'requesting' || status === 'loading') {
        setStatus(status === 'requesting' ? 'REQUESTING CAMERA' : 'LOADING VISION', 'linking');
        showToast(message ?? 'Connecting to local camera');
      } else if (status === 'ready') {
        setStatus('HAND LINK ACTIVE', 'live');
        el('camera-placeholder').classList.add('is-hidden');
      } else if (status === 'lost') {
        setStatus('HAND NOT SEEN', 'lost');
        el('camera-placeholder').classList.remove('is-hidden');
      } else if (status === 'error') {
        setStatus('CAMERA UNAVAILABLE', 'error');
        showToast(message ?? 'Camera unavailable');
      } else {
        setStatus('FIELD IDLE');
      }
    },
    onConfidence: value => {
      const percentage = Math.round(value * 100);
      confidenceMeter.style.width = `${percentage}%`;
      confidenceValue.textContent = value ? `${percentage}%` : '--';
    },
    getPreferredHand: () => handSelect.value as 'any' | 'left' | 'right',
    getSensitivity: () => Number(sensitivity.value) / 100,
  });
  return tracker;
}

function stopCamera(announce = true) {
  const wasStarting = cameraStarting;
  cameraStartToken++;
  cameraStarting = false;
  tracker?.stop();
  startCameraButton.disabled = false;
  cameraToggle.hidden = true;
  cameraToggle.textContent = 'CAMERA OFF';
  world.setMode('idle');
  activeMode = 'idle';
  livePanel.classList.remove('is-visible');
  setIntroVisible(true);
  setStatus('FIELD IDLE');
  if (announce) showToast(wasStarting ? 'CAMERA START CANCELLED' : 'CAMERA DISCONNECTED');
}

startCameraButton.addEventListener('click', async () => {
  const token = ++cameraStartToken;
  cameraStarting = true;
  startCameraButton.disabled = true;
  cameraToggle.hidden = false;
  cameraToggle.textContent = 'CANCEL START';
  try {
    setStatus('LOADING VISION', 'linking');
    showToast('LOADING ON-DEVICE VISION');
    const activeTracker = await ensureTracker();
    if (token !== cameraStartToken) return;
    const started = await activeTracker.start();
    if (token !== cameraStartToken || !started) return;
    activateLive('hand');
    showToast('HAND LINK ESTABLISHED · YOUR FIELD IS LIVE', true);
  } catch (error) {
    console.warn('Camera could not start', error);
  } finally {
    if (token === cameraStartToken) {
      cameraStarting = false;
      startCameraButton.disabled = false;
      cameraToggle.hidden = activeMode !== 'hand';
      cameraToggle.textContent = 'CAMERA OFF';
    }
  }
});
el('start-demo').addEventListener('click', () => {
  activateLive('mouse');
  showToast(flightMode === 'dragon' ? 'MOVE TO STEER · CLICK TO BREATHE FIRE' : 'MOVE TO STEER · CLICK TO RELEASE A VOLLEY', true);
});
el('swarm-mode').addEventListener('click', () => setFlightMode('swarm', true));
el('dragon-mode').addEventListener('click', () => setFlightMode('dragon', true));
cameraToggle.addEventListener('click', () => stopCamera());

let previousPointerFrame = 0;
window.addEventListener('pointermove', event => {
  if (activeMode !== 'mouse' || event.timeStamp - previousPointerFrame < 16) return;
  previousPointerFrame = event.timeStamp;
  pointer = { x: event.clientX / window.innerWidth, y: event.clientY / window.innerHeight };
  world.steerMouse(pointer.x, pointer.y);
});
el('world').addEventListener('pointerdown', event => {
  if (activeMode !== 'mouse') return;
  if (world.getPaused()) { showToast('SIMULATION PAUSED · RESUME TO COMMAND'); return; }
  if (flightMode === 'dragon') {
    world.triggerDragonBreath();
    showToast('FORGE FLAME RELEASED', true);
    return;
  }
  const volley = world.launch({
    x: (event.clientX / window.innerWidth - .5) * 1.4,
    y: (.5 - event.clientY / window.innerHeight) * 1.1,
  });
  showToast(volley ? 'VOLLEY RELEASED · GATE ACQUIRED' : 'BLADES RETURNING · WAIT FOR THE SWARM', Boolean(volley));
});

document.querySelectorAll<HTMLButtonElement>('.formation-button').forEach(button => {
  button.addEventListener('click', () => setFormation(button.dataset.formation as Formation, true));
});
const pauseButton = el<HTMLButtonElement>('pause-toggle');
pauseButton.addEventListener('click', () => {
  const paused = !world.getPaused();
  world.setPaused(paused);
  pauseButton.innerHTML = paused ? '▶ &nbsp; RESUME' : 'Ⅱ &nbsp; PAUSE';
  pauseButton.classList.toggle('is-active', paused);
  showToast(paused ? 'SIMULATION PAUSED' : 'SIMULATION RESUMED');
});
el('reset-button').addEventListener('click', () => {
  if (flightMode === 'dragon') {
    world.resetDragon();
    showToast('DRAGON RECENTERED', true);
  } else {
    world.recall();
    setFormation('orbit');
    showToast('BLADES RETURNING TO YOUR HAND', true);
  }
});

const settingsPanel = el('settings-panel');
const guidePanel = el('guide-panel');
function openDrawer(drawer: HTMLElement) {
  const wasOpen = drawer.classList.contains('is-open');
  settingsPanel.classList.remove('is-open');
  guidePanel.classList.remove('is-open');
  settingsPanel.setAttribute('aria-hidden', 'true');
  guidePanel.setAttribute('aria-hidden', 'true');
  if (!wasOpen) {
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
  }
}
el('settings-toggle').addEventListener('click', () => openDrawer(settingsPanel));
el('guide-toggle').addEventListener('click', () => openDrawer(guidePanel));
document.querySelectorAll<HTMLButtonElement>('[data-close]').forEach(button => {
  button.addEventListener('click', () => {
    const drawer = button.dataset.close === 'settings' ? settingsPanel : guidePanel;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
  });
});
sensitivity.addEventListener('input', () => {
  const value = Number(sensitivity.value);
  el('sensitivity-value').textContent = `${value}%`;
  tracker?.setSensitivity(value / 100);
  world.setSensitivity(value / 100);
});
el<HTMLSelectElement>('quality-select').addEventListener('change', event => {
  world.setQuality((event.currentTarget as HTMLSelectElement).value as 'auto' | 'high' | 'balanced' | 'low');
  showToast('RENDER PROFILE UPDATED');
});
el('fullscreen-toggle').addEventListener('click', () => {
  if (!document.fullscreenElement) void document.documentElement.requestFullscreen?.();
  else void document.exitFullscreen?.();
});
window.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    settingsPanel.classList.remove('is-open');
    guidePanel.classList.remove('is-open');
    return;
  }
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement)?.tagName)) return;
  if (event.key === ' ') { event.preventDefault(); pauseButton.click(); }
  if (/^[1-5]$/.test(event.key)) setFormation(formationNames[Number(event.key) - 1], true);
  if (event.key.toLowerCase() === 'r') {
    if (flightMode === 'dragon') {
      world.resetDragon();
      showToast('DRAGON RECENTERED', true);
    } else {
      world.recall();
      showToast('BLADES RETURNING TO YOUR HAND', true);
    }
  }
  if (event.key.toLowerCase() === 'd') setFlightMode(flightMode === 'dragon' ? 'swarm' : 'dragon', true);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && (activeMode === 'hand' || cameraStarting)) stopCamera(false);
});
window.addEventListener('pagehide', () => {
  cameraStartToken++;
  cameraStarting = false;
  startCameraButton.disabled = false;
  tracker?.stop(false);
});

setFormation('orbit');
setFlightMode('swarm');
setStatus('FIELD IDLE');
