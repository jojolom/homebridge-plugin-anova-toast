"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnovaOvenPlatformAccessory = void 0;
const recipes_1 = require("./recipes");
/** Subtype of the main on/off switch. Unchanged from earlier versions so existing HomeKit setups keep working. */
const MAIN_SWITCH_SUBTYPE = 'Power On';
/** Name the main switch had before it became configurable; renamed to the configured name if still unchanged. */
const LEGACY_MAIN_SWITCH_NAME = 'Power On';
/** After a tap, report the requested state for this long while waiting for the oven to confirm it. */
const STATE_UPDATE_TIMEOUT_MS = 5000;
/**
 * Siri and grouped Home tiles turn on every switch of the accessory at once. "On" requests arriving
 * within this window are treated as one request, and only the highest-priority one starts a cook.
 */
const START_BURST_WINDOW_MS = 400;
/** Wait this long after the last temperature change (e.g. dragging the slider) before restarting the cook. */
const TEMPERATURE_CHANGE_DEBOUNCE_MS = 1500;
const AUTO_OFF_CHECK_INTERVAL_MS = 60000;
const PRIORITY_MAIN = 2;
const PRIORITY_RECIPE = 1;
/** Ignore state updates that still show the previous cook for this long after starting a new one. */
const AUTO_OFF_GRACE_MS = 15000;
class AnovaOvenPlatformAccessory {
    constructor(platform, accessory, oven, recipes, options) {
        var _a, _b;
        this.platform = platform;
        this.accessory = accessory;
        this.oven = oven;
        this.recipes = recipes;
        this.options = options;
        this.switches = [];
        this.refreshers = [];
        this.pendingStarts = [];
        const { Characteristic, Service } = this.platform;
        this.accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'Anova Culinary')
            .setCharacteristic(Characteristic.Model, 'Precision Oven')
            .setCharacteristic(Characteristic.SerialNumber, oven.deviceId)
            .setCharacteristic(Characteristic.FirmwareRevision, `FW: ${(_a = oven.state.systemInfo) === null || _a === void 0 ? void 0 : _a.firmwareVersion}, HW: ${(_b = oven.state.systemInfo) === null || _b === void 0 ? void 0 : _b.hardwareVersion}`);
        // Main switch: on whenever the oven is cooking anything; turning it on cooks at the thermostat's target.
        const mainSwitch = this.createSwitch({
            subtype: MAIN_SWITCH_SUBTYPE,
            name: options.mainSwitchName,
            priority: PRIORITY_MAIN,
            isActive: () => this.oven.isOn,
            start: () => this.startMainCook(),
            stopsAnyCook: true,
        });
        mainSwitch.setPrimaryService(true);
        // Recipe switches: on only while that recipe is the active cook.
        recipes.forEach((recipe) => this.createSwitch({
            subtype: recipe.name,
            name: recipe.name,
            priority: PRIORITY_RECIPE,
            isActive: () => this.oven.isCooking(recipe.stages),
            start: () => this.startTracked(recipe.stages),
            stopsAnyCook: false,
        }));
        this.removeStale(Service.Switch, [MAIN_SWITCH_SUBTYPE, ...recipes.map((r) => r.name)], 'switch');
        this.setUpThermostat();
        this.setUpSensors();
        oven.on('ovenState', () => this.refresh());
        oven.on('cookStart', () => this.refresh());
        oven.on('cookEnd', () => this.refresh());
        oven.on('setName', (name) => {
            this.platform.log.debug('Setting name to', name);
            this.accessory.displayName = name;
            this.platform.api.updatePlatformAccessories([this.accessory]);
        });
        this.autoOffTimer = setInterval(() => this.checkAutoOff(), AUTO_OFF_CHECK_INTERVAL_MS);
        this.platform.api.on('shutdown', () => clearInterval(this.autoOffTimer));
        this.refresh();
    }
    get context() {
        return this.accessory.context;
    }
    saveContext() {
        this.platform.api.updatePlatformAccessories([this.accessory]);
    }
    get targetC() {
        var _a;
        return (0, recipes_1.clampTemperatureC)((_a = this.context.targetC) !== null && _a !== void 0 ? _a : this.options.defaultTemperatureC, this.options.ovenMode);
    }
    refresh() {
        for (const sw of this.switches) {
            sw.service.updateCharacteristic(this.platform.Characteristic.On, sw.currentValue());
        }
        this.refreshers.forEach((fn) => fn());
        this.checkAutoOff();
    }
    // ---- Starting and stopping ---------------------------------------------------------------------
    /** Start the main cook: the configured heating mode at the thermostat's target temperature. */
    startMainCook() {
        return this.startTracked((0, recipes_1.buildStages)({ mode: this.options.ovenMode, temperatureC: this.targetC }));
    }
    /** Start a cook from HomeKit and arm the auto-off safety limit for it. */
    async startTracked(stages) {
        const cookId = await this.oven.startCook(stages);
        if (this.options.maxCookHours > 0) {
            const timerSeconds = stages.reduce((sum, s) => { var _a, _b; return sum + ((_b = (_a = s.timer) === null || _a === void 0 ? void 0 : _a.initial) !== null && _b !== void 0 ? _b : 0); }, 0);
            const now = Date.now();
            this.context.autoOff = { cookId, armedAt: now, deadline: now + this.options.maxCookHours * 3600000 + timerSeconds * 1000 };
        }
        else {
            delete this.context.autoOff;
        }
        this.saveContext();
        return cookId;
    }
    /** Queue a start; within a short window only the highest-priority request runs (see START_BURST_WINDOW_MS). */
    requestStart(name, priority, start) {
        return new Promise((resolve, reject) => {
            this.pendingStarts.push({ name, priority, start, resolve, reject });
            if (!this.startTimer) {
                this.startTimer = setTimeout(() => void this.flushStarts(), START_BURST_WINDOW_MS);
            }
        });
    }
    async flushStarts() {
        const requests = this.pendingStarts;
        this.pendingStarts = [];
        this.startTimer = undefined;
        const winner = requests.reduce((best, r) => (r.priority > best.priority ? r : best), requests[0]);
        if (requests.length > 1) {
            this.platform.log.info(`${requests.length} controls were turned on at once (${requests.map((r) => r.name).join(', ')}); `
                + `starting only "${winner.name}".`);
            this.switches.forEach((sw) => {
                if (sw.service.subtype !== winner.name && sw.service.displayName !== winner.name) {
                    sw.clearPending();
                }
            });
        }
        try {
            await winner.start();
            requests.forEach((r) => r.resolve());
        }
        catch (e) {
            requests.forEach((r) => r.reject(e));
        }
        finally {
            setTimeout(() => this.refresh(), 50);
        }
    }
    async stop(reason) {
        if (!this.oven.isOn) {
            return;
        }
        this.platform.log.info(`Stopping the oven (${reason})`);
        await this.oven.stopCook();
    }
    checkAutoOff() {
        var _a;
        const autoOff = this.context.autoOff;
        if (!autoOff) {
            return;
        }
        const cook = this.oven.state.cook;
        if (!cook || cook.cookId !== autoOff.cookId) {
            // That cook ended or was replaced (e.g. from the Anova app); nothing to enforce.
            if (Date.now() - ((_a = autoOff.armedAt) !== null && _a !== void 0 ? _a : 0) > AUTO_OFF_GRACE_MS) {
                delete this.context.autoOff;
                this.saveContext();
            }
            return;
        }
        if (Date.now() >= autoOff.deadline) {
            delete this.context.autoOff;
            this.saveContext();
            this.platform.log.warn(`Turning the oven off: a cook started from HomeKit has been running longer than the ${this.options.maxCookHours} hour limit ("maxCookHours" in the plugin settings).`);
            this.oven.stopCook().catch((e) => this.platform.log.error(`Auto-off failed: ${e instanceof Error ? e.message : e}`));
        }
    }
    // ---- Switches ----------------------------------------------------------------------------------
    createSwitch(opts) {
        const { Characteristic, api } = this.platform;
        let sw = this.accessory.getServiceById(this.platform.Service.Switch, opts.subtype);
        if (!sw) {
            sw = new this.platform.Service.Switch(opts.name, opts.subtype);
            sw.addOptionalCharacteristic(Characteristic.ConfiguredName);
            sw.setCharacteristic(Characteristic.Name, opts.name);
            sw.setCharacteristic(Characteristic.ConfiguredName, opts.name);
            this.accessory.addService(sw);
        }
        else if (opts.subtype === MAIN_SWITCH_SUBTYPE && opts.name !== LEGACY_MAIN_SWITCH_NAME
            && sw.getCharacteristic(Characteristic.ConfiguredName).value === LEGACY_MAIN_SWITCH_NAME) {
            // Still has the old default name (not renamed in the Home app): apply the new name.
            sw.setCharacteristic(Characteristic.Name, opts.name);
            sw.setCharacteristic(Characteristic.ConfiguredName, opts.name);
        }
        sw.displayName = opts.name;
        this.platform.log.debug('Creating switch', opts.name);
        let pendingState;
        let pendingStateExpiration = 0;
        const currentValue = () => {
            const actual = opts.isActive();
            if (pendingState !== undefined && pendingState !== actual && Date.now() < pendingStateExpiration) {
                return pendingState;
            }
            pendingState = undefined;
            return actual;
        };
        sw.getCharacteristic(Characteristic.On)
            .onSet(async (value) => {
            this.platform.log.debug(`Set ${opts.name} ->`, value);
            pendingState = Boolean(value);
            pendingStateExpiration = Date.now() + STATE_UPDATE_TIMEOUT_MS;
            try {
                if (value) {
                    if (!opts.isActive()) {
                        await this.requestStart(opts.name, opts.priority, opts.start);
                    }
                }
                else if (opts.stopsAnyCook || opts.isActive()) {
                    await this.stop(`${opts.name} turned off`);
                }
                else {
                    // Turning off a recipe that isn't the one cooking leaves the current cook alone.
                    pendingState = undefined;
                    setTimeout(() => this.refresh(), 50);
                }
            }
            catch (e) {
                pendingState = undefined;
                this.platform.log.error(`Could not turn ${opts.name} ${value ? 'on' : 'off'}: ${e instanceof Error ? e.message : e}`);
                throw new api.hap.HapStatusError(-70402 /* SERVICE_COMMUNICATION_FAILURE */);
            }
        })
            .onGet(() => currentValue());
        this.switches.push({ service: sw, currentValue, clearPending: () => (pendingState = undefined) });
        return sw;
    }
    // ---- Thermostat --------------------------------------------------------------------------------
    setUpThermostat() {
        const { Characteristic, Service } = this.platform;
        const { api, log } = this.platform;
        if (!this.options.thermostat) {
            this.removeStale(Service.Thermostat, [], 'thermostat');
            return;
        }
        const name = `${this.options.mainSwitchName} Temperature`;
        const svc = this.getOrAddService(Service.Thermostat, name, 'thermostat');
        const maxC = recipes_1.COOKING_MODES[this.options.ovenMode].bulb === 'wet' ? 100 : recipes_1.MAX_DRY_TEMP_C;
        svc.getCharacteristic(Characteristic.CurrentTemperature)
            .setProps({ minValue: -50, maxValue: 300, minStep: 0.1 })
            .onGet(() => { var _a; return (_a = this.oven.currentTemperatureC) !== null && _a !== void 0 ? _a : 0; });
        // Widen the range first, move the value into it, then raise the minimum. Setting the minimum straight
        // away makes HAP warn about HomeKit's default value (10 °C) being out of range.
        const targetTemp = svc.getCharacteristic(Characteristic.TargetTemperature);
        targetTemp.setProps({ maxValue: maxC, minStep: 0.5 });
        targetTemp.updateValue(this.displayedTargetC());
        targetTemp.setProps({ minValue: recipes_1.MIN_TEMP_C });
        targetTemp
            .onGet(() => this.displayedTargetC())
            .onSet((value) => {
            const celsius = Number(value);
            this.context.targetC = celsius;
            this.saveContext();
            if (this.oven.isOn) {
                this.scheduleRetarget(celsius);
            }
        });
        svc.getCharacteristic(Characteristic.CurrentHeatingCoolingState)
            .setProps({ validValues: [Characteristic.CurrentHeatingCoolingState.OFF, Characteristic.CurrentHeatingCoolingState.HEAT] })
            .onGet(() => (this.oven.isOn ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF));
        let pendingTarget;
        let pendingTargetExpiration = 0;
        svc.getCharacteristic(Characteristic.TargetHeatingCoolingState)
            .setProps({ validValues: [Characteristic.TargetHeatingCoolingState.OFF, Characteristic.TargetHeatingCoolingState.HEAT] })
            .onGet(() => {
            const actual = this.oven.isOn ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.OFF;
            return pendingTarget !== undefined && Date.now() < pendingTargetExpiration ? pendingTarget : actual;
        })
            .onSet(async (value) => {
            pendingTarget = Number(value);
            pendingTargetExpiration = Date.now() + STATE_UPDATE_TIMEOUT_MS;
            try {
                if (value === Characteristic.TargetHeatingCoolingState.HEAT) {
                    if (!this.oven.isOn) {
                        await this.requestStart(name, PRIORITY_MAIN, () => this.startMainCook());
                    }
                }
                else {
                    await this.stop(`${name} turned off`);
                }
            }
            catch (e) {
                pendingTarget = undefined;
                log.error(`Could not change ${name}: ${e instanceof Error ? e.message : e}`);
                throw new api.hap.HapStatusError(-70402 /* SERVICE_COMMUNICATION_FAILURE */);
            }
        });
        svc.getCharacteristic(Characteristic.TemperatureDisplayUnits)
            .onGet(() => (this.oven.temperatureUnit === 'C'
            ? Characteristic.TemperatureDisplayUnits.CELSIUS : Characteristic.TemperatureDisplayUnits.FAHRENHEIT))
            .onSet(() => undefined);
        this.refreshers.push(() => {
            var _a;
            svc.updateCharacteristic(Characteristic.CurrentTemperature, (_a = this.oven.currentTemperatureC) !== null && _a !== void 0 ? _a : 0);
            svc.updateCharacteristic(Characteristic.TargetTemperature, this.displayedTargetC());
            svc.updateCharacteristic(Characteristic.CurrentHeatingCoolingState, this.oven.isOn ? Characteristic.CurrentHeatingCoolingState.HEAT : Characteristic.CurrentHeatingCoolingState.OFF);
            if (Date.now() >= pendingTargetExpiration) {
                svc.updateCharacteristic(Characteristic.TargetHeatingCoolingState, this.oven.isOn ? Characteristic.TargetHeatingCoolingState.HEAT : Characteristic.TargetHeatingCoolingState.OFF);
            }
        });
    }
    /** While cooking, the active stage's setpoint; otherwise the saved target. Clamped to the characteristic's range. */
    displayedTargetC() {
        var _a;
        const maxC = recipes_1.COOKING_MODES[this.options.ovenMode].bulb === 'wet' ? 100 : recipes_1.MAX_DRY_TEMP_C;
        const c = (_a = (this.oven.isOn ? this.oven.setpointC : undefined)) !== null && _a !== void 0 ? _a : this.targetC;
        return Math.min(maxC, Math.max(recipes_1.MIN_TEMP_C, c));
    }
    /** Change the temperature of the running cook (debounced), keeping its heating mode and any remaining timer. */
    scheduleRetarget(celsius) {
        if (this.retargetTimer) {
            clearTimeout(this.retargetTimer);
        }
        this.retargetTimer = setTimeout(() => {
            var _a, _b;
            this.retargetTimer = undefined;
            const stage = this.oven.activeStage;
            if (!this.oven.isOn || !stage) {
                return;
            }
            if (this.oven.setpointC !== undefined && Math.abs(this.oven.setpointC - celsius) < 0.25) {
                return;
            }
            const timer = (_a = this.oven.state.nodes) === null || _a === void 0 ? void 0 : _a.timer;
            const remaining = (timer === null || timer === void 0 ? void 0 : timer.mode) === 'running' ? timer.current : (_b = stage.timer) === null || _b === void 0 ? void 0 : _b.initial;
            this.platform.log.info(`Changing the oven temperature to ${Math.round(celsius)}°C (restarting the cook at the new temperature)`);
            this.startTracked((0, recipes_1.retargetStages)(stage, celsius, remaining))
                .catch((e) => this.platform.log.error(`Could not change the temperature: ${e instanceof Error ? e.message : e}`));
        }, TEMPERATURE_CHANGE_DEBOUNCE_MS);
    }
    // ---- Sensors -----------------------------------------------------------------------------------
    setUpSensors() {
        const { Characteristic, Service } = this.platform;
        const base = this.options.mainSwitchName;
        const { sensors } = this.options;
        this.sensor(sensors.preheated, Service.OccupancySensor, `${base} Preheated`, 'preheated', (svc) => {
            var _a;
            const cookId = (_a = this.oven.state.cook) === null || _a === void 0 ? void 0 : _a.cookId;
            if (cookId && this.oven.isPreheated) {
                // Latch for the rest of this cook, so opening the door (and the temperature dipping) doesn't flip it back.
                this.preheatedCookId = cookId;
            }
            const preheated = Boolean(cookId && this.preheatedCookId === cookId);
            svc.updateCharacteristic(Characteristic.OccupancyDetected, preheated ? 1 : 0);
        });
        this.sensor(sensors.done, Service.OccupancySensor, `${base} Done`, 'done', (svc) => {
            svc.updateCharacteristic(Characteristic.OccupancyDetected, this.oven.isDone ? 1 : 0);
        });
        this.sensor(sensors.door, Service.ContactSensor, `${base} Door`, 'door', (svc) => {
            svc.updateCharacteristic(Characteristic.ContactSensorState, this.oven.isDoorClosed
                ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED);
        });
        this.sensor(sensors.waterTank, Service.OccupancySensor, `${base} Water Tank Empty`, 'water-tank', (svc) => {
            svc.updateCharacteristic(Characteristic.OccupancyDetected, this.oven.isWaterTankEmpty ? 1 : 0);
        });
        this.sensor(sensors.descale, Service.OccupancySensor, `${base} Needs Descaling`, 'descale', (svc) => {
            svc.updateCharacteristic(Characteristic.OccupancyDetected, this.oven.needsDescaling ? 1 : 0);
        });
        let probePropsSet = false;
        this.sensor(sensors.probe, Service.TemperatureSensor, `${base} Food Probe`, 'probe', (svc) => {
            var _a;
            const probe = this.oven.probe;
            if (!probePropsSet) {
                svc.getCharacteristic(Characteristic.CurrentTemperature).setProps({ minValue: -50, maxValue: 300, minStep: 0.1 });
                probePropsSet = true;
            }
            svc.updateCharacteristic(Characteristic.CurrentTemperature, (_a = probe.celsius) !== null && _a !== void 0 ? _a : 0);
            svc.updateCharacteristic(Characteristic.StatusActive, probe.connected);
        });
    }
    sensor(enabled, type, name, subtype, update) {
        if (!enabled) {
            this.removeStale(type, [], subtype);
            return;
        }
        const svc = this.getOrAddService(type, name, subtype);
        const run = () => update(svc);
        run();
        this.refreshers.push(run);
    }
    // ---- Helpers -----------------------------------------------------------------------------------
    getOrAddService(type, name, subtype) {
        const { Characteristic } = this.platform;
        let svc = this.accessory.getServiceById(type, subtype);
        if (!svc) {
            svc = new type(name, subtype);
            svc.addOptionalCharacteristic(Characteristic.ConfiguredName);
            svc.setCharacteristic(Characteristic.Name, name);
            svc.setCharacteristic(Characteristic.ConfiguredName, name);
            this.accessory.addService(svc);
        }
        return svc;
    }
    /**
     * Remove services of `type` whose subtype isn't in `keep`. With a single `onlySubtype`-style call
     * (keep = [], subtype given as label), removes just that subtype.
     */
    removeStale(type, keep, label) {
        this.accessory.services
            .filter((svc) => svc.UUID === type.UUID && svc.subtype !== undefined
            && (keep.length ? !keep.includes(svc.subtype) : svc.subtype === label))
            .forEach((svc) => {
            const why = keep.length ? 'no longer in the recipe list' : 'turned off in settings';
            this.platform.log.info(`Removing "${svc.displayName}" (${why})`);
            this.accessory.removeService(svc);
        });
    }
}
exports.AnovaOvenPlatformAccessory = AnovaOvenPlatformAccessory;
//# sourceMappingURL=platformAccessory.js.map