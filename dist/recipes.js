"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.retargetStages = exports.resolveRecipes = exports.DEFAULT_RECIPE_NAMES = exports.parseRecipe = exports.buildStages = exports.clampTemperatureC = exports.isCookingMode = exports.cToF = exports.fToC = exports.MAX_WET_TEMP_C = exports.MAX_DRY_TEMP_C = exports.MIN_TEMP_C = exports.DEFAULT_TEMPERATURE_F = exports.DEFAULT_OVEN_MODE = exports.COOKING_MODES = void 0;
const defaultRecipes_1 = require("./defaultRecipes");
/**
 * Cooking modes for recipes built from simple settings. Element and fan combinations come from
 * the Anova app's own recipes (Bake, Air Fry, Toast) and Anova's official developer examples (Roast, Steam, Sous Vide).
 */
exports.COOKING_MODES = {
    bake: { label: 'Bake (bottom element, low fan)', top: false, bottom: true, rear: false, fan: 33, bulb: 'dry' },
    roast: { label: 'Roast / convection (bottom + rear, fan)', top: false, bottom: true, rear: true, fan: 75, bulb: 'dry' },
    airFry: { label: 'Air fry (rear element, full fan)', top: false, bottom: false, rear: true, fan: 100, bulb: 'dry' },
    broil: { label: 'Broil (top element, no fan)', top: true, bottom: false, rear: false, fan: 0, bulb: 'dry' },
    steam: { label: 'Steam (all elements + humidity)', top: true, bottom: true, rear: true, fan: 50, bulb: 'dry' },
    sousVide: { label: 'Sous vide (wet bulb, 100% humidity)', top: false, bottom: false, rear: true, fan: 100, bulb: 'wet' },
};
exports.DEFAULT_OVEN_MODE = 'roast';
exports.DEFAULT_TEMPERATURE_F = 350;
/** Oven limits from Anova's docs: 25-250 °C dry bulb, wet bulb (sous vide) up to 100 °C. */
exports.MIN_TEMP_C = 25;
exports.MAX_DRY_TEMP_C = 250;
exports.MAX_WET_TEMP_C = 100;
const fToC = (f) => Math.round((f - 32) * 5 / 9 * 100) / 100;
exports.fToC = fToC;
const cToF = (c) => Math.round(c * 9 / 5 + 32);
exports.cToF = cToF;
const isCookingMode = (mode) => typeof mode === 'string' && Object.prototype.hasOwnProperty.call(exports.COOKING_MODES, mode);
exports.isCookingMode = isCookingMode;
const clampTemperatureC = (celsius, mode) => {
    const max = exports.COOKING_MODES[mode].bulb === 'wet' ? exports.MAX_WET_TEMP_C : exports.MAX_DRY_TEMP_C;
    return Math.min(max, Math.max(exports.MIN_TEMP_C, celsius));
};
exports.clampTemperatureC = clampTemperatureC;
/** Build Anova v1 cook stages (same field set as Anova's official examples) from simple settings. */
function buildStages(settings) {
    var _a;
    const preset = exports.COOKING_MODES[settings.mode];
    const celsius = (0, exports.clampTemperatureC)(settings.temperatureC, settings.mode);
    const setpoint = { celsius: Math.round(celsius * 100) / 100, fahrenheit: (0, exports.cToF)(celsius) };
    const temperatureBulbs = preset.bulb === 'wet'
        ? { mode: 'wet', wet: { setpoint } }
        : { mode: 'dry', dry: { setpoint } };
    let steamGenerators;
    const steam = Math.min(100, Math.max(0, Math.round((_a = settings.steamPercent) !== null && _a !== void 0 ? _a : 0)));
    if (settings.mode === 'sousVide') {
        steamGenerators = { mode: 'relative-humidity', relativeHumidity: { setpoint: 100 } };
    }
    else if (settings.mode === 'steam') {
        steamGenerators = { mode: 'relative-humidity', relativeHumidity: { setpoint: settings.steamPercent === undefined ? 100 : steam } };
    }
    else if (steam > 0) {
        steamGenerators = { mode: 'steam-percentage', steamPercentage: { setpoint: steam } };
    }
    const stage = (type, timerSeconds) => ({
        stepType: 'stage',
        title: type === 'preheat' ? 'Preheat' : 'Cook',
        description: '',
        type,
        userActionRequired: false,
        temperatureBulbs,
        heatingElements: { top: { on: preset.top }, bottom: { on: preset.bottom }, rear: { on: preset.rear } },
        fan: { speed: preset.fan },
        vent: { open: false },
        rackPosition: 3,
        stageTransitionType: 'automatic',
        ...(steamGenerators ? { steamGenerators } : {}),
        ...(timerSeconds ? { timer: { initial: timerSeconds } } : {}),
    });
    const timerSeconds = settings.timerMinutes && settings.timerMinutes > 0 ? Math.round(settings.timerMinutes * 60) : undefined;
    const stages = [];
    if (settings.preheat !== false) {
        stages.push(stage('preheat'));
    }
    stages.push(stage('cook', timerSeconds));
    return stages;
}
exports.buildStages = buildStages;
const toNumber = (v) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
/** Turns one config entry into a Recipe, or returns an error message explaining why it was skipped. */
function parseRecipe(entry) {
    var _a;
    if (typeof (entry === null || entry === void 0 ? void 0 : entry.name) !== 'string' || !entry.name.trim()) {
        return 'it needs a "name"';
    }
    const name = entry.name.trim();
    if (Array.isArray(entry.stages)) {
        return entry.stages.length ? { name, stages: entry.stages } : `"${name}" has an empty "stages" list`;
    }
    const mode = (_a = entry.mode) !== null && _a !== void 0 ? _a : exports.DEFAULT_OVEN_MODE;
    if (!(0, exports.isCookingMode)(mode)) {
        return `"${name}" has an unknown mode "${String(mode)}" (use one of ${Object.keys(exports.COOKING_MODES).join(', ')})`;
    }
    const temperatureF = toNumber(entry.temperatureF);
    if (!Number.isFinite(temperatureF)) {
        return `"${name}" needs a temperature ("temperatureF")`;
    }
    const timerMinutes = toNumber(entry.timerMinutes);
    const steamPercent = toNumber(entry.steamPercent);
    return {
        name,
        stages: buildStages({
            mode,
            temperatureC: (0, exports.fToC)(temperatureF),
            steamPercent: Number.isFinite(steamPercent) ? steamPercent : undefined,
            timerMinutes: Number.isFinite(timerMinutes) ? timerMinutes : undefined,
            preheat: entry.preheat !== false,
        }),
    };
}
exports.parseRecipe = parseRecipe;
exports.DEFAULT_RECIPE_NAMES = defaultRecipes_1.DEFAULT_RECIPES.map((r) => r.name);
/**
 * The recipe switches to create: the selected built-in recipes plus the user's own.
 * A user recipe with the same name as a built-in one replaces it.
 */
function resolveRecipes(config, log) {
    let defaults = defaultRecipes_1.DEFAULT_RECIPES;
    if (Array.isArray(config.defaultRecipes)) {
        const wanted = new Set(config.defaultRecipes.filter((n) => typeof n === 'string'));
        defaults = defaultRecipes_1.DEFAULT_RECIPES.filter((r) => wanted.has(r.name));
    }
    else if (config.defaultRecipes !== undefined) {
        log.warn('"defaultRecipes" should be a list of built-in recipe names; showing all of them.');
    }
    const custom = [];
    if (Array.isArray(config.recipes)) {
        config.recipes.forEach((entry, idx) => {
            const e = entry;
            // The settings form starts with one blank row (only its defaults filled in); ignore it quietly.
            if (e && typeof e === 'object' && !e.name && e.temperatureF === undefined && e.stages === undefined) {
                return;
            }
            const parsed = parseRecipe(e);
            if (typeof parsed === 'string') {
                log.warn(`Skipping recipe #${idx + 1}: ${parsed}.`);
            }
            else {
                custom.push(parsed);
            }
        });
    }
    else if (config.recipes !== undefined) {
        log.error('"recipes" in the plugin config must be a list; ignoring it.');
    }
    const customNames = new Set(custom.map((r) => r.name));
    return [...defaults.filter((r) => !customNames.has(r.name)), ...custom];
}
exports.resolveRecipes = resolveRecipes;
/**
 * Stages that keep the heating setup of `stage` (elements, fan, steam, wet/dry) at a new temperature.
 * Used when the temperature is changed mid-cook, since the token API can only start and stop cooks.
 * A running timer carries over as `remainingTimerSeconds`.
 */
function retargetStages(stage, celsius, remainingTimerSeconds) {
    var _a;
    const wet = ((_a = stage.temperatureBulbs) === null || _a === void 0 ? void 0 : _a.mode) === 'wet';
    const clamped = Math.min(wet ? exports.MAX_WET_TEMP_C : exports.MAX_DRY_TEMP_C, Math.max(exports.MIN_TEMP_C, celsius));
    const setpoint = { celsius: Math.round(clamped * 100) / 100, fahrenheit: (0, exports.cToF)(clamped) };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, timer, ...rest } = stage;
    const base = {
        ...rest,
        stepType: 'stage',
        description: '',
        userActionRequired: false,
        stageTransitionType: 'automatic',
        temperatureBulbs: wet ? { mode: 'wet', wet: { setpoint } } : { mode: 'dry', dry: { setpoint } },
    };
    const cook = { ...base, type: 'cook', title: 'Cook' };
    if (remainingTimerSeconds && remainingTimerSeconds > 0) {
        cook.timer = { initial: Math.round(remainingTimerSeconds) };
    }
    return [{ ...base, type: 'preheat', title: 'Preheat' }, cook];
}
exports.retargetStages = retargetStages;
//# sourceMappingURL=recipes.js.map