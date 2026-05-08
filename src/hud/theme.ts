/**
 * theme — shared visual constants for HUD overlays.
 *
 * Extracted from the hardcoded literals previously scattered across HUD.ts and
 * the index.html `<style>` block. New HUD modules should pull from here so
 * future redesigns are a one-file change.
 *
 * Migration policy (per issue #101): only HUD.ts and index.html consume this
 * for now. Other HUD modules (InventoryPanel, DirectionIndicator, FloatingDamage,
 * etc.) keep their literals — they will be migrated incrementally in follow-up
 * issues. Keeping the diff narrow avoids visual regressions across modules
 * that aren't being touched here.
 */

export const theme = {
  /** Default font for HUD elements. Game uses monospace consistently. */
  font: 'monospace',

  /** Background colors. */
  bg: {
    /** Main panel background — opaque, dark blue-grey. */
    panel: 'rgba(20, 20, 30, 0.95)',
    /** Backdrop behind modal panels — translucent black. */
    backdrop: 'rgba(0, 0, 0, 0.7)',
    /** Subtle inner cell / placeholder background. */
    subtle: 'rgba(40, 40, 50, 0.6)',
    /** Pure black — body and overlay backgrounds. */
    black: '#000',
  },

  /** Border colors. */
  border: {
    default: '#444',
    hover: '#666',
    accent: '#ffcc00',
  },

  /** Text colors. */
  text: {
    primary: '#ddd',
    secondary: '#aaa',
    muted: '#888',
    accent: '#ffcc00',
    /** White text on dark backdrops (e.g. click-to-play). */
    inverse: '#fff',
  },

  /** Status / state colors. */
  status: {
    /** "Good" — green (debug overlay, healthy). */
    good: '#0f0',
    /** "Warn" — yellow (FSM label, FPS info). */
    warn: '#ff0',
    /** "Bad" — red. */
    bad: '#cc4444',
    /** "Info" — blue. */
    info: '#4488cc',
  },

  /** z-index tiers. Higher = closer to user. */
  z: {
    /** HUD elements (health, stamina, FPS, debug overlay, crosshair). */
    hud: 10,
    /** Click-prompt / pre-game overlays. */
    prompt: 100,
    /** Modal menus (pause, controls, inventory). */
    menu: 200,
    /** Modal panel above its backdrop. */
    overlay: 201,
  },
} as const;

export type Theme = typeof theme;
