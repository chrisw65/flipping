export function createLimiter(maxConcurrent: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= maxConcurrent) return;
    const resolver = queue.shift();
    if (!resolver) return;
    active += 1;
    resolver();
  };

  const acquire = () =>
    new Promise<() => void>((resolve) => {
      const release = () => {
        active = Math.max(0, active - 1);
        next();
      };
      queue.push(() => resolve(release));
      next();
    });

  return { acquire };
}
