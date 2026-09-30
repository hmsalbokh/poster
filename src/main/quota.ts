export const INSERT_COST = 1600;
export const DAILY_LIMIT = 10000;

export function uploadsLeftToday(usedUnits: number): number {
  return Math.max(0, Math.floor((DAILY_LIMIT - usedUnits) / INSERT_COST));
}
