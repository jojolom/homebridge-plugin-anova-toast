import { PlatformAccessory } from 'homebridge';
import { AnovaOven, Recipe } from './AnovaOvenService';
import { AnovaOvenHomebridgePlatform } from './platform';
import { CookingMode } from './recipes';
export declare type OvenAccessoryOptions = {
    mainSwitchName: string;
    /** Heating setup used by the main switch and the thermostat. */
    ovenMode: CookingMode;
    /** Starting target temperature for the main switch and thermostat. */
    defaultTemperatureC: number;
    thermostat: boolean;
    sensors: {
        preheated: boolean;
        done: boolean;
        door: boolean;
        waterTank: boolean;
        descale: boolean;
        probe: boolean;
    };
    /** Turn off cooks started from HomeKit after this many hours (plus any timer). 0 disables. */
    maxCookHours: number;
};
export declare class AnovaOvenPlatformAccessory {
    readonly platform: AnovaOvenHomebridgePlatform;
    readonly accessory: PlatformAccessory;
    readonly oven: AnovaOven;
    readonly recipes: Recipe[];
    readonly options: OvenAccessoryOptions;
    private readonly switches;
    private readonly refreshers;
    private pendingStarts;
    private startTimer?;
    private preheatedCookId?;
    private readonly autoOffTimer;
    constructor(platform: AnovaOvenHomebridgePlatform, accessory: PlatformAccessory, oven: AnovaOven, recipes: Recipe[], options: OvenAccessoryOptions);
    private get context();
    private saveContext;
    private get targetC();
    private refresh;
    /** Start the main cook: the configured heating mode at the thermostat's target temperature. */
    private startMainCook;
    /** Start a cook from HomeKit and arm the auto-off safety limit for it. */
    private startTracked;
    /** Queue a start; within a short window only the highest-priority request runs (see START_BURST_WINDOW_MS). */
    private requestStart;
    private flushStarts;
    private stop;
    private checkAutoOff;
    private createSwitch;
    private setUpThermostat;
    /** While cooking, the active stage's setpoint; otherwise the saved target. Clamped to the characteristic's range. */
    private displayedTargetC;
    private retargetTimer?;
    /** Change the temperature of the running cook (debounced), keeping its heating mode and any remaining timer. */
    private scheduleRetarget;
    private setUpSensors;
    private sensor;
    private getOrAddService;
    /**
     * Remove services of `type` whose subtype isn't in `keep`. With a single `onlySubtype`-style call
     * (keep = [], subtype given as label), removes just that subtype.
     */
    private removeStale;
}
//# sourceMappingURL=platformAccessory.d.ts.map