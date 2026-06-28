// EmuLatte Couch Mode renderer — Phase 0 placeholder (see docs/couch-mode-plan.md).
// Just proves the fullscreen mode loads and can hand control back to Desktop Mode.
function exitCouch() { window.api && window.api.exitCouch && window.api.exitCouch(); }

document.getElementById('exit').addEventListener('click', exitCouch);
document.addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'F11') exitCouch(); });

// Gamepad B / Circle (button 1) → exit. Edge-triggered poll of the first connected pad.
let _bWasDown = false;
function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.prototype.find.call(pads, p => p);
    const bDown = !!(gp && gp.buttons[1] && gp.buttons[1].pressed);
    if (bDown && !_bWasDown) exitCouch();
    _bWasDown = bDown;
    requestAnimationFrame(pollGamepad);
}
requestAnimationFrame(pollGamepad);
