import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HealthBar } from './HealthBar';

describe('HealthBar', () => {
  let bar: HealthBar;

  beforeEach(() => {
    bar = new HealthBar();
  });

  afterEach(() => {
    bar.dispose();
  });

  it('creates health-bar element in DOM', () => {
    expect(document.getElementById('health-bar')).not.toBeNull();
  });

  it('updates label text with current/max', () => {
    bar.update(75, 100);
    const container = document.getElementById('health-bar')!;
    const label = container.querySelector('div:last-child') as HTMLElement;
    expect(label.textContent).toBe('75 / 100');
  });

  it('sets green color when health > 60%', () => {
    bar.update(80, 100);
    const fill = document.getElementById('health-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.background).toContain('rgb(68, 204, 68)');
  });

  it('sets yellow color when health 30-60%', () => {
    bar.update(40, 100);
    const fill = document.getElementById('health-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.background).toContain('rgb(204, 204, 68)');
  });

  it('sets red color when health < 30%', () => {
    bar.update(20, 100);
    const fill = document.getElementById('health-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.background).toContain('rgb(204, 68, 68)');
  });

  it('sets width to 0% when current is 0', () => {
    bar.update(0, 100);
    const fill = document.getElementById('health-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.width).toBe('0%');
  });

  it('sets width to 100% when current >= max', () => {
    bar.update(120, 100);
    const fill = document.getElementById('health-bar')!.querySelector('div') as HTMLElement;
    expect(fill.style.width).toBe('100%');
  });

  it('removes element on dispose', () => {
    bar.dispose();
    expect(document.getElementById('health-bar')).toBeNull();
  });
});
