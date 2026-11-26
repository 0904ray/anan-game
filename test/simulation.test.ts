import { describe, it, expect } from 'vitest';
import { simulate, type Team } from './helpers';

// 隨機電腦大量對打：抓當機、卡住、數值跑到不合理的地方
const SAV: Team = ['savanna', 'savanna'];
const MIX: Team = ['savanna', 'granny'];
const SAVIEL: Team = ['saviel', 'savanna'];

describe('隨機對打（壓力測試）', () => {
  it('兩隻薩凡娜對打 1000 場', () => {
    const w = simulate([SAV, SAV], 1000, () => 34);
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
  it('薩凡娜＋葛蘭妮 對打 1000 場（吞噬的牌會在隊友之間移動，所以檢查雙方總數）', () => {
    const w = simulate([MIX, MIX], 1000, () => 34);
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
  it('薩維爾＋薩凡娜 對打 1000 場', () => {
    const w = simulate([SAVIEL, MIX], 1000, () => 34);
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
});
