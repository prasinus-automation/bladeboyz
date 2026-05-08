/**
 * theme — sanity tests
 */
import { describe, it, expect } from 'vitest';
import { theme } from './theme';

describe('theme', () => {
  it('exports the documented top-level groups', () => {
    expect(theme).toHaveProperty('font');
    expect(theme).toHaveProperty('bg');
    expect(theme).toHaveProperty('border');
    expect(theme).toHaveProperty('text');
    expect(theme).toHaveProperty('status');
    expect(theme).toHaveProperty('z');
  });

  it('font is monospace (matches existing HUD convention)', () => {
    expect(theme.font).toBe('monospace');
  });

  it('z-index tiers are strictly ordered', () => {
    expect(theme.z.hud).toBeLessThan(theme.z.prompt);
    expect(theme.z.prompt).toBeLessThan(theme.z.menu);
    expect(theme.z.menu).toBeLessThanOrEqual(theme.z.overlay);
  });

  it('all color values are non-empty strings', () => {
    const groups = [theme.bg, theme.border, theme.text, theme.status] as const;
    for (const g of groups) {
      for (const v of Object.values(g)) {
        expect(typeof v).toBe('string');
        expect(v.length).toBeGreaterThan(0);
      }
    }
  });

  it('preserves the warn/good colors that match index.html CSS variables', () => {
    // index.html mirrors these in :root — keep in sync.
    expect(theme.status.good).toBe('#0f0');
    expect(theme.status.warn).toBe('#ff0');
    expect(theme.text.inverse).toBe('#fff');
    expect(theme.bg.black).toBe('#000');
    expect(theme.bg.backdrop).toBe('rgba(0, 0, 0, 0.7)');
  });
});
