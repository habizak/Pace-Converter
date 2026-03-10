const MIN_ROUTE_KM = 5;
const MAX_ROUTE_KM = 45;
const SEGMENT_LENGTH_KM = 0.1;
const EARTH_RADIUS_METERS = 6371000;

function toRadians(value) {
    return (value * Math.PI) / 180;
}

function haversineMeters(a, b) {
    const lat1 = toRadians(a.lat);
    const lat2 = toRadians(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRadians(b.lon - a.lon);
    const sinLat = Math.sin(dLat / 2);
    const sinLon = Math.sin(dLon / 2);
    const calc = sinLat * sinLat
        + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;

    return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(calc), Math.sqrt(1 - calc));
}

function parseNumber(value) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function interpolatePoint(start, end, ratio) {
    const elevation = start.ele == null || end.ele == null
        ? null
        : start.ele + (end.ele - start.ele) * ratio;

    return {
        lat: start.lat + (end.lat - start.lat) * ratio,
        lon: start.lon + (end.lon - start.lon) * ratio,
        ele: elevation,
        distanceKm: start.distanceKm + ((end.distanceKm - start.distanceKm) * ratio),
    };
}

function sampleRoute(points, totalKm) {
    const samples = [];
    const lastDistance = points[points.length - 1].distanceKm;
    let cursor = 0;

    for (let target = 0; target < totalKm; target += SEGMENT_LENGTH_KM) {
        while (cursor < points.length - 2 && points[cursor + 1].distanceKm < target) {
            cursor += 1;
        }

        const start = points[cursor];
        const end = points[Math.min(cursor + 1, points.length - 1)];
        const span = end.distanceKm - start.distanceKm;
        const ratio = span <= 0 ? 0 : (target - start.distanceKm) / span;
        samples.push(interpolatePoint(start, end, Math.max(0, Math.min(1, ratio))));
    }

    const finalPoint = points[points.length - 1];
    if (!samples.length || samples[samples.length - 1].distanceKm < lastDistance) {
        samples.push({
            lat: finalPoint.lat,
            lon: finalPoint.lon,
            ele: finalPoint.ele,
            distanceKm: lastDistance,
        });
    }

    return samples;
}

export function parseGPX(xmlText) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, 'application/xml');
    const parseError = xml.querySelector('parsererror');

    if (parseError) {
        throw new Error('Could not parse GPX file.');
    }

    const trkpts = Array.from(xml.getElementsByTagNameNS('*', 'trkpt'));
    if (trkpts.length < 2) {
        throw new Error('GPX file has no track data.');
    }

    let totalKm = 0;
    let previous = null;
    let hasElevation = true;
    const points = [];

    trkpts.forEach(node => {
        const lat = parseNumber(node.getAttribute('lat'));
        const lon = parseNumber(node.getAttribute('lon'));
        const eleNode = node.getElementsByTagNameNS('*', 'ele')[0];
        const ele = eleNode ? parseNumber(eleNode.textContent) : null;

        if (lat == null || lon == null) {
            return;
        }

        const point = { lat, lon, ele };
        if (ele == null) {
            hasElevation = false;
        }

        if (previous) {
            totalKm += haversineMeters(previous, point) / 1000;
        }

        points.push({
            ...point,
            distanceKm: totalKm,
        });
        previous = point;
    });

    if (points.length < 2 || totalKm <= 0) {
        throw new Error('GPX file has no track data.');
    }

    if (totalKm < MIN_ROUTE_KM) {
        throw new Error('Route must be at least 5km.');
    }

    if (totalKm > MAX_ROUTE_KM) {
        throw new Error('Route must be 45km or less.');
    }

    return {
        points,
        totalKm,
        hasElevation,
    };
}

export function segmentRoute(points) {
    const totalKm = points[points.length - 1]?.distanceKm ?? 0;
    const samples = sampleRoute(points, totalKm);
    const segments = [];

    for (let index = 0; index < samples.length - 1; index += 1) {
        const start = samples[index];
        const end = samples[index + 1];
        const distanceKm = Number((end.distanceKm - start.distanceKm).toFixed(6));
        const avgElevation = start.ele == null || end.ele == null
            ? null
            : Number((((start.ele ?? 0) + (end.ele ?? 0)) / 2).toFixed(3));
        const elevationDelta = start.ele == null || end.ele == null
            ? null
            : Number((end.ele - start.ele).toFixed(3));

        segments.push({
            index,
            startKm: Number(start.distanceKm.toFixed(6)),
            endKm: Number(end.distanceKm.toFixed(6)),
            distanceKm,
            avgElevation,
            elevationDelta,
        });
    }

    return segments;
}
