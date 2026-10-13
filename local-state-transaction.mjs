function restorePlainState(target, snapshot) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, snapshot);
}

// The mutation and storage write are intentionally synchronous. Callers must
// finish any photo/IO staging first so no other UI action can interleave between
// the snapshot, Meal/reward/event mutation, and the durable localStorage write.
export function commitLocalStateMutation(state, mutate, persist) {
  const snapshot = structuredClone(state);
  try {
    const value = mutate();
    if (persist()) return { persisted: true, value };
    restorePlainState(state, snapshot);
    return { persisted: false, value: null };
  } catch (error) {
    restorePlainState(state, snapshot);
    throw error;
  }
}
