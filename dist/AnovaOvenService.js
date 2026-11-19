"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnovaOven = exports.NotConnectedError = exports.CommandTimeoutError = exports.CommandRejectedError = exports.AuthenticationError = void 0;
const axios_1 = __importDefault(require("axios"));
const events_1 = __importDefault(require("events"));
const uuid_1 = require("uuid");
const ws_1 = __importDefault(require("ws"));
/** After a stop, ignore late state messages that still show the stopped cook for this long. */
const STALE_COOK_WINDOW_MS = 5000;
/** A stage counts as preheated when the oven is within this many degrees of the setpoint (for cooks without a preheat stage). */
const PREHEAT_TOLERANCE_C = 3;
const DEFAULT_WEBSOCKET_URL = 'wss://devices.anovaculinary.io/';
const DEFAULT_AUTH_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=AIzaSyCGJwHXUhkNBdPkH3OAkjc9-3xMMjvanfU';
/** How long to wait after opening the socket for Anova to send the oven list. */
const CONNECT_TIMEOUT_MS = 15000;
/** How long to wait for Anova to acknowledge a command. */
const COMMAND_TIMEOUT_MS = 10000;
const COMMAND_ATTEMPTS = 3;
/** Keep-alive ping interval. */
const PING_INTERVAL_MS = 30000;
/** If nothing at all arrives for this long, assume the socket is dead and reconnect. */
const STALE_CONNECTION_MS = 10 * 60000;
const MIN_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 5 * 60000;
/**
 * Only reset the backoff once a connection has stayed up this long, so that a server that accepts and then
 * immediately drops us (e.g. Anova's rate limiting) doesn't cause a tight reconnect loop.
 */
const STABLE_CONNECTION_MS = 60000;
/** Firebase error codes that mean the configured credentials are wrong (retrying won't help). */
const BAD_CREDENTIAL_CODES = [
    'EMAIL_NOT_FOUND', 'INVALID_PASSWORD', 'INVALID_LOGIN_CREDENTIALS', 'INVALID_EMAIL',
    'MISSING_PASSWORD', 'MISSING_EMAIL', 'USER_DISABLED',
];
/** Temperatures reported back by the oven may be rounded differently from the configured recipe. */
const TEMPERATURE_TOLERANCE_C = 0.1;
class AuthenticationError extends Error {
}
exports.AuthenticationError = AuthenticationError;
class CommandRejectedError extends Error {
}
exports.CommandRejectedError = CommandRejectedError;
class CommandTimeoutError extends Error {
}
exports.CommandTimeoutError = CommandTimeoutError;
class NotConnectedError extends Error {
}
exports.NotConnectedError = NotConnectedError;
const describeError = (e) => {
    var _a, _b, _c;
    if (axios_1.default.isAxiosError(e)) {
        const code = (_c = (_b = (_a = e.response) === null || _a === void 0 ? void 0 : _a.data) === null || _b === void 0 ? void 0 : _b.error) === null || _c === void 0 ? void 0 : _c.message;
        return code ? `${e.message} (${code})` : e.message;
    }
    return e instanceof Error ? e.message : String(e);
};
const steamGeneratorsEqual = (a, b) => {
    var _a, _b, _c, _d;
    if (!a && !b) {
        return true;
    }
    if (!a || !b || a.mode !== b.mode) {
        return false;
    }
    if (a.mode === 'steam-percentage') {
        return ((_a = a.steamPercentage) === null || _a === void 0 ? void 0 : _a.setpoint) === ((_b = b.steamPercentage) === null || _b === void 0 ? void 0 : _b.setpoint);
    }
    if (a.mode === 'relative-humidity') {
        return ((_c = a.relativeHumidity) === null || _c === void 0 ? void 0 : _c.setpoint) === ((_d = b.relativeHumidity) === null || _d === void 0 ? void 0 : _d.setpoint);
    }
    // Unknown steam mode: treat matching modes as equal rather than throwing inside a HomeKit read.
    return true;
};
const temperaturesEqual = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= TEMPERATURE_TOLERANCE_C;
const temperatureBulbsEqual = (a, b) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!a || !b || a.mode !== b.mode) {
        return false;
    }
    if (a.mode === 'dry' && b.mode === 'dry') {
        return temperaturesEqual((_b = (_a = a.dry) === null || _a === void 0 ? void 0 : _a.setpoint) === null || _b === void 0 ? void 0 : _b.celsius, (_d = (_c = b.dry) === null || _c === void 0 ? void 0 : _c.setpoint) === null || _d === void 0 ? void 0 : _d.celsius);
    }
    if (a.mode === 'wet' && b.mode === 'wet') {
        return temperaturesEqual((_f = (_e = a.wet) === null || _e === void 0 ? void 0 : _e.setpoint) === null || _f === void 0 ? void 0 : _f.celsius, (_h = (_g = b.wet) === null || _g === void 0 ? void 0 : _g.setpoint) === null || _h === void 0 ? void 0 : _h.celsius);
    }
    return false;
};
const stagesEqual = (stage1, stage2) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    return ((_a = stage1.fan) === null || _a === void 0 ? void 0 : _a.speed) === ((_b = stage2.fan) === null || _b === void 0 ? void 0 : _b.speed) &&
        ((_d = (_c = stage1.heatingElements) === null || _c === void 0 ? void 0 : _c.bottom) === null || _d === void 0 ? void 0 : _d.on) === ((_f = (_e = stage2.heatingElements) === null || _e === void 0 ? void 0 : _e.bottom) === null || _f === void 0 ? void 0 : _f.on) &&
        ((_h = (_g = stage1.heatingElements) === null || _g === void 0 ? void 0 : _g.rear) === null || _h === void 0 ? void 0 : _h.on) === ((_k = (_j = stage2.heatingElements) === null || _j === void 0 ? void 0 : _j.rear) === null || _k === void 0 ? void 0 : _k.on) &&
        ((_m = (_l = stage1.heatingElements) === null || _l === void 0 ? void 0 : _l.top) === null || _m === void 0 ? void 0 : _m.on) === ((_p = (_o = stage2.heatingElements) === null || _o === void 0 ? void 0 : _o.top) === null || _p === void 0 ? void 0 : _p.on) &&
        steamGeneratorsEqual(stage1.steamGenerators, stage2.steamGenerators) &&
        temperatureBulbsEqual(stage1.temperatureBulbs, stage2.temperatureBulbs) &&
        ((_q = stage1.vent) === null || _q === void 0 ? void 0 : _q.open) === ((_r = stage2.vent) === null || _r === void 0 ? void 0 : _r.open);
};
class AnovaOven extends events_1.default {
    constructor(deviceId, name, startingState, service) {
        super();
        this.deviceId = deviceId;
        this.service = service;
        this._name = name;
        this._state = startingState;
    }
    set name(name) {
        if (name === this._name) {
            return;
        }
        this._name = name;
        this.emit('setName', name);
    }
    get name() {
        return this._name;
    }
    /** Apply a state update received from the Anova cloud. */
    updateState(update) {
        var _a, _b, _c, _d;
        if (this.stoppedCook && ((_a = update.cook) === null || _a === void 0 ? void 0 : _a.cookId) === this.stoppedCook.cookId && Date.now() < this.stoppedCook.until) {
            // Sent before the oven processed our stop; don't let it flip things back on.
            update = { ...update, cook: undefined };
        }
        const prev = this._state;
        this._state = update;
        if (((_b = update.state) === null || _b === void 0 ? void 0 : _b.mode) !== ((_c = prev.state) === null || _c === void 0 ? void 0 : _c.mode)) {
            this.service.log.info(`Oven ${this.deviceId} is in state ${(_d = update.state) === null || _d === void 0 ? void 0 : _d.mode}`);
        }
        this.emit('ovenState', update);
        if (update.cook && !prev.cook) {
            this.service.log.info(`Oven ${this.deviceId} started cooking`);
            this.emit('cookStart', update.cook);
        }
        else if (prev.cook && !update.cook) {
            this.service.log.info(`Oven ${this.deviceId} stopped cooking`);
            this.emit('cookEnd');
        }
    }
    /** True while the oven is running any cook (from HomeKit, the app, or the oven's own controls). */
    get isOn() {
        return Boolean(this._state.cook);
    }
    get state() {
        return this._state;
    }
    /** The stage the oven is currently running, if cooking. */
    get activeStage() {
        var _a, _b;
        const cook = this._state.cook;
        if (!((_a = cook === null || cook === void 0 ? void 0 : cook.stages) === null || _a === void 0 ? void 0 : _a.length)) {
            return undefined;
        }
        const byId = cook.activeStageId ? cook.stages.find((s) => s.id === cook.activeStageId) : undefined;
        return byId !== null && byId !== void 0 ? byId : cook.stages[(_b = cook.activeStageIndex) !== null && _b !== void 0 ? _b : 0];
    }
    get activeStageIndex() {
        var _a;
        const cook = this._state.cook;
        if (!(cook === null || cook === void 0 ? void 0 : cook.stages)) {
            return -1;
        }
        const byId = cook.activeStageId ? cook.stages.findIndex((s) => s.id === cook.activeStageId) : -1;
        return byId >= 0 ? byId : (_a = cook.activeStageIndex) !== null && _a !== void 0 ? _a : 0;
    }
    /** Oven temperature in °C, from the wet bulb in sous vide mode and the dry bulb otherwise. */
    get currentTemperatureC() {
        var _a, _b, _c, _d, _e, _f, _g, _h;
        const bulbs = (_a = this._state.nodes) === null || _a === void 0 ? void 0 : _a.temperatureBulbs;
        const mode = (_d = (_c = (_b = this.activeStage) === null || _b === void 0 ? void 0 : _b.temperatureBulbs) === null || _c === void 0 ? void 0 : _c.mode) !== null && _d !== void 0 ? _d : bulbs === null || bulbs === void 0 ? void 0 : bulbs.mode;
        return mode === 'wet' ? (_f = (_e = bulbs === null || bulbs === void 0 ? void 0 : bulbs.wet) === null || _e === void 0 ? void 0 : _e.current) === null || _f === void 0 ? void 0 : _f.celsius : (_h = (_g = bulbs === null || bulbs === void 0 ? void 0 : bulbs.dry) === null || _g === void 0 ? void 0 : _g.current) === null || _h === void 0 ? void 0 : _h.celsius;
    }
    /** Target temperature of the active stage in °C, if cooking. */
    get setpointC() {
        var _a, _b, _c, _d, _e;
        const bulbs = (_a = this.activeStage) === null || _a === void 0 ? void 0 : _a.temperatureBulbs;
        if (!bulbs) {
            return undefined;
        }
        return bulbs.mode === 'wet' ? (_c = (_b = bulbs.wet) === null || _b === void 0 ? void 0 : _b.setpoint) === null || _c === void 0 ? void 0 : _c.celsius : (_e = (_d = bulbs.dry) === null || _d === void 0 ? void 0 : _d.setpoint) === null || _e === void 0 ? void 0 : _e.celsius;
    }
    /**
     * True once the oven has finished preheating for the current cook: it has moved past its preheat
     * stage(s), or (for cooks without one) reached the setpoint.
     */
    get isPreheated() {
        var _a;
        const stage = this.activeStage;
        if (!this.isOn || !stage || stage.type === 'preheat') {
            return false;
        }
        const idx = this.activeStageIndex;
        if ((_a = this._state.cook) === null || _a === void 0 ? void 0 : _a.stages.slice(0, Math.max(0, idx)).some((s) => s.type === 'preheat')) {
            return true;
        }
        const current = this.currentTemperatureC;
        const target = this.setpointC;
        return current !== undefined && target !== undefined && current >= target - PREHEAT_TOLERANCE_C;
    }
    /**
     * True when the final stage has finished and the oven is waiting for someone (it keeps holding
     * temperature rather than turning itself off).
     */
    get isDone() {
        const cook = this._state.cook;
        return Boolean(this.isOn && (cook === null || cook === void 0 ? void 0 : cook.stageTransitionPendingUserAction) && this.activeStageIndex === cook.stages.length - 1);
    }
    get isDoorClosed() {
        var _a, _b;
        return ((_b = (_a = this._state.nodes) === null || _a === void 0 ? void 0 : _a.door) === null || _b === void 0 ? void 0 : _b.closed) !== false;
    }
    get isWaterTankEmpty() {
        var _a, _b;
        return ((_b = (_a = this._state.nodes) === null || _a === void 0 ? void 0 : _a.waterTank) === null || _b === void 0 ? void 0 : _b.empty) === true;
    }
    get needsDescaling() {
        var _a, _b, _c;
        return ((_c = (_b = (_a = this._state.nodes) === null || _a === void 0 ? void 0 : _a.steamGenerators) === null || _b === void 0 ? void 0 : _b.boiler) === null || _c === void 0 ? void 0 : _c.descaleRequired) === true;
    }
    get probe() {
        var _a, _b;
        const probe = (_a = this._state.nodes) === null || _a === void 0 ? void 0 : _a.temperatureProbe;
        return { connected: (probe === null || probe === void 0 ? void 0 : probe.connected) === true, celsius: (_b = probe === null || probe === void 0 ? void 0 : probe.current) === null || _b === void 0 ? void 0 : _b.celsius };
    }
    get temperatureUnit() {
        var _a;
        return ((_a = this._state.state) === null || _a === void 0 ? void 0 : _a.temperatureUnit) === 'C' ? 'C' : 'F';
    }
    /** Stop the oven. Concurrent calls (e.g. several HomeKit switches turned off at once) share one command. */
    stopCook() {
        if (!this.stopInFlight) {
            this.stopInFlight = this.service.sendOvenCommand('CMD_APO_STOP', {
                type: 'CMD_APO_STOP',
                id: this.deviceId,
            }).then(() => {
                var _a;
                if ((_a = this._state.cook) === null || _a === void 0 ? void 0 : _a.cookId) {
                    this.stoppedCook = { cookId: this._state.cook.cookId, until: Date.now() + STALE_COOK_WINDOW_MS };
                }
                if (this._state.cook) {
                    this._state = { ...this._state, cook: undefined };
                    this.emit('cookEnd');
                }
            }).finally(() => {
                this.stopInFlight = undefined;
            });
        }
        return this.stopInFlight;
    }
    /**
     * Start a cook with the given stages. Stages without an ID get a fresh UUID; the caller's
     * objects are not modified. Returns the cook ID.
     */
    async startCook(stages) {
        var _a;
        const cookStages = stages.map((stage) => ({ ...stage, id: stage.id || (0, uuid_1.v4)() }));
        const cookId = (0, uuid_1.v4)();
        await this.service.sendOvenCommand('CMD_APO_START', {
            payload: { cookId, stages: cookStages },
            type: 'CMD_APO_START',
            id: this.deviceId,
        });
        // Reflect the new cook right away; the oven's own state update follows within a second or two.
        const wasOn = this.isOn;
        this._state = {
            ...this._state,
            cook: { cookId, stages: cookStages, activeStageIndex: 0, activeStageId: (_a = cookStages[0]) === null || _a === void 0 ? void 0 : _a.id },
        };
        if (!wasOn) {
            this.emit('cookStart', this._state.cook);
        }
        else {
            this.emit('ovenState', this._state);
        }
        return cookId;
    }
    /**
     * Returns true if the currently active cook has the same stages (compares settings, not stage or cook IDs)
     */
    isCooking(stages) {
        var _a;
        const curCook = (_a = this._state) === null || _a === void 0 ? void 0 : _a.cook;
        if (!(curCook === null || curCook === void 0 ? void 0 : curCook.stages) || curCook.stages.length !== stages.length) {
            return false;
        }
        return stages.every((v, idx) => stagesEqual(v, curCook.stages[idx]));
    }
}
exports.AnovaOven = AnovaOven;
/**
 * Maintains a single WebSocket connection to the Anova cloud, reconnecting with backoff when it drops.
 */
class AnovaOvenService extends events_1.default {
    constructor(options, log) {
        super();
        this.options = options;
        this.log = log;
        this.ovens = new Map();
        this.connected = false;
        this.running = false;
        this.connecting = false;
        this.credentialsRejected = false;
        this.reconnectAttempts = 0;
        this.ovenNames = new Map();
        // One listener per in-flight command or waiter; avoid spurious leak warnings.
        this.setMaxListeners(50);
    }
    get isConnected() {
        var _a;
        return this.connected && ((_a = this.socket) === null || _a === void 0 ? void 0 : _a.readyState) === ws_1.default.OPEN;
    }
    /** Connect and stay connected until stop() is called. */
    start() {
        if (this.running) {
            return;
        }
        this.running = true;
        void this.connect();
    }
    stop() {
        this.running = false;
        this.clearReconnectTimer();
        this.clearConnectionTimers();
        const socket = this.socket;
        this.socket = undefined;
        this.connected = false;
        if (socket) {
            socket.removeAllListeners('message');
            socket.on('error', () => undefined);
            socket.terminate();
        }
    }
    /** Builds the URL (including credentials) and subprotocols used to open the socket. */
    async getConnectionParameters() {
        var _a;
        const base = (_a = this.options.websocketUrl) !== null && _a !== void 0 ? _a : DEFAULT_WEBSOCKET_URL;
        if (this.options.token) {
            // Official developer API: https://developer.anovaculinary.com/docs/devices/wifi/authentication
            return {
                url: `${base}?token=${encodeURIComponent(this.options.token)}&supportedAccessories=APO`,
            };
        }
        const token = await this.getFirebaseToken();
        return {
            url: `${base}?token=${encodeURIComponent(token)}&supportedAccessories=APO&platform=android`,
            protocols: ['ANOVA_V2'],
        };
    }
    async getFirebaseToken() {
        var _a, _b, _c, _d;
        try {
            const { data } = await (0, axios_1.default)({
                method: 'post',
                url: (_a = this.options.authUrl) !== null && _a !== void 0 ? _a : DEFAULT_AUTH_URL,
                headers: { 'content-type': 'application/json' },
                timeout: 15000,
                data: {
                    email: this.options.email,
                    password: this.options.password,
                    returnSecureToken: true,
                },
            });
            return data.idToken;
        }
        catch (e) {
            const code = axios_1.default.isAxiosError(e)
                ? (_d = (_c = (_b = e.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.error) === null || _d === void 0 ? void 0 : _d.message
                : undefined;
            if (code && BAD_CREDENTIAL_CODES.some((bad) => code.startsWith(bad))) {
                throw new AuthenticationError(`Anova rejected the email/password (${code}).`);
            }
            throw e;
        }
    }
    async connect() {
        if (!this.running || this.connecting || this.socket) {
            return;
        }
        this.connecting = true;
        this.clearReconnectTimer();
        let params;
        try {
            params = await this.getConnectionParameters();
        }
        catch (e) {
            this.connecting = false;
            if (e instanceof AuthenticationError) {
                this.credentialsRejected = true;
                this.log.error(`${e.message} Fix the credentials in the plugin settings and restart Homebridge.`);
                return;
            }
            this.log.warn(`Could not sign in to Anova: ${describeError(e)}`);
            this.scheduleReconnect();
            return;
        }
        this.connecting = false;
        if (!this.running) {
            return;
        }
        const socket = new ws_1.default(params.url, params.protocols);
        this.socket = socket;
        let lastError;
        const connectTimeout = setTimeout(() => {
            this.log.warn('Timed out waiting for the Anova cloud to respond; reconnecting');
            socket.terminate();
        }, CONNECT_TIMEOUT_MS);
        socket.on('open', () => {
            this.log.debug('WebSocket open, waiting for oven list');
            this.pingTimer = setInterval(() => {
                if (socket.readyState === ws_1.default.OPEN) {
                    socket.ping();
                }
            }, PING_INTERVAL_MS);
            this.resetStaleTimer(socket);
        });
        socket.on('message', (raw) => {
            if (socket !== this.socket) {
                return;
            }
            this.resetStaleTimer(socket);
            let message;
            try {
                message = JSON.parse(raw.toString());
            }
            catch (_a) {
                this.log.warn('Ignoring a message from Anova that was not valid JSON');
                return;
            }
            if (message.command === 'EVENT_APO_WIFI_LIST' && !this.connected) {
                clearTimeout(connectTimeout);
                this.connected = true;
                this.stableTimer = setTimeout(() => {
                    this.reconnectAttempts = 0;
                }, STABLE_CONNECTION_MS);
                this.log.info('Connected to the Anova cloud');
                this.emit('connected');
            }
            this.dispatch(message);
        });
        // Without an 'error' listener, ws re-throws and takes down the whole Homebridge process.
        socket.on('error', (err) => {
            lastError = err;
            this.log.warn(`Anova connection error: ${err.message}`);
        });
        socket.on('close', (code, reason) => {
            clearTimeout(connectTimeout);
            if (socket !== this.socket) {
                return;
            }
            this.socket = undefined;
            this.clearConnectionTimers();
            const wasConnected = this.connected;
            this.connected = false;
            if (wasConnected) {
                const why = (reason === null || reason === void 0 ? void 0 : reason.length) ? `: ${reason.toString()}` : '';
                this.log.warn(`Disconnected from the Anova cloud (code ${code}${why})`);
                this.emit('disconnected');
            }
            if (lastError && /Unexpected server response: 40[13]/.test(lastError.message)) {
                this.credentialsRejected = true;
                this.log.error('Anova refused the connection (not authorized). Check the credentials in the plugin settings '
                    + 'and restart Homebridge.');
                return;
            }
            this.scheduleReconnect();
        });
    }
    scheduleReconnect() {
        if (!this.running || this.reconnectTimer || this.credentialsRejected) {
            return;
        }
        const backoff = Math.min(MAX_RECONNECT_DELAY_MS, MIN_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts);
        const delay = Math.round(backoff * (0.8 + Math.random() * 0.4));
        this.reconnectAttempts++;
        this.log.info(`Reconnecting to the Anova cloud in ${Math.round(delay / 1000)}s`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined;
            void this.connect();
        }, delay);
    }
    /** Skip any pending backoff and reconnect right away (used when the user is actively waiting on a command). */
    reconnectNow() {
        if (this.connected || this.connecting || this.socket || this.credentialsRejected) {
            return;
        }
        this.reconnectAttempts = 0;
        this.clearReconnectTimer();
        void this.connect();
    }
    resetStaleTimer(socket) {
        if (this.staleTimer) {
            clearTimeout(this.staleTimer);
        }
        this.staleTimer = setTimeout(() => {
            this.log.warn(`No messages from Anova for ${STALE_CONNECTION_MS / 60000} minutes; reconnecting`);
            socket.terminate();
        }, STALE_CONNECTION_MS);
    }
    clearConnectionTimers() {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = undefined;
        }
        if (this.staleTimer) {
            clearTimeout(this.staleTimer);
            this.staleTimer = undefined;
        }
        if (this.stableTimer) {
            clearTimeout(this.stableTimer);
            this.stableTimer = undefined;
        }
    }
    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = undefined;
        }
    }
    dispatch(message) {
        if (message.command === 'EVENT_APO_WIFI_LIST') {
            message.payload.forEach((oven) => {
                this.ovenNames.set(oven.cookerId, oven.name);
                const existingOven = this.ovens.get(oven.cookerId);
                if (existingOven) {
                    existingOven.name = oven.name;
                }
            });
        }
        else if (message.command === 'EVENT_APO_STATE') {
            const ovenId = message.payload.cookerId;
            this.log.debug(`Oven ${ovenId} state update`);
            let oven = this.ovens.get(ovenId);
            if (!oven) {
                this.log.info(`Found oven ${ovenId}`);
                const name = this.ovenNames.get(ovenId) || `Oven ${ovenId.substring(0, 4)}`;
                oven = new AnovaOven(ovenId, name, message.payload.state, this);
                this.ovens.set(ovenId, oven);
                this.emit('ovenFound', oven);
            }
            oven.updateState(message.payload.state);
        }
        else if (message.command === 'RESPONSE') {
            this.log.debug(`Received response to command ${message.requestId}`);
            this.emit('commandResponse', message);
        }
        else if (message.command === 'EVENT_USER_STATE') {
            // ignore
        }
        else {
            this.log.debug(`Ignoring message type ${message.command}`);
        }
    }
    waitUntilConnected(timeoutMs) {
        if (this.isConnected) {
            return Promise.resolve();
        }
        if (!this.running || this.credentialsRejected) {
            return Promise.reject(new NotConnectedError('Not connected to the Anova cloud'));
        }
        this.reconnectNow();
        return new Promise((resolve, reject) => {
            const onConnected = () => {
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(() => {
                this.off('connected', onConnected);
                reject(new NotConnectedError('Timed out waiting to connect to the Anova cloud'));
            }, timeoutMs);
            this.once('connected', onConnected);
        });
    }
    /**
     * Send a command, waiting for a connection if needed. Retries on timeouts and dropped connections,
     * but not when Anova explicitly rejects the command.
     */
    async sendOvenCommand(command, payload) {
        var _a;
        let lastError;
        for (let attempt = 1; attempt <= COMMAND_ATTEMPTS; attempt++) {
            try {
                await this.waitUntilConnected(CONNECT_TIMEOUT_MS + 5000);
                await this.sendOnce(command, payload);
                return;
            }
            catch (e) {
                lastError = e;
                if (e instanceof CommandRejectedError || this.credentialsRejected || !this.running) {
                    break;
                }
                this.log.warn(`${command} attempt ${attempt} of ${COMMAND_ATTEMPTS} failed: ${describeError(e)}`);
                if (e instanceof CommandTimeoutError) {
                    // The socket may be half-dead; force a fresh connection before retrying.
                    (_a = this.socket) === null || _a === void 0 ? void 0 : _a.terminate();
                }
            }
        }
        throw lastError;
    }
    sendOnce(command, payload) {
        const socket = this.socket;
        if (!socket || socket.readyState !== ws_1.default.OPEN) {
            return Promise.reject(new NotConnectedError('Not connected to the Anova cloud'));
        }
        const cmd = {
            command,
            payload,
            requestId: (0, uuid_1.v4)(),
        };
        this.log.debug(`Sending command ${JSON.stringify(cmd)}`);
        return new Promise((resolve, reject) => {
            const onResponse = (response) => {
                var _a;
                if (response.requestId !== cmd.requestId) {
                    return;
                }
                cleanup();
                if (((_a = response.payload) === null || _a === void 0 ? void 0 : _a.status) === 'ok') {
                    resolve();
                }
                else {
                    this.log.error(`Anova rejected ${command}: ${JSON.stringify(response.payload)}`);
                    reject(new CommandRejectedError(`Anova rejected ${command}`));
                }
            };
            const onDisconnected = () => {
                cleanup();
                reject(new NotConnectedError('Connection to the Anova cloud dropped before the command was acknowledged'));
            };
            const timeout = setTimeout(() => {
                cleanup();
                reject(new CommandTimeoutError(`Timed out waiting for Anova to acknowledge ${command}`));
            }, COMMAND_TIMEOUT_MS);
            const cleanup = () => {
                clearTimeout(timeout);
                this.off('commandResponse', onResponse);
                this.off('disconnected', onDisconnected);
            };
            this.on('commandResponse', onResponse);
            this.on('disconnected', onDisconnected);
            socket.send(JSON.stringify(cmd), (err) => {
                if (err) {
                    cleanup();
                    reject(new NotConnectedError(`Could not send ${command}: ${err.message}`));
                }
            });
        });
    }
}
exports.default = AnovaOvenService;
//# sourceMappingURL=AnovaOvenService.js.map