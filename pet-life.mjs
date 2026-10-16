// Presentation-only lively pet behavior for the soft home artwork. It owns
// timers/listeners only and never reads or writes task, meal, reward, or plan data.
const PREF_KEY = 'dietbuddy_public_demo_v1_pet_roam_enabled';
const TURN_MS = 260;
const SETTLE_MS = 320;
const SURFACE_ACTION_MS = 960;
const MIN_TRAVEL_MS = 1300;
const MAX_TRAVEL_MS = 2500;
const MIN_PIXEL_TRAVEL_MS = 520;
const MAX_PIXEL_TRAVEL_MS = 3200;
const WALK_SPEED_PX_PER_MS = 0.064;
const WALK_STRIDE_RATIO = 0.235;
const MIN_WALK_DISTANCE_PX = 12;
const MIN_STEP_MS = 520;
const MAX_STEP_MS = 720;
const MIN_SOFA_SCENE_HEIGHT = 360;
// Keep a perch stroll inside the visible cushion rather than making a second
// jump loop. Percentages are relative to the room, and are deliberately much
// smaller than the floor destinations.
const SOFA_STROLL_LIMIT = 4.5;
// The sofa cushion's foot line in the approved 853x1844 room backdrop. The
// backdrop uses object-fit: cover, so its visible y changes with both width and
// height; deriving the anchor from that same crop keeps the jump off the backrest.
const ROOM_ART_WIDTH = 853;
const ROOM_ART_HEIGHT = 1844;
const SOFA_CUSHION_Y = 770;
let lastPosition = null;

export const PET_LIFE_SPOTS = Object.freeze([
  Object.freeze({ name: 'rug', left: 51, top: 84, topCss: 'var(--floor-anchor)', activity: 'rug-groom', facing: 'right' }),
  Object.freeze({
    name: 'sofa', left: 38, top: 84, topCss: 'var(--floor-anchor)', activity: 'sofa-play', facing: 'right',
    perch: Object.freeze({ left: 35, top: 40, topCss: 'var(--sofa-seat-anchor)', surface: 'sofa' }),
  }),
  Object.freeze({ name: 'window', left: 72, top: 84, topCss: 'var(--floor-anchor)', activity: 'window-look', facing: 'right' }),
  Object.freeze({ name: 'meal', left: 35, top: 84, topCss: 'var(--floor-anchor)', activity: 'meal-look', facing: 'left' }),
  Object.freeze({ name: 'nest', left: 83, top: 78, topCss: 'var(--nest-pet-anchor)', activity: 'nest-rest', facing: 'right' }),
]);

function readEnabled() { try { return localStorage.getItem(PREF_KEY) !== 'false'; } catch { return true; } }
function writeEnabled(value) { try { localStorage.setItem(PREF_KEY, String(value)); } catch {} }

export function activePetLifeSpots(sceneRect, spots = PET_LIFE_SPOTS) {
  const height = Number(sceneRect?.height) || 0;
  const filtered = spots.filter((spot) => spot.name !== 'sofa' || height >= MIN_SOFA_SCENE_HEIGHT);
  return filtered.length > 1 ? filtered : spots.filter((spot) => spot.name !== 'sofa');
}

export function planPetLifeMove(from, to, geometry = null) {
  const start = from || PET_LIFE_SPOTS[0];
  const dx = Number(to.left) - Number(start.left);
  const dy = Number(to.top) - Number(start.top);
  const distance = Math.hypot(dx, dy);
  const sceneWidth = Number(geometry?.sceneWidth) || 0;
  const sceneHeight = Number(geometry?.sceneHeight) || 0;
  const measuredDistancePx = Number(geometry?.distancePx);
  const distancePx = Number.isFinite(measuredDistancePx) && measuredDistancePx > 0
    ? measuredDistancePx
    : sceneWidth > 0
      ? Math.hypot(dx * sceneWidth / 100, dy * (sceneHeight || sceneWidth) / 100)
      : 0;
  const preferredTravelMs = distance < 0.2 || (distancePx > 0 && distancePx < MIN_WALK_DISTANCE_PX)
    ? 0
    : distancePx > 0
      ? Math.round(Math.min(MAX_PIXEL_TRAVEL_MS, Math.max(MIN_PIXEL_TRAVEL_MS, distancePx / WALK_SPEED_PX_PER_MS)))
      : Math.round(Math.min(MAX_TRAVEL_MS, Math.max(MIN_TRAVEL_MS, distance * 68)));
  const petWidth = Number(geometry?.petWidth) || 156;
  const preferredCycles = distancePx > 0
    ? Math.max(1, Math.round(distancePx / Math.max(28, petWidth * WALK_STRIDE_RATIO)))
    : Math.max(2, Math.round(preferredTravelMs / 640));
  const cycleCandidates = Array.from({ length: 5 }, (_, index) => Math.max(1, preferredCycles - 2 + index));
  const timing = cycleCandidates.reduce((best, cycles) => {
    const stepMs = Math.round(Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, preferredTravelMs / cycles)));
    const travelMs = stepMs * cycles;
    const score = Math.abs(travelMs - preferredTravelMs) + Math.abs(cycles - preferredCycles) * 8;
    return !best || score < best.score ? { cycles, stepMs, travelMs, score } : best;
  }, null);
  return Object.freeze({
    direction: dx < 0 ? 'left' : 'right',
    distance,
    distancePx,
    travelMs: preferredTravelMs ? timing.travelMs : 0,
    stepMs: preferredTravelMs ? timing.stepMs : 0,
    cycles: preferredTravelMs ? timing.cycles : 0,
  });
}

export function anchoredPetLifePosition(sceneRect, petRect) {
  if (!sceneRect?.width || !sceneRect?.height) return null;
  return Object.freeze({
    name: 'interrupted',
    left: ((petRect.left + petRect.width / 2 - sceneRect.left) / sceneRect.width) * 100,
    top: ((petRect.bottom - sceneRect.top) / sceneRect.height) * 100,
    activity: '',
  });
}

export function sofaSeatAnchorPx(sceneRect, roomRect) {
  if (!sceneRect?.width || !sceneRect?.height || !roomRect?.width || !roomRect?.height) return null;
  const scale = Math.max(roomRect.width / ROOM_ART_WIDTH, roomRect.height / ROOM_ART_HEIGHT);
  const renderedTop = roomRect.top + (roomRect.height - ROOM_ART_HEIGHT * scale) / 2;
  const anchor = renderedTop + SOFA_CUSHION_Y * scale - sceneRect.top;
  return Math.round(anchor * 100) / 100;
}

export function petLifeReaction(roamState, kind, spotActivity = '') {
  if (roamState === 'sleeping' || spotActivity === 'nest-rest') return 'sleep-react';
  if (kind === 'groom' || kind === 'greet') return kind;
  if (roamState === 'walking' || roamState === 'arriving' || roamState === 'departing') return 'stop-look';
  return kind || 'greet';
}

function nearestSpotIndex(point, spots) {
  if (!point) return 0;
  let bestIndex = 0;
  let bestDistance = Infinity;
  spots.forEach((spot, index) => {
    const distance = Math.hypot(Number(point.left) - spot.left, Number(point.top) - spot.top);
    if (distance < bestDistance) { bestIndex = index; bestDistance = distance; }
  });
  return bestIndex;
}

export function mountPetLife(scene, { toggle: suppliedToggle = null, paused = false, resting = false, reacting = false, spots = PET_LIFE_SPOTS } = {}) {
  if (!scene) return () => {};
  const pet = scene.querySelector('[data-action="pet"]');
  const toggle = suppliedToggle || scene.querySelector('[data-action="pet-life-toggle"]');
  if (!pet || !toggle) return () => {};

  const lifeStage = pet.querySelector?.('.pet-life-stage');
  const lifeStatic = pet.querySelector?.('.pet-life-static');
  const lifeFrames = Array.from(pet.querySelectorAll?.('.pet-life-frame') || []);
  const petRender = lifeStage?.closest?.('.pet-render') || lifeStatic?.closest?.('.pet-render');
  const sceneRect = scene.getBoundingClientRect();
  const roomHome = scene.closest?.('.room-home');
  const syncSofaAnchor = () => {
    if (!scene.style?.setProperty || !roomHome?.getBoundingClientRect) return;
    const anchor = sofaSeatAnchorPx(scene.getBoundingClientRect(), roomHome.getBoundingClientRect());
    if (anchor !== null) scene.style.setProperty('--sofa-seat-anchor', `${anchor}px`);
  };
  syncSofaAnchor();
  let lifeSpots = activePetLifeSpots(sceneRect, spots);
  let nestIndex = Math.max(0, lifeSpots.findIndex((spot) => spot.name === 'nest'));
  let enabled = readEnabled();
  let hidden = document.visibilityState === 'hidden';
  let reactingNow = reacting;
  let assetFailed = false;
  let assetsReady = !lifeFrames.length || lifeFrames.every((frame) => frame.complete && frame.naturalWidth > 0);
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  let reduced = Boolean(motionPreference?.matches);
  let timer = null;
  let phaseTimer = null;
  const rememberedSpot = lastPosition && lifeSpots.find((spot) => spot.name === lastPosition.name);
  const resumeInterrupted = lastPosition?.name === 'interrupted';
  const resumeRemembered = Boolean(rememberedSpot || resumeInterrupted);
  const unavailableSofaPosition = lastPosition?.surface === 'sofa' && !lifeSpots.some((spot) => spot.name === 'sofa');
  let currentPosition = resumeRemembered && !unavailableSofaPosition ? lastPosition : lifeSpots[0];
  let currentSpot = resumeRemembered && !unavailableSofaPosition
    ? (rememberedSpot || (resumeInterrupted && lastPosition?.surface === 'sofa'
      ? lifeSpots.find((spot) => spot.name === 'sofa')
      : lastPosition))
    : lifeSpots[0];
  let currentSpotIndex = nearestSpotIndex(currentSpot, lifeSpots);
  let targetSpot = null;
  let sofaStrollDone = false;

  const showAssetSurface = () => {
    if (lifeStage) lifeStage.hidden = !assetsReady;
    if (lifeStatic && petRender?.dataset?.petLifeStaticFailed !== 'true') lifeStatic.hidden = assetsReady;
  };
  showAssetSurface();

  if (resting) {
    currentSpot = lifeSpots[nestIndex];
    currentPosition = currentSpot;
    currentSpotIndex = nestIndex;
    lastPosition = currentPosition;
  }

  const setState = (value) => { pet.dataset.roamState = value; };
  const setActivity = (value = '') => { pet.dataset.spotActivity = value; };
  const setTravelOffset = (x = 0, y = 0) => {
    pet.style.setProperty('--pet-life-travel-x', `${Number.isFinite(x) ? x : 0}px`);
    pet.style.setProperty('--pet-life-travel-y', `${Number.isFinite(y) ? y : 0}px`);
  };
  const placeAt = (position, spot = position) => {
    pet.style.left = `${position.left}%`;
    pet.style.top = position.topCss || `${position.top}%`;
    pet.dataset.petSpot = spot.name;
    if (position.surface) pet.dataset.petSurface = position.surface;
    else delete pet.dataset.petSurface;
  };
  const placeInitialPosition = () => {
    // A remounted button starts at the stylesheet's floor anchor. Commit a
    // remembered perch before transitions are enabled so reopening a drawer
    // never visibly travels from the floor back to the saved surface.
    pet.style.transition = 'none';
    placeAt(currentPosition, currentSpot);
    pet.getBoundingClientRect();
    pet.style.transition = '';
  };
  const clear = () => {
    if (timer) window.clearTimeout(timer);
    if (phaseTimer) window.clearTimeout(phaseTimer);
    timer = null;
    phaseTimer = null;
  };
  const updateToggle = () => {
    toggle.setAttribute('aria-pressed', String(enabled && !assetFailed));
    toggle.textContent = enabled && !assetFailed ? '🐾' : '⏸';
    toggle.setAttribute('aria-label', assetFailed ? '动作素材未加载，已恢复静态陪伴' : enabled ? '暂停团团的自主活动' : '开启团团的自主活动');
    toggle.title = assetFailed ? '已恢复静态陪伴' : enabled ? '暂停自主活动' : '开启自主活动';
    toggle.disabled = assetFailed;
  };
  const isMoving = () => ['walking', 'arriving', 'departing'].includes(pet.dataset.roamState);
  const remember = (position, spot) => {
    currentPosition = Object.freeze({ ...position, name: spot.name, activity: spot.activity });
    lastPosition = currentPosition;
  };
  const freeze = () => {
    const point = anchoredPetLifePosition(scene.getBoundingClientRect(), pet.getBoundingClientRect());
    if (!point) return;
    const onSofa = pet.dataset.petSurface === 'sofa';
    const frozenPosition = onSofa ? Object.freeze({ ...point, surface: 'sofa' }) : point;
    pet.style.transition = 'none';
    setTravelOffset();
    placeAt(frozenPosition, onSofa ? currentSpot : frozenPosition);
    pet.getBoundingClientRect();
    pet.style.transition = '';
    currentPosition = frozenPosition;
    if (!onSofa) currentSpot = frozenPosition;
    currentSpotIndex = nearestSpotIndex(frozenPosition, lifeSpots);
    targetSpot = null;
    lastPosition = frozenPosition;
  };
  const nextSpot = () => {
    const currentIndex = lifeSpots.findIndex((spot) => spot.name === currentSpot.name);
    const normalizedIndex = currentIndex < 0 ? nearestSpotIndex(currentSpot, lifeSpots) : currentIndex;
    const candidates = lifeSpots.map((_, index) => index).filter((index) => index !== normalizedIndex);
    const index = candidates[Math.floor(Math.random() * candidates.length)] ?? ((normalizedIndex + 1) % lifeSpots.length);
    return { spot: lifeSpots[index], index };
  };

  const schedule = () => {
    clear();
    if (assetFailed) return;
    if (!assetsReady) {
      setState('loading');
      setActivity('');
      return;
    }
    if (resting) {
      currentSpot = lifeSpots[nestIndex];
      currentPosition = currentSpot;
      currentSpotIndex = nestIndex;
      lastPosition = currentPosition;
      placeAt(currentSpot);
      setActivity('nest-rest');
      setState('sleeping');
      return;
    }
    if (paused || !enabled || hidden || reduced) {
      setState('paused');
      setActivity(currentSpot.activity || '');
      return;
    }
    if (reactingNow) {
      setState(currentSpot.activity === 'nest-rest' ? 'sleep-react' : 'reacting');
      timer = window.setTimeout(() => { reactingNow = false; schedule(); }, 1120);
      return;
    }

    const explore = (spot, index) => {
      currentSpot = spot;
      currentSpotIndex = index;
      targetSpot = null;
      if (spot.facing) pet.dataset.direction = spot.facing;
      setState('exploring');
      setActivity(spot.activity);
      const onSofa = spot.name === 'sofa' && currentPosition.surface === 'sofa';
      if (onSofa && !sofaStrollDone) {
        timer = window.setTimeout(() => strollOnSofa(spot, index), 1500 + Math.floor(Math.random() * 700));
      } else {
        timer = window.setTimeout(schedule, 2100 + Math.floor(Math.random() * 1500));
      }
    };
    const arrive = (spot, index) => {
      if (!spot.perch) {
        remember(spot, spot);
        explore(spot, index);
        return;
      }
      setActivity(spot.activity);
      setState('arriving');
      pet.style.setProperty('--roam-duration', `${SURFACE_ACTION_MS}ms`);
      placeAt(spot.perch, spot);
      phaseTimer = window.setTimeout(() => {
        remember(spot.perch, spot);
        sofaStrollDone = false;
        explore(spot, index);
      }, SURFACE_ACTION_MS);
    };
    const strollOnSofa = (spot, index) => {
      const perch = spot.perch;
      if (!perch || currentPosition.surface !== 'sofa') { explore(spot, index); return; }
      const liveSceneRect = scene.getBoundingClientRect();
      const livePetRect = pet.getBoundingClientRect();
      const offset = currentPosition.left <= perch.left ? SOFA_STROLL_LIMIT : -SOFA_STROLL_LIMIT;
      const targetPosition = Object.freeze({
        ...perch,
        name: 'sofa-stroll',
        activity: spot.activity,
        left: Math.max(perch.left - SOFA_STROLL_LIMIT, Math.min(perch.left + SOFA_STROLL_LIMIT, perch.left + offset)),
      });
      let movement = planPetLifeMove(currentPosition, targetPosition, {
        sceneWidth: liveSceneRect.width,
        sceneHeight: liveSceneRect.height,
        petWidth: livePetRect.width,
      });
      if (!movement.travelMs) { sofaStrollDone = true; explore(spot, index); return; }
      targetSpot = spot;
      setActivity(spot.activity);
      pet.dataset.turnTarget = movement.direction;
      pet.style.setProperty('--roam-duration', `${movement.travelMs}ms`);
      pet.style.setProperty('--step-duration', `${movement.stepMs}ms`);
      setState('turning');
      phaseTimer = window.setTimeout(() => {
        pet.dataset.direction = movement.direction;
        delete pet.dataset.turnTarget;
        const fromRect = pet.getBoundingClientRect();
        pet.style.transition = 'none';
        placeAt(targetPosition, spot);
        const toRect = pet.getBoundingClientRect();
        const travelX = fromRect.left - toRect.left;
        const travelY = fromRect.bottom - toRect.bottom;
        const measuredDistancePx = Math.hypot(travelX, travelY);
        if (measuredDistancePx > 0.5) {
          movement = planPetLifeMove(currentPosition, targetPosition, { distancePx: measuredDistancePx, petWidth: fromRect.width });
          pet.style.setProperty('--roam-duration', `${movement.travelMs}ms`);
          pet.style.setProperty('--step-duration', `${movement.stepMs}ms`);
        }
        setTravelOffset(travelX, travelY);
        setState('walking');
        pet.getBoundingClientRect();
        pet.style.transition = '';
        setTravelOffset();
        phaseTimer = window.setTimeout(() => {
          remember(targetPosition, spot);
          targetSpot = null;
          sofaStrollDone = true;
          explore(spot, index);
        }, movement.travelMs);
      }, TURN_MS);
    };
    const startTravel = (next) => {
      const liveSceneRect = scene.getBoundingClientRect();
      const livePetRect = pet.getBoundingClientRect();
      let movement = planPetLifeMove(currentSpot, next.spot, {
        sceneWidth: liveSceneRect.width,
        sceneHeight: liveSceneRect.height,
        petWidth: livePetRect.width,
      });
      if (!movement.travelMs) { arrive(next.spot, next.index); return; }
      targetSpot = next.spot;
      setActivity('');
      pet.dataset.turnTarget = movement.direction;
      pet.style.setProperty('--roam-duration', `${movement.travelMs}ms`);
      pet.style.setProperty('--step-duration', `${movement.stepMs}ms`);
      setState('turning');
      phaseTimer = window.setTimeout(() => {
        pet.dataset.direction = movement.direction;
        delete pet.dataset.turnTarget;
        // FLIP the button onto its destination layout, then animate only the
        // compositor transform. This keeps the visible foot at its real start
        // point without continuously laying out 24 decoded candidate images.
        const fromRect = pet.getBoundingClientRect();
        pet.style.transition = 'none';
        placeAt(targetSpot, targetSpot);
        const toRect = pet.getBoundingClientRect();
        const travelX = fromRect.left - toRect.left;
        const travelY = fromRect.bottom - toRect.bottom;
        const measuredDistancePx = Math.hypot(travelX, travelY);
        if (measuredDistancePx > 0.5) {
          movement = planPetLifeMove(currentSpot, targetSpot, {
            distancePx: measuredDistancePx,
            petWidth: fromRect.width,
          });
          pet.style.setProperty('--roam-duration', `${movement.travelMs}ms`);
          pet.style.setProperty('--step-duration', `${movement.stepMs}ms`);
        }
        setTravelOffset(travelX, travelY);
        setState('walking');
        pet.getBoundingClientRect();
        pet.style.transition = '';
        setTravelOffset();
        phaseTimer = window.setTimeout(() => {
          currentSpot = targetSpot;
          currentPosition = currentSpot;
          lastPosition = currentPosition;
          targetSpot = null;
          setState('settling');
          phaseTimer = window.setTimeout(() => arrive(currentSpot, next.index), SETTLE_MS);
        }, movement.travelMs);
      }, TURN_MS);
    };
    const leaveSurfaceThenTravel = (next) => {
      if (!currentSpot.perch || currentPosition.surface !== currentSpot.perch.surface) { startTravel(next); return; }
      setActivity(currentSpot.activity);
      setState('departing');
      pet.style.setProperty('--roam-duration', `${SURFACE_ACTION_MS}ms`);
      placeAt(currentSpot, currentSpot);
      phaseTimer = window.setTimeout(() => {
        remember(currentSpot, currentSpot);
        startTravel(next);
      }, SURFACE_ACTION_MS);
    };

    setState('idle');
    setActivity(currentSpot.activity || '');
    timer = window.setTimeout(() => leaveSurfaceThenTravel(nextSpot()), 3000 + Math.floor(Math.random() * 3600));
  };

  const pauseAtCurrentPosition = () => {
    if (isMoving()) freeze();
    clear();
    setState(resting ? 'sleeping' : 'paused');
    setActivity(resting ? 'nest-rest' : currentSpot.activity || '');
  };
  const onResize = () => {
    syncSofaAnchor();
    const nextLifeSpots = activePetLifeSpots(scene.getBoundingClientRect(), spots);
    const sofaRemoved = !nextLifeSpots.some((spot) => spot.name === 'sofa');
    const wasUsingSofa = currentSpot?.name === 'sofa' || targetSpot?.name === 'sofa' || pet.dataset.petSpot === 'sofa';
    lifeSpots = nextLifeSpots;
    nestIndex = Math.max(0, lifeSpots.findIndex((spot) => spot.name === 'nest'));
    if (!sofaRemoved || !wasUsingSofa) return;
    clear();
    const floorSpot = lifeSpots.find((spot) => spot.name === 'rug') || lifeSpots[0];
    pet.style.transition = 'none';
    setTravelOffset();
    currentSpot = floorSpot;
    currentPosition = floorSpot;
    currentSpotIndex = lifeSpots.indexOf(floorSpot);
    targetSpot = null;
    placeAt(floorSpot, floorSpot);
    pet.getBoundingClientRect();
    pet.style.transition = '';
    lastPosition = floorSpot;
    schedule();
  };
  const onToggle = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (assetFailed) return;
    enabled = !enabled;
    writeEnabled(enabled);
    if (!enabled) pauseAtCurrentPosition();
    else schedule();
    updateToggle();
  };
  const onInteraction = (event) => {
    const priorState = pet.dataset.roamState;
    const priorActivity = pet.dataset.spotActivity;
    if (isMoving()) freeze();
    clear();
    const inNest = resting || priorActivity === 'nest-rest' || currentSpot.activity === 'nest-rest';
    setActivity(inNest ? 'nest-rest' : '');
    setState(petLifeReaction(priorState, event.detail?.kind, inNest ? 'nest-rest' : priorActivity));
    timer = window.setTimeout(schedule, event.detail?.kind === 'groom' ? 1320 : 1060);
  };
  const onVisibility = () => {
    hidden = document.visibilityState === 'hidden';
    if (hidden) pauseAtCurrentPosition();
    else schedule();
  };
  const onMotionPreference = (event) => {
    reduced = Boolean(event.matches);
    if (reduced) pauseAtCurrentPosition();
    else schedule();
  };
  const onAssetFailure = () => {
    assetFailed = true;
    assetsReady = false;
    if (isMoving()) freeze();
    clear();
    lastPosition = null;
    setTravelOffset();
    pet.removeAttribute?.('style');
    delete pet.dataset.petSpot;
    delete pet.dataset.petSurface;
    setActivity('');
    setState('asset-fallback');
    showAssetSurface();
    updateToggle();
  };
  const onFrameLoad = () => {
    if (assetFailed || assetsReady) return;
    assetsReady = lifeFrames.every((frame) => frame.complete && frame.naturalWidth > 0);
    if (!assetsReady) return;
    showAssetSurface();
    schedule();
  };

  toggle.addEventListener('click', onToggle);
  pet.addEventListener('pet-interaction', onInteraction);
  pet.addEventListener('pet-life-assets-failed', onAssetFailure);
  lifeFrames.forEach((frame) => frame.addEventListener?.('load', onFrameLoad));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener?.('resize', onResize);
  motionPreference?.addEventListener?.('change', onMotionPreference);
  updateToggle();
  placeInitialPosition();
  schedule();
  if (lifeFrames.some((frame) => frame.complete && frame.naturalWidth === 0)) onAssetFailure();

  return () => {
    if (isMoving()) freeze();
    clear();
    toggle.removeEventListener('click', onToggle);
    pet.removeEventListener('pet-interaction', onInteraction);
    pet.removeEventListener('pet-life-assets-failed', onAssetFailure);
    lifeFrames.forEach((frame) => frame.removeEventListener?.('load', onFrameLoad));
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener?.('resize', onResize);
    motionPreference?.removeEventListener?.('change', onMotionPreference);
    setState(resting ? 'sleeping' : assetFailed ? 'asset-fallback' : 'paused');
  };
}
