import { describe, it, expect } from 'vitest';
import { simulate, type Team } from './helpers';

// 隨機電腦大量對打：抓當機、卡住、數值跑到不合理的地方
const SAV: Team = ['savanna', 'savanna'];
const MIX: Team = ['savanna', 'granny'];
const SAVIEL: Team = ['saviel', 'savanna'];
const RANIS: Team = ['ranis', 'savanna'];
const MIA: Team = ['mia', 'savanna'];
const LIL: Team = ['liliante', 'savanna'];
const HER: Team = ['heretic', 'savanna'];

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
  it('拉尼斯＋薩凡娜 對打 1000 場（牌會被移出牌局，所以雙方總數檢查含移除的牌）', () => {
    const w = simulate([RANIS, MIX], 1000, () => 34);
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
  it('米雅＋薩凡娜 對打 1000 場（不公之恩寵會把牌移出牌局）', () => {
    const w = simulate([MIA, MIX], 1000, () => 34);
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
  it('利利安特＋薩凡娜 對打 1000 場（自傷、[不屈]讓瀕死時還能行動）', () => {
    // 利利安特牌組規格列出的張數是 16 張（薩凡娜、葛蘭妮是 17），所以第 0 邊是 33
    const w = simulate([LIL, MIX], 1000, p => (p === 0 ? 33 : 34));
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
  it('異端物＋薩凡娜 對打 1000 場（手牌付費、掃場、型態改寫）', () => {
    // 異端物 18 張＋薩凡娜 17 張
    const w = simulate([HER, MIX], 1000, p => (p === 0 ? 35 : 34));
    expect(w[0] + w[1]).toBeGreaterThan(950);
  });
});
