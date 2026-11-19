// Gamepad (PS4 DualShock 4 over Bluetooth) input — shared by the six
// playable level pages (courtyard, ballroom x3, theater, halloween).
// Standard Gamepad API mapping; poll once per frame in the page's
// animation loop. If no gamepad is connected the game is untouched
// (keyboard / mouse / touch keep working exactly as before).
//
// Button indices (standard mapping): Cross 0, Circle 1, Square 2,
// Triangle 3, L1 4, R1 5, L2 6 (analog), R2 7 (analog), Share 8,
// Options 9, L3 10, R3 11, D-pad Up 12, Down 13, Left 14, Right 15,
// PS 16, Touchpad 17. Axes: left stick X/Y 0/1, right stick X/Y 2/3.
// Dead zone 0.2 on the sticks. pressed() is edge-detected (this frame
// only); held() is the current held state.
export const GP = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3,
  L1: 4, R1: 5, L2: 6, R2: 7,
  SHARE: 8, OPTIONS: 9, L3: 10, R3: 11,
  DPAD_UP: 12, DPAD_DOWN: 13, DPAD_LEFT: 14, DPAD_RIGHT: 15,
  PS: 16, TOUCHPAD: 17,
  LX: 0, LY: 1, RX: 2, RY: 3,
  DEADZONE: 0.2,
  // Right-stick look speed, rad/s at full deflection.
  LOOK_SPEED: 2.5,
};

export function createGamepad() {
  let pad = null, prev = [];
  // seen latches true the first time any gamepad input is detected and
  // clears on disconnect. The courtyard uses it to know a controller
  // (not pointer lock) is driving the game, so losing pointer lock does
  // not pop the start overlay back up for a controller-only player.
  let seen = false;
  function find() {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      if (pads[i] && pads[i].connected) return pads[i];
    }
    return null;
  }
  function dz(v) { return Math.abs(v) < GP.DEADZONE ? 0 : v; }
  const gp = {
    lx: 0, ly: 0, rx: 0, ry: 0, l2: 0, r2: 0,
    _cur: [], _prev: [],
    get connected() { return !!pad; },
    get seen() { return seen; },
    update() {
      pad = find();
      if (!pad) {
        // Disconnected (or never connected): clear everything so no
        // button or stick direction sticks, and drop the latch so the
        // page falls back to its normal pointer-lock / touch flow.
        this.lx = this.ly = this.rx = this.ry = 0;
        this.l2 = this.r2 = 0;
        this._cur = []; this._prev = [];
        prev = []; seen = false;
        return false;
      }
      const b = pad.buttons, cur = [];
      for (let i = 0; i < b.length; i++) cur[i] = !!b[i].pressed;
      this._prev = prev; this._cur = cur; prev = cur;
      this.lx = dz(pad.axes[0] || 0);
      this.ly = dz(pad.axes[1] || 0);
      this.rx = dz(pad.axes[2] || 0);
      this.ry = dz(pad.axes[3] || 0);
      this.l2 = (b[6] && b[6].value) || 0;
      this.r2 = (b[7] && b[7].value) || 0;
      if (this.lx || this.ly || this.rx || this.ry || cur.some((v) => v)) seen = true;
      return true;
    },
    held(i) { return !!(this._cur && this._cur[i]); },
    pressed(i) { return !!(this._cur && this._cur[i] && !(this._prev && this._prev[i])); },
    released(i) { return !!(!(this._cur && this._cur[i]) && this._prev && this._prev[i]); },
  };
  return gp;
}
