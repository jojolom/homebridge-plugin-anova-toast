import { Logger } from 'homebridge';
import { Recipe } from './AnovaOvenService';
import { StagesEntity } from './AnovaTypes';
/**
 * Cooking modes for recipes built from simple settings. Element and fan combinations come from
 * the Anova app's own recipes (Bake, Air Fry, Toast) and Anova's official developer examples (Roast, Steam, Sous Vide).
 */
export declare const COOKING_MODES: {
    readonly bake: {
        readonly label: "Bake (bottom element, low fan)";
        readonly top: false;
        readonly bottom: true;
        readonly rear: false;
        readonly fan: 33;
        readonly bulb: "dry";
    };
    readonly roast: {
        readonly label: "Roast / convection (bottom + rear, fan)";
        readonly top: false;
        readonly bottom: true;
        readonly rear: true;
        readonly fan: 75;
        readonly bulb: "dry";
    };
    readonly airFry: {
        readonly label: "Air fry (rear element, full fan)";
        readonly top: false;
        readonly bottom: false;
        readonly rear: true;
        readonly fan: 100;
        readonly bulb: "dry";
    };
    readonly broil: {
        readonly label: "Broil (top element, no fan)";
        readonly top: true;
        readonly bottom: false;
        readonly rear: false;
        readonly fan: 0;
        readonly bulb: "dry";
    };
    readonly steam: {
        readonly label: "Steam (all elements + humidity)";
        readonly top: true;
        readonly bottom: true;
        readonly rear: true;
        readonly fan: 50;
        readonly bulb: "dry";
    };
    readonly sousVide: {
        readonly label: "Sous vide (wet bulb, 100% humidity)";
        readonly top: false;
        readonly bottom: false;
        readonly rear: true;
        readonly fan: 100;
        readonly bulb: "wet";
    };
};
export declare type CookingMode = keyof typeof COOKING_MODES;
export declare const DEFAULT_OVEN_MODE: CookingMode;
export declare const DEFAULT_TEMPERATURE_F = 350;
/** Oven limits from Anova's docs: 25-250 °C dry bulb, wet bulb (sous vide) up to 100 °C. */
export declare const MIN_TEMP_C = 25;
export declare const MAX_DRY_TEMP_C = 250;
export declare const MAX_WET_TEMP_C = 100;
export declare const fToC: (f: number) => number;
export declare const cToF: (c: number) => number;
export declare const isCookingMode: (mode: unknown) => mode is "bake" | "roast" | "airFry" | "broil" | "steam" | "sousVide";
export declare const clampTemperatureC: (celsius: number, mode: CookingMode) => number;
export declare type SimpleRecipeSettings = {
    mode: CookingMode;
    temperatureC: number;
    /** Steam mode: relative humidity %. Other dry modes: steam %. Ignored for sous vide (always 100% humidity). */
    steamPercent?: number;
    timerMinutes?: number;
    /** Add a preheat stage before the timed cook stage (default true). */
    preheat?: boolean;
};
/** Build Anova v1 cook stages (same field set as Anova's official examples) from simple settings. */
export declare function buildStages(settings: SimpleRecipeSettings): StagesEntity[];
/** A recipe entry as it appears in the plugin config: either simple settings or raw Anova stages. */
export declare type RecipeConfig = {
    name?: unknown;
    stages?: unknown;
    mode?: unknown;
    temperatureF?: unknown;
    steamPercent?: unknown;
    timerMinutes?: unknown;
    preheat?: unknown;
};
/** Turns one config entry into a Recipe, or returns an error message explaining why it was skipped. */
export declare function parseRecipe(entry: RecipeConfig): Recipe | string;
export declare const DEFAULT_RECIPE_NAMES: string[];
/**
 * The recipe switches to create: the selected built-in recipes plus the user's own.
 * A user recipe with the same name as a built-in one replaces it.
 */
export declare function resolveRecipes(config: {
    recipes?: unknown;
    defaultRecipes?: unknown;
}, log: Logger): Recipe[];
/**
 * Stages that keep the heating setup of `stage` (elements, fan, steam, wet/dry) at a new temperature.
 * Used when the temperature is changed mid-cook, since the token API can only start and stop cooks.
 * A running timer carries over as `remainingTimerSeconds`.
 */
export declare function retargetStages(stage: StagesEntity, celsius: number, remainingTimerSeconds?: number): StagesEntity[];
//# sourceMappingURL=recipes.d.ts.map