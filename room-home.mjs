// Room-first presentation helpers. This module only derives view data and
// markup; it never writes records, settles tasks, or changes the save schema.
export const ROOM_ENTRYPOINTS = Object.freeze({
  task: Object.freeze({ action: 'room-task-open', label: '打开今日任务' }),
  meal: Object.freeze({ action: 'room-meal-open', label: '打开鉴饭台' }),
  activity: Object.freeze({ action: 'room-activity-open', label: '打开运动角' }),
  rest: Object.freeze({ action: 'rest-open', label: '进入休息选项' }),
  memory: Object.freeze({ action: 'room-memory-open', label: '打开回忆柜' }),
});

export const ROOM_ART_ASSETS = Object.freeze({
  backdrop: 'assets/pet/room-interior-reference-v1.webp',
  rug: 'assets/pet/room-rug-reference-v1.webp',
  nest: 'assets/pet/room-nest-reference-v1.webp',
  meal: 'assets/pet/room-meal-table-reference-v1.webp',
  shoes: 'assets/pet/room-shoes-reference-v1.webp',
});

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

export function createRoomHomeModel({
  task,
  taskTitle,
  taskStatus,
  taskStatusLabel,
  paused = false,
  dayIndex = -1,
  mode = 'real',
  dateLabel = '',
  petName = '团团',
  mealCount = 0,
  activityCount = 0,
}) {
  const inWeek = dayIndex >= 0 && dayIndex <= 6;
  return Object.freeze({
    taskTitle: taskTitle || '本周计划已经走完',
    taskStatus: taskStatus || 'unknown',
    taskStatusLabel: taskStatusLabel || '待确认',
    taskType: task?.type || 'review',
    paused: Boolean(paused),
    dayLabel: paused ? '今天休息' : inWeek ? `第 ${dayIndex + 1} 天` : '真实日期',
    modeLabel: mode === 'demo' ? 'DEMO' : '',
    dateLabel,
    petName,
    mealCount: Number(mealCount) || 0,
    activityCount: Number(activityCount) || 0,
  });
}

export function roomHomeHtml({ model, petHtml, feedbackHtml = '', prototypeChrome = '', petMotionClass = '', summaryHtml = '' }) {
  const taskIcon = model.taskType === 'diet' ? '🥬' : model.taskType === 'activity' ? '👟' : '📖';
  const petName = escapeHtml(model.petName);
  const taskTitle = escapeHtml(model.taskTitle);
  const taskStatus = escapeHtml(model.taskStatus);
  const taskStatusLabel = escapeHtml(model.taskStatusLabel);
  const motionClass = escapeHtml(petMotionClass);
  return `<section class="room-home" aria-label="${petName}的小屋">
    <div class="scene-backdrop" data-room-layer="0" aria-hidden="true">
      <img class="room-backdrop-art" src="${ROOM_ART_ASSETS.backdrop}" alt="">
    </div>
    <div class="room-world pet-scene" data-room-layer-root>
      <div class="room-ground" data-room-layer="1" aria-hidden="true">
        <img class="room-rug-art" src="${ROOM_ART_ASSETS.rug}" alt="">
      </div>
      <div class="room-props" data-room-layer="2">
        <div class="room-mantra-note" aria-hidden="true"><span class="room-note-pin"></span><strong>今天，<br>我们只做<br>一件小事。</strong><i>♡</i></div>
        <button class="room-hotspot room-cabinet" type="button" data-action="${ROOM_ENTRYPOINTS.memory.action}" aria-label="${ROOM_ENTRYPOINTS.memory.label}">
          <span class="cabinet-photo" aria-hidden="true"><i>♡</i></span><span class="hotspot-label"><b aria-hidden="true">▧</b> 回忆</span>
        </button>
        <button class="room-hotspot room-meal-table" type="button" data-action="${ROOM_ENTRYPOINTS.meal.action}" aria-label="${ROOM_ENTRYPOINTS.meal.label}，拍照或手工记录一餐">
          <img class="room-prop-image" src="${ROOM_ART_ASSETS.meal}" alt=""><span class="hotspot-label"><b aria-hidden="true">◉</b> 鉴饭台</span>
        </button>
        <button class="room-hotspot room-nest" type="button" data-action="${ROOM_ENTRYPOINTS.rest.action}" aria-label="${ROOM_ENTRYPOINTS.rest.label}">
          <img class="room-prop-image" src="${ROOM_ART_ASSETS.nest}" alt=""><span class="hotspot-label"><b aria-hidden="true">⌂</b> 小窝</span>
        </button>
        <button class="room-hotspot room-shoes" type="button" data-action="${ROOM_ENTRYPOINTS.activity.action}" aria-label="${ROOM_ENTRYPOINTS.activity.label}">
          <img class="room-prop-image" src="${ROOM_ART_ASSETS.shoes}" alt=""><span class="hotspot-label"><b aria-hidden="true">⌁</b> 运动角</span>
        </button>
      </div>
      <div class="room-pet-layer" data-room-layer="3">
        ${prototypeChrome}
        <span class="pet-shadow" aria-hidden="true"></span><span class="room-yarn" aria-hidden="true"></span><button class="pet-button ${model.paused ? 'rest' : 'companion'}${motionClass ? ` ${motionClass}` : ''}" type="button" data-action="pet" aria-label="摸摸${petName}">${petHtml}</button>
      </div>
      <div class="room-feedback" data-room-layer="4" aria-live="polite">${feedbackHtml}</div>
    </div>
    <div class="room-bottom-panel">
      <button class="room-hotspot room-task-paper" type="button" data-action="${ROOM_ENTRYPOINTS.task.action}" aria-label="${ROOM_ENTRYPOINTS.task.label}：${taskTitle}">
        <span class="room-task-title"><b aria-hidden="true">▣</b> 今日任务</span><strong>${taskIcon} ${taskTitle}</strong><span class="status ${taskStatus}">${taskStatusLabel}</span><i aria-hidden="true">›</i>
      </button>
      ${summaryHtml}
    </div>
  </section>`;
}
