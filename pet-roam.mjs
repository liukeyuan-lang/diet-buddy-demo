// Presentation-only autonomous pet behavior. It owns timers/listeners and never writes application state.
const PREF_KEY = 'dietbuddy_public_demo_v1_pet_roam_enabled';
export const PET_ROAM_SPOTS = Object.freeze([
  Object.freeze({ name: 'rug', left: 49, top: 48, activity: 'rug-stretch' }),
  Object.freeze({ name: 'window', left: 73, top: 39, activity: 'window-look' }),
  Object.freeze({ name: 'nest', left: 25, top: 55, activity: 'nest-rest' }),
]);
const TURN_MS = 280;
const SETTLE_MS = 360;
const MIN_TRAVEL_MS = 1350;
const MAX_TRAVEL_MS = 2600;
const PET_ANCHOR_Y = 0.35;
let lastPosition = null;

function readEnabled() { try { return localStorage.getItem(PREF_KEY) !== 'false'; } catch { return true; } }
function writeEnabled(value) { try { localStorage.setItem(PREF_KEY, String(value)); } catch {} }

export function planRoamMove(from, to) {
  const start = from || PET_ROAM_SPOTS[0];
  const dx = Number(to.left) - Number(start.left);
  const dy = Number(to.top) - Number(start.top);
  const distance = Math.hypot(dx, dy);
  const travelMs = distance < 0.2 ? 0 : Math.round(Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, distance * 72)));
  return Object.freeze({
    direction: dx < 0 ? 'left' : 'right',
    distance,
    travelMs,
    stepMs: travelMs ? Math.round(Math.min(620, Math.max(440, travelMs / Math.max(3, Math.round(distance / 7))))) : 0,
  });
}

export function nearestRoamSpotIndex(point, spots = PET_ROAM_SPOTS) {
  if (!point) return 0;
  let bestIndex = 0;
  let bestDistance = Infinity;
  spots.forEach((spot, index) => {
    const distance = Math.hypot(Number(point.left) - spot.left, Number(point.top) - spot.top);
    if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
  });
  return bestIndex;
}

export function anchoredPositionFromRects(sceneRect, petRect, anchorY = PET_ANCHOR_Y) {
  if (!sceneRect?.width || !sceneRect?.height) return null;
  return Object.freeze({
    name: 'interrupted',
    left: ((petRect.left + petRect.width / 2 - sceneRect.left) / sceneRect.width) * 100,
    top: ((petRect.top + petRect.height * anchorY - sceneRect.top) / sceneRect.height) * 100,
    activity: '',
  });
}

export function reactionForInteraction(roamState, kind, spotActivity = '') {
  if (roamState === 'sleeping' || roamState === 'nest-rest' || spotActivity === 'nest-rest') return 'sleep-react';
  if (kind === 'petting') return 'petting';
  if (roamState === 'walking') return 'stop-look';
  return kind || 'tilt';
}

export function mountPetRoam(scene, { paused = false, resting = false, reacting = false, spots = PET_ROAM_SPOTS } = {}) {
  if (!scene) return () => {};
  const pet = scene.querySelector('[data-action="pet"]');
  const toggle = scene.querySelector('[data-action="pet-roam-toggle"]');
  if (!pet || !toggle) return () => {};

  let enabled = readEnabled();
  let stopped = paused || resting || !enabled;
  let reactingNow = reacting;
  let hidden = document.visibilityState === 'hidden';
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = Boolean(motionPreference?.matches);
  let timer = null;
  let phaseTimer = null;
  const roamSpots = Array.isArray(spots) && spots.length > 1 ? spots : PET_ROAM_SPOTS;
  const foundNestIndex = roamSpots.findIndex((spot) => spot.name === 'nest');
  const nestIndex = foundNestIndex < 0 ? roamSpots.length - 1 : foundNestIndex;
  let currentSpot = lastPosition || roamSpots[0];
  let lastSpotIndex = nearestRoamSpotIndex(currentSpot, roamSpots);
  let targetSpot = null;

  if (resting) {
    currentSpot = roamSpots[nestIndex];
    lastPosition = currentSpot;
    lastSpotIndex = nestIndex;
  }

  const updateToggle = () => {
    toggle.setAttribute('aria-pressed', String(enabled));
    toggle.textContent = enabled ? '⟳' : '⏸';
    toggle.setAttribute('aria-label', enabled ? '关闭宠物自主走动' : '开启宠物自主走动');
    toggle.title = enabled ? '关闭自主走动' : '开启自主走动';
  };
  const setState = (value) => { pet.dataset.roamState = value; };
  const setSpotActivity = (activity = '') => { pet.dataset.spotActivity = activity; };
  const placeAt = (spot) => {
    pet.style.left = `${spot.left}%`;
    pet.style.top = `${spot.top}%`;
    pet.dataset.petSpot = spot.name;
  };
  placeAt(currentSpot);

  const clear = () => {
    if (timer) window.clearTimeout(timer);
    if (phaseTimer) window.clearTimeout(phaseTimer);
    timer = null;
    phaseTimer = null;
  };

  const freezeAtCurrentPosition = () => {
    const point = anchoredPositionFromRects(scene.getBoundingClientRect(), pet.getBoundingClientRect());
    if (!point) return;
    pet.style.transition = 'none';
    placeAt(point);
    pet.getBoundingClientRect();
    pet.style.transition = '';
    currentSpot = point;
    lastPosition = point;
    lastSpotIndex = nearestRoamSpotIndex(point, roamSpots);
    targetSpot = null;
  };

  const nextSpot = () => {
    const currentIndex = nearestRoamSpotIndex(currentSpot, roamSpots);
    const candidates = roamSpots.map((_, index) => index).filter((index) => index !== currentIndex);
    const nextIndex = candidates[Math.floor(Math.random() * candidates.length)] ?? ((currentIndex + 1) % roamSpots.length);
    return { spot: roamSpots[nextIndex], index: nextIndex };
  };

  const schedule = () => {
    clear();
    stopped = paused || resting || !enabled;
    if (reactingNow) {
      setState(resting || currentSpot.activity === 'nest-rest' ? 'sleep-react' : 'reacting');
      timer = window.setTimeout(() => { reactingNow = false; schedule(); }, 760);
      return;
    }
    if (resting) {
      placeAt(roamSpots[nestIndex]);
      currentSpot = roamSpots[nestIndex];
      lastPosition = currentSpot;
      lastSpotIndex = nestIndex;
      setSpotActivity('nest-rest');
      setState('sleeping');
      return;
    }
    if (stopped || hidden || reduced) {
      setState('paused');
      setSpotActivity(currentSpot.activity || '');
      return;
    }
    setState('idle');
    setSpotActivity(currentSpot.activity || '');
    timer = window.setTimeout(() => {
      const next = nextSpot();
      const movement = planRoamMove(currentSpot, next.spot);
      if (!movement.travelMs) { currentSpot = next.spot; lastPosition = next.spot; lastSpotIndex = next.index; schedule(); return; }
      targetSpot = next.spot;
      setSpotActivity('');
      pet.dataset.turnTarget = movement.direction;
      pet.style.setProperty('--roam-duration', `${movement.travelMs}ms`);
      pet.style.setProperty('--step-duration', `${movement.stepMs}ms`);
      setState('turning');
      phaseTimer = window.setTimeout(() => {
        pet.dataset.direction = movement.direction;
        delete pet.dataset.turnTarget;
        setState('walking');
        placeAt(targetSpot);
        phaseTimer = window.setTimeout(() => {
          currentSpot = targetSpot;
          lastPosition = currentSpot;
          lastSpotIndex = next.index;
          targetSpot = null;
          setState('settling');
          phaseTimer = window.setTimeout(() => {
            setState('exploring');
            setSpotActivity(currentSpot.activity);
            timer = window.setTimeout(schedule, 1900 + Math.floor(Math.random() * 1600));
          }, SETTLE_MS);
        }, movement.travelMs);
      }, TURN_MS);
    }, 3200 + Math.floor(Math.random() * 4400));
  };

  const onToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    enabled = !enabled;
    writeEnabled(enabled);
    stopped = paused || resting || !enabled;
    if (stopped) {
      if (pet.dataset.roamState === 'walking') freezeAtCurrentPosition();
      clear();
      if (resting) { setState('sleeping'); setSpotActivity('nest-rest'); }
      else { setState('paused'); setSpotActivity(currentSpot.activity || ''); }
    } else schedule();
    updateToggle();
  };

  const onInteraction = (event) => {
    const priorState = pet.dataset.roamState;
    const priorActivity = pet.dataset.spotActivity;
    const inNest = resting || priorActivity === 'nest-rest' || (priorState !== 'walking' && currentSpot.activity === 'nest-rest');
    if (priorState === 'walking') freezeAtCurrentPosition();
    clear();
    setSpotActivity(inNest ? 'nest-rest' : '');
    setState(reactionForInteraction(priorState, event.detail?.kind, inNest ? 'nest-rest' : priorActivity));
    timer = window.setTimeout(schedule, event.detail?.kind === 'petting' ? 1250 : 820);
  };

  const pauseForLifecycle = () => {
    if (pet.dataset.roamState === 'walking') freezeAtCurrentPosition();
    clear();
    setState(resting ? 'sleeping' : 'paused');
    setSpotActivity(resting ? 'nest-rest' : currentSpot.activity || '');
  };
  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) pauseForLifecycle();
    else schedule();
  };
  const onMotionPreference = (event) => {
    reduced = Boolean(event.matches);
    if (reduced) pauseForLifecycle();
    else schedule();
  };

  toggle.addEventListener('click', onToggle);
  pet.addEventListener('pet-interaction', onInteraction);
  document.addEventListener('visibilitychange', onVisibility);
  motionPreference?.addEventListener?.('change', onMotionPreference);
  updateToggle();
  schedule();

  return () => {
    if (pet.dataset.roamState === 'walking') freezeAtCurrentPosition();
    clear();
    toggle.removeEventListener('click', onToggle);
    pet.removeEventListener('pet-interaction', onInteraction);
    document.removeEventListener('visibilitychange', onVisibility);
    motionPreference?.removeEventListener?.('change', onMotionPreference);
    setState(resting ? 'sleeping' : 'paused');
  };
}
