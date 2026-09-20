import { defaultLibDir, loadScanner } from './scanner-loader';

describe('loadScanner', () => {
  it('CLI lib를 동적 import로 불러온다', async () => {
    const s = await loadScanner(defaultLibDir());
    expect(s.scanText('password: hunter2', 'a.yml')[0].rule).toBe(
      'secret-key-value',
    );
  });
});
