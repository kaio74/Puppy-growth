(function (globalScope) {
  'use strict';

  const AUTOSAVE_KEY = 'puppy_growth_autosave_v1';

  const COLOR_PALETTE = [
    '#dc143c', // crimson
    '#4169e1', // royalblue
    '#008000', // green
    '#ff8c00', // darkorange
    '#800080', // purple
    '#8b4513', // saddlebrown
    '#0f766e', // teal
    '#db2777', // pink
  ];

  const DEFAULT_TYPICAL_RANGE = {
    label: 'Typical Height Range',
    ageWeeks: [4, 8, 12, 16, 20, 24, 28, 32, 36, 48, 52],
    lowerLimit: [8, 13, 18, 23, 27, 28, 30, 30, 30, 30, 30],
    upperLimit: [12, 18, 23, 28, 32, 33, 34, 35, 35.5, 36, 36],
  };

  const STARTER_PUPPY_DATA = {
    Aliss: [
      [7, 21],
      [9, 22.5],
      [11, 26],
      [12, 26],
      [13, 26.5],
      [14, 27.5],
      [15, 28.25],
      [16, 29],
      [17, 29.5],
      [18, 29.75],
      [19, 30.25],
      [20, 31],
      [21, 31],
      [22, 31.5],
      [23, 32],
      [24, 32.5],
      [25, 33],
      [26, 33],
      [27, 33],
      [28, 33],
      [29, 34],
      [30, 34],
      [31, 34],
      [32, 34],
      [33, 34],
      [34, 34],
      [35, 34.5],
      [36, 34.5],
    ],
    Lilly: [
      [8, 21],
      [11, 24],
      [12, 24.5],
      [14, 25],
      [15, 26.5],
      [16, 27],
      [17, 28],
      [18, 28.5],
      [19, 29.5],
      [20, 29.7],
      [21, 29.7],
      [22, 30.25],
      [23, 31],
      [24, 31.5],
      [25, 31.5],
      [26, 31.75],
      [27, 32],
      [28, 32],
      [29, 32.5],
      [30, 32.5],
      [31, 32.5],
      [32, 32.5],
      [33, 32.5],
      [34, 32.5],
      [35, 32.75],
      [36, 32.75],
    ],
  };

  function makeId(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
    }
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function cloneDeep(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function cloneDefaultTypicalRange() {
    return cloneDeep(DEFAULT_TYPICAL_RANGE);
  }

  const VALID_PROJECTION_MODELS = [
    'gompertz',
    'brody',
    'logistic',
    'richards',
    'percentile',
    'compare',
  ];

  function normalizeSettings(rawSettings) {
    const s = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const projectionModel = VALID_PROJECTION_MODELS.includes(s.projectionModel)
      ? s.projectionModel
      : 'gompertz';
    return {
      showTypicalRange: s.showTypicalRange !== false,
      showProjections: s.showProjections !== false,
      projectionModel,
      showConfidenceBand: s.showConfidenceBand === true,
      showVelocityChart: s.showVelocityChart === true,
    };
  }

  function createStarterProject() {
    const puppies = Object.entries(STARTER_PUPPY_DATA).map(([name, rows], idx) => ({
      id: makeId('pup'),
      name,
      color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
      visible: true,
      measurements: rows.map(([week, height]) => ({
        id: makeId('m'),
        week: Number(week),
        height: Number(height),
        note: '',
      })),
    }));

    return {
      schemaVersion: 1,
      name: 'Puppy Growth Project',
      updatedAt: new Date().toISOString(),
      settings: normalizeSettings({}),
      typicalRange: cloneDefaultTypicalRange(),
      puppies,
    };
  }

  function createEmptyProject(name) {
    return {
      schemaVersion: 1,
      name: (name && String(name).trim()) || 'Untitled Puppy Project',
      updatedAt: new Date().toISOString(),
      settings: normalizeSettings({}),
      typicalRange: cloneDefaultTypicalRange(),
      puppies: [],
    };
  }

  function normalizeTypicalRange(rawRange) {
    if (!rawRange || typeof rawRange !== 'object') {
      return cloneDefaultTypicalRange();
    }
    const ageWeeks = Array.isArray(rawRange.ageWeeks) ? rawRange.ageWeeks.map(Number) : null;
    const lowerLimit = Array.isArray(rawRange.lowerLimit) ? rawRange.lowerLimit.map(Number) : null;
    const upperLimit = Array.isArray(rawRange.upperLimit) ? rawRange.upperLimit.map(Number) : null;

    if (
      !ageWeeks ||
      !lowerLimit ||
      !upperLimit ||
      ageWeeks.length < 2 ||
      ageWeeks.length !== lowerLimit.length ||
      ageWeeks.length !== upperLimit.length
    ) {
      return cloneDefaultTypicalRange();
    }

    const zipped = ageWeeks
      .map((w, i) => ({
        week: w,
        lower: lowerLimit[i],
        upper: upperLimit[i],
      }))
      .filter(
        (row) =>
          Number.isFinite(row.week) &&
          Number.isFinite(row.lower) &&
          Number.isFinite(row.upper) &&
          row.week >= 0 &&
          row.lower > 0 &&
          row.upper >= row.lower
      )
      .sort((a, b) => a.week - b.week);

    if (zipped.length < 2) {
      return cloneDefaultTypicalRange();
    }

    return {
      label:
        typeof rawRange.label === 'string' && rawRange.label.trim()
          ? rawRange.label.trim()
          : DEFAULT_TYPICAL_RANGE.label,
      ageWeeks: zipped.map((r) => r.week),
      lowerLimit: zipped.map((r) => r.lower),
      upperLimit: zipped.map((r) => r.upper),
    };
  }

  function normalizeMeasurements(rawMeasurements, puppyName) {
    if (!Array.isArray(rawMeasurements)) {
      throw new Error(`Measurements for "${puppyName}" must be an array.`);
    }
    const normalized = [];
    for (let i = 0; i < rawMeasurements.length; i++) {
      const entry = rawMeasurements[i];
      let week;
      let height;
      let note = '';
      let id = makeId('m');

      if (Array.isArray(entry)) {
        if (entry.length < 2) {
          throw new Error(`Invalid measurement tuple for "${puppyName}" at index ${i}.`);
        }
        week = Number(entry[0]);
        height = Number(entry[1]);
        if (entry[2] != null) note = String(entry[2]).slice(0, 80);
      } else if (entry && typeof entry === 'object') {
        week = Number(entry.week);
        height = Number(entry.height);
        if (typeof entry.note === 'string') note = entry.note.slice(0, 80);
        if (typeof entry.id === 'string' && entry.id.trim()) id = entry.id.trim();
      } else {
        throw new Error(`Invalid measurement entry for "${puppyName}" at index ${i}.`);
      }

      if (!Number.isFinite(week) || week < 0 || week > 260) {
        throw new Error(`Invalid age in weeks (${entry && entry.week}) for "${puppyName}".`);
      }
      if (!Number.isFinite(height) || height <= 0 || height > 200) {
        throw new Error(`Invalid height in cm (${entry && entry.height}) for "${puppyName}".`);
      }

      normalized.push({ id, week, height, note });
    }

    normalized.sort((a, b) => a.week - b.week);
    return normalized;
  }

  function normalizeProject(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Project file must contain a JSON object.');
    }

    // Legacy Python dict format: { "Aliss": [[7, 21], ...], "Lilly": [...] }
    if (!Array.isArray(raw.puppies)) {
      const keys = Object.keys(raw);
      if (keys.length === 0) {
        throw new Error('Project JSON does not contain any puppies.');
      }
      const looksLikeLegacy = keys.every((k) => Array.isArray(raw[k]));
      if (!looksLikeLegacy) {
        throw new Error('Unrecognized project format: expected "puppies" array or puppy measurement dictionary.');
      }
      const puppies = keys.map((name, idx) => ({
        id: makeId('pup'),
        name: String(name).trim() || `Puppy ${idx + 1}`,
        color: COLOR_PALETTE[idx % COLOR_PALETTE.length],
        visible: true,
        measurements: normalizeMeasurements(raw[name], name),
      }));
      return {
        schemaVersion: 1,
        name: 'Imported Puppy Growth Project',
        updatedAt: new Date().toISOString(),
        settings: normalizeSettings({}),
        typicalRange: cloneDefaultTypicalRange(),
        puppies,
      };
    }

    const puppies = raw.puppies.map((p, idx) => {
      if (!p || typeof p !== 'object') {
        throw new Error(`Invalid puppy entry at index ${idx}.`);
      }
      const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : `Puppy ${idx + 1}`;
      const color =
        typeof p.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(p.color.trim())
          ? p.color.trim()
          : COLOR_PALETTE[idx % COLOR_PALETTE.length];
      return {
        id: typeof p.id === 'string' && p.id.trim() ? p.id.trim() : makeId('pup'),
        name,
        color,
        visible: p.visible !== false,
        measurements: normalizeMeasurements(p.measurements || [], name),
      };
    });

    return {
      schemaVersion: 1,
      name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : 'Puppy Growth Project',
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      settings: normalizeSettings(raw.settings),
      typicalRange: normalizeTypicalRange(raw.typicalRange),
      puppies,
    };
  }

  function serializeProject(project) {
    const clean = normalizeProject(project);
    clean.updatedAt = new Date().toISOString();
    return JSON.stringify(clean, null, 2) + '\n';
  }

  function parseProject(jsonText) {
    if (typeof jsonText !== 'string' || !jsonText.trim()) {
      throw new Error('The selected file is empty.');
    }
    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      throw new Error(`Invalid JSON file: ${err.message}`);
    }
    return normalizeProject(parsed);
  }

  function slugifyFilename(name) {
    const base = String(name || 'puppy_growth_project')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return (base || 'puppy_growth_project') + '.puppyproj.json';
  }

  function loadAutosave() {
    try {
      if (typeof localStorage === 'undefined') return null;
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      return parseProject(raw);
    } catch (_err) {
      return null;
    }
  }

  function saveAutosave(project) {
    try {
      if (typeof localStorage === 'undefined') return false;
      localStorage.setItem(AUTOSAVE_KEY, serializeProject(project));
      return true;
    } catch (_err) {
      return false;
    }
  }

  function exportCsv(project) {
    const lines = ['puppy,color,week,height_cm,note'];
    const esc = (val) => {
      const s = String(val == null ? '' : val);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    for (const pup of project.puppies) {
      for (const m of pup.measurements) {
        lines.push([esc(pup.name), esc(pup.color), m.week, m.height, esc(m.note || '')].join(','));
      }
    }
    return lines.join('\n') + '\n';
  }

  const api = {
    AUTOSAVE_KEY,
    COLOR_PALETTE,
    DEFAULT_TYPICAL_RANGE,
    makeId,
    cloneDeep,
    cloneDefaultTypicalRange,
    createStarterProject,
    createEmptyProject,
    normalizeProject,
    serializeProject,
    parseProject,
    slugifyFilename,
    loadAutosave,
    saveAutosave,
    exportCsv,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (globalScope) {
    globalScope.PuppyStorage = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
