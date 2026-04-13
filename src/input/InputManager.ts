/**
 * Raw input capture — keyboard, mouse, pointer lock.
 * No abstraction libraries — direct browser events.
 */
export class InputManager {
  readonly keys = new Set<string>();
  mouseDeltaX = 0;
  mouseDeltaY = 0;
  mouseButtons = 0;
  isPointerLocked = false;

  private _element: HTMLElement;

  constructor(element: HTMLElement) {
    this._element = element;

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);

    document.addEventListener('pointerlockchange', this._onPointerLockChange);

    // Request pointer lock on click
    element.addEventListener('click', () => {
      if (!this.isPointerLocked) {
        element.requestPointerLock();
      }
    });
  }

  /** Reset per-frame deltas. Call at end of each frame. */
  resetDeltas(): void {
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
  }

  dispose(): void {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    document.removeEventListener(
      'pointerlockchange',
      this._onPointerLockChange,
    );
  }

  private _onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code);
  };

  private _onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private _onMouseMove = (e: MouseEvent): void => {
    if (this.isPointerLocked) {
      this.mouseDeltaX += e.movementX;
      this.mouseDeltaY += e.movementY;
    }
  };

  private _onMouseDown = (e: MouseEvent): void => {
    this.mouseButtons = e.buttons;
  };

  private _onMouseUp = (e: MouseEvent): void => {
    this.mouseButtons = e.buttons;
  };

  private _onPointerLockChange = (): void => {
    this.isPointerLocked = document.pointerLockElement === this._element;
  };
}
