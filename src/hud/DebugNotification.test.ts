import { describe, it, expect, beforeEach } from 'vitest';
import { showNotification } from './DebugNotification';

describe('DebugNotification', () => {
  beforeEach(() => {
    // Clean up any existing notification container
    const existing = document.getElementById('debug-notifications');
    if (existing) existing.remove();
  });

  it('should create a notification container on first call', () => {
    showNotification('Test');
    const container = document.getElementById('debug-notifications');
    expect(container).not.toBeNull();
  });

  it('should add a notification element with the correct text', () => {
    showNotification('Wireframe: ON');
    const container = document.getElementById('debug-notifications');
    expect(container).not.toBeNull();
    const children = container!.children;
    expect(children.length).toBe(1);
    expect(children[0].textContent).toBe('Wireframe: ON');
  });

  it('should support multiple notifications', () => {
    showNotification('First');
    showNotification('Second');
    const container = document.getElementById('debug-notifications');
    expect(container!.children.length).toBe(2);
  });
});
