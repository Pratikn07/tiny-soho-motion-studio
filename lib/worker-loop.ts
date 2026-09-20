export function createSingleFlightRunner(task: () => Promise<void>) {
  let active: Promise<void> | null = null;
  return function run() {
    if (active) return active;
    active = task().finally(() => { active = null; });
    return active;
  };
}
