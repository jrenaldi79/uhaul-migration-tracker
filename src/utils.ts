export function randomDelay(range: [number, number]): Promise<void> {
  const [min, max] = range;
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function getLookupDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatDate(d);
}

export function log(context: string, message: string): void {
  const ts = new Date().toISOString();
  console.log('[' + ts + '] [' + context + '] ' + message);
}

export function logError(context: string, message: string): void {
  const ts = new Date().toISOString();
  console.error('[' + ts + '] [' + context + '] ERROR: ' + message);
}
