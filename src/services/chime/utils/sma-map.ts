export type ClinicSmaMap = Record<string, string>;

let cachedMap: ClinicSmaMap | undefined;

function parseSmaMap(): ClinicSmaMap {
  if (cachedMap) {
    return cachedMap;
  }

  const raw = process.env.SMA_ID_MAP;
  if (!raw) {
    console.warn('[sma-map] SMA_ID_MAP environment variable is not defined');
    cachedMap = {};
    return cachedMap;
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      cachedMap = parsed as ClinicSmaMap;
    } else {
      console.error('[sma-map] SMA_ID_MAP did not parse to an object');
      cachedMap = {};
    }
  } catch (err) {
    console.error('[sma-map] Failed to parse SMA_ID_MAP', err);
    cachedMap = {};
  }

  return cachedMap;
}

export function getSmaIdForClinic(clinicId: string | undefined): string | undefined {
  if (!clinicId) {
    return undefined;
  }

  const map = parseSmaMap();
  return map[clinicId];
}

export function getSmaMap(): ClinicSmaMap {
  return parseSmaMap();
}
