/**
 * DebugNotification — shows brief toast notifications when debug toggles fire.
 *
 * Notifications appear in the bottom-center, stack upward, and fade after ~1.5s.
 */

const DISPLAY_MS = 1500;

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  // Check both cache and DOM (in case it was removed externally, e.g. in tests)
  if (container && container.parentNode) return container;
  container = document.createElement('div');
  container.id = 'debug-notifications';
  container.style.cssText =
    'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
    'display:flex;flex-direction:column-reverse;align-items:center;gap:4px;' +
    'pointer-events:none;z-index:50;';
  document.body.appendChild(container);
  return container;
}

/**
 * Show a brief notification (e.g. "Hitboxes: ON").
 */
export function showNotification(text: string): void {
  const c = ensureContainer();
  const el = document.createElement('div');
  el.textContent = text;
  el.style.cssText =
    'padding:4px 12px;background:rgba(0,0,0,0.75);color:#fff;' +
    'font-family:monospace;font-size:14px;border-radius:4px;' +
    'opacity:1;transition:opacity 0.3s ease;';

  c.appendChild(el);

  setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, DISPLAY_MS);
}
