import { parseDigitsToPace, normalizePace } from './normalize.js';
import { parseGPX, segmentRoute } from './gpx.js';

const MIN_ZONE_SEGMENTS = 5;
const EMPTY_HINT = 'Routes between 5.0km and 45.0km.';
const NO_ELEVATION_WARNING = 'Elevation data missing. Using flat segment bars.';

function createZoneId() {
    return `zone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, min, max) {
    if (Number.isNaN(value)) return min;
    return Math.max(min, Math.min(max, value));
}

function formatDistance(distanceKm) {
    return `${distanceKm.toFixed(1)}km`;
}

function formatDuration(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) {
        return '';
    }

    const rounded = Math.round(totalSeconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;

    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatTotalTime(totalSeconds) {
    if (!Number.isFinite(totalSeconds)) {
        return '';
    }

    const rounded = Math.round(totalSeconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const seconds = rounded % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatPace(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '';
    }

    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return normalizePace(`${mins}:${secs}`);
}

function formatSpeed(secondsPerKm) {
    if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) {
        return '';
    }

    return `${(3600 / secondsPerKm).toFixed(1)} km/h`;
}

function getZoneDistanceKm(zone, segments, route) {
    if (!segments.length) {
        return 0;
    }

    const start = segments[zone.startIndex];
    const end = segments[zone.endIndex];
    if (!start || !end) {
        return 0;
    }

    const preciseEndKm = zone.endIndex === segments.length - 1
        ? route.totalKm
        : end.endKm;
    return Number((preciseEndKm - start.startKm).toFixed(6));
}

function cloneState(state) {
    return JSON.parse(JSON.stringify(state));
}

function ensureValidZones(zones, segmentCount) {
    if (!Array.isArray(zones) || !zones.length || segmentCount <= 0) {
        return null;
    }

    const ordered = zones
        .map(zone => ({
            id: zone.id || createZoneId(),
            startIndex: Number(zone.startIndex),
            endIndex: Number(zone.endIndex),
            paceSeconds: Number.isFinite(zone.paceSeconds) ? zone.paceSeconds : null,
        }))
        .sort((a, b) => a.startIndex - b.startIndex);

    let expectedStart = 0;
    for (const zone of ordered) {
        const span = zone.endIndex - zone.startIndex + 1;
        if (zone.startIndex !== expectedStart || span < MIN_ZONE_SEGMENTS) {
            return null;
        }
        expectedStart = zone.endIndex + 1;
    }

    if (expectedStart !== segmentCount) {
        return null;
    }

    return ordered;
}

export function initMultiPaceApp({ root, storageKey, announce, getSeedPace }) {
    const doc = root.ownerDocument;
    const elements = {
        emptyState: root.querySelector('#multiEmptyState'),
        loadedState: root.querySelector('#multiLoadedState'),
        chartRegion: root.querySelector('#multiChartRegion'),
        zones: root.querySelector('#multiZones'),
        totalRow: root.querySelector('#multiTotalRow'),
        totalTime: root.querySelector('#multiTotalTime'),
        error: root.querySelector('#multiError'),
        warning: root.querySelector('#multiWarning'),
        uploadGpxBtn: root.querySelector('#uploadGpxBtn'),
        uploadMultiBtn: root.querySelector('#multiUploadBtn'),
        addZoneBtn: root.querySelector('#addZoneBtn'),
        deleteZoneBtn: root.querySelector('#deleteZoneBtn'),
        fileInput: root.querySelector('#gpxFileInput'),
        actionRow: root.querySelector('#multiActionRow'),
        resetBtn: root.querySelector('#multiReset'),
        sheet: doc.getElementById('mpSheet'),
        sheetBackdrop: doc.getElementById('mpSheetBackdrop'),
        sheetLabel: doc.getElementById('mpSheetLabel'),
        sheetInput: doc.getElementById('mpSheetInput'),
        sheetConfirm: doc.getElementById('mpSheetConfirm'),
    };

    const state = {
        route: null,
        segments: [],
        zones: [],
        selectedZoneId: null,
        warning: '',
        error: '',
        editing: false,
        dragging: null,
    };

    let listenersBound = false;

    function clearPersistedState() {
        try {
            localStorage.removeItem(storageKey);
        } catch {
            // Storage is optional; keep the current session running.
        }
    }

    function getPersistedState() {
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) {
                return null;
            }

            const parsed = JSON.parse(raw);
            if (!parsed?.route || !Array.isArray(parsed?.segments)) {
                return null;
            }

            const firstSegment = parsed.segments[0];
            if (
                !Number.isFinite(parsed.route.totalKm) || parsed.route.totalKm <= 0 ||
                !firstSegment ||
                !Number.isFinite(firstSegment.startKm) ||
                !Number.isFinite(firstSegment.endKm) ||
                !Number.isFinite(firstSegment.heightRatio)
            ) {
                clearPersistedState();
                return null;
            }

            const zones = ensureValidZones(parsed.zones, parsed.segments.length);
            if (!zones) {
                return null;
            }

            return {
                route: parsed.route,
                segments: parsed.segments,
                zones,
                selectedZoneId: zones.some(zone => zone.id === parsed.selectedZoneId)
                    ? parsed.selectedZoneId
                    : zones[0]?.id ?? null,
                warning: parsed.warning || '',
            };
        } catch {
            return null;
        }
    }

    function persist() {
        if (!state.route || !state.segments.length || !state.zones.length) {
            clearPersistedState();
            return;
        }

        try {
            localStorage.setItem(storageKey, JSON.stringify({
                route: state.route,
                segments: state.segments,
                zones: state.zones,
                selectedZoneId: state.selectedZoneId,
                warning: state.warning,
            }));
        } catch {
            // Storage is optional; keep the current session running.
        }
    }

    function clearStatus() {
        state.error = '';
        elements.error.hidden = true;
        elements.error.textContent = '';
    }

    function showError(message) {
        state.error = message;
        elements.error.hidden = false;
        elements.error.textContent = message;
        announce(message);
    }

    function showWarning(message) {
        state.warning = message || '';
        elements.warning.hidden = !message;
        elements.warning.textContent = message || '';
    }

    function getSelectedZone() {
        return state.zones.find(zone => zone.id === state.selectedZoneId) ?? null;
    }

    function getZoneMetrics(zone) {
        const distanceKm = getZoneDistanceKm(zone, state.segments, state.route);
        const durationSeconds = zone.paceSeconds ? zone.paceSeconds * distanceKm : null;
        return {
            distanceKm,
            durationSeconds,
            speedText: formatSpeed(zone.paceSeconds),
            paceText: formatPace(zone.paceSeconds),
            durationText: durationSeconds == null ? '' : formatDuration(durationSeconds),
        };
    }

    function getTotalDuration() {
        if (!state.zones.length || state.zones.some(zone => !zone.paceSeconds)) {
            return null;
        }

        return state.zones.reduce((sum, zone) => {
            const distanceKm = getZoneDistanceKm(zone, state.segments, state.route);
            return sum + (zone.paceSeconds * distanceKm);
        }, 0);
    }

    function renderChart() {
        elements.chartRegion.innerHTML = '';

        const barWrap = document.createElement('div');
        barWrap.className = 'ctds-multi-chart-bars';

        const heights = state.segments.map(segment => segment.heightRatio);
        const fallback = heights.every(value => value === 0);

        state.segments.forEach(segment => {
            const bar = document.createElement('div');
            bar.className = 'ctds-multi-bar';
            const ratio = fallback ? 0.5 : segment.heightRatio;
            bar.style.width = `${clamp(ratio, 0.12, 1) * 100}%`;
            barWrap.appendChild(bar);
        });

        elements.chartRegion.appendChild(barWrap);
    }

    function renderBoundaryRules() {
        elements.chartRegion.querySelectorAll('.ctds-multi-boundary').forEach(el => el.remove());

        const chartRect = elements.chartRegion.getBoundingClientRect();
        if (!chartRect.height) return;

        const dividers = elements.zones.querySelectorAll('.ctds-multi-divider');
        dividers.forEach(divider => {
            const dividerRect = divider.getBoundingClientRect();
            const topPx = dividerRect.top + dividerRect.height / 2 - chartRect.top;
            const topPct = (topPx / chartRect.height) * 100;

            const rule = document.createElement('div');
            rule.className = 'ctds-multi-boundary';
            rule.style.top = `${topPct}%`;
            elements.chartRegion.appendChild(rule);
        });
    }



    function renderZones() {
        elements.zones.innerHTML = '';

        state.zones.forEach((zone, index) => {
            const zoneButton = document.createElement('button');
            zoneButton.type = 'button';
            zoneButton.className = 'ctds-multi-zone';
            zoneButton.dataset.zoneId = zone.id;
            zoneButton.setAttribute('role', 'listitem');
            zoneButton.classList.toggle('is-selected', zone.id === state.selectedZoneId);
            zoneButton.style.flex = `${zone.endIndex - zone.startIndex + 1} 1 0`;

            const metrics = getZoneMetrics(zone);
            zoneButton.innerHTML = `
                <span class="ctds-multi-zone-inner">
                    <span class="ctds-multi-zone-copy">
                        <span class="ctds-multi-zone-title-row">
                            <span class="ctds-multi-zone-title">Z${index + 1}</span>
                            <span class="ctds-multi-zone-distance">[${formatDistance(metrics.distanceKm)}]</span>
                        </span>
                        <span class="ctds-multi-zone-duration">${metrics.durationText || '\u2014'}</span>
                    </span>
                    <span class="ctds-multi-zone-value">
                        <span class="ctds-multi-zone-pace">${metrics.paceText || '--:--'}</span>
                        <span class="ctds-multi-zone-speed">${metrics.speedText || '\u2014'}</span>
                    </span>
                </span>
            `;
            elements.zones.appendChild(zoneButton);

            if (index < state.zones.length - 1) {
                const divider = document.createElement('button');
                divider.type = 'button';
                divider.className = 'ctds-multi-divider';
                divider.dataset.leftZoneId = zone.id;
                divider.dataset.rightZoneId = state.zones[index + 1].id;
                divider.setAttribute('aria-label', `Resize boundary between zone ${index + 1} and zone ${index + 2}`);
                divider.innerHTML = '<span class="ctds-multi-divider-handle" aria-hidden="true"></span>';
                elements.zones.appendChild(divider);
            }
        });
    }

    function renderTotal() {
        const total = getTotalDuration();
        elements.totalTime.textContent = total == null ? '' : formatTotalTime(total);
    }

    function syncFooter() {
        const hasLoadedState = Boolean(state.route && state.segments.length);
        const showDelete = hasLoadedState && state.selectedZoneId != null && state.zones.length > 1;

        elements.actionRow.hidden = !hasLoadedState;
        elements.addZoneBtn.disabled = !canAddZone();
        elements.deleteZoneBtn.hidden = !showDelete;
    }

    function render() {
        const hasLoadedState = Boolean(state.route && state.segments.length && state.zones.length);

        elements.emptyState.hidden = hasLoadedState;
        elements.loadedState.hidden = !hasLoadedState;
        elements.totalRow.hidden = !hasLoadedState;

        showWarning(state.warning);

        if (hasLoadedState) {
            requestAnimationFrame(() => requestAnimationFrame(() => {
                renderChart();
                renderZones();
                renderBoundaryRules();
            }));
            renderTotal();
        } else {
            elements.chartRegion.innerHTML = '';
            elements.zones.innerHTML = '';
            elements.totalTime.textContent = '';
        }

        syncFooter();
    }

    function buildRenderableSegments(parsedSegments, hasElevation) {
        const elevations = parsedSegments
            .map(segment => segment.avgElevation)
            .filter(value => Number.isFinite(value));
        const minElevation = elevations.length ? Math.min(...elevations) : 0;
        const maxElevation = elevations.length ? Math.max(...elevations) : 0;
        const range = maxElevation - minElevation;

        return parsedSegments.map(segment => {
            const ratio = !hasElevation || !Number.isFinite(segment.avgElevation) || range === 0
                ? 0.5
                : (segment.avgElevation - minElevation) / range;

            return {
                ...segment,
                heightRatio: Number(ratio.toFixed(4)),
            };
        });
    }

    function buildInitialZones(segmentCount, seedPace) {
        return [{
            id: createZoneId(),
            startIndex: 0,
            endIndex: segmentCount - 1,
            paceSeconds: seedPace || null,
        }];
    }

    function loadPersisted() {
        const persisted = getPersistedState();
        if (!persisted) {
            return false;
        }

        state.route = persisted.route;
        state.segments = persisted.segments;
        state.zones = persisted.zones;
        state.selectedZoneId = persisted.selectedZoneId;
        state.warning = persisted.warning;
        return true;
    }

    function openFilePicker() {
        elements.fileInput.value = '';
        elements.fileInput.click();
    }

    async function handleFileSelect() {
        const [file] = elements.fileInput.files || [];
        if (!file) {
            return;
        }

        clearStatus();

        try {
            const xmlText = await file.text();
            const parsed = parseGPX(xmlText);
            const segments = buildRenderableSegments(segmentRoute(parsed.points), parsed.hasElevation);
            const seedPace = getSeedPace();

            state.route = {
                totalKm: Number(parsed.totalKm.toFixed(6)),
                hasElevation: parsed.hasElevation,
                fileName: file.name,
            };
            state.segments = segments;
            state.zones = buildInitialZones(segments.length, seedPace);
            state.selectedZoneId = state.zones[0].id;
            state.warning = parsed.hasElevation ? '' : NO_ELEVATION_WARNING;
            state.editing = false;
            persist();
            
            // Un-hide the loaded state so measurement works. 
            // The requestAnimationFrame in render() will ensure the DOM is painted once before chart render runs
            render();
            
            announce(`Loaded ${file.name}.`);
        } catch (error) {
            showError(error instanceof Error ? error.message : 'Could not parse GPX file.');
            render();
        }
    }

    function canAddZone() {
        const lastZone = state.zones[state.zones.length - 1];
        if (!lastZone) {
            return false;
        }

        const span = lastZone.endIndex - lastZone.startIndex + 1;
        return span >= MIN_ZONE_SEGMENTS * 2;
    }

    function addZone() {
        const lastZone = state.zones[state.zones.length - 1];
        if (!lastZone || !canAddZone()) {
            return;
        }

        const span = lastZone.endIndex - lastZone.startIndex + 1;
        const newZoneSpan = Math.floor(span / 2);
        const oldZoneSpan = span - newZoneSpan;

        if (newZoneSpan < MIN_ZONE_SEGMENTS || oldZoneSpan < MIN_ZONE_SEGMENTS) {
            return;
        }

        const startIndex = lastZone.startIndex + oldZoneSpan;
        const seedPace = getSeedPace();
        const newZone = {
            id: createZoneId(),
            startIndex,
            endIndex: lastZone.endIndex,
            paceSeconds: seedPace || null,
        };

        lastZone.endIndex = startIndex - 1;
        state.zones.push(newZone);
        state.selectedZoneId = newZone.id;
        state.editing = false;
        persist();
        render();
    }

    function closeSheet() {
        elements.sheet.classList.remove('is-open');
        elements.sheetBackdrop.classList.remove('is-open');

        setTimeout(() => {
            elements.sheet.hidden = true;
            elements.sheetBackdrop.hidden = true;
        }, 200);
    }

    function selectZone(zoneId) {
        if (!state.zones.some(zone => zone.id === zoneId)) return;

        const index = state.zones.findIndex(z => z.id === zoneId);
        const zone = state.zones[index];

        state.selectedZoneId = zoneId;
        state.editing = true;

        elements.sheetLabel.textContent = `Z${index + 1} Pace`;
        elements.sheetInput.value = zone.paceSeconds ? formatPace(zone.paceSeconds) : '';
        elements.sheet.hidden = false;
        elements.sheetBackdrop.hidden = false;

        requestAnimationFrame(() => {
            elements.sheet.classList.add('is-open');
            elements.sheetBackdrop.classList.add('is-open');
            elements.sheetInput.focus();
        });

        persist();
        render();
    }

    function reset() {
        state.route = null;
        state.segments = [];
        state.zones = [];
        state.selectedZoneId = null;
        state.warning = '';
        state.error = '';
        state.editing = false;
        state.dragging = null;
        clearStatus();
        showWarning('');
        persist();
        render();
    }

    function commitPace() {
        const selected = getSelectedZone();
        if (!selected) {
            closeSheet();
            return;
        }

        const normalized = normalizePace(elements.sheetInput.value || '0:0');
        const [minutes, seconds] = normalized.split(':').map(Number);
        const totalSeconds = minutes * 60 + seconds;
        selected.paceSeconds = totalSeconds > 0 ? totalSeconds : null;

        state.editing = false;
        state.selectedZoneId = null;
        closeSheet();
        persist();
        render();
    }

    function deleteZone() {
        const selectedIndex = state.zones.findIndex(zone => zone.id === state.selectedZoneId);
        if (selectedIndex === -1 || state.zones.length <= 1) {
            return;
        }

        const deletedZone = state.zones[selectedIndex];

        // If it's the first zone, the zone below absorbs it
        if (selectedIndex === 0) {
            const belowZone = state.zones[1];
            belowZone.startIndex = deletedZone.startIndex;
        } 
        // Otherwise, the zone above absorbs it
        else {
            const aboveZone = state.zones[selectedIndex - 1];
            aboveZone.endIndex = deletedZone.endIndex;
        }

        state.zones.splice(selectedIndex, 1);
        state.selectedZoneId = null;
        state.editing = false;
        
        persist();
        render();
        announce('Zone deleted returning to overview.');
    }

    function normalizePaceInputValue() {
        const raw = elements.sheetInput.value.trim();
        if (!raw) {
            return;
        }

        const converted = /^\d+$/.test(raw) ? parseDigitsToPace(raw) : raw;
        elements.sheetInput.value = normalizePace(converted);
    }

    function startDrag(zoneId, clientY) {
        const leftIndex = state.zones.findIndex(zone => zone.id === zoneId);
        if (leftIndex < 0 || leftIndex >= state.zones.length - 1) {
            return;
        }

        state.dragging = {
            leftIndex,
            lastY: clientY,
        };
    }

    function moveDrag(clientY) {
        if (!state.dragging) return;

        const { leftIndex, lastY } = state.dragging;
        const deltaY = clientY - lastY;

        const panelHeight = elements.zones.getBoundingClientRect().height;
        if (panelHeight <= 0) {
            return;
        }
        const deltaSegments = Math.round((deltaY / panelHeight) * state.segments.length);

        if (deltaSegments === 0) return;

        const above = state.zones[leftIndex];
        const below = state.zones[leftIndex + 1];

        const newAboveEnd = above.endIndex + deltaSegments;
        const newBelowStart = below.startIndex + deltaSegments;

        if (
            newAboveEnd - above.startIndex + 1 < MIN_ZONE_SEGMENTS ||
            below.endIndex - newBelowStart + 1 < MIN_ZONE_SEGMENTS
        ) return;

        above.endIndex = newAboveEnd;
        below.startIndex = newBelowStart;

        // Update lastY only when a move actually happened
        state.dragging.lastY = clientY;

        renderZones();
        renderBoundaryRules();
        syncFooter();
        renderTotal();
    }

    function endDrag() {
        if (!state.dragging) {
            return;
        }

        state.dragging = null;
        persist();
        render();
    }

    function deleteZone() {
        const selected = getSelectedZone();
        if (!selected || state.zones.length <= 1) {
            closeSheet();
            return;
        }

        closeSheet();

        const index = state.zones.findIndex(z => z.id === state.selectedZoneId);
        if (index < 0) {
            render();
            return;
        }

        const zoneToRemove = state.zones[index];
        if (index === 0) {
            state.zones[1].startIndex = zoneToRemove.startIndex;
            state.zones.splice(0, 1);
            state.selectedZoneId = state.zones[0].id;
        } else {
            state.zones[index - 1].endIndex = zoneToRemove.endIndex;
            state.zones.splice(index, 1);
            state.selectedZoneId = state.zones[Math.min(index - 1, state.zones.length - 1)].id;
        }

        state.editing = false;
        persist();
        render();
    }

    function handlePointerDown(event) {
        const divider = event.target.closest('.ctds-multi-divider');
        if (!divider) {
            return;
        }

        event.preventDefault();
        startDrag(divider.dataset.leftZoneId, event.clientY);
    }

    function handleTouchStart(event) {
        const divider = event.target.closest('.ctds-multi-divider');
        if (!divider) {
            return;
        }

        event.preventDefault();

        const touch = event.touches[0];
        if (!touch) {
            return;
        }

        startDrag(divider.dataset.leftZoneId, touch.clientY);
    }

    function handleTouchMove(event) {
        if (!state.dragging) {
            return;
        }

        const touch = event.touches[0];
        if (!touch) {
            return;
        }

        event.preventDefault();
        moveDrag(touch.clientY);
    }

    function handleZoneClick(event) {
        const zone = event.target.closest('.ctds-multi-zone');
        if (!zone) {
            return;
        }

        selectZone(zone.dataset.zoneId);
    }

    function bindListeners() {
        if (listenersBound) {
            return;
        }

        elements.uploadGpxBtn.addEventListener('click', openFilePicker);
        elements.uploadMultiBtn.addEventListener('click', openFilePicker);
        elements.fileInput.addEventListener('change', handleFileSelect);
        elements.addZoneBtn.addEventListener('click', addZone);
        elements.deleteZoneBtn.addEventListener('click', deleteZone);
        elements.resetBtn.addEventListener('click', reset);
        elements.sheetConfirm.addEventListener('click', commitPace);
        elements.sheetBackdrop.addEventListener('click', commitPace);
        elements.sheetInput.addEventListener('keydown', e => {
            if (e.key === 'Enter') commitPace();
        });
        elements.sheetInput.addEventListener('blur', normalizePaceInputValue);
        elements.zones.addEventListener('click', handleZoneClick);
        elements.zones.addEventListener('mousedown', handlePointerDown);
        elements.zones.addEventListener('touchstart', handleTouchStart, { passive: false });
        window.addEventListener('mousemove', event => moveDrag(event.clientY));
        window.addEventListener('mouseup', endDrag);
        window.addEventListener('touchmove', handleTouchMove, { passive: false });
        window.addEventListener('touchend', endDrag, { passive: true });
        window.addEventListener('touchcancel', endDrag, { passive: true });
        listenersBound = true;
    }

    function activate() {
        bindListeners();

        if (!state.route && !state.segments.length) {
            loadPersisted();
        }

        if (!state.route) {
            clearStatus();
            elements.warning.hidden = true;
            elements.warning.textContent = '';
            elements.error.hidden = true;
            elements.error.textContent = '';
            elements.emptyState.querySelector('#uploadState').firstElementChild.textContent = EMPTY_HINT;
        }

        render();
    }

    function deactivate() {
        state.editing = false;
        state.dragging = null;
        render();
    }

    if (!loadPersisted()) {
        render();
    }

    return {
        activate,
        deactivate,
        reset,
    };
}
