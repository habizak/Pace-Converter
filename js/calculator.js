import {
    normalizeTime,
    normalizeDistance,
    normalizePace,
    normalizeVelocity,
    parseDigitsToTime,
    parseDigitsToPace,
} from './normalize.js';
import { convertUnits } from './convert.js';

class PaceCalculator {
    constructor() {
        this.target = 'TIME';
        this.unitSystem = 'METRIC';
        this.computeTimeout = null;
        this.lastEdited = 'PACE';

        this.init();
        this.loadState();
        this.attachEventListeners();
        this.updateUI();
    }

    init() {
        this.timeInput = document.getElementById('timeInput');
        this.distanceInput = document.getElementById('distanceInput');
        this.speedInput = document.getElementById('speedInput');
        this.paceInput = document.getElementById('paceInput');

        this.distanceLabel = document.getElementById('distanceLabel');
        this.speedLabel = document.getElementById('speedLabel');
        this.paceLabel = document.getElementById('paceLabel');

        this.unitToggle = document.getElementById('unitToggle');
        this.imperialToggle = document.getElementById('imperialToggle');
        this.resetBtn = document.getElementById('resetBtn');

        this.timeBtn = document.getElementById('timeBtn');
        this.distanceBtn = document.getElementById('distanceBtn');
        this.speedBtn = document.getElementById('speedBtn');
    }

    attachEventListeners() {
        [this.timeInput, this.distanceInput, this.speedInput, this.paceInput].forEach(input => {
            input.addEventListener('input', () => {
                if (input === this.paceInput) this.lastEdited = 'PACE';
                if (input === this.speedInput) this.lastEdited = 'SPEED';
                this.debouncedCompute();
            });
            input.addEventListener('blur', () => this.handleBlur(input));
        });

        this.unitToggle.addEventListener('click', () => this.setUnitSystem('METRIC'));
        this.imperialToggle.addEventListener('click', () => this.setUnitSystem('IMPERIAL'));
        // Click clears values, long-press (>=500ms) does factory reset
        let pressTimer = null;
        const startPress = () => {
            clearTimeout(pressTimer);
            pressTimer = setTimeout(() => this.factoryReset(), 500);
        };
        const cancelPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
        };
        this.resetBtn.addEventListener('mousedown', startPress);
        this.resetBtn.addEventListener('touchstart', startPress, { passive: true });
        this.resetBtn.addEventListener('mouseup', () => {
            if (pressTimer) { cancelPress(); this.clear(); }
        });
        this.resetBtn.addEventListener('touchend', () => {
            if (pressTimer) { cancelPress(); this.clear(); }
        });
        this.resetBtn.addEventListener('mouseleave', cancelPress);

        this.timeBtn.addEventListener('click', () => this.setTarget('TIME'));
        this.distanceBtn.addEventListener('click', () => this.setTarget('DISTANCE'));
        this.speedBtn.addEventListener('click', () => this.setTarget('SPEED'));
    }

    debouncedCompute() {
        clearTimeout(this.computeTimeout);
        this.computeTimeout = setTimeout(() => this.compute(), 200);
    }

    handleBlur(input) {
        clearTimeout(this.computeTimeout);

        // Apply digits-to-timestamp conversion before normalization (blur-only)
        const raw = input.value.trim();

        if (input === this.timeInput) {
            const auto = parseDigitsToTime(raw);
            if (auto) input.value = auto;
        } else if (input === this.paceInput) {
            const auto = parseDigitsToPace(raw);
            if (auto) input.value = auto;
        }

        this.normalizeInput(input);
        this.compute();
        this.saveState();
    }

    normalizeInput(input) {
        let value = input.value.trim();
        if (!value) return;

        if (input === this.timeInput) {
            value = normalizeTime(value);
        } else if (input === this.distanceInput) {
            value = normalizeDistance(value);
        } else if (input === this.speedInput) {
            value = normalizeVelocity(value);
        } else if (input === this.paceInput) {
            value = normalizePace(value);
        }

        input.value = value;
    }

    setTarget(newTarget) {
        this.target = newTarget;
        this.updateUI();
        this.saveState();
    }

    setUnitSystem(newSystem) {
        const old = this.unitSystem;
        this.unitSystem = newSystem;
        this.convertUnits(old, this.unitSystem);
        this.updateUI();
        this.saveState();
        this.compute();
    }

    convertUnits(fromSystem, toSystem) {
        convertUnits(fromSystem, toSystem, {
            distanceInput: this.distanceInput,
            speedInput: this.speedInput,
            paceInput: this.paceInput,
            normalizePace,
        });
    }

    clear() {
        this.timeInput.value = '';
        this.distanceInput.value = '';
        this.speedInput.value = '';
        this.paceInput.value = '';

        this.updateUI();
        this.saveState();
    }

    factoryReset() {
        this.timeInput.value = '';
        this.distanceInput.value = '';
        this.speedInput.value = '';
        this.paceInput.value = '';
        this.target = 'TIME';
        this.unitSystem = 'METRIC';
        this.updateUI();
        this.saveState();
    }

    updateUI() {
        // Clear target/nontarget classes from all fields
        const allFields = Array.from(document.querySelectorAll('.ctds-field'));
        allFields.forEach(field => field.classList.remove('is-target', 'is-nontarget'));

        // Mark target field(s)
        const timeField = document.querySelector('.ctds-field--time');
        const distanceField = document.querySelector('.ctds-field--distance');
        const speedField = document.querySelector('.ctds-field--speed');
        const paceField = document.querySelector('.ctds-field--pace');

        if (this.target === 'TIME') {
            timeField.classList.add('is-target');
        } else if (this.target === 'DISTANCE') {
            distanceField.classList.add('is-target');
        } else if (this.target === 'SPEED') {
            // Lock BOTH speed and pace (both are derived from time+distance)
            speedField.classList.add('is-target');
            paceField.classList.add('is-target');
        }

        // Anything not marked as target becomes non-target (dimmed, editable)
        allFields.forEach(field => {
            if (!field.classList.contains('is-target')) field.classList.add('is-nontarget');
        });

        // Enable/disable inputs based on is-target flag
        [this.timeInput, this.distanceInput, this.speedInput, this.paceInput].forEach(input => {
            const field = input.closest('.ctds-field');
            const isTarget = field.classList.contains('is-target');
            input.disabled = isTarget;
            input.setAttribute('aria-disabled', String(isTarget));
        });

        // Update labels based on unit system
        this.distanceLabel.textContent = this.unitSystem === 'METRIC' ? 'KM' : 'MI';
        this.speedLabel.textContent = this.unitSystem === 'METRIC' ? 'KM/H' : 'MPH';
        this.paceLabel.textContent = this.unitSystem === 'METRIC' ? 'MIN/KM' : 'MIN/MI';

        // Set input modes and patterns
        this.timeInput.setAttribute('inputmode', 'numeric');
        this.timeInput.setAttribute('pattern', '\\d{1,2}:\\d{2}:\\d{2}');

        this.distanceInput.setAttribute('inputmode', 'decimal');
        this.distanceInput.removeAttribute('pattern');

        this.speedInput.setAttribute('inputmode', 'decimal');
        this.speedInput.removeAttribute('pattern');

        this.paceInput.setAttribute('inputmode', 'numeric');
        this.paceInput.setAttribute('pattern', '\\d{1,2}:\\d{2}');

        // Update toggle button states
        this.unitToggle.classList.toggle('is-active', this.unitSystem === 'METRIC');
        this.imperialToggle.classList.toggle('is-active', this.unitSystem === 'IMPERIAL');

        // Update circle buttons
        [this.timeBtn, this.distanceBtn, this.speedBtn].forEach(btn => {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-pressed', 'false');
        });
        const activeBtn = document.getElementById(`${this.target.toLowerCase()}Btn`);
        if (activeBtn) {
            activeBtn.classList.add('is-active');
            activeBtn.setAttribute('aria-pressed', 'true');
        }
    }

    compute() {
        const timeStr = this.timeInput.value;
        const distanceStr = this.distanceInput.value;
        const speedStr = this.speedInput.value;
        const paceStr = this.paceInput.value;

        const time = this.parseTime(timeStr);
        const distance = parseFloat(distanceStr) || 0;
        const speed = parseFloat(speedStr) || 0;
        const pace = this.parsePace(paceStr);

        const hasV = speed > 0, hasP = pace > 0;
        const pickPace = (hasP && !hasV) || (hasP && hasV && this.lastEdited === 'PACE');
        const pickSpeed = (hasV && !hasP) || (hasP && hasV && this.lastEdited === 'SPEED');

        if (this.target === 'TIME') {
            if (distance > 0) {
                if (pickSpeed) {
                    // Calculate from speed: time = distance / speed
                    const result = (distance / speed) * 3600;
                    this.timeInput.value = this.formatTime(result);
                } else if (pickPace) {
                    // Calculate from pace: time = distance * pace
                    const result = distance * pace;
                    this.timeInput.value = this.formatTime(result);
                }
            }
        } else if (this.target === 'DISTANCE') {
            if (time > 0) {
                if (pickSpeed) {
                    // Calculate from speed: distance = speed * (time / 3600)
                    const result = speed * (time / 3600);
                    this.distanceInput.value = Math.min(99.99, result).toFixed(2);
                } else if (pickPace) {
                    // Calculate from pace: distance = time / pace
                    const result = time / pace;
                    this.distanceInput.value = Math.min(99.99, result).toFixed(2);
                }
            }
        } else if (this.target === 'SPEED') {
            if (time > 0 && distance > 0) {
                const vNew = distance / (time / 3600);
                const pNew = time / distance;
                this.speedInput.value = Math.min(99.99, vNew).toFixed(2);
                this.paceInput.value = this.formatPace(pNew);
            }
        }

        // --- keep speed/pace in sync when time & distance are known ---
        {
            const tNow = this.parseTime(this.timeInput.value);
            const dNow = parseFloat(this.distanceInput.value) || 0;

            if (tNow > 0 && dNow > 0) {
                const vNew = dNow / (tNow / 3600); // units/hour
                const pNew = tNow / dNow;          // sec/unit

                const hasSpeed = !!(parseFloat(this.speedInput.value) || 0);
                const hasPace = !!this.parsePace(this.paceInput.value);

                if (this.lastEdited === 'PACE') {
                    // user is driving with pace; back-fill speed
                    this.speedInput.value = Math.min(99.99, vNew).toFixed(2);
                } else if (this.lastEdited === 'SPEED') {
                    // user is driving with speed; back-fill pace
                    this.paceInput.value = this.formatPace(pNew);
                } else {
                    // neither explicitly "last touched": fill whichever is empty, or both
                    if (!hasSpeed) this.speedInput.value = Math.min(99.99, vNew).toFixed(2);
                    if (!hasPace) this.paceInput.value = this.formatPace(pNew);
                }
            }
        }

        const ann = document.getElementById('ann');
        if (ann) {
            const prev = this._lastAnn || '';
            const msg = `Updated: time ${this.timeInput.value || '—'}, distance ${this.distanceInput.value || '—'}, speed ${this.speedInput.value || '—'}, pace ${this.paceInput.value || '—'}`;
            if (msg !== prev) { ann.textContent = msg; this._lastAnn = msg; }
        }

        this.saveState();
    }

    parseTime(timeStr) {
        if (!timeStr) return 0;
        const parts = timeStr.split(':').map(p => parseInt(p) || 0);
        if (parts.length === 3) {
            const [h, m, s] = parts;
            return h * 3600 + m * 60 + s;
        }
        return 0;
    }

    parsePace(paceStr) {
        if (!paceStr) return 0;
        const parts = paceStr.split(':').map(p => parseInt(p) || 0);
        if (parts.length === 2) {
            const [m, s] = parts;
            return m * 60 + s;
        }
        return 0;
    }

    formatTime(seconds) {
        let h = Math.floor(seconds / 3600);
        let m = Math.floor((seconds % 3600) / 60);
        let s = Math.round(seconds % 60);
        if (s === 60) { s = 0; m += 1; }
        if (m === 60) { m = 0; h += 1; }
        h = Math.min(99, h);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    formatPace(seconds) {
        let m = Math.floor(seconds / 60);
        let s = Math.round(seconds % 60);
        if (s === 60) { s = 0; m += 1; }
        if (m > 20 || (m === 20 && s > 59)) { m = 20; s = 59; }
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    saveState() {
        const state = {
            target: this.target,
            unitSystem: this.unitSystem,
            values: {
                time: this.timeInput.value,
                distance: this.distanceInput.value,
                speed: this.speedInput.value,
                pace: this.paceInput.value,
            },
        };
        localStorage.setItem('pace-calculator-state', JSON.stringify(state));
    }

    loadState() {
        try {
            const saved = localStorage.getItem('pace-calculator-state');
            if (saved) {
                const state = JSON.parse(saved);
                this.target = state.target || 'TIME';
                this.unitSystem = state.unitSystem || 'METRIC';

                if (state.values) {
                    if (state.values.time) this.timeInput.value = state.values.time;
                    if (state.values.distance) this.distanceInput.value = state.values.distance;
                    if (state.values.speed) this.speedInput.value = state.values.speed;
                    if (state.values.pace) this.paceInput.value = state.values.pace;
                }
            }
        } catch (e) {
            // Use defaults
        }
    }

    getSeedPace() {
        const pace = this.paceInput.value.trim();
        if (!pace) {
            return null;
        }

        const normalized = this.normalizePace(pace);
        const seconds = this.parsePace(normalized);
        return seconds > 0 ? seconds : null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const calculator = new PaceCalculator();

    const modeSingle = document.getElementById('modeSingle');
    const modeMulti = document.getElementById('modeMulti');
    const singleApp = document.getElementById('singlePaceApp');
    const multiApp = document.getElementById('multiPaceApp');
    const announcer = document.getElementById('ann');

    if (!modeSingle || !modeMulti || !singleApp || !multiApp || !announcer) {
        return;
    }

    let multiController = null;
    let multiModulePromise = null;

    function announce(message) {
        announcer.textContent = message;
    }

    async function ensureMultiController() {
        if (multiController) {
            return multiController;
        }

        if (!multiModulePromise) {
            multiModulePromise = import('./multi-pace.js');
        }

        const { initMultiPaceApp } = await multiModulePromise;
        multiController = initMultiPaceApp({
            root: multiApp,
            storageKey: 'multi-pace-state',
            announce,
            getSeedPace: () => calculator.getSeedPace(),
        });
        return multiController;
    }

    async function setMode(mode) {
        const isMulti = mode === 'multi';
        document.body.classList.toggle('is-multi-pace', isMulti);
        singleApp.hidden = isMulti;
        multiApp.hidden = !isMulti;
        modeSingle.classList.toggle('is-active', !isMulti);
        modeMulti.classList.toggle('is-active', isMulti);
        localStorage.setItem('pace-mode', isMulti ? 'multi' : 'single');

        if (isMulti) {
            const controller = await ensureMultiController();
            controller.activate();
        } else if (multiController) {
            multiController.deactivate();
        }
    }

    modeSingle.addEventListener('click', () => { void setMode('single'); });
    modeMulti.addEventListener('click', () => { void setMode('multi'); });

    const savedMode = localStorage.getItem('pace-mode') || 'single';
    void setMode(savedMode);
});
