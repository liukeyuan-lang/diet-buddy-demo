export const SCHEMA_VERSION = 6;
// Public demo storage is isolated from the private/full application and from
// earlier prototypes that may share the same browser origin.
export const REAL_KEY = 'dietbuddy_public_demo_v1_state';
export const DEMO_KEY = 'dietbuddy_public_demo_v1_state';
export const LEGACY_KEY = 'dietbuddy_public_demo_v1_no_legacy_import';
export const TASK_STATUSES = ['unknown', 'completed', 'partial', 'missed', 'adjusted', 'paused'];

export function uid(prefix = 'id', now = Date.now) {
  const random = globalThis.crypto?.randomUUID?.() || `${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${random}`;
}

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseLocalDate(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addLocalDays(key, amount) {
  const date = parseLocalDate(key);
  date.setDate(date.getDate() + amount);
  return localDateKey(date);
}

export function dayIndex(startDate, dateKey) {
  const start = parseLocalDate(startDate);
  const current = parseLocalDate(dateKey);
  return Math.round((current - start) / 86400000);
}

export function isoNow(now = () => new Date()) {
  return now().toISOString();
}

export function taskTypeForIndex(index) {
  if (index === 6) return 'review';
  return index % 2 === 0 ? 'diet' : 'activity';
}

export function makePlan({ mode = 'real', startDate = localDateKey(), petName = '团团', focus = 'veggie', movement = 'walk', duration = 15, now = () => new Date() } = {}) {
  const createdAt = isoNow(now);
  const planId = uid('plan');
  const version = uid('planv');
  const plan = {
    id: planId,
    version,
    createdAt,
    effectiveFrom: startDate,
    startDate,
    petName,
    focus,
    movement,
    duration: Number(duration),
    mode,
    source: mode === 'demo' ? 'demo-setup' : 'user-setup',
  };
  const tasks = Array.from({ length: 7 }, (_, index) => {
    const type = taskTypeForIndex(index);
    return {
      id: uid('task'),
      planId,
      planVersion: version,
      date: addLocalDays(startDate, index),
      dayIndex: index,
      type,
      target: type === 'diet' ? focus : type === 'activity' ? { movement, minutes: Number(duration) } : 'week-review',
      status: 'unknown',
      statusSource: 'system',
      statusUpdatedAt: null,
      requiresReconfirm: false,
      createdAt,
      source: 'plan-generated',
    };
  });
  return { plan, tasks };
}

export function initialState(options = {}) {
  const now = options.now || (() => new Date());
  const startDate = options.startDate || localDateKey(now());
  const mode = options.mode || 'real';
  const { plan, tasks } = makePlan({ ...options, mode, startDate, now });
  return {
    schemaVersion: SCHEMA_VERSION,
    mode,
    createdAt: isoNow(now),
    updatedAt: isoNow(now),
    setupComplete: Boolean(options.setupComplete),
    activePlanId: plan.id,
    plans: [plan],
    tasks,
    meals: [],
    bodyMeasurements: [],
    mealTemplates: [],
    activities: [],
    petEvents: [],
    rewardLedger: [],
    weekReviews: [],
    pauses: [],
    memories: [],
    nextWeekDraft: null,
    timer: { running: false, startedAt: null, elapsedMs: 0, draftId: uid('timer') },
    drafts: { meal: {}, activity: {}, bodyMeasurement: {} },
    settings: { dailyCalorieTarget: null },
    ui: { view: 'home', demoDayIndex: 0 },
  };
}

export function validateState(raw, mode = 'real') {
  if (!raw || raw.schemaVersion !== SCHEMA_VERSION || raw.mode !== mode) return null;
  const arrays = ['plans', 'tasks', 'meals', 'activities', 'petEvents', 'rewardLedger', 'weekReviews', 'pauses'];
  if (arrays.some((key) => !Array.isArray(raw[key]))) return null;
  raw.bodyMeasurements = Array.isArray(raw.bodyMeasurements)
    ? raw.bodyMeasurements.map(normalizeBodyMeasurement).filter(Boolean).slice(0, 1000)
    : [];
  raw.drafts = { meal: {}, activity: {}, bodyMeasurement: {}, ...(raw.drafts || {}) };
  raw.mealTemplates = Array.isArray(raw.mealTemplates)
    ? raw.mealTemplates.map(normalizeMealTemplate).filter(Boolean).slice(0, 50)
    : [];
  raw.settings = { dailyCalorieTarget: null, ...(raw.settings || {}) };
  return raw;
}

// These measurements are deliberately local, optional observations. They are
// never used for task settlement, rewards, pet appearance, or health claims.
function bodyValue(value, max) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= max ? number : null;
}

export function normalizeBodyMeasurement(raw) {
  const date = String(raw?.date || '');
  if (!raw || typeof raw !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || localDateKey(parseLocalDate(date)) !== date) return null;
  const weightKg = bodyValue(raw.weightKg, 500);
  const waistCm = bodyValue(raw.waistCm, 300);
  const hipCm = bodyValue(raw.hipCm, 400);
  if (weightKg === null && waistCm === null && hipCm === null) return null;
  return {
    id: String(raw.id || uid('body')).slice(0, 120),
    date,
    weightKg,
    waistCm,
    hipCm,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

export function bodyMeasurementSnapshot(records) {
  const ordered = [...(records || [])].sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt.localeCompare(b.updatedAt));
  const metric = (key) => {
    const measured = ordered.filter((item) => Number.isFinite(item[key]));
    const latest = measured.at(-1) || null;
    const prior = measured.length > 1 ? measured.at(-2) : null;
    return { latest, prior, change: latest && prior ? latest[key] - prior[key] : null };
  };
  return { weightKg: metric('weightKg'), waistCm: metric('waistCm'), hipCm: metric('hipCm') };
}

const NUTRIENTS = Object.freeze(['kcal', 'protein', 'carbs', 'fat']);

function finiteRange(value) {
  if (!value || value.min === null || value.min === undefined || value.min === ''
    || value.max === null || value.max === undefined || value.max === '') return null;
  const min = Number(value?.min);
  const max = Number(value?.max);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < 0) return null;
  return { min: Math.min(min, max), max: Math.max(min, max) };
}

function mealNutritionRanges(meal) {
  const estimate = meal?.nutritionEstimate;
  const historicalPartial = Boolean(estimate?.range && !estimate?.estimatorVersion
    && (estimate?.unmappedIngredients?.length || estimate?.missingPortions?.length));
  const explicitlyPartial = estimate?.estimateKind === 'partial-subtotal' || historicalPartial;
  const source = explicitlyPartial ? (estimate?.partialRange || estimate?.range) : (estimate?.macroRange || estimate?.range);
  const ranges = Object.fromEntries(NUTRIENTS.map((key) => [key, finiteRange(source?.[key])]));
  const hasAny = NUTRIENTS.some((key) => ranges[key]);
  const hasMacro = ['protein', 'carbs', 'fat'].some((key) => ranges[key]);
  const completeMacros = !explicitlyPartial && ['protein', 'carbs', 'fat'].every((key) => ranges[key]);
  return { ranges, hasAny, hasMacro, completeMacros, explicitlyPartial };
}

function addRange(target, range) {
  if (!range) return;
  target.min += range.min;
  target.max += range.max;
}

// A day is complete only when every saved meal has a whole-meal macro range.
// Otherwise numeric values are labelled known subtotals; meals without data are
// counted separately and never contribute a synthetic zero.
export function dailyNutritionSummary(state, date) {
  const meals = (state?.meals || []).filter((meal) => meal.date === date);
  const knownSubtotal = Object.fromEntries(NUTRIENTS.map((key) => [key, { min: 0, max: 0 }]));
  const knownCounts = Object.fromEntries(NUTRIENTS.map((key) => [key, 0]));
  let completeMeals = 0;
  let partialMeals = 0;
  let unknownMeals = 0;
  let unmappedIngredients = 0;
  let missingPortions = 0;

  for (const meal of meals) {
    const parsed = mealNutritionRanges(meal);
    if (parsed.completeMacros) completeMeals += 1;
    else if (parsed.hasMacro) partialMeals += 1;
    else unknownMeals += 1;
    for (const nutrient of NUTRIENTS) {
      if (!parsed.ranges[nutrient]) continue;
      addRange(knownSubtotal[nutrient], parsed.ranges[nutrient]);
      knownCounts[nutrient] += 1;
    }
    const lines = [...(meal.ingredients || []), ...(meal.fatsAndSauces || [])];
    if (lines.length) {
      unmappedIngredients += lines.filter((line) => !line?.foodKey || line.foodKey === 'unknown').length;
      missingPortions += lines.filter((line) => line?.foodKey && line.foodKey !== 'unknown'
        && (line.gramsMin == null || line.gramsMax == null)).length;
    } else {
      unmappedIngredients += estimateCount(meal?.nutritionEstimate?.unmappedIngredients);
      missingPortions += estimateCount(meal?.nutritionEstimate?.missingPortions);
    }
  }

  for (const nutrient of NUTRIENTS) {
    if (!knownCounts[nutrient]) knownSubtotal[nutrient] = null;
  }
  const complete = meals.length > 0 && completeMeals === meals.length;
  return {
    date,
    status: !meals.length ? 'no-record' : complete ? 'complete' : knownCounts.protein || knownCounts.carbs || knownCounts.fat ? 'partial' : 'unavailable',
    mealCount: meals.length,
    completeMeals,
    partialMeals,
    unknownMeals,
    unmappedIngredients,
    missingPortions,
    macroRange: complete ? {
      protein: knownSubtotal.protein,
      carbs: knownSubtotal.carbs,
      fat: knownSubtotal.fat,
    } : null,
    knownSubtotal,
    knownCounts,
  };
}

function estimateCount(value) {
  return Array.isArray(value) ? value.length : 0;
}

export function nutritionWeekTrend(state, endDate) {
  return Array.from({ length: 7 }, (_, index) => dailyNutritionSummary(state, addLocalDays(endDate, index - 6)));
}

function cleanTemplateLine(raw) {
  const finiteGrams = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.min(3000, parsed)) : null;
  };
  const a = finiteGrams(raw?.gramsMin);
  const b = finiteGrams(raw?.gramsMax);
  return {
    name: String(raw?.name || '').trim().slice(0, 80),
    foodKey: String(raw?.foodKey || 'unknown').slice(0, 60),
    gramsMin: a === null || b === null ? null : Math.min(a, b),
    gramsMax: a === null || b === null ? null : Math.max(a, b),
    confidence: ['high', 'medium', 'low'].includes(raw?.confidence) ? raw.confidence : 'low',
    origin: ['ai-suggested', 'user-edited'].includes(raw?.origin) ? raw.origin : 'unknown',
  };
}

export function normalizeMealTemplate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const food = String(raw.food || '').trim().slice(0, 80);
  if (!food) return null;
  const portionScale = Number(raw.portionScale);
  return {
    id: String(raw.id || uid('meal-template')).slice(0, 120),
    name: String(raw.name || food).trim().slice(0, 80) || food,
    food,
    mealType: ['breakfast', 'lunch', 'dinner', 'snack'].includes(raw.mealType) ? raw.mealType : 'snack',
    portion: String(raw.portion || '').trim().slice(0, 120),
    cookingMethod: ['unknown', 'pan_fried', 'steamed', 'deep_fried'].includes(raw.cookingMethod) ? raw.cookingMethod : 'unknown',
    portionScale: Number.isFinite(portionScale) ? Math.max(10, Math.min(300, portionScale)) : 100,
    ingredients: (Array.isArray(raw.ingredients) ? raw.ingredients : []).slice(0, 40).map(cleanTemplateLine),
    fatsAndSauces: (Array.isArray(raw.fatsAndSauces) ? raw.fatsAndSauces : []).slice(0, 40).map(cleanTemplateLine),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
  };
}

// Deliberately excludes photoId, AI analysis, nutrition snapshots, notes and
// confirmation/reward identifiers. The template is an independent editable
// snapshot and remains valid if its source meal is edited or deleted.
export function createMealTemplate(input, options = {}) {
  return normalizeMealTemplate({
    id: options.id || uid('meal-template'),
    name: options.name || input?.food,
    food: input?.food,
    mealType: input?.mealType,
    portion: input?.portion,
    cookingMethod: input?.cookingMethod,
    portionScale: input?.portionScale,
    ingredients: input?.ingredients,
    fatsAndSauces: input?.fatsAndSauces,
    createdAt: options.at,
    updatedAt: options.at,
  });
}

export function draftFromMealTemplate(template, portionPercent = 100, submissionId = uid('meal-submit')) {
  const clean = normalizeMealTemplate(template);
  if (!clean) return null;
  const percent = Number(portionPercent);
  const relative = Number.isFinite(percent) ? Math.max(10, Math.min(300, percent)) : 100;
  return {
    clientSubmissionId: submissionId,
    food: clean.food,
    mealType: clean.mealType,
    portion: clean.portion,
    cookingMethod: clean.cookingMethod,
    portionScale: Math.max(10, Math.min(300, clean.portionScale * relative / 100)),
    notes: '',
    practice: 'unknown',
    ingredients: structuredClone(clean.ingredients),
    fatsAndSauces: structuredClone(clean.fatsAndSauces),
    aiAnalysis: null,
    nutritionEstimate: null,
    existingPhotoId: null,
    photoChanged: false,
    removePhoto: false,
  };
}

export function todayMealSummary(state, date) {
  const meals = state.meals.filter((meal) => meal.date === date);
  let kcalMin = 0;
  let kcalMax = 0;
  let rangedMeals = 0;
  let unconfirmedIngredients = 0;
  for (const meal of meals) {
    const estimate = meal.nutritionEstimate;
    const partial = estimate?.estimateKind === 'partial-subtotal'
      || (!estimate?.estimatorVersion && Boolean(estimate?.unmappedIngredients?.length || estimate?.missingPortions?.length));
    const range = !partial ? estimate?.range?.kcal : null;
    if (range && Number.isFinite(Number(range.min)) && Number.isFinite(Number(range.max))) {
      kcalMin += Number(range.min);
      kcalMax += Number(range.max);
      rangedMeals += 1;
    }
    const lines = [...(meal.ingredients || []), ...(meal.fatsAndSauces || [])];
    unconfirmedIngredients += lines.length
      ? lines.filter((line) => line.foodKey === 'unknown' || line.gramsMin == null || line.gramsMax == null).length
      : Math.max(estimate?.unmappedIngredients?.length || 0, estimate?.missingPortions?.length || 0);
  }
  const target = Number(state.settings?.dailyCalorieTarget);
  return {
    mealCount: meals.length,
    unconfirmedIngredients,
    remainingRange: Number.isFinite(target) && target > 0 && meals.length && rangedMeals === meals.length
      ? { min: target - kcalMax, max: target - kcalMin }
      : null,
    kcalRange: rangedMeals === meals.length && meals.length ? { min: kcalMin, max: kcalMax } : null,
  };
}

export function activePlan(state) {
  return state.plans.find((plan) => plan.id === state.activePlanId) || state.plans.at(-1);
}

export function taskForDate(state, date) {
  return state.tasks.find((task) => task.date === date) || null;
}

export function isDatePaused(state, date) {
  return state.pauses.some((pause) => date >= pause.startDate && date <= pause.endDate && !pause.resumedDates?.includes(date));
}

export function visibleTaskStatus(state, task) {
  if (!task) return 'unknown';
  if (task.status === 'completed') return 'completed';
  if (isDatePaused(state, task.date)) return 'paused';
  return task.status;
}

export function setTaskStatus(state, taskId, status, source = 'user', at = new Date().toISOString()) {
  if (!TASK_STATUSES.includes(status)) throw new Error(`Invalid task status: ${status}`);
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  task.status = status;
  task.statusSource = source;
  task.statusUpdatedAt = at;
  task.requiresReconfirm = false;
  return task;
}

export function addRewardOnce(state, { eventId, kind, domain, taskId = null, recordId = null, at = new Date().toISOString() }) {
  const existing = state.rewardLedger.find((entry) => entry.eventId === eventId);
  if (existing) return { awarded: false, reward: existing };
  const reward = { id: uid('reward'), eventId, kind, domain, taskId, recordId, createdAt: at, source: 'local-settlement' };
  state.rewardLedger.push(reward);
  return { awarded: true, reward };
}

export function settleTaskReward(state, task, at = new Date().toISOString()) {
  if (!task || task.status !== 'completed' || !['diet', 'activity'].includes(task.type)) return { awarded: false, reward: null };
  return addRewardOnce(state, {
    eventId: `task-completed:${task.id}`,
    kind: 'main-task',
    domain: task.type,
    taskId: task.id,
    at,
  });
}

export function settleRecordSticker(state, domain, recordId, at = new Date().toISOString()) {
  return addRewardOnce(state, {
    eventId: `record-sticker:${recordId}`,
    kind: 'sticker',
    domain,
    recordId,
    at,
  });
}

// A stable clientSubmissionId belongs to one explicit confirmation action. It
// prevents a network retry, double submit, or restored draft from creating a
// second Meal. Existing V0.6 meals remain valid without this optional field.
export function commitMealOnce(state, input, at = new Date().toISOString()) {
  const clientSubmissionId = String(input?.clientSubmissionId || '').trim();
  if (!clientSubmissionId) throw new Error('Meal clientSubmissionId is required');
  const existing = state.meals.find((item) => item.clientSubmissionId === clientSubmissionId);
  if (existing) return { created: false, meal: existing };
  const meal = {
    id: input.id || uid('meal'),
    date: input.date,
    food: String(input.food || '').trim(),
    mealType: ['breakfast', 'lunch', 'dinner', 'snack'].includes(input.mealType) ? input.mealType : 'snack',
    portion: String(input.portion || '').trim(),
    portionScale: Number(input.portionScale) || 100,
    notes: String(input.notes || '').trim(),
    actionPractice: input.actionPractice || 'unknown',
    ingredients: Array.isArray(input.ingredients) ? input.ingredients : [],
    fatsAndSauces: Array.isArray(input.fatsAndSauces) ? input.fatsAndSauces : [],
    aiAnalysis: input.aiAnalysis || null,
    nutritionEstimate: input.nutritionEstimate || null,
    source: input.source || 'manual',
    planVersion: input.planVersion,
    photoId: input.photoId || null,
    clientSubmissionId,
    createdAt: at,
    updatedAt: at,
  };
  state.meals.push(meal);
  return { created: true, meal };
}

export function activityMinutesForDate(state, date, task = taskForDate(state, date)) {
  if (!task || task.type !== 'activity') return 0;
  const targetMovement = task.target?.movement;
  return state.activities
    .filter((item) => item.date === date && Number(item.minutes) > 0 && (targetMovement === 'other' || item.type === targetMovement))
    .reduce((sum, item) => sum + Number(item.minutes), 0);
}

export function deriveActivityStatus(minutes, target) {
  const actual = Number(minutes) || 0;
  const goal = Math.max(1, Number(target) || 1);
  if (actual <= 0) return 'unknown';
  return actual >= goal ? 'completed' : 'partial';
}

export function reconcileActivityTask(state, date, at = new Date().toISOString()) {
  const task = taskForDate(state, date);
  if (!task || task.type !== 'activity' || isDatePaused(state, date)) return { task, awarded: false };
  const minutes = activityMinutesForDate(state, date, task);
  const next = deriveActivityStatus(minutes, task.target.minutes);
  setTaskStatus(state, task.id, next, 'activity-total', at);
  const result = settleTaskReward(state, task, at);
  return { task, awarded: result.awarded, minutes };
}

export function invalidateDietConfirmation(state, date, at = new Date().toISOString()) {
  const task = taskForDate(state, date);
  if (!task || task.type !== 'diet' || task.status === 'unknown' || task.status === 'paused') return task;
  task.status = 'unknown';
  task.statusSource = 'record-changed';
  task.statusUpdatedAt = at;
  task.requiresReconfirm = true;
  return task;
}

export function pauseDates(state, startDate, count, at = new Date().toISOString()) {
  const pause = {
    id: uid('pause'),
    startDate,
    endDate: addLocalDays(startDate, Math.max(1, count) - 1),
    createdAt: at,
    resumedDates: [],
    source: 'user-rest',
  };
  state.pauses.push(pause);
  state.tasks.forEach((task) => {
    if (task.date < pause.startDate || task.date > pause.endDate || task.status === 'completed') return;
    task.status = 'paused';
    task.statusSource = 'pause';
    task.statusUpdatedAt = at;
  });
  return pause;
}

export function resumeDate(state, date, at = new Date().toISOString()) {
  state.pauses.forEach((pause) => {
    if (date >= pause.startDate && date <= pause.endDate && !pause.resumedDates.includes(date)) pause.resumedDates.push(date);
  });
  const task = taskForDate(state, date);
  if (task?.status === 'paused') {
    task.status = 'unknown';
    task.statusSource = 'resume';
    task.statusUpdatedAt = at;
  }
  return task;
}

export function updateFuturePlan(state, fromDate, changes, at = new Date().toISOString()) {
  const current = activePlan(state);
  const version = uid('planv');
  const next = { ...current, ...changes, version, effectiveFrom: fromDate, createdAt: at, id: uid('plan') };
  state.plans.push(next);
  state.activePlanId = next.id;
  state.tasks.forEach((task) => {
    if (task.date < fromDate || task.status !== 'unknown') return;
    task.planId = next.id;
    task.planVersion = version;
    if (task.type === 'diet') task.target = next.focus;
    if (task.type === 'activity') task.target = { movement: next.movement, minutes: Number(next.duration) };
  });
  return next;
}

export function timerElapsedMs(timer, nowMs = Date.now()) {
  if (!timer?.running || !timer.startedAt) return Math.max(0, Number(timer?.elapsedMs) || 0);
  return Math.max(0, Number(timer.elapsedMs) || 0) + Math.max(0, nowMs - new Date(timer.startedAt).getTime());
}

export function startTimer(timer, at = new Date().toISOString()) {
  if (timer.running) return timer;
  timer.running = true;
  timer.startedAt = at;
  return timer;
}

export function pauseTimer(timer, at = new Date().toISOString()) {
  if (!timer.running) return timer;
  timer.elapsedMs = timerElapsedMs(timer, new Date(at).getTime());
  timer.running = false;
  timer.startedAt = null;
  return timer;
}

export function resetTimer(timer) {
  timer.running = false;
  timer.startedAt = null;
  timer.elapsedMs = 0;
  timer.draftId = uid('timer');
  return timer;
}

export function weekSummary(state) {
  const tasks = state.tasks.slice().sort((a, b) => a.date.localeCompare(b.date));
  const statuses = Object.fromEntries(TASK_STATUSES.map((status) => [status, 0]));
  tasks.filter((task) => task.type !== 'review').forEach((task) => { statuses[visibleTaskStatus(state, task)] += 1; });
  const evaluable = statuses.completed + statuses.partial + statuses.missed;
  const dietCompleted = tasks.filter((task) => task.type === 'diet' && visibleTaskStatus(state, task) === 'completed').length;
  const activityCompleted = tasks.filter((task) => task.type === 'activity' && visibleTaskStatus(state, task) === 'completed').length;
  const totalActivityMinutes = state.activities.reduce((sum, item) => sum + Math.max(0, Number(item.minutes) || 0), 0);
  return {
    statuses,
    evaluable,
    dietCompleted,
    activityCompleted,
    mealCount: state.meals.length,
    activityCount: state.activities.filter((item) => Number(item.minutes) > 0).length,
    totalActivityMinutes,
    enoughForEnding: statuses.unknown === 0 && evaluable >= 4,
  };
}

export function endingForSummary(summary) {
  if (!summary.enoughForEnding) return 'insufficient';
  if (summary.dietCompleted >= 2 && summary.activityCompleted >= 2) return 'lake';
  if (summary.dietCompleted >= 2) return 'balcony';
  if (summary.activityCompleted >= 2) return 'tree';
  return 'home';
}

export function saveWeekReviewOnce(state, at = new Date().toISOString()) {
  const plan = activePlan(state);
  const eventId = `week-review:${plan.startDate}`;
  const existing = state.weekReviews.find((review) => review.eventId === eventId);
  if (existing) return { created: false, review: existing };
  const summary = weekSummary(state);
  const review = {
    id: uid('review'), eventId, planId: plan.id, planVersion: plan.version,
    weekStart: plan.startDate, weekEnd: addLocalDays(plan.startDate, 6),
    summary, ending: endingForSummary(summary), createdAt: at, source: 'local-summary',
  };
  state.weekReviews.push(review);
  return { created: true, review };
}

export function worldProgress(state, domain) {
  return state.rewardLedger.filter((entry) => entry.kind === 'main-task' && entry.domain === domain).length;
}

export function migrateLegacyPresence(storage) {
  try { return Boolean(storage?.getItem?.(LEGACY_KEY)); } catch { return false; }
}
