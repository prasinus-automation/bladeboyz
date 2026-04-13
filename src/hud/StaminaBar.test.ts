import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StaminaBar } from './StaminaBar';

describe('StaminaBar', () => {
  let bar: StaminaBar;

  beforeEach(() => {
    bar = new StaminaBar();
  });

  afterEach(() => {
    bar.dispose();
  });

  it('creates stamina-bar element in DOM', () => {
    expect(document.getElementById('stamina-bar')).not.toBeNull();
  });

  it('updates label text with current/max', () => {
    bar.update(60, 100);
    const container = document.getElementById('stamina-bar')!;
    const label = container.querySelector('div:last-child') as HTMLElement;
    expect(label.textContent).toBe('60 / 100');
  });

  it('sets blue color when stamina > 30%', () => {
    bar.update(50, 100);
    const fill = document.getElementById('stamina-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.background).toContain('rgb(68, 136, 204)');
  });

  it('sets yellow color when stamina <= 30%', () => {
    bar.update(25, 100);
    const fill = document.getElementById('stamina-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.background).toContain('rgb(204, 170, 68)');
  });

  it('removes element on dispose', () => {
    bar.dispose();
    expect(document.getElementById('stamina-bar')).toBeNull();
  });
});
