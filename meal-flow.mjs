import { isDatePaused, setTaskStatus, settleTaskReward, taskForDate } from './core.mjs';

export const DIET_TASK_CONFIRMATIONS = Object.freeze(['completed', 'missed', 'unknown']);

export function dietTaskForMealConfirmation(state, date) {
  const task = taskForDate(state, date);
  if (!task || task.type !== 'diet' || isDatePaused(state, date)) return null;
  return task;
}

// Meal.actionPractice describes only this meal. A daily task is changed only by
// this separate, explicit choice made during the save flow.
export function applyDietTaskConfirmation(state, date, confirmation = 'unknown', at = new Date().toISOString()) {
  const task = dietTaskForMealConfirmation(state, date);
  if (!task || !['completed', 'missed'].includes(confirmation)) {
    return { confirmed: false, task, reward: { awarded: false, reward: null } };
  }
  setTaskStatus(state, task.id, confirmation, 'meal-save-user-confirmed', at);
  const reward = confirmation === 'completed'
    ? settleTaskReward(state, task, at)
    : { awarded: false, reward: null };
  return { confirmed: true, task, reward };
}
