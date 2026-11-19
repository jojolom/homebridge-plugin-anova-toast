"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnovaOvenHomebridgePlatform = void 0;
const AnovaOvenService_1 = __importDefault(require("./AnovaOvenService"));
const platformAccessory_1 = require("./platformAccessory");
const recipes_1 = require("./recipes");
const settings_1 = require("./settings");
class AnovaOvenHomebridgePlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        // this is used to track restored cached accessories
        this.accessories = [];
        this.log.debug('Finished initializing platform:', this.config.name);
        const token = typeof config.token === 'string' ? config.token.trim() : '';
        if (token && !token.startsWith('anova-')) {
            this.log.warn('The Anova personal access token should start with "anova-"; check that you copied all of it.');
        }
        if (!token && (!config.email || !config.password)) {
            this.log.error('Add an Anova personal access token (or your Anova email and password) in the plugin settings; '
                + 'the oven will not be available until you do.');
        }
        else {
            if (!token) {
                this.log.info('Signing in with email/password. A personal access token is recommended instead; see the plugin README.');
            }
            this.anovaOvenService = new AnovaOvenService_1.default({
                token: token || undefined,
                email: config.email,
                password: config.password,
                websocketUrl: config.websocketUrl,
                authUrl: config.authUrl,
            }, log);
        }
        // When this event is fired it means Homebridge has restored all cached accessories from disk.
        // Dynamic Platform plugins should only register new accessories after this event was fired,
        // in order to ensure they weren't added to homebridge already. This event can also be used
        // to start discovery of new accessories.
        this.api.on('didFinishLaunching', () => {
            log.debug('Executed didFinishLaunching callback');
            this.discoverDevices();
        });
        this.api.on('shutdown', () => { var _a; return (_a = this.anovaOvenService) === null || _a === void 0 ? void 0 : _a.stop(); });
    }
    /**
     * This function is invoked when homebridge restores cached accessories from disk at startup.
     * It should be used to setup event handlers for characteristics and update respective values.
     */
    configureAccessory(accessory) {
        this.log.info('Loading accessory from cache:', accessory.displayName);
        this.accessories.push(accessory);
    }
    get recipes() {
        // `advancedRecipes` holds raw Anova stage lists (kept out of the settings form so the UI can't drop them).
        const advanced = Array.isArray(this.config.advancedRecipes) ? this.config.advancedRecipes : [];
        const simple = Array.isArray(this.config.recipes) ? this.config.recipes : [];
        const recipes = this.config.recipes !== undefined && !Array.isArray(this.config.recipes)
            ? this.config.recipes
            : [...simple, ...advanced];
        return (0, recipes_1.resolveRecipes)({ recipes, defaultRecipes: this.config.defaultRecipes }, this.log);
    }
    get accessoryOptions() {
        const c = this.config;
        const num = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
        if (c.ovenMode !== undefined && !(0, recipes_1.isCookingMode)(c.ovenMode)) {
            this.log.warn(`Unknown "ovenMode" "${c.ovenMode}"; using "${recipes_1.DEFAULT_OVEN_MODE}". `
                + `Valid modes: ${Object.keys(recipes_1.COOKING_MODES).join(', ')}.`);
        }
        const name = typeof c.mainSwitchName === 'string' && c.mainSwitchName.trim() ? c.mainSwitchName.trim() : 'Oven';
        const sensor = (key) => c[key] !== false;
        return {
            mainSwitchName: name,
            ovenMode: (0, recipes_1.isCookingMode)(c.ovenMode) ? c.ovenMode : recipes_1.DEFAULT_OVEN_MODE,
            defaultTemperatureC: (0, recipes_1.fToC)(num(c.defaultTemperatureF, recipes_1.DEFAULT_TEMPERATURE_F)),
            thermostat: c.thermostat !== false,
            sensors: {
                preheated: sensor('preheatedSensor'),
                done: sensor('doneSensor'),
                door: sensor('doorSensor'),
                waterTank: sensor('waterTankSensor'),
                descale: sensor('descaleSensor'),
                probe: sensor('probeSensor'),
            },
            maxCookHours: Math.max(0, num(c.maxCookHours, 3)),
        };
    }
    discoverDevices() {
        // Earlier versions stored the whole oven object (including the Anova password) in the accessory context,
        // which Homebridge writes to its cache file. Replace it with just the device ID.
        const scrubbed = this.accessories.filter((accessory) => { var _a; return ((_a = accessory.context) === null || _a === void 0 ? void 0 : _a.oven) !== undefined; });
        scrubbed.forEach((accessory) => {
            var _a, _b, _c;
            accessory.context = { deviceId: (_b = (_a = accessory.context.oven) === null || _a === void 0 ? void 0 : _a._id) !== null && _b !== void 0 ? _b : (_c = accessory.context.oven) === null || _c === void 0 ? void 0 : _c.deviceId };
        });
        if (scrubbed.length) {
            this.api.updatePlatformAccessories(scrubbed);
        }
        const service = this.anovaOvenService;
        if (!service) {
            return;
        }
        const recipes = this.recipes;
        const options = this.accessoryOptions;
        service.on('ovenFound', (oven) => {
            var _a;
            const uuid = this.api.hap.uuid.generate(oven.deviceId);
            const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
            if (existingAccessory) {
                this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
                // Keep saved settings (e.g. target temperature); drop anything else, such as the old oven object.
                const { targetC, autoOff } = (_a = existingAccessory.context) !== null && _a !== void 0 ? _a : {};
                existingAccessory.context = { deviceId: oven.deviceId, targetC, autoOff };
                new platformAccessory_1.AnovaOvenPlatformAccessory(this, existingAccessory, oven, recipes, options);
                this.api.updatePlatformAccessories([existingAccessory]);
            }
            else {
                this.log.info(`Adding new accessory: ${oven.deviceId} ${oven.name}`);
                const accessory = new this.api.platformAccessory(oven.name, uuid);
                accessory.context = { deviceId: oven.deviceId };
                new platformAccessory_1.AnovaOvenPlatformAccessory(this, accessory, oven, recipes, options);
                this.api.registerPlatformAccessories(settings_1.PLUGIN_NAME, settings_1.PLATFORM_NAME, [accessory]);
                this.accessories.push(accessory);
            }
        });
        service.start();
    }
}
exports.AnovaOvenHomebridgePlatform = AnovaOvenHomebridgePlatform;
//# sourceMappingURL=platform.js.map