// 角色名單與隊伍：選角畫面、連線驗證、電腦組隊都用這裡
import { CHAR_DEFS, type CharDef } from './defs';

/** 一隊兩隻角色：[左邊 slot 0, 右邊 slot 1] */
export type Team = [string, string];

/** 可以選的角色（依登記順序） */
export function roster(): CharDef[] {
  return Object.values(CHAR_DEFS).filter(c => !c.hidden);
}

/** 檢查隊伍是否合法（連線時對方送來的隊伍一定要先檢查） */
export function isValidTeam(t: unknown, allowSameChar: boolean): t is Team {
  if (!Array.isArray(t) || t.length !== 2) return false;
  const ids = new Set(roster().map(c => c.id));
  if (!t.every(x => typeof x === 'string' && ids.has(x))) return false;
  return allowSameChar || t[0] !== t[1];
}

/** 隨機組一隊（電腦用） */
export function randomTeam(rnd: () => number, allowSameChar: boolean): Team {
  const ids = roster().map(c => c.id);
  const a = ids[Math.floor(rnd() * ids.length)];
  const rest = allowSameChar || ids.length < 2 ? ids : ids.filter(x => x !== a);
  return [a, rest[Math.floor(rnd() * rest.length)]];
}
