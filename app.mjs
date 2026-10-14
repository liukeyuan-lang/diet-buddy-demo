import {
  localDateKey, addLocalDays, dayIndex, initialState, validateState,
  activePlan, taskForDate, visibleTaskStatus, isDatePaused, setTaskStatus, settleTaskReward,
  settleRecordSticker, commitMealOnce, reconcileActivityTask, invalidateDietConfirmation, pauseDates, resumeDate,
  updateFuturePlan, timerElapsedMs, startTimer, pauseTimer, resetTimer, weekSummary, endingForSummary,
  saveWeekReviewOnce, worldProgress, todayMealSummary, dailyNutritionSummary, nutritionWeekTrend,
  createMealTemplate, draftFromMealTemplate, uid,
  normalizeBodyMeasurement, bodyMeasurementSnapshot,
} from './core.mjs';
import { PET_LIFE_ASSETS, PET_WALK_CANDIDATE_ASSETS, activatePetFallback, normalizeBodyVariant, petRenderSpec } from './pet.mjs';
import { mountPetRoam } from './pet-roam.mjs';
import { mountPetLife } from './pet-life.mjs';
import { createRoomHomeModel, roomHomeHtml } from './room-home.mjs';
import { NUTRITION_FOODS, NUTRITION_SOURCE, estimateMealNutrition, normalizeEstimateLine } from './nutrition.mjs';
import { commitLocalStateMutation } from './local-state-transaction.mjs';

const $ = (selector, root = document) => root.querySelector(selector);
const page = $('#page');
const overlay = $('#overlay');
const phone = $('#phone');
const ROOM_ROAM_SPOTS = Object.freeze([
  Object.freeze({ name: 'rug', left: 51, top: 62, activity: 'rug-stretch' }),
  Object.freeze({ name: 'window', left: 72, top: 51, activity: 'window-look' }),
  Object.freeze({ name: 'nest', left: 20, top: 55, activity: 'nest-rest' }),
]);
// The legacy four-frame walk sequence remains candidate art. The public build
// disables its query-string prototype route; the default lively layer below is
// separately marked as candidate artwork pending visual confirmation.
const PUBLIC_STATE_KEY = 'dietbuddy_public_demo_v1_state';
const PUBLIC_NIGHT_KEY = 'dietbuddy_public_demo_v1_room_night';
const PUBLIC_PHOTO_DB = 'dietbuddy_public_demo_v1_media';
const petPrototypeEnabled = false;
const mode = 'demo';
let state = load();
let modal = null;
let celebration = null;
let toastTimer = null;
let timerTicker = null;
let pendingPhoto = null;
let pendingPhotoUrl = '';
let mealAnalysisBusy = false;
let mealAnalysisError = '';
let mealAnalysisToken = 0;
let mealAnalysisController = null;
let photoRevision = 0;
let photoSelectionToken = 0;
let endingPreview = null;
let petMotion = null;
let petMotionTimer = null;
let petHoldTimer = null;
let petHoldActive = false;
let suppressPetClickUntil = 0;
let petPointerId = null;
let petPointerStartX = 0;
let petPointerStartY = 0;
let petPointerMoved = false;
let petTapSequence = 0;
let unmountPetRoam = () => {};
let roomFeedback = null;
let roomFeedbackTimer = null;
let roomNight = localStorage.getItem(PUBLIC_NIGHT_KEY) === 'true';

function load() {
  try {
    const parsed = validateState(JSON.parse(localStorage.getItem(PUBLIC_STATE_KEY)), 'demo');
    if (parsed) return normalizePetAppearance(parsed);
  } catch {}
  return normalizePetAppearance(initialState({ mode: 'demo', setupComplete: true }));
}

// Appearance is an independent, backwards-compatible presentation field. It is
// never derived from meals, task settlement, rewards, rest, or health records.
function normalizePetAppearance(loadedState) {
  loadedState.petAppearance = { ...loadedState.petAppearance, bodyVariant: normalizeBodyVariant(loadedState.petAppearance?.bodyVariant) };
  return loadedState;
}

function persist() {
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(PUBLIC_STATE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error('本地存档写入失败', error);
    notify('本地存储空间不足，本次更改可能无法在刷新后保留。');
    return false;
  }
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function today() { return localDateKey(); }
function plan() { return activePlan(state); }
function currentDate() {
  return mode === 'demo' ? addLocalDays(plan().startDate, state.ui.demoDayIndex || 0) : today();
}
function currentTask() { return taskForDate(state, currentDate()); }
function dateLabel(date) {
  const value = new Date(`${date}T12:00:00`);
  return `${value.getMonth() + 1}月${value.getDate()}日 · ${['周日','周一','周二','周三','周四','周五','周六'][value.getDay()]}`;
}
function fmtTime(value) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }); }
function statusLabel(status) {
  return ({ unknown: '待确认', completed: '已完成', partial: '部分完成', missed: '未完成', adjusted: '已调整', paused: '休息中' })[status] || '待确认';
}
function focusLabel(value) { return ({ veggie: '给一餐增加蔬菜', regular: '安排一顿规律正餐', satiety: '留意一餐的饱腹感' })[value] || value; }
function movementLabel(value) { return ({ walk: '步行 / 散步', stretch: '拉伸 / 舒缓活动', cycle: '骑行', other: '其他适宜运动' })[value] || value; }
function taskTitle(task) {
  if (!task) return '本周计划已经走完';
  if (task.type === 'diet') return focusLabel(task.target);
  if (task.type === 'activity') return `${movementLabel(task.target.movement)} ${task.target.minutes} 分钟`;
  return '和团团回顾这一周';
}
function notify(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2800);
}

function petSvg() {
  return `<svg class="pet-art" viewBox="0 0 190 175" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="奶油色的${esc(plan().petName)}"><ellipse cx="98" cy="160" rx="58" ry="10" fill="#c7bb99" opacity=".3"/><path d="M51 73Q28 31 53 23Q77 21 83 56M109 55Q122 17 148 25Q166 38 135 76" fill="#f3e2bd" stroke="#b99e75" stroke-width="4" stroke-linecap="round"/><path d="M55 39Q53 29 61 33Q72 35 71 53M121 53Q134 30 143 34Q148 40 132 56" fill="#e8b8a7"/><ellipse cx="95" cy="103" rx="65" ry="61" fill="#f8e9c9" stroke="#c9ae84" stroke-width="3"/><ellipse cx="96" cy="113" rx="49" ry="39" fill="#fff3dc"/><ellipse cx="75" cy="97" rx="6" ry="7" fill="#534c43"/><ellipse cx="116" cy="97" rx="6" ry="7" fill="#534c43"/><ellipse cx="62" cy="113" rx="12" ry="7" fill="#edaea0" opacity=".62"/><ellipse cx="129" cy="113" rx="12" ry="7" fill="#edaea0" opacity=".62"/><path d="M94 107l4 0 -2 4z" fill="#8e6657"/><path d="M89 118q7 8 15 0" stroke="#89645a" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M55 140q-17 5-11 15M135 140q19 4 14 14" fill="none" stroke="#c9ae84" stroke-width="9" stroke-linecap="round"/><path d="M66 151q-3 14 9 13M115 151q4 14-9 13" fill="none" stroke="#c9ae84" stroke-width="8" stroke-linecap="round"/></svg>`;
}

// The approved WebPs remain untouched. This separate four-frame raster sequence
// contains genuinely different paw poses and is only a candidate until the user
// approves it. The legacy SVG remains a load-failure fallback.
function walkingSoftPetCandidate(label) {
  const frames = PET_WALK_CANDIDATE_ASSETS.map((asset, index) => `<img class="pet-walk-frame pet-walk-frame-${index + 1}" src="${asset}" alt="">`).join('');
  // The generated frames only depict walking. At the nest, switch to the
  // approved curled rest art instead of trying to distort a standing pose.
  return `<span class="pet-walk-facing" role="img" aria-label="${label}"><span class="pet-walk-size"><span class="pet-walk-turn"><span class="pet-walk-viewport"><span class="pet-walk-frames">${frames}</span></span><img class="pet-nest-rest-art pet-image" src="assets/pet/pet-soft-rest.webp" alt=""></span></span><span class="pet-fallback" hidden>${petSvg()}</span></span>`;
}

function livelySoftPetCandidate(label, approvedAsset) {
  const sequences = Object.entries(PET_LIFE_ASSETS).map(([action, assets]) => {
    const frames = assets.map((asset, index) => `<img class="pet-life-frame pet-life-frame-${index + 1}" src="${asset}" alt="">`).join('');
    return `<span class="pet-life-sequence pet-life-sequence-${action}" data-frame-count="${assets.length}" aria-hidden="true">${frames}</span>`;
  }).join('');
  return `<span class="pet-life-facing" role="img" aria-label="${label}"><span class="pet-life-size"><span class="pet-life-turn"><span class="pet-life-stage">${sequences}</span></span></span><img class="pet-life-static pet-art pet-image" src="${esc(approvedAsset)}" alt="${label}" hidden><span class="pet-fallback" hidden>${petSvg()}</span></span>`;
}

// This legacy SVG is an explicitly temporary fallback, not formal character art.
function renderPet(mood = 'companion', context = 'home') {
  const spec = petRenderSpec({ bodyVariant: state.petAppearance?.bodyVariant, mood, context });
  const label = `橘白色的${esc(plan().petName)}（${spec.mood === 'excited' ? '兴奋' : spec.mood === 'rest' ? '休息' : '陪伴'}态）`;
  const useWalkCandidate = petPrototypeEnabled && spec.context === 'home' && spec.bodyVariant === 'soft';
  const usePetLife = !petPrototypeEnabled && spec.context === 'home' && spec.bodyVariant === 'soft';
  const content = useWalkCandidate
    ? walkingSoftPetCandidate(label)
    : usePetLife
    ? livelySoftPetCandidate(label, spec.asset)
    : spec.asset
    ? `<img class="pet-art pet-image" src="${esc(spec.asset)}" alt="${label}"><span class="pet-fallback" hidden>${petSvg()}</span>`
    : `<span class="pet-fallback" aria-label="${label}">${petSvg()}</span>`;
  return `<span class="pet-render pet-${spec.context} pet-${spec.mood} pet-body-${spec.bodyVariant}${useWalkCandidate ? ' pet-sequence-candidate' : ''}${usePetLife ? ' pet-life-candidate' : ''}" data-pet-body-variant="${spec.bodyVariant}" data-pet-mood="${spec.mood}" data-pet-context="${spec.context}">${content}</span>`;
}

function petMessage() {
  const latest = state.petEvents.at(-1);
  if (latest) return latest.message;
  if (isDatePaused(state, currentDate())) return '今天不赶进度。想记点什么也可以，我就在这里。';
  return '早呀！今天想先做点什么？';
}

function roomFeedbackHtml() {
  if (!roomFeedback) return '';
  return `<div class="room-feedback-bubble ${esc(roomFeedback.kind)}"><button type="button" data-action="feedback-close" aria-label="关闭团团的话">×</button>${esc(roomFeedback.message)}</div>`;
}

function addPetEvent(kind, message, sourceId = null) {
  const eventId = sourceId ? `pet:${kind}:${sourceId}` : `pet:${kind}:${uid('event')}`;
  if (state.petEvents.some((item) => item.eventId === eventId)) return false;
  state.petEvents.push({ id: uid('pet'), eventId, kind, message, date: currentDate(), sourceId, source: 'user-action', planVersion: currentTask()?.planVersion || plan().version, createdAt: new Date().toISOString() });
  roomFeedback = { kind, message };
  clearTimeout(roomFeedbackTimer);
  roomFeedbackTimer = setTimeout(() => {
    roomFeedback = null;
    const bubble = $('.room-feedback-bubble');
    if (bubble) bubble.remove();
  }, 4200);
  const layer = $('.room-feedback');
  if (layer) layer.innerHTML = roomFeedbackHtml();
  return true;
}

function dayStrip() {
  return `<div class="week-row">${Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(plan().startDate, index);
    const task = taskForDate(state, date);
    const status = visibleTaskStatus(state, task);
    const selected = date === currentDate();
    return `<button class="day-dot ${status} ${selected ? 'active' : ''}" ${mode === 'real' ? 'disabled' : ''} data-action="demo-day" data-index="${index}" aria-label="第${index + 1}天，${statusLabel(status)}">${index + 1}<br>${['一','二','三','四','五','六','日'][index]}</button>`;
  }).join('')}</div>`;
}

function sceneHtml() {
  const paused = isDatePaused(state, currentDate());
  const mood = celebration ? 'excited' : paused ? 'rest' : 'companion';
  const walkCandidateEnabled = petPrototypeEnabled && normalizeBodyVariant(state.petAppearance?.bodyVariant) === 'soft';
  const petLifeEnabled = !petPrototypeEnabled && normalizeBodyVariant(state.petAppearance?.bodyVariant) === 'soft';
  const prototypeChrome = walkCandidateEnabled
    ? '<span class="prototype-badge">AI 候选步态素材 · 待视觉确认</span><button class="pet-roam-toggle" data-action="pet-roam-toggle" type="button" aria-pressed="true" aria-label="关闭宠物自主走动">⟳</button>'
    : petLifeEnabled
      ? '<span class="prototype-badge">AI 候选动作素材 · 待视觉确认</span>'
      : '';
  const task = currentTask();
  const taskStatus = visibleTaskStatus(state, task);
  const model = createRoomHomeModel({
    task,
    taskTitle: taskTitle(task),
    taskStatus,
    taskStatusLabel: statusLabel(taskStatus),
    paused,
    dayIndex: dayIndex(plan().startDate, currentDate()),
    mode,
    dateLabel: dateLabel(currentDate()),
    petName: plan().petName,
    mealCount: state.meals.filter((item) => item.date === currentDate()).length,
    activityCount: state.activities.filter((item) => item.date === currentDate()).length,
  });
  const summary = todayMealSummary(state, currentDate());
  const dailyNutrition = dailyNutritionSummary(state, currentDate());
  const macroLine = dailyNutrition.status === 'complete'
    ? `蛋白质 ${formatRange(dailyNutrition.macroRange.protein)}g · 碳水 ${formatRange(dailyNutrition.macroRange.carbs)}g · 脂肪 ${formatRange(dailyNutrition.macroRange.fat)}g`
    : dailyNutrition.status === 'partial'
      ? `三大营养素仅有已知小计，${dailyNutrition.unknownMeals + dailyNutrition.partialMeals} 餐仍不完整`
      : dailyNutrition.status === 'no-record' ? '今天未记录，不按 0 摄入计算' : '三大营养素暂无可汇总值';
  const summaryHtml = `<section class="today-summary"><div><strong>今天的记录</strong><span>${summary.mealCount} 餐已确认 · ${summary.kcalRange ? `${summary.kcalRange.min}–${summary.kcalRange.max} kcal` : '热量区间待补充'} · ${summary.unconfirmedIngredients} 项食材待确认${summary.remainingRange ? ` · 剩余目标 ${summary.remainingRange.min}–${summary.remainingRange.max} kcal` : ''}</span><span>${macroLine}</span></div><div class="today-summary-actions"><button type="button" data-action="room-meal-open">查看饮食</button><button type="button" data-action="body-open">身体记录</button></div></section>`;
  const feedbackHtml = roomFeedbackHtml();
  const html = roomHomeHtml({
    model,
    petHtml: renderPet(mood, 'home'),
    feedbackHtml,
    summaryHtml,
    prototypeChrome,
    petMotionClass: petMotion ? `pet-motion-${petMotion}` : '',
  });
  if (walkCandidateEnabled) return html.replace('room-world pet-scene', 'room-world pet-scene pet-prototype-scene');
  return petLifeEnabled ? html.replace('room-world pet-scene', 'room-world pet-scene pet-life-scene') : html;
}

function setupHtml() {
  return `<div class="setup"><div class="setup-art">${renderPet('companion', 'setup')}</div><span class="pill demo">公开 DEMO</span><h1 class="title">你好，我会陪你<br>体验这一周。</h1><p class="lead">这是固定演示模式。所有记录只保存在当前浏览器，不提供 AI 识别或云同步。</p><form id="setup-form"><label class="form-label">搭子的名字</label><input class="field" name="petName" maxlength="12" value="团团"><label class="form-label">这一周的饮食行动</label><select class="field" name="focus"><option value="veggie">给一餐增加蔬菜</option><option value="regular">安排一顿规律正餐</option><option value="satiety">留意一餐的饱腹感</option></select><label class="form-label">活动类型</label><select class="field" name="movement"><option value="walk">轻松步行</option><option value="stretch">舒缓活动</option><option value="other">其他适宜运动</option></select><label class="form-label">每次活动目标</label><select class="field" name="duration"><option value="10">10 分钟</option><option value="15" selected>15 分钟</option><option value="20">20 分钟</option></select><button class="btn block" type="submit" style="margin-top:16px">开始演示</button></form><p class="hint">内容仅用于生活记录演示，不构成医疗或减重效果建议。</p></div>`;
}

function homeHtml() {
  return sceneHtml();
}

function bodyMetricHtml(label, unit, item) {
  if (!item.latest) return `<div class="body-metric"><small>${label}</small><strong>未记录</strong><span>填写可选</span></div>`;
  const change = item.change === null ? '暂无上次记录可比较' : `${item.change > 0 ? '+' : ''}${formatBodyValue(item.change)} ${unit}（较上次）`;
  const key = label === '体重' ? 'weightKg' : label === '腰围' ? 'waistCm' : 'hipCm';
  return `<div class="body-metric"><small>${label}</small><strong>${formatBodyValue(item.latest[key])} ${unit}</strong><span>${esc(dateLabel(item.latest.date))}</span><em>${change}</em></div>`;
}

function formatBodyValue(value) {
  return Number(value).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function bodyEntry(item) {
  const values = [['体重', item.weightKg, 'kg'], ['腰围', item.waistCm, 'cm'], ['臀围', item.hipCm, 'cm']]
    .filter(([, value]) => value !== null).map(([label, value, unit]) => `${label} ${formatBodyValue(value)} ${unit}`).join(' · ');
  return `<div class="list-entry"><div><strong>${esc(dateLabel(item.date))}</strong><small>${values}</small></div><div class="entry-actions"><button data-action="body-edit" data-id="${esc(item.id)}">编辑</button><button data-action="body-delete" data-id="${esc(item.id)}">删除</button></div></div>`;
}

function bodyHtml() {
  const draft = state.drafts.bodyMeasurement || {};
  const snapshot = bodyMeasurementSnapshot(state.bodyMeasurements);
  const records = [...state.bodyMeasurements].sort((a, b) => b.date.localeCompare(a.date) || b.updatedAt.localeCompare(a.updatedAt));
  const input = (name, label, unit, max, value) => `<label class="form-label">${label}（可选）<span>${unit}</span></label><input class="field" name="${name}" type="number" inputmode="decimal" min="0.01" max="${max}" step="0.01" value="${esc(value ?? '')}" placeholder="留空即可">`;
  const clear = draft.editId ? '<div class="body-clear"><label><input type="checkbox" name="clearWeight"> 清除体重</label><label><input type="checkbox" name="clearWaist"> 清除腰围</label><label><input type="checkbox" name="clearHip"> 清除臀围</label></div>' : '';
  return `<span class="pill">⚪ 身体记录</span><h1 class="title">记下身体数据，<br>回看自己的变化。</h1><p class="lead">体重与围度填写可选，保存在当前浏览器。</p><section class="body-snapshot">${bodyMetricHtml('体重', 'kg', snapshot.weightKg)}${bodyMetricHtml('腰围', 'cm', snapshot.waistCm)}${bodyMetricHtml('臀围', 'cm', snapshot.hipCm)}</section><form id="body-form" data-edit-id="${esc(draft.editId || '')}"><label class="form-label">记录日期</label><input class="field" name="date" type="date" required value="${esc(draft.date || currentDate())}">${input('weightKg', '体重', 'kg', 500, draft.weightKg)}${input('waistCm', '腰围', 'cm', 300, draft.waistCm)}${input('hipCm', '臀围', 'cm', 400, draft.hipCm)}${clear}<p class="hint">同一日期只保留一条记录。再次保存会保留该日期未填写的已有数值；要移除时勾选对应“清除”。</p><button class="btn block" type="submit" style="margin-top:14px">${draft.editId ? '保存修改' : '保存身体记录'}</button>${draft.editId ? '<button class="btn ghost block" type="button" data-action="body-cancel" style="margin-top:7px">取消编辑</button>' : ''}</form><div class="section-heading">历史记录 <span>${records.length} 条</span></div><div class="card">${records.length ? records.map(bodyEntry).join('') : '<p class="lead">还没有身体记录。你可以从体重或腰围中任选一项开始。</p>'}</div>`;
}

function mealHtml() {
  const date = currentDate();
  const draft = ensureMealDraft();
  const items = state.meals.filter((item) => item.date === date).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const photoMarkup = pendingPhotoUrl
    ? `<img src="${pendingPhotoUrl}" alt="待确认的餐食照片"><span class="photo-state">已在本机压缩 · 确认前不写入餐食</span>`
    : '<span class="picture-empty">📷<br><small>先拍照或从相册选择</small></span>';
  const estimate = nutritionEstimateHtml(draft.nutritionEstimate);
  const recognized = draft.aiAnalysis ? `<div class="analysis-meta"><b>AI 图像线索 · ${confidenceLabel(draft.aiAnalysis.overallConfidence)}</b><span>${esc(providerLabel(draft.aiAnalysis))} · 模型 ${esc(draft.aiAnalysis.model || '未知')}</span></div>${draft.aiAnalysis.uncertainties?.length ? `<details class="note warning analysis-uncertainties"><summary>待核对信息（${draft.aiAnalysis.uncertainties.length} 项）</summary><small>${draft.aiAnalysis.uncertainties.map(esc).join('；')}</small></details>` : ''}` : '';
  return `<span class="pill">🥣 饮食记录</span><h1 class="title">手动记下一餐，<br>确认权在你。</h1><div class="note">公开展示版不提供 AI 识别。照片只在本机预览和保存，不会发送到服务器或第三方；也可以不选照片，直接手动记录。</div><form id="meal-form" data-edit-id="${esc(draft.editId || '')}"><label class="form-label">餐食照片（可选）</label><div class="picture" id="photo-preview">${photoMarkup}</div><div class="photo-actions"><label class="btn secondary small">${pendingPhotoUrl ? '重新拍照' : '拍照'}<input type="file" id="meal-camera" accept="image/jpeg,image/png,image/webp" capture="environment" hidden></label><label class="btn ghost small">${pendingPhotoUrl ? '从相册替换' : '从相册选择'}<input type="file" id="meal-gallery" accept="image/jpeg,image/png,image/webp" hidden></label>${pendingPhotoUrl ? '<button class="btn danger small" type="button" data-action="photo-remove">取消照片</button>' : ''}</div><button class="btn peach block" type="button" data-action="meal-analyze" disabled>展示版不提供 AI 识别</button>${mealAnalysisError ? `<div class="inline-error" role="alert">${esc(mealAnalysisError)}<br><small>照片和草稿已保留在当前页面，可重试或继续手工填写。</small></div>` : ''}<div id="meal-nutrition-estimate">${estimate}</div><label class="form-label">食物 / 餐食名称 *</label><input class="field" name="food" required maxlength="80" value="${esc(draft.food || '')}" placeholder="例如：番茄鸡蛋面"><label class="form-label">份量描述（可选）</label><input class="field" name="portion" maxlength="120" value="${esc(draft.portion || '')}" placeholder="例如：一碗，大约 350–450 克"><label class="form-label">烹调方式（可选，用于粗估假设）</label><select class="field" name="cookingMethod"><option value="unknown" ${!draft.cookingMethod || draft.cookingMethod === 'unknown' ? 'selected' : ''}>不确定 / 先不补充</option><option value="pan_fried" ${draft.cookingMethod === 'pan_fried' ? 'selected' : ''}>煎 / 香煎</option><option value="steamed" ${draft.cookingMethod === 'steamed' ? 'selected' : ''}>清蒸 / 少油</option><option value="deep_fried" ${draft.cookingMethod === 'deep_fried' ? 'selected' : ''}>油炸</option></select><label class="form-label">份量系数（相对当前估算）</label><div class="portion-scale"><input class="field" name="portionScale" type="number" min="10" max="300" step="5" value="${esc(draft.portionScale || 100)}"><span>%</span></div><p class="hint">例如只吃了图中一半，改为 50%；重新估算只缩放一次整体区间。所有补充都是可选的，不补也可保存。</p><div class="section-heading compact">食材 <button class="btn ghost small" type="button" data-action="meal-line-add" data-group="ingredients">+添加</button></div>${mealLinesHtml(draft.ingredients, 'ingredients')}<div class="section-heading compact">油 / 酱料 <button class="btn ghost small" type="button" data-action="meal-line-add" data-group="fatsAndSauces">+添加</button></div>${mealLinesHtml(draft.fatsAndSauces, 'fatsAndSauces')}<button class="btn secondary block" type="button" data-action="meal-reestimate">按当前信息重新估算</button><button class="btn ghost block" type="button" data-action="meal-template-save-draft" style="margin-top:7px">收藏当前填写为常吃餐</button><label class="form-label">本次是否实践了约定行动？</label><div class="radio-row">${[['yes','有'],['no','没有'],['unknown','不确定']].map(([value,label]) => `<label class="radio-pill"><input type="radio" name="practice" value="${value}" ${(draft.practice || 'unknown') === value ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div><p class="hint">记录一餐不会自动判定整天任务，主任务仍由你单独确认。</p><label class="form-label">备注（可选）</label><textarea class="field" name="notes" rows="2" maxlength="240" placeholder="当时的感受、场景或想记住的事">${esc(draft.notes || '')}</textarea><button class="btn block" type="submit" style="margin-top:14px">${draft.editId ? '确认并保存修改' : '我已核对，确认保存这一餐'}</button><button class="btn ghost block" type="button" data-action="${draft.editId ? 'cancel-edit' : 'meal-cancel'}" style="margin-top:7px">${draft.editId ? '取消编辑' : '取消，不保存'}</button></form><div class="section-heading">${dateLabel(date)} <span>${items.length} 餐</span></div><div class="card">${items.length ? items.map(mealEntry).join('') : '<p class="lead">今天还没有餐食记录。没有填写不会自动算作未完成。</p>'}</div>`;
}

function formatRange(range, digits = 1) {
  if (!range) return '未知';
  const clean = (value) => Number(value).toFixed(digits).replace(/\.0$/, '');
  return `${clean(range.min)}–${clean(range.max)}`;
}

function dailyNutritionHtml(summary) {
  if (summary.status === 'no-record') {
    return '<section class="macro-summary empty"><div class="row"><strong>今日三大营养素</strong><span>未记录</span></div><p>今天没有已保存餐食；未记录不会显示成 0g。</p></section>';
  }
  const ranges = summary.macroRange || summary.knownSubtotal;
  const label = summary.status === 'complete' ? '已录餐食完整汇总' : summary.status === 'partial' ? '已知小计 · 非全天' : '暂不可汇总';
  const cards = ['protein', 'carbs', 'fat'].map((key) => {
    const name = ({ protein: '蛋白质', carbs: '碳水', fat: '脂肪' })[key];
    return `<div><small>${name}</small><strong>${ranges?.[key] ? `${formatRange(ranges[key])}g` : '未知'}</strong></div>`;
  }).join('');
  const gaps = [summary.partialMeals ? `${summary.partialMeals} 餐仅有部分数据` : '', summary.unknownMeals ? `${summary.unknownMeals} 餐无宏量数据` : '', summary.unmappedIngredients ? `${summary.unmappedIngredients} 项未映射` : '', summary.missingPortions ? `${summary.missingPortions} 项缺克数` : ''].filter(Boolean).join(' · ');
  return `<section class="macro-summary ${summary.status}"><div class="row"><strong>今日三大营养素</strong><span>${label}</span></div><div class="macro-summary-grid">${cards}</div><p>${summary.status === 'complete' ? `${summary.mealCount} 餐都有完整整餐宏量区间。` : gaps || '现有餐食没有可汇总的蛋白质、碳水和脂肪数据。'}</p></section>`;
}

function nutritionWeekHtml(days) {
  const dayCards = days.map((day) => {
    const local = new Date(`${day.date}T12:00:00`);
    const label = `${local.getMonth() + 1}/${local.getDate()}`;
    if (day.status === 'no-record') return `<div class="trend-day no-record"><b>${label}</b><span>未记录</span><small>不计 0</small></div>`;
    if (day.status === 'unavailable') return `<div class="trend-day unavailable"><b>${label}</b><span>${day.mealCount} 餐 · 宏量未知</span><small>${day.knownSubtotal.kcal ? `${formatRange(day.knownSubtotal.kcal, 0)} kcal 已知` : '热量未知'}</small></div>`;
    const ranges = day.macroRange || day.knownSubtotal;
    return `<div class="trend-day ${day.status}"><b>${label}</b><span>${day.status === 'complete' ? '已录完整' : '已知小计'}</span><small>${day.knownSubtotal.kcal ? `${formatRange(day.knownSubtotal.kcal, 0)} kcal` : 'kcal 未知'}</small><small>P ${formatRange(ranges.protein)}g</small><small>C ${formatRange(ranges.carbs)}g</small><small>F ${formatRange(ranges.fat)}g</small></div>`;
  }).join('');
  return `<details class="nutrition-week"><summary>近 7 天营养趋势</summary><p>绿色为当天所有已记录餐食都有完整宏量区间；黄色只展示已知小计。灰色“未记录”和“宏量未知”不会按 0 画入趋势。</p><div class="trend-days">${dayCards}</div></details>`;
}

function mealTemplatesHtml() {
  const templates = state.mealTemplates || [];
  const options = templates.map((template) => `<option value="${esc(template.id)}">${esc(template.name)} · ${esc(template.portion || '默认份量')}</option>`).join('');
  const manage = templates.map((template) => `<div class="template-manage-row" data-template-row="${esc(template.id)}"><input class="field" maxlength="80" value="${esc(template.name)}" aria-label="常吃餐名称"><button class="btn ghost small" type="button" data-action="meal-template-rename" data-id="${esc(template.id)}">改名</button><button class="btn danger small" type="button" data-action="meal-template-delete" data-id="${esc(template.id)}">删除</button></div>`).join('');
  return `<section class="meal-templates"><div class="row"><strong>常吃餐</strong><span>${templates.length} 个本地模板</span></div>${templates.length ? `<div class="template-apply"><select class="field" id="meal-template-select" aria-label="选择常吃餐">${options}</select><label>本次相对模板份量 <span><input class="field" id="meal-template-percent" type="number" min="10" max="300" step="5" value="100">%</span></label><button class="btn secondary" type="button" data-action="meal-template-apply">套用到草稿</button></div><details><summary>管理常吃餐</summary>${manage}</details>` : '<p>可从已保存餐食或当前填写收藏。模板只保留餐名、餐次、份量与食材克数，不保存照片、备注或 AI 图片分析。</p>'}</section>`;
}

function enhanceMealPage(root = page) {
  const form = $('#meal-form', root);
  if (!form) return;
  const date = currentDate();
  const summary = todayMealSummary(state, date);
  const dailyNutrition = dailyNutritionSummary(state, date);
  const trend = nutritionWeekTrend(state, date);
  const latest = [...state.meals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const heading = $('.pill', root);
  heading.insertAdjacentHTML('afterend', `<section class="meal-summary"><strong>今日摘要</strong><span>${summary.mealCount} 餐已确认</span><span>${summary.kcalRange ? `${summary.kcalRange.min}–${summary.kcalRange.max} kcal` : '暂无已录餐食完整热量区间'}</span><span>${summary.unconfirmedIngredients} 项食材待确认</span>${summary.remainingRange ? `<span>剩余目标 ${summary.remainingRange.min}–${summary.remainingRange.max} kcal</span>` : ''}</section>${dailyNutritionHtml(dailyNutrition)}${nutritionWeekHtml(trend)}<form id="calorie-target-form" class="target-form"><label class="form-label" for="daily-calorie-target">每日热量目标（可选）</label><div class="target-input"><input class="field" id="daily-calorie-target" name="target" type="number" min="500" max="10000" step="50" value="${esc(state.settings.dailyCalorieTarget || '')}" placeholder="留空表示不设置"><button class="btn ghost small" type="submit">保存目标</button></div><small class="hint">仅按已保存餐食估算剩余区间，不扣除运动消耗。</small></form>${mealTemplatesHtml()}${latest && !form.dataset.editId ? `<button class="btn secondary block" type="button" data-action="meal-copy-recent">复制最近一餐（${esc(latest.food)}）</button>` : ''}`);
  const foodInput = form.querySelector('[name="food"]');
  const type = document.createElement('label');
  type.className = 'form-label';
  type.textContent = '餐食类型';
  const select = document.createElement('select');
  select.className = 'field'; select.name = 'mealType';
  select.innerHTML = '<option value="breakfast">早餐</option><option value="lunch">午餐</option><option value="dinner">晚餐</option><option value="snack">加餐</option>';
  select.value = state.drafts.meal?.mealType || 'snack';
  if (foodInput) { foodInput.before(select); foodInput.before(type); }
  form.querySelectorAll('[data-action="meal-edit"]').forEach((button) => {
    const item = state.meals.find((meal) => meal.id === button.dataset.id);
    const title = button.closest('.list-entry')?.querySelector('strong');
    if (item && title) title.insertAdjacentHTML('beforeend', ` <small>${({breakfast:'早餐',lunch:'午餐',dinner:'晚餐',snack:'加餐'})[item.mealType || 'snack']}</small>`);
  });
}

function mealEntry(item) {
  const estimate = item.nutritionEstimate;
  const historicalPartial = estimate?.range && !estimate.estimatorVersion && (estimate.unmappedIngredients?.length || estimate.missingPortions?.length);
  const kcal = historicalPartial ? estimate.range.kcal : estimate?.range?.kcal || estimate?.partialRange?.kcal;
  const estimateLabel = historicalPartial ? '历史部分小计，非整餐'
    : estimate?.estimateKind === 'rough-whole-meal' ? '粗略整餐区间'
      : estimate?.estimateKind === 'partial-subtotal' ? '已映射项小计，非整餐'
        : '按已确认食材估算';
  const aiLabel = item.aiAnalysis ? (item.aiAnalysis.recognized ? ' · AI 辅助后已确认' : ' · AI 未识别后手工记录') : '';
  return `<div class="list-entry"><div><strong>${esc(item.food)}</strong><small>${esc(item.portion || '份量未补充')}${kcal ? ` · ${estimateLabel} ${kcal.min}–${kcal.max} kcal` : ''} · 行动：${({yes:'有实践',no:'未实践',unknown:'不确定'})[item.actionPractice]}<br>${fmtTime(item.createdAt)}${item.notes ? ` · ${esc(item.notes)}` : ''}${item.photoId ? ' · 照片已本地保存' : ''}${aiLabel}</small></div><div class="entry-actions"><button data-action="meal-template-save-record" data-id="${item.id}" aria-label="收藏${esc(item.food)}为常吃餐">收藏</button><button data-action="meal-edit" data-id="${item.id}" aria-label="编辑${esc(item.food)}">编辑</button><button data-action="meal-delete" data-id="${item.id}" aria-label="删除${esc(item.food)}">删除</button></div></div>`;
}

function roomMemoryRecordsHtml() {
  const meals = [...state.meals].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activities = [...state.activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const mealRecords = meals.length
    ? meals.map((item) => `<div class="memory-dated-entry"><span>${esc(dateLabel(item.date))}</span>${mealEntry(item)}</div>`).join('')
    : '<p class="lead">还没有餐食记录。</p>';
  const activityRecords = activities.length
    ? activities.map((item) => `<div class="memory-dated-entry"><span>${esc(dateLabel(item.date))}</span>${activityEntry(item)}</div>`).join('')
    : '<p class="lead">还没有活动记录。</p>';
  return `<div class="section-heading room-memory-heading">生活记录 <span>可继续编辑或删除</span></div><div class="memory-tabs"><div><h3>餐食 · ${meals.length}</h3>${mealRecords}<button class="btn ghost block" data-action="room-meal-open">在鉴饭台继续记录</button></div><div><h3>活动 · ${activities.length}</h3>${activityRecords}<button class="btn ghost block" data-action="room-activity-open">在运动角继续记录</button></div></div>`;
}

function ensureMealDraft() {
  const draft = state.drafts.meal || (state.drafts.meal = {});
  if (!draft.clientSubmissionId) draft.clientSubmissionId = uid('meal-submit');
  if (!Array.isArray(draft.ingredients)) draft.ingredients = [];
  if (!Array.isArray(draft.fatsAndSauces)) draft.fatsAndSauces = [];
  if (!draft.portionScale) draft.portionScale = 100;
  if (!draft.cookingMethod) draft.cookingMethod = 'unknown';
  return draft;
}

function confidenceLabel(value) { return ({ high: '线索较清楚', medium: '线索一般', low: '线索有限' })[value] || '需核对'; }

function providerLabel(analysis = {}) {
  if (analysis.provider === 'demo') return 'DEMO 演示，非真实模型';
  if (analysis.providerDisplayName) return analysis.providerDisplayName;
  return analysis.provider ? `旧服务端自报：${analysis.provider}` : 'AI 提供商未标明';
}

function mealLinesHtml(lines = [], group) {
  if (!lines.length) return `<div class="empty-lines">暂无${group === 'ingredients' ? '食材' : '油酱'}条目，可手工添加。</div>`;
  const options = [`<option value="unknown">无可靠映射</option>`, ...Object.entries(NUTRITION_FOODS).map(([key, value]) => `<option value="${key}">${esc(value.label)} · FDC ${value.fdcId}</option>`)].join('');
  return `<div class="ingredient-list">${lines.map((line, index) => `<div class="ingredient-row"><input class="field" name="${group}Name" maxlength="80" value="${esc(line.name || '')}" placeholder="食材名"><select class="field" name="${group}Key">${options.replace(`value="${esc(line.foodKey || 'unknown')}"`, `value="${esc(line.foodKey || 'unknown')}" selected`)}</select><div class="gram-range"><input class="field" name="${group}Min" type="number" min="0" max="3000" step="1" value="${esc(line.gramsMin ?? '')}" placeholder="最小"><span>–</span><input class="field" name="${group}Max" type="number" min="0" max="3000" step="1" value="${esc(line.gramsMax ?? '')}" placeholder="最大"><span>g</span></div><input type="hidden" name="${group}Confidence" value="${esc(line.confidence || 'low')}"><input type="hidden" name="${group}Origin" value="${esc(line.origin || 'unknown')}"><button class="line-remove" type="button" data-action="meal-line-remove" data-group="${group}" data-index="${index}" aria-label="删除${esc(line.name || '条目')}">×</button></div>`).join('')}</div>`;
}

function nutritionEstimateHtml(estimate) {
  if (!estimate) return '<div class="nutrition-card muted"><b>尚未估算</b><span>可手动补充食材、克数或烹调方式后在本机估算，也可直接保存记录。</span></div>';
  const historicalPartial = !estimate.estimatorVersion && estimate.range && (estimate.unmappedIngredients?.length || estimate.missingPortions?.length);
  if (historicalPartial) {
    const kcal = estimate.range.kcal;
    return `<div class="nutrition-card warning"><div class="row"><b>历史部分小计</b><span>非整餐热量</span></div><span>${kcal.min}–${kcal.max} kcal（仅已知部分）</span><small>这是旧版仅对已映射条目的小计，未自动重算或覆盖。编辑并主动保存时才会按新规则重算。</small></div>`;
  }
  if (estimate.estimateKind === 'partial-subtotal' && estimate.partialRange) {
    const kcal = estimate.partialRange.kcal;
    return `<div class="nutrition-card warning"><div class="row"><b>仅已映射项小计</b><span>不是整餐热量</span></div><span>${kcal.min}–${kcal.max} kcal（仅已知部分）</span><details><summary>查看未计入项与可选补充</summary><small>${estimate.assumptions?.map(esc).join(' ')} ${estimate.suggestions?.map(esc).join(' ')}</small></details></div>`;
  }
  if (!estimate.range) return `<div class="nutrition-card warning"><b>暂无依据给出整餐区间</b><span>目前没有可靠映射或适用的粗估规则。你可选补充，也可不补充直接保存记录。${estimate.unmappedIngredients?.length ? ` 未映射：${estimate.unmappedIngredients.map(esc).join('、')}` : ''}</span></div>`;
  const { kcal } = estimate.range;
  const rough = estimate.estimateKind === 'rough-whole-meal';
  const macros = estimate.macroRange && estimate.macroRange.protein ? `<div class="nutrition-macros"><span>蛋白质 ${estimate.macroRange.protein.min}–${estimate.macroRange.protein.max}g</span><span>碳水 ${estimate.macroRange.carbs.min}–${estimate.macroRange.carbs.max}g</span><span>脂肪 ${estimate.macroRange.fat.min}–${estimate.macroRange.fat.max}g</span></div>` : '';
  return `<div class="nutrition-card ${rough ? 'warning' : ''}"><div class="row"><b>${rough ? '粗略整餐热量区间' : '按已确认食材估算'}</b><span>${rough ? '不准确 · 可直接保存' : `${estimate.mappedCount}/${estimate.totalCount} 项已计入`}</span></div><strong>${kcal.min}–${kcal.max} kcal</strong>${macros}<details><summary>查看估算依据与可选补充</summary><small>数据：${esc(NUTRITION_SOURCE.name)} ${esc(NUTRITION_SOURCE.dataType)} ${esc(NUTRITION_SOURCE.release)}。${estimate.method ? ` 方法：${esc(estimate.method)}。` : ''} ${estimate.assumptions?.map(esc).join(' ')} ${estimate.suggestions?.map(esc).join(' ')}</small></details></div>`;
}

function formatElapsed(ms) {
  const seconds = Math.floor(ms / 1000);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h ? `${String(h).padStart(2,'0')}:` : ''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function activityHtml() {
  const date = currentDate();
  const draft = state.drafts.activity || {};
  const items = state.activities.filter((item) => item.date === date).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  const elapsed = timerElapsedMs(state.timer);
  return `<span class="pill">🌿 运动记录</span><h1 class="title">按实际时间记录，<br>不拿运动补偿饮食。</h1><div class="timer"><div class="mini">可恢复的本地计时器</div><div class="timer-time" id="timer-time">${formatElapsed(elapsed)}</div><div class="button-row"><button class="btn ${state.timer.running ? 'peach' : 'secondary'} small" data-action="timer-toggle">${state.timer.running ? '暂停' : elapsed ? '继续' : '开始计时'}</button><button class="btn ghost small" data-action="timer-use" ${elapsed < 60000 ? 'disabled' : ''}>填入分钟</button><button class="btn ghost small" data-action="timer-reset" ${!elapsed ? 'disabled' : ''}>清零</button></div><p class="hint">开始、暂停和累计时间会保存；刷新或切到后台后按时间戳恢复。未保存的计时会一直显示提醒。</p></div><form id="activity-form" data-edit-id="${esc(draft.editId || '')}"><label class="form-label">活动类型</label><select class="field" name="type">${[['walk','步行 / 散步'],['stretch','拉伸 / 舒缓活动'],['cycle','骑行'],['other','其他适宜运动']].map(([value,label])=>`<option value="${value}" ${draft.type===value?'selected':''}>${label}</option>`).join('')}</select><label class="form-label">实际分钟数 *</label><input class="field" name="minutes" type="number" min="0" max="600" step="1" required value="${esc(draft.minutes ?? '')}" placeholder="例如：15"><label class="form-label">主观体感</label><select class="field" name="feeling"><option value="easy" ${draft.feeling==='easy'?'selected':''}>挺轻松</option><option value="justright" ${!draft.feeling||draft.feeling==='justright'?'selected':''}>刚刚好</option><option value="hard" ${draft.feeling==='hard'?'selected':''}>有点太累了</option></select><input type="hidden" name="source" value="${esc(draft.source || 'manual')}"><button class="btn block" type="submit" style="margin-top:14px">${draft.editId ? '保存修改' : '保存活动'}</button>${draft.editId ? '<button class="btn ghost block" type="button" data-action="cancel-edit" style="margin-top:7px">取消编辑</button>' : ''}</form><div class="section-heading">${dateLabel(date)} <span>${items.length} 条</span></div><div class="card">${items.length ? items.map(activityEntry).join('') : '<p class="lead">今天还没有活动记录。0 分钟可以作为笔记保存，但不会获得活动贴纸或完成奖励。</p>'}</div>`;
}

function activityEntry(item) {
  return `<div class="list-entry"><div><strong>${esc(movementLabel(item.type))} · ${item.minutes} 分钟</strong><small>${({easy:'挺轻松',justright:'刚刚好',hard:'有点太累了'})[item.feeling]} · ${item.source === 'timer' ? '计时记录' : '手动记录'} · ${fmtTime(item.createdAt)}</small></div><div class="entry-actions"><button data-action="activity-edit" data-id="${item.id}">编辑</button><button data-action="activity-delete" data-id="${item.id}">删除</button></div></div>`;
}

const endings = {
  lake: { icon: '🧺🌊', title: '湖边的丰盛野餐', text: '饮食行动与活动安排都留下了清楚的足迹。' },
  balcony: { icon: '🥗🌤️', title: '阳台上的料理会', text: '厨房里积攒了许多对生活有用的新发现。' },
  tree: { icon: '🌳👟', title: '大树下的路线图', text: '这一周的活动足迹，让地图慢慢展开。' },
  home: { icon: '🏠☕', title: '小屋里的慢野餐', text: '有些周适合待在小屋里，真实记录也值得被记住。' },
  insufficient: { icon: '🏠❔', title: '本周记录不足', text: '问号会被好好保留，不把没有填写说成没有完成。' },
};

function reviewHtml() {
  const summary = weekSummary(state);
  const ended = today() >= addLocalDays(plan().startDate, 6);
  const actual = endingForSummary(summary);
  const key = mode === 'demo' && endingPreview ? endingPreview : actual;
  const ending = endings[key];
  const existing = state.weekReviews.find((item) => item.eventId === `week-review:${plan().startDate}`);
  return `<span class="pill">📖 一周回忆</span><h1 class="title">我们看真实发生，<br>不猜体重结果。</h1><p class="lead">计划执行不等于减脂成功。体重可以选择不记录，本版不会据此奖惩宠物。</p><div class="stats"><div class="stat"><small>饮食记录</small><strong>${summary.mealCount}</strong><small>餐</small></div><div class="stat"><small>活动记录</small><strong>${summary.activityCount}</strong><small>${summary.totalActivityMinutes} 分钟</small></div><div class="stat"><small>状态未知</small><strong>${summary.statuses.unknown}</strong><small>不算失败</small></div></div><div class="section-heading">计划执行状态 <span>分母仅含已评价任务</span></div><div class="card"><div class="mini">完成 ${summary.statuses.completed} · 部分 ${summary.statuses.partial} · 未完成 ${summary.statuses.missed} · 已调整 ${summary.statuses.adjusted} · 休息 ${summary.statuses.paused} · 未知 ${summary.statuses.unknown}</div><div class="divider"></div><div class="note">已评价分母：${summary.evaluable}。休息、调整和未知不会混进“未完成”。</div></div><div class="section-heading">宠物世界回忆 <span>来自主任务奖励</span></div><div class="card"><div class="row"><div><strong>厨房筹备 ${worldProgress(state,'diet')}/3</strong><div class="mini">只由饮食主任务完成推进</div></div><div><strong>地图筹备 ${worldProgress(state,'activity')}/3</strong><div class="mini">只由活动主任务完成推进</div></div></div></div><div class="section-heading">本周纪念卡 <span>${mode === 'demo' ? 'DEMO 可预览四结局' : ended ? '本周已结束' : '周末后可保存'}</span></div><div class="card">${mode === 'demo' ? `<div class="ending-tabs">${['lake','balcony','tree','home'].map((item)=>`<button data-action="ending-preview" data-ending="${item}" class="${key===item?'active':''}">${({lake:'湖边',balcony:'阳台',tree:'大树',home:'小屋'})[item]}</button>`).join('')}</div>` : ''}<div class="ending-art ${key}"><span class="ending-icon" aria-hidden="true">${ending.icon}</span>${renderPet('companion', 'ending')}</div><h2 class="title" style="font-size:18px">${ending.title}</h2><p class="lead">${ending.text}</p>${mode === 'real' ? `<button class="btn secondary block" data-action="review-save" ${!ended || existing ? 'disabled' : ''}>${existing ? '纪念卡已保存' : ended ? '保存本周纪念卡' : '本周结束后可保存'}</button>` : '<p class="hint">这里只是演示预览；不会写入真实周复盘。</p>'}</div><div class="section-heading">下周小调整 <span>需要你确认</span></div><div class="card"><p class="lead">如果这周觉得难，可以只调整下一次活动分钟数或行动方式。建议不会自动生效。</p><button class="btn ghost block" data-action="plan-open">由我确认一个小调整</button></div>`;
}

function render() {
  unmountPetRoam();
  unmountPetRoam = () => {};
  clearInterval(timerTicker);
  const view = state.setupComplete ? (state.ui.view || 'home') : 'setup';
  phone.dataset.view = view;
  $('#pet-life-toggle').hidden = !(state.setupComplete && view === 'home' && !petPrototypeEnabled && normalizeBodyVariant(state.petAppearance?.bodyVariant) === 'soft');
  phone.classList.toggle('room-night', roomNight && view === 'home');
  $('#demo-badge').hidden = mode !== 'demo';
  const index = dayIndex(plan().startDate, currentDate());
  const paused = isDatePaused(state, currentDate());
  $('#date-label').textContent = `${dateLabel(currentDate())}${view === 'home' ? ` · ${paused ? '今天休息' : index >= 0 && index <= 6 ? `第 ${index + 1} 天` : '真实日期'}` : mode === 'demo' ? ' · 演示日期' : ' · 本地日期'}`;
  $('#night-toggle').setAttribute('aria-pressed', String(roomNight));
  $('#night-toggle').textContent = roomNight ? '☀' : '☾';
  if (!state.setupComplete) page.innerHTML = setupHtml();
  else {
    page.innerHTML = view === 'home' ? homeHtml() : view === 'meal' ? mealHtml() : view === 'activity' ? activityHtml() : view === 'body' ? bodyHtml() : reviewHtml();
    if (view === 'meal') enhanceMealPage();
    document.querySelectorAll('[data-nav]').forEach((button) => button.classList.toggle('active', button.dataset.nav === view));
    if (view === 'activity' || modal === 'room-activity') timerTicker = setInterval(updateTimerLabel, 1000);
  }
  renderOverlay();
}

function syncPetRoam() {
  unmountPetRoam();
  unmountPetRoam = () => {};
  const scene = $('.room-world.pet-scene');
  if (petPrototypeEnabled && normalizeBodyVariant(state.petAppearance?.bodyVariant) === 'soft' && scene) {
    const resting = isDatePaused(state, currentDate());
    unmountPetRoam = mountPetRoam(scene, {
      paused: Boolean(modal) || Boolean(celebration),
      resting,
      reacting: Boolean(petMotion),
      spots: ROOM_ROAM_SPOTS,
    });
  } else if (normalizeBodyVariant(state.petAppearance?.bodyVariant) === 'soft' && scene) {
    const resting = isDatePaused(state, currentDate());
    unmountPetRoam = mountPetLife(scene, {
      toggle: $('#pet-life-toggle'),
      paused: Boolean(modal) || Boolean(celebration),
      resting,
      reacting: Boolean(petMotion),
    });
  }
}

function renderOverlay() {
  if (celebration) {
    overlay.innerHTML = `<div class="reward-backdrop"><div class="reward-card" role="dialog" aria-modal="true">${renderPet('excited', 'reward')}<div class="reward-emoji">${celebration.domain === 'diet' ? '🧺🥬' : '🗺️👟'}</div><div class="mini">主任务奖励 · 仅结算一次</div><h2>${celebration.domain === 'diet' ? '厨房多了一份准备' : '地图展开了一段路线'}</h2><p>记录已先保存。这个奖励事件也已写入账本，刷新或重复提交不会再次领取。</p><button class="btn block" data-action="reward-close">收好这份回忆</button></div></div>`;
    syncPetRoam();
    return;
  }
  if (!modal) { overlay.innerHTML = ''; syncPetRoam(); return; }
  let title = '', content = '';
  if (modal === 'mode') {
    title = '公开演示模式';
    content = `<p class="lead">本页面固定为独立 DEMO，不提供真实模式或旧档导入。数据只保存在当前浏览器。</p><div class="section-heading">演示日期 <span>仅影响公开 DEMO</span></div>${dayStrip()}`;
  } else if (modal === 'rest') {
    title = '今天想休息';
    const hasDraft = hasFormDraft();
    content = `<p class="lead">已有记录、已确认完成结果和收藏都会保留。休息日不按未完成计算，你仍然可以自由记录。</p>${hasDraft ? '<div class="note warning">检测到正在填写的内容。选择休息不会清空它；稍后返回表单可以继续。</div>' : ''}<div class="stack"><button class="btn secondary block" data-action="pause-one">今天休息${hasDraft ? '（保留草稿）' : ''}</button><button class="btn ghost block" data-action="pause-three">休息 3 天${hasDraft ? '（保留草稿）' : ''}</button>${hasDraft ? '<button class="btn danger block" data-action="pause-discard">放弃草稿并休息今天</button><button class="btn peach block" data-action="modal-close">返回继续填写</button>' : ''}<button class="btn ghost block" data-action="resume">恢复今天的计划</button></div>`;
  } else if (modal === 'room-task' || modal === 'result') {
    const task = currentTask();
    title = '今天的计划怎么样？';
    const paused = isDatePaused(state, currentDate());
    content = !task || task.type === 'review'
      ? `<p class="lead">${esc(taskTitle(task))}</p><button class="btn secondary block" ${modal === 'room-task' ? 'data-action="room-memory-open"' : 'data-nav="review"'}>${modal === 'room-task' ? '去回忆柜看看' : '打开完整周复盘'}</button>`
      : paused
      ? `<p class="lead">${esc(taskTitle(task))}。今天正在休息，主任务不计入未完成。</p><button class="btn secondary block" data-action="resume">恢复今天的计划</button>`
      : `<div class="room-sheet-task"><span class="status ${visibleTaskStatus(state, task)}">${statusLabel(visibleTaskStatus(state, task))}</span><strong>${esc(taskTitle(task))}</strong></div><p class="lead">没有记录不代表失败，请按真实情况选择。选择后才会更新任务结果。</p><div class="stack"><button class="btn secondary block" data-action="task-status" data-status="completed">✓ 我确认已经完成</button><button class="btn ghost block" data-action="task-status" data-status="partial">◒ 完成了一部分</button><button class="btn ghost block" data-action="task-status" data-status="missed">○ 这次没有完成</button><button class="btn peach block" data-action="task-status" data-status="adjusted">↻ 已调整 / 改期</button><button class="btn ghost block" data-action="task-status" data-status="unknown">? 暂不评价</button></div><p class="hint">活动任务会核对已保存的实际分钟数：0 分钟不能标为部分或完成。</p>`;
  } else if (modal === 'room-meal') {
    title = '鉴饭台 · 拍一餐';
    content = `<div class="room-sheet-flow">${mealHtml()}</div>`;
  } else if (modal === 'room-activity') {
    title = '运动角 · 记录活动';
    content = `<div class="room-sheet-flow">${activityHtml()}<button class="btn ghost block room-flow-cancel" type="button" data-action="room-activity-cancel">取消，不保存并返回房间</button></div>`;
  } else if (modal === 'room-memory') {
    title = '回忆柜 · 记录与复盘';
    content = `<div class="room-sheet-flow room-memory-flow">${roomMemoryRecordsHtml()}${reviewHtml()}</div>`;
  } else if (modal === 'plan') {
    title = '调整未来计划';
    content = `<p class="lead">更改从明天起生效，只更新未来且未开始的任务。昨天和已经确认的结果、奖励都不会重写。</p><form id="plan-form"><label class="form-label">饮食行动</label><select class="field" name="focus"><option value="veggie">给一餐增加蔬菜</option><option value="regular">安排一顿规律正餐</option><option value="satiety">留意一餐的饱腹感</option></select><label class="form-label">活动类型</label><select class="field" name="movement"><option value="walk">轻松步行</option><option value="stretch">舒缓活动</option><option value="other">其他适宜运动</option></select><label class="form-label">活动目标</label><select class="field" name="duration"><option value="10">10 分钟</option><option value="15">15 分钟</option><option value="20">20 分钟</option></select><button class="btn block" type="submit" style="margin-top:15px">确认这个小调整</button></form>`;
  } else if (modal.startsWith('delete:')) {
    title = '确认删除记录？';
    content = `<p class="lead">统计和任务状态会立即重新计算。已经发放的奖励会保留审计记录，但同一任务不能借删除重领。</p><div class="button-row"><button class="btn ghost" data-action="modal-close">取消</button><button class="btn danger" data-action="delete-confirm">确认删除</button></div>`;
  }
  const roomFlow = modal.startsWith('room-');
  overlay.innerHTML = `<div class="modal-backdrop" data-action="backdrop"><section class="sheet${roomFlow ? ' room-flow-sheet' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="row sheet-heading"><h2>${esc(title)}</h2><button class="close" data-action="modal-close" aria-label="关闭并返回房间">×</button></div>${content}</section></div>`;
  if (modal === 'room-meal') enhanceMealPage(overlay);
  if (modal === 'plan') {
    const form = $('#plan-form');
    form.elements.focus.value = plan().focus;
    form.elements.movement.value = plan().movement;
    form.elements.duration.value = String(plan().duration);
  }
  syncPetRoam();
}

function hasFormDraft() {
  const meal = state.drafts.meal || {};
  const activity = state.drafts.activity || {};
  return Boolean(meal.food || meal.portion || meal.notes || pendingPhoto || activity.minutes || activity.editId);
}

function clearDrafts() {
  state.drafts = { meal: {}, activity: {} };
  pendingPhoto = null;
  if (pendingPhotoUrl) URL.revokeObjectURL(pendingPhotoUrl);
  pendingPhotoUrl = '';
}

function updateTimerLabel() {
  const label = $('#timer-time');
  if (label) label.textContent = formatElapsed(timerElapsedMs(state.timer));
}

function showReward(domain) {
  celebration = { domain };
  renderOverlay();
}

function playPetMotion(kind, duration = 760) {
  clearTimeout(petMotionTimer);
  petMotion = kind;
  const pet = $('[data-action="pet"]');
  if (pet) {
    [...pet.classList].filter((name) => name.startsWith('pet-motion-')).forEach((name) => pet.classList.remove(name));
    pet.classList.add(`pet-motion-${kind}`);
    pet.dispatchEvent(new CustomEvent('pet-interaction', { detail: { kind }, bubbles: false }));
  }
  petMotionTimer = setTimeout(() => {
    const currentPet = $('[data-action="pet"]');
    currentPet?.classList.remove(`pet-motion-${kind}`);
    petMotion = null;
  }, duration);
}

function interactPet(kind) {
  const longPress = kind === 'hold';
  const pet = $('[data-action="pet"]');
  const sleeping = pet?.dataset.roamState === 'sleeping' || pet?.dataset.spotActivity === 'nest-rest';
  const lively = Boolean(pet?.querySelector('.pet-life-stage'));
  const tapMotions = lively ? ['greet', 'groom'] : ['tilt', 'blink', 'hop'];
  const motion = sleeping ? 'sleep-react' : longPress && lively ? 'groom' : longPress ? 'petting' : tapMotions[petTapSequence++ % tapMotions.length];
  const message = motion === 'sleep-react'
    ? '团团在小窝里轻轻动了动耳朵，又安心趴好了。'
    : motion === 'greet'
      ? '团团站起来合起小爪，认真向你拜一拜。'
      : motion === 'groom'
        ? '团团舔舔小爪，慢悠悠地理了理毛。'
        : longPress
          ? '我在。今天慢一点也完全可以。'
          : '摸摸收到啦。今天无论做多少，我都陪着你。';
  addPetEvent('companion', message);
  persist();
  playPetMotion(motion, lively ? 1260 : longPress ? 1180 : 780);
  notify(motion === 'sleep-react' ? '团团没有被吵醒。' : motion === 'groom' ? '团团认真舔了舔小爪。' : motion === 'greet' ? '团团向你拜了一拜。' : longPress ? '团团在这里陪你慢一会儿。' : '留下了一条温柔的共同回忆。');
}

function linesFromForm(data, group) {
  const names = data.getAll(`${group}Name`);
  const keys = data.getAll(`${group}Key`);
  const mins = data.getAll(`${group}Min`);
  const maxs = data.getAll(`${group}Max`);
  const confidences = data.getAll(`${group}Confidence`);
  const origins = data.getAll(`${group}Origin`);
  return names.map((name, index) => normalizeEstimateLine({
    name,
    foodKey: keys[index],
    gramsMin: mins[index],
    gramsMax: maxs[index],
    confidence: confidences[index],
    origin: origins[index],
  })).filter((line) => line.name || line.foodKey !== 'unknown');
}

function captureMealDraftFromForm(form = $('#meal-form'), invalidateEstimate = false) {
  const draft = ensureMealDraft();
  if (!form) return draft;
  const data = new FormData(form);
  Object.assign(draft, {
    food: data.get('food') || '',
    mealType: data.get('mealType') || draft.mealType || 'snack',
    portion: data.get('portion') || '',
    cookingMethod: data.get('cookingMethod') || 'unknown',
    portionScale: Number(data.get('portionScale')) || 100,
    practice: data.get('practice') || 'unknown',
    notes: data.get('notes') || '',
    ingredients: linesFromForm(data, 'ingredients'),
    fatsAndSauces: linesFromForm(data, 'fatsAndSauces'),
    editId: form.dataset.editId || '',
  });
  if (invalidateEstimate) draft.nutritionEstimate = null;
  return draft;
}

function mealFormForTarget(target) {
  return target?.closest('#meal-form') || $('#meal-form');
}

function analyzePendingMeal() {
  mealAnalysisError = '公开展示版不提供 AI 识别；照片仅在本机处理，请手动填写。';
  render();
}

function cancelMealAnalysis() {
  mealAnalysisToken += 1;
  mealAnalysisController?.abort('cancelled');
  mealAnalysisController = null;
  mealAnalysisBusy = false;
}

async function saveMeal(form) {
  const returnToRoom = modal === 'room-meal';
  const data = new FormData(form);
  const draft = captureMealDraftFromForm(form);
  draft.nutritionEstimate = estimateMealNutrition(draft);
  const target = {
    state, mode, date: currentDate(), submissionId: draft.clientSubmissionId, photo: pendingPhoto,
    photoRevision, planVersion: currentTask()?.planVersion || plan().version,
  };
  const contextIsCurrent = () => state === target.state && mode === target.mode && currentDate() === target.date
    && state.drafts.meal?.clientSubmissionId === target.submissionId && photoRevision === target.photoRevision;
  const editId = form.dataset.editId;
  const at = new Date().toISOString();
  const source = draft.aiAnalysis?.recognized === true ? 'ai-assisted-confirmed' : 'manual';
  let stagedPhotoId = null;
  if (target.photo && (!editId || draft.photoChanged)) stagedPhotoId = await tryStorePhoto(target.photo, uid('photo'));
  if (!contextIsCurrent()) {
    if (stagedPhotoId) deletePhoto(stagedPhotoId);
    throw new Error('保存期间日期、模式或草稿已变化，本次未写入。');
  }

  let transaction;
  try {
    transaction = commitLocalStateMutation(target.state, () => {
      let successMessage;
      let photoToDeleteAfterPersist = null;
      if (editId) {
        const item = target.state.meals.find((record) => record.id === editId);
        if (!item) throw new Error('待编辑的餐食记录已不存在。');
        const previousPhotoId = item.photoId;
        Object.assign(item, {
          food: data.get('food').trim(), portion: data.get('portion').trim(), cookingMethod: draft.cookingMethod, portionScale: draft.portionScale,
          mealType: draft.mealType || 'snack',
          notes: data.get('notes').trim(), actionPractice: data.get('practice'), ingredients: draft.ingredients,
          fatsAndSauces: draft.fatsAndSauces, nutritionEstimate: draft.nutritionEstimate,
          aiAnalysis: draft.aiAnalysis || null, source, updatedAt: at,
        });
        if (draft.removePhoto && previousPhotoId) { item.photoId = null; photoToDeleteAfterPersist = previousPhotoId; }
        else if (stagedPhotoId) {
          item.photoId = stagedPhotoId;
          if (previousPhotoId !== stagedPhotoId) photoToDeleteAfterPersist = previousPhotoId;
        }
        invalidateDietConfirmation(target.state, item.date, at);
        addPetEvent('companion', '餐食记录改好了；今天的任务结果先留作待确认。', item.id);
        successMessage = '修改已保存，请重新确认相关饮食任务结果。';
      } else {
        const result = commitMealOnce(target.state, {
          clientSubmissionId: draft.clientSubmissionId, date: target.date, food: data.get('food'), mealType: draft.mealType, portion: data.get('portion'),
          portionScale: draft.portionScale, notes: data.get('notes'), actionPractice: data.get('practice'), ingredients: draft.ingredients,
          fatsAndSauces: draft.fatsAndSauces, aiAnalysis: draft.aiAnalysis || null, nutritionEstimate: draft.nutritionEstimate,
          source, planVersion: target.planVersion, photoId: stagedPhotoId,
        }, at);
        const item = result.meal;
        if (result.created) item.cookingMethod = draft.cookingMethod;
        else if (stagedPhotoId) photoToDeleteAfterPersist = stagedPhotoId;
        const sticker = result.created ? settleRecordSticker(target.state, 'diet', item.id, at) : { awarded: false };
        if (result.created) addPetEvent('companion', `我把「${item.food}」收进生活笔记了。`, item.id);
        successMessage = result.created ? (sticker.awarded ? '餐食已确认保存，并获得一张料理贴纸；主任务仍待确认。' : '餐食已保存。') : '这次确认已处理，没有重复创建餐食或奖励。';
      }
      target.state.drafts.meal = {};
      return { successMessage, photoToDeleteAfterPersist };
    }, persist);
  } catch (error) {
    if (stagedPhotoId) deletePhoto(stagedPhotoId);
    throw error;
  }
  if (!transaction.persisted) {
    if (stagedPhotoId) deletePhoto(stagedPhotoId);
    mealAnalysisError = '本地存档写入失败，餐食草稿与照片仍保留在当前页；请清理浏览器空间后重试保存。';
    render();
    return;
  }
  if (transaction.value.photoToDeleteAfterPersist) deletePhoto(transaction.value.photoToDeleteAfterPersist);
  mealAnalysisError = '';
  clearPendingPhoto();
  if (returnToRoom && modal === 'room-meal') modal = null;
  render(); notify(transaction.value.successMessage);
}

function saveActivity(form) {
  const returnToRoom = modal === 'room-activity';
  const data = new FormData(form);
  const minutes = Number(data.get('minutes'));
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 600) { notify('请输入 0–600 的整数分钟数。'); return; }
  const editId = form.dataset.editId;
  const at = new Date().toISOString();
  let record;
  if (editId) {
    record = state.activities.find((item) => item.id === editId);
    if (!record) return;
    Object.assign(record, { type: data.get('type'), minutes, feeling: data.get('feeling'), source: data.get('source') || 'manual', updatedAt: at });
  } else {
    record = { id: uid('activity'), date: currentDate(), type: data.get('type'), minutes, feeling: data.get('feeling'), source: data.get('source') || 'manual', planVersion: currentTask()?.planVersion || plan().version, createdAt: at, updatedAt: at };
    state.activities.push(record);
    if (minutes > 0) settleRecordSticker(state, 'activity', record.id, at);
  }
  const result = reconcileActivityTask(state, record.date, at);
  addPetEvent(result.task?.status === 'completed' ? 'excited' : 'companion', minutes > 0 ? `这次 ${minutes} 分钟活动已经记下来了。` : '0 分钟作为真实笔记保存，不会结算完成奖励。', record.id);
  state.drafts.activity = {};
  if (record.source === 'timer') resetTimer(state.timer);
  if (returnToRoom && modal === 'room-activity') modal = null;
  persist(); render();
  if (result.awarded) showReward('activity');
  else notify(editId ? '活动修改已保存，任务状态已重算。' : minutes ? '活动已保存，任务按累计实际分钟结算。' : '0 分钟已保存，不发放活动奖励。');
}

function setResult(status) {
  const task = currentTask();
  if (!task || isDatePaused(state, task.date)) { notify('休息中不考核主任务；可先恢复计划。'); return; }
  if (task.type === 'activity') {
    const result = reconcileActivityTask(state, task.date);
    if (status === 'completed' && result.minutes < task.target.minutes) { notify(`已保存 ${result.minutes} 分钟，达到 ${task.target.minutes} 分钟后才能确认完成。`); return; }
    if (status === 'partial' && result.minutes <= 0) { notify('实际活动为 0 分钟，不能标记为部分完成。'); return; }
  }
  setTaskStatus(state, task.id, status, 'user-confirmed');
  const reward = settleTaskReward(state, task);
  addPetEvent(status === 'completed' ? 'excited' : 'companion', status === 'completed' ? '这件小事完成啦，我们把它收进野餐准备。' : status === 'unknown' ? '没有足够信息就先保留问号。' : '真实结果已经记下，不需要补偿或自责。', task.id);
  modal = null;
  persist(); render();
  if (reward.awarded) showReward(task.type);
  else notify('任务状态已更新。');
}

function applyPause(days, discard = false) {
  if (discard) clearDrafts();
  pauseDates(state, currentDate(), days);
  addPetEvent('rest', days === 1 ? '今天不赶进度，我陪你慢慢休息。' : '这几天先把计划放轻一点，我一直都在。');
  modal = null; persist(); render(); notify(`已开启${days === 1 ? '今天' : '3 天'}休息；已有记录和完成结果保留。`);
}

function handleClick(event) {
  const nav = event.target.closest('[data-nav]');
  if (nav && state.setupComplete) { state.ui.view = nav.dataset.nav; modal = null; persist(); render(); $('#scroll').scrollTop = 0; return; }
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  if (action === 'backdrop' && event.target === target) { modal = null; renderOverlay(); return; }
  if (action === 'modal-close') { modal = null; renderOverlay(); return; }
  if (action === 'feedback-close') { roomFeedback = null; clearTimeout(roomFeedbackTimer); target.closest('.room-feedback-bubble')?.remove(); return; }
  if (action === 'mode-menu') { modal = 'mode'; renderOverlay(); return; }
  if (action === 'night-toggle') { roomNight = !roomNight; localStorage.setItem(PUBLIC_NIGHT_KEY, String(roomNight)); render(); return; }
  if (action === 'room-task-open') { modal = 'room-task'; renderOverlay(); return; }
  if (action === 'room-meal-open') { modal = 'room-meal'; render(); return; }
  if (action === 'room-activity-open') { modal = 'room-activity'; render(); return; }
  if (action === 'body-open') { state.ui.view = 'body'; modal = null; persist(); render(); $('#scroll').scrollTop = 0; return; }
  if (action === 'room-memory-open') { modal = 'room-memory'; renderOverlay(); return; }
  if (action === 'room-activity-cancel') { state.drafts.activity = {}; modal = null; persist(); render(); notify('已取消，没有创建活动记录。'); return; }
  if (action === 'rest-open') { modal = 'rest'; renderOverlay(); return; }
  if (action === 'pause-one') { applyPause(1); return; }
  if (action === 'pause-three') { applyPause(3); return; }
  if (action === 'pause-discard') { applyPause(1, true); return; }
  if (action === 'resume') { const resumed = resumeDate(state, currentDate()); if (resumed?.type === 'activity') reconcileActivityTask(state, resumed.date); addPetEvent('companion', '欢迎回来，我们从今天这件小事重新开始。'); modal = null; persist(); render(); notify('今天已恢复计划。'); return; }
  if (action === 'result-open') { modal = 'result'; renderOverlay(); return; }
  if (action === 'task-status') { setResult(target.dataset.status); return; }
  if (action === 'plan-open') { modal = 'plan'; renderOverlay(); return; }
  if (action === 'reward-close') { celebration = null; renderOverlay(); return; }
  if (action === 'demo-day' && mode === 'demo') { state.ui.demoDayIndex = Number(target.dataset.index); persist(); render(); return; }
  if (action === 'pet') { if (Date.now() >= suppressPetClickUntil) interactPet('tap'); return; }
  if (action === 'timer-toggle') { state.timer.running ? pauseTimer(state.timer) : startTimer(state.timer); state.drafts.activity.source = 'timer'; persist(); render(); return; }
  if (action === 'timer-use') { const input = $('#activity-form [name="minutes"]'); input.value = Math.max(1, Math.floor(timerElapsedMs(state.timer) / 60000)); state.drafts.activity.minutes = input.value; state.drafts.activity.source = 'timer'; persist(); notify('已按累计完整分钟填入，保存后才会成为活动记录。'); return; }
  if (action === 'timer-reset') { resetTimer(state.timer); state.drafts.activity.source = 'manual'; persist(); render(); return; }
  if (action === 'meal-analyze') { analyzePendingMeal(target.closest('#meal-form') || $('#meal-form')); return; }
  if (action === 'meal-copy-recent') { copyRecentMeal(); return; }
  if (action === 'meal-template-apply') { applySelectedMealTemplate(); return; }
  if (action === 'meal-template-save-draft') {
    const form = mealFormForTarget(target);
    const draft = captureMealDraftFromForm(form);
    saveMealTemplateFrom(draft);
    return;
  }
  if (action === 'meal-template-save-record') {
    const item = state.meals.find((record) => record.id === target.dataset.id);
    if (item) saveMealTemplateFrom(item);
    return;
  }
  if (action === 'meal-template-rename') { renameMealTemplate(target); return; }
  if (action === 'meal-template-delete') { deleteMealTemplate(target.dataset.id); return; }
  if (action === 'photo-remove') { const draft = ensureMealDraft(); draft.removePhoto = true; draft.photoChanged = false; clearPendingPhoto(); mealAnalysisError = ''; persist(); render(); notify('照片已从当前草稿移除，尚未改变已保存记录。'); return; }
  if (action === 'meal-line-add') { const draft = captureMealDraftFromForm(mealFormForTarget(target)); draft[target.dataset.group].push({ name:'', foodKey:'unknown', gramsMin:null, gramsMax:null, confidence:'low', origin:'user-edited' }); draft.nutritionEstimate = null; persist(); render(); return; }
  if (action === 'meal-line-remove') { const draft = captureMealDraftFromForm(mealFormForTarget(target)); draft[target.dataset.group].splice(Number(target.dataset.index), 1); draft.nutritionEstimate = null; persist(); render(); return; }
  if (action === 'meal-reestimate') { const draft = captureMealDraftFromForm(mealFormForTarget(target)); draft.nutritionEstimate = estimateMealNutrition(draft); persist(); render(); notify(draft.nutritionEstimate.range ? '已按当前食材和份量重新计算区间。' : '还缺可映射的食材或克数，暂无法计算。'); return; }
  if (action === 'meal-cancel') { const returnToRoom = modal === 'room-meal'; state.drafts.meal = {}; mealAnalysisError = ''; clearPendingPhoto(); if (returnToRoom) modal = null; persist(); render(); notify('已取消，没有创建餐食记录。'); return; }
  if (action === 'cancel-edit') {
    const mealContext = Boolean(target.closest('#meal-form')) || modal === 'room-meal' || state.ui.view === 'meal';
    if (mealContext) { state.drafts.meal = {}; clearPendingPhoto(); }
    else state.drafts.activity = {};
    persist(); render(); return;
  }
  if (action === 'meal-edit') { const item = state.meals.find((record)=>record.id===target.dataset.id); if (item) { if (modal === 'room-memory') modal = 'room-meal'; beginMealEdit(item); } return; }
  if (action === 'activity-edit') { const item = state.activities.find((record)=>record.id===target.dataset.id); if (item) { if (modal === 'room-memory') modal = 'room-activity'; state.drafts.activity = { editId:item.id, type:item.type, minutes:item.minutes, feeling:item.feeling, source:item.source }; persist(); render(); } return; }
  if (action === 'body-edit') { const item = state.bodyMeasurements.find((record) => record.id === target.dataset.id); if (item) { state.drafts.bodyMeasurement = { ...item, editId: item.id }; persist(); render(); } return; }
  if (action === 'body-cancel') { state.drafts.bodyMeasurement = {}; persist(); render(); return; }
  if (action === 'body-delete') { modal = `delete:body:${target.dataset.id}`; renderOverlay(); return; }
  if (action === 'meal-delete' || action === 'activity-delete') { modal = `delete:${action.startsWith('meal')?'meal':'activity'}:${target.dataset.id}`; renderOverlay(); return; }
  if (action === 'delete-confirm') { deleteConfirmed(); return; }
  if (action === 'ending-preview') { endingPreview = target.dataset.ending; render(); return; }
  if (action === 'review-save') { const result = saveWeekReviewOnce(state); if (result.created) { state.memories.push({ id:uid('memory'), reviewId:result.review.id, title:endings[result.review.ending].title, createdAt:new Date().toISOString() }); persist(); render(); notify('本周纪念卡已保存。'); } return; }
}

function deleteConfirmed() {
  const [, type, id] = modal.split(':');
  const at = new Date().toISOString();
  if (type === 'meal') {
    const item = state.meals.find((record) => record.id === id);
    state.meals = state.meals.filter((record) => record.id !== id);
    if (item) { invalidateDietConfirmation(state, item.date, at); if (item.photoId) deletePhoto(item.photoId); }
  } else if (type === 'activity') {
    const item = state.activities.find((record) => record.id === id);
    state.activities = state.activities.filter((record) => record.id !== id);
    if (item) reconcileActivityTask(state, item.date, at);
  } else if (type === 'body') {
    const result = commitLocalStateMutation(state, () => {
      state.bodyMeasurements = state.bodyMeasurements.filter((record) => record.id !== id);
    }, persist);
    if (!result.persisted) { notify('本地存储写入失败，身体记录未删除。'); return; }
  }
  modal = null; persist(); render(); notify(type === 'body' ? '身体记录已删除。' : '记录已删除，统计和任务状态已同步更新；历史奖励账本保留。');
}

function handleSubmit(event) {
  event.preventDefault();
  const form = event.target;
  if (!form.reportValidity()) return;
  if (form.id === 'calorie-target-form') {
    const value = new FormData(form).get('target');
    const target = value === '' ? null : Number(value);
    if (target !== null && (!Number.isInteger(target) || target < 500 || target > 10000)) { notify('目标需为 500–10000 kcal 的整数。'); return; }
    state.settings.dailyCalorieTarget = target;
    persist(); render(); notify(target ? '每日目标已保存。' : '每日目标已清除。'); return;
  }
  if (form.id === 'setup-form') {
    const data = new FormData(form);
    const fresh = initialState({ mode, setupComplete: true, petName: data.get('petName').trim() || '团团', focus: data.get('focus'), movement: data.get('movement'), duration: Number(data.get('duration')) });
    state = fresh; addPetEvent('excited', `你好呀！我是${plan().petName}，这一周我们慢慢来。`); persist(); render(); return;
  }
  if (form.id === 'meal-form') {
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    form.querySelector('button[type="submit"]').disabled = true;
    saveMeal(form).catch((error) => {
      console.error('餐食保存失败', error);
      form.dataset.submitting = 'false';
      form.querySelector('button[type="submit"]').disabled = false;
      notify('餐食暂未保存，请稍后重试。');
    });
    return;
  }
  if (form.id === 'activity-form') {
    if (form.dataset.submitting === 'true') return;
    form.dataset.submitting = 'true';
    form.querySelector('button[type="submit"]').disabled = true;
    saveActivity(form);
    return;
  }
  if (form.id === 'body-form') {
    const data = new FormData(form);
    const toValue = (name, max) => {
      const value = data.get(name);
      if (value === '') return null;
      const number = Number(value);
      return Number.isFinite(number) && number > 0 && number <= max ? number : undefined;
    };
    const weightKg = toValue('weightKg', 500), waistCm = toValue('waistCm', 300), hipCm = toValue('hipCm', 400);
    if ([weightKg, waistCm, hipCm].includes(undefined)) { notify('请输入合理的正数，或留空。'); return; }
    if (weightKg === null && waistCm === null && hipCm === null) { notify('请至少填写体重、腰围或臀围中的一项。'); return; }
    const date = String(data.get('date'));
    const editId = form.dataset.editId;
    const editing = state.bodyMeasurements.find((item) => item.id === editId);
    const sameDate = state.bodyMeasurements.find((item) => item.date === date);
    if (editing && sameDate && sameDate.id !== editing.id) { notify('该日期已有一条身体记录；请先编辑那一条。'); return; }
    const existing = editing || sameDate;
    const record = normalizeBodyMeasurement({
      ...(existing || {}), id: existing?.id || uid('body'), date,
      weightKg: data.get('clearWeight') ? null : weightKg === null && existing ? existing.weightKg : weightKg,
      waistCm: data.get('clearWaist') ? null : waistCm === null && existing ? existing.waistCm : waistCm,
      hipCm: data.get('clearHip') ? null : hipCm === null && existing ? existing.hipCm : hipCm,
      createdAt: existing?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    if (!record) { notify('请至少保留一项有效数值。'); return; }
    const transaction = commitLocalStateMutation(state, () => {
      if (existing) Object.assign(existing, record);
      else state.bodyMeasurements.push(record);
      state.drafts.bodyMeasurement = {};
    }, persist);
    if (!transaction.persisted) { notify('本地存储写入失败，身体记录尚未保存。'); return; }
    render(); notify(existing ? '该日期的身体记录已更新。' : '身体记录已保存在本机。'); return;
  }
  if (form.id === 'plan-form') {
    const data = new FormData(form);
    const changes = { focus: data.get('focus'), movement: data.get('movement'), duration: Number(data.get('duration')) };
    const effectiveFrom = addLocalDays(currentDate(), 1);
    if (effectiveFrom > addLocalDays(plan().startDate, 6)) state.nextWeekDraft = { ...changes, id:uid('draft'), createdAt:new Date().toISOString(), confirmedByUser:true };
    else updateFuturePlan(state, effectiveFrom, changes);
    addPetEvent('companion', '未来的路线已经重新画好，走过的脚印没有改变。'); modal = null; persist(); render(); notify('调整已保存，只影响未来未开始的任务。');
  }
}

function handleInput(event) {
  const form = event.target.closest('form');
  if (!form || !['meal-form','activity-form'].includes(form.id)) return;
  const data = Object.fromEntries(new FormData(form));
  if (form.id === 'meal-form') {
    const lineField = /^(ingredients|fatsAndSauces)(?:Name|Key|Min|Max)$/.exec(event.target.name || '');
    if (lineField) {
      const origin = event.target.closest('.ingredient-row')?.querySelector(`[name="${lineField[1]}Origin"]`);
      if (origin) origin.value = 'user-edited';
    }
    const nutritionField = /^(food|cookingMethod|portionScale|ingredients|fatsAndSauces)/.test(event.target.name || '');
    const draft = captureMealDraftFromForm(form, nutritionField);
    if (nutritionField) {
      draft.nutritionEstimate = estimateMealNutrition(draft);
      const formRoot = form.closest('.room-flow-sheet') || page;
      const estimateCard = $('#meal-nutrition-estimate', formRoot);
      if (estimateCard) estimateCard.innerHTML = nutritionEstimateHtml(draft.nutritionEstimate);
    }
  }
  else state.drafts.activity = { ...state.drafts.activity, type:data.type || 'walk', minutes:data.minutes ?? '', feeling:data.feeling || 'justright', source:data.source || 'manual', editId:form.dataset.editId || '' };
  persist();
}

function handleChange(event) {
  if (!['meal-camera', 'meal-gallery'].includes(event.target.id)) return;
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = '';
  selectMealPhoto(file, mealFormForTarget(event.target)).catch((error) => {
    console.error('照片处理失败', error);
    notify(error?.message || '照片无法处理，请更换 JPEG、PNG 或 WebP。');
  });
}

async function beginMealEdit(item) {
  const targetState = state;
  const targetMode = mode;
  clearPendingPhoto();
  mealAnalysisError = '';
  state.drafts.meal = {
    clientSubmissionId: item.clientSubmissionId || uid('meal-submit'), editId:item.id, food:item.food, mealType:item.mealType || 'snack', portion:item.portion,
    cookingMethod:item.cookingMethod || 'unknown', portionScale:item.portionScale || 100, notes:item.notes, practice:item.actionPractice,
    ingredients:item.ingredients || [], fatsAndSauces:item.fatsAndSauces || [], aiAnalysis:item.aiAnalysis || null,
    nutritionEstimate:item.nutritionEstimate || null, existingPhotoId:item.photoId || null, photoChanged:false, removePhoto:false,
  };
  const existingPhotoLoadToken = ++photoSelectionToken;
  persist(); render();
  if (!item.photoId) return;
  const blob = await getPhoto(item.photoId).catch(() => null);
  if (!blob || existingPhotoLoadToken !== photoSelectionToken || state !== targetState || mode !== targetMode
    || state.drafts.meal.editId !== item.id || state.drafts.meal.photoChanged || state.drafts.meal.removePhoto) return;
  setPendingPhoto(blob, false);
  render();
}

function copyRecentMeal() {
  const source = [...state.meals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!source) return;
  const currentDraft = state.drafts.meal || {};
  if ((currentDraft.food || currentDraft.notes || currentDraft.editId) && !window.confirm('以最近一餐开始新记录？当前草稿不会保留。')) return;
  cancelMealAnalysis();
  clearPendingPhoto();
  state.drafts.meal = {
    clientSubmissionId: uid('meal-submit'), food: source.food, mealType: source.mealType || 'snack',
    portion: source.portion || '', cookingMethod: source.cookingMethod || 'unknown', portionScale: source.portionScale || 100,
    notes: '', practice: 'unknown', ingredients: structuredClone(source.ingredients || []),
    fatsAndSauces: structuredClone(source.fatsAndSauces || []), nutritionEstimate: source.nutritionEstimate || null,
    aiAnalysis: null, existingPhotoId: null, photoChanged: false, removePhoto: false,
  };
  persist(); render(); notify('已复制为新草稿；核对后需再次确认保存。');
}

function saveMealTemplateFrom(source) {
  if ((state.mealTemplates || []).length >= 50) { notify('常吃餐最多保存 50 个；请先删除不再使用的模板。'); return; }
  const at = new Date().toISOString();
  const template = createMealTemplate(source, { at });
  if (!template) { notify('请先填写餐食名称，再收藏为常吃餐。'); return; }
  const transaction = commitLocalStateMutation(state, () => {
    state.mealTemplates ||= [];
    state.mealTemplates.unshift(template);
    return template;
  }, persist);
  if (!transaction.persisted) { notify('本地空间不足，常吃餐未保存。'); return; }
  render(); notify(`已收藏「${template.name}」；照片、备注和 AI 图片分析未写入模板。`);
}

function applySelectedMealTemplate() {
  const select = $('#meal-template-select');
  const percentInput = $('#meal-template-percent');
  const template = (state.mealTemplates || []).find((item) => item.id === select?.value);
  if (!template) { notify('请选择一个常吃餐。'); return; }
  const percent = Number(percentInput?.value);
  if (!Number.isFinite(percent) || percent < 10 || percent > 300) { notify('本次份量需为模板的 10%–300%。'); return; }
  const form = $('#meal-form');
  if (form) captureMealDraftFromForm(form);
  const currentDraft = state.drafts.meal || {};
  const hasDraft = Boolean(currentDraft.food || currentDraft.notes || currentDraft.editId || currentDraft.ingredients?.length || pendingPhoto);
  if (hasDraft && !window.confirm('套用常吃餐会替换当前草稿。继续吗？')) return;
  const draft = draftFromMealTemplate(template, percent, uid('meal-submit'));
  if (!draft) { notify('这个常吃餐无法读取，请删除后重新收藏。'); return; }
  draft.nutritionEstimate = estimateMealNutrition(draft);
  const transaction = commitLocalStateMutation(state, () => { state.drafts.meal = draft; }, persist);
  if (!transaction.persisted) { notify('本地空间不足，当前草稿仍保留，常吃餐未套用。'); return; }
  cancelMealAnalysis();
  clearPendingPhoto();
  mealAnalysisError = '';
  render(); notify(`已套用「${template.name}」并按 ${percent}% 调整；核对后确认保存才会创建餐食。`);
}

function renameMealTemplate(target) {
  const template = (state.mealTemplates || []).find((item) => item.id === target.dataset.id);
  const input = target.closest('[data-template-row]')?.querySelector('input');
  const name = String(input?.value || '').trim().slice(0, 80);
  if (!template || !name) { notify('常吃餐名称不能为空。'); return; }
  const transaction = commitLocalStateMutation(state, () => {
    template.name = name;
    template.updatedAt = new Date().toISOString();
  }, persist);
  if (!transaction.persisted) { notify('本地空间不足，名称未修改。'); return; }
  render(); notify('常吃餐名称已修改。');
}

function deleteMealTemplate(id) {
  const template = (state.mealTemplates || []).find((item) => item.id === id);
  if (!template || !window.confirm(`删除常吃餐「${template.name}」？已保存的餐食不会改变。`)) return;
  const transaction = commitLocalStateMutation(state, () => {
    state.mealTemplates = state.mealTemplates.filter((item) => item.id !== id);
  }, persist);
  if (!transaction.persisted) { notify('本地空间不足，常吃餐未删除。'); return; }
  render(); notify('常吃餐已删除；原餐食记录保留。');
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('浏览器无法解码这张图片。')); };
    image.src = url;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('图片压缩失败。')), type, quality));
}

async function compressMealPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('仅支持 JPEG、PNG 或 WebP；HEIC 请先转换。');
  if (file.size > 12 * 1024 * 1024) throw new Error('原图请小于 12MB。');
  const image = await loadImageElement(file);
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let blob = await canvasToBlob(canvas, 'image/jpeg', 0.82);
  if (blob.size > 3_000_000) blob = await canvasToBlob(canvas, 'image/jpeg', 0.66);
  if (blob.size > 3_000_000) throw new Error('压缩后仍超过 3MB，请选择更小的图片。');
  return blob;
}

function setPendingPhoto(blob, changed = true) {
  clearPendingPhoto();
  pendingPhoto = blob;
  pendingPhotoUrl = URL.createObjectURL(blob);
  const draft = ensureMealDraft();
  draft.photoChanged = changed;
  draft.removePhoto = false;
}

async function selectMealPhoto(file, form = $('#meal-form')) {
  const draft = captureMealDraftFromForm(form);
  const target = { state, mode, submissionId: draft.clientSubmissionId };
  const token = ++photoSelectionToken;
  notify('正在本机压缩照片…');
  const blob = await compressMealPhoto(file);
  if (token !== photoSelectionToken || state !== target.state || mode !== target.mode || state.drafts.meal?.clientSubmissionId !== target.submissionId) return;
  setPendingPhoto(blob, true);
  mealAnalysisError = '';
  const currentDraft = ensureMealDraft();
  currentDraft.aiAnalysis = null;
  currentDraft.nutritionEstimate = null;
  persist(); render();
  notify(`照片已压缩为 ${Math.ceil(blob.size / 1024)}KB；不会自动发送或保存。`);
}

function clearPendingPhoto() {
  cancelMealAnalysis();
  photoSelectionToken += 1;
  photoRevision += 1;
  pendingPhoto = null;
  if (pendingPhotoUrl) URL.revokeObjectURL(pendingPhotoUrl);
  pendingPhotoUrl = '';
}

function openPhotoDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PUBLIC_PHOTO_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storePhoto(blob, id) {
  const db = await openPhotoDb();
  await new Promise((resolve, reject) => { const tx = db.transaction('photos','readwrite'); tx.objectStore('photos').put(blob,id); tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error); });
  db.close(); return id;
}

async function getPhoto(id) {
  const db = await openPhotoDb();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction('photos', 'readonly');
    const request = tx.objectStore('photos').get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return value;
}

async function tryStorePhoto(blob, id) {
  try {
    return await storePhoto(blob, id);
  } catch (error) {
    console.error('照片写入失败', error);
    notify('照片未能保存在此浏览器；文字记录仍会正常保存。');
    return null;
  }
}

async function deletePhoto(id) {
  try { const db = await openPhotoDb(); const tx = db.transaction('photos','readwrite'); tx.objectStore('photos').delete(id); tx.oncomplete=()=>db.close(); } catch {}
}

phone.addEventListener('click', handleClick);
phone.addEventListener('submit', handleSubmit);
phone.addEventListener('input', handleInput);
phone.addEventListener('change', handleChange);
phone.addEventListener('error', (event) => {
  const lifeAssetFailed = Boolean(event.target?.closest?.('.pet-life-candidate'));
  const activated = activatePetFallback(event.target);
  if (activated && lifeAssetFailed) event.target.closest?.('[data-action="pet"]')?.dispatchEvent(new CustomEvent('pet-life-assets-failed'));
}, true);
phone.addEventListener('pointerdown', (event) => {
  const pet = event.target.closest('[data-action="pet"]');
  if (!pet || event.button > 0) return;
  petPointerId = event.pointerId;
  petPointerStartX = event.clientX;
  petPointerStartY = event.clientY;
  petPointerMoved = false;
  pet.setPointerCapture?.(event.pointerId);
  petHoldActive = false;
  clearTimeout(petHoldTimer);
  petHoldTimer = setTimeout(() => {
    petHoldActive = true;
    suppressPetClickUntil = Date.now() + 900;
    interactPet('hold');
  }, 520);
});
phone.addEventListener('pointerup', (event) => {
  if (event.pointerId !== petPointerId) return;
  clearTimeout(petHoldTimer);
  if (!petHoldActive && !petPointerMoved) {
    suppressPetClickUntil = Date.now() + 900;
    interactPet('tap');
  }
  petPointerId = null;
  petPointerMoved = false;
});
phone.addEventListener('pointermove', (event) => {
  if (event.pointerId !== petPointerId || petHoldActive || petPointerMoved) return;
  const distance = Math.hypot(event.clientX - petPointerStartX, event.clientY - petPointerStartY);
  if (distance < 10) return;
  petPointerMoved = true;
  clearTimeout(petHoldTimer);
});
phone.addEventListener('pointercancel', (event) => {
  if (event.pointerId !== petPointerId) return;
  clearTimeout(petHoldTimer);
  petHoldActive = false;
  petPointerId = null;
  petPointerMoved = false;
});
phone.addEventListener('pointerleave', (event) => {
  if (!event.target.closest?.('[data-action="pet"]') || event.pointerId !== petPointerId) return;
  clearTimeout(petHoldTimer);
  petHoldActive = false;
  petPointerId = null;
  petPointerMoved = false;
});
phone.addEventListener('pointerout', (event) => {
  if (event.pointerId !== petPointerId || !event.target.closest?.('[data-action="pet"]')) return;
  if (event.relatedTarget instanceof Node && event.target.closest('[data-action="pet"]')?.contains(event.relatedTarget)) return;
  clearTimeout(petHoldTimer);
  petHoldActive = false;
  petPointerId = null;
  petPointerMoved = false;
});
phone.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || (!modal && !celebration)) return;
  event.preventDefault();
  modal = null;
  celebration = null;
  renderOverlay();
});
window.addEventListener('beforeunload', persist);
render();
let renderedRealDate = today();
setInterval(() => {
  if (mode !== 'real' || today() === renderedRealDate) return;
  renderedRealDate = today();
  render();
  notify('新的一天到了，已切换到今天的计划。');
}, 60_000);
