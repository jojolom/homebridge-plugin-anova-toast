import TypedEventEmitter from 'typed-emitter';
import { AnovaOvenEvent, DeviceID, OvenCommand, OvenCommandResponse, OvenStateMessage, StagesEntity } from './AnovaTypes';
import { Logger } from 'homebridge';
export declare class AuthenticationError extends Error {
}
export declare class CommandRejectedError extends Error {
}
export declare class CommandTimeoutError extends Error {
}
export declare class NotConnectedError extends Error {
}
declare const AnovaOven_base: new () => TypedEventEmitter<AnovaOvenEvent>;
export declare class AnovaOven extends AnovaOven_base {
    readonly deviceId: DeviceID;
    private readonly service;
    private _name;
    private _state;
    constructor(deviceId: DeviceID, name: string, startingState: OvenStateMessage, service: AnovaOvenService);
    set name(name: string);
    get name(): string;
    private stoppedCook?;
    /** Apply a state update received from the Anova cloud. */
    updateState(update: OvenStateMessage): void;
    /** True while the oven is running any cook (from HomeKit, the app, or the oven's own controls). */
    get isOn(): boolean;
    get state(): OvenStateMessage;
    /** The stage the oven is currently running, if cooking. */
    get activeStage(): StagesEntity | undefined;
    private get activeStageIndex();
    /** Oven temperature in °C, from the wet bulb in sous vide mode and the dry bulb otherwise. */
    get currentTemperatureC(): number | undefined;
    /** Target temperature of the active stage in °C, if cooking. */
    get setpointC(): number | undefined;
    /**
     * True once the oven has finished preheating for the current cook: it has moved past its preheat
     * stage(s), or (for cooks without one) reached the setpoint.
     */
    get isPreheated(): boolean;
    /**
     * True when the final stage has finished and the oven is waiting for someone (it keeps holding
     * temperature rather than turning itself off).
     */
    get isDone(): boolean;
    get isDoorClosed(): boolean;
    get isWaterTankEmpty(): boolean;
    get needsDescaling(): boolean;
    get probe(): {
        connected: boolean;
        celsius?: number;
    };
    get temperatureUnit(): 'C' | 'F';
    private stopInFlight?;
    /** Stop the oven. Concurrent calls (e.g. several HomeKit switches turned off at once) share one command. */
    stopCook(): Promise<void>;
    /**
     * Start a cook with the given stages. Stages without an ID get a fresh UUID; the caller's
     * objects are not modified. Returns the cook ID.
     */
    startCook(stages: StagesEntity[]): Promise<any>;
    /**
     * Returns true if the currently active cook has the same stages (compares settings, not stage or cook IDs)
     */
    isCooking(stages: StagesEntity[]): boolean;
}
export declare type AnovaOvenServiceEvents = {
    connected: () => void;
    disconnected: () => void;
    ovenFound: (oven: AnovaOven) => void;
    commandResponse: (response: OvenCommandResponse) => void;
};
export declare type Recipe = {
    name: string;
    stages: StagesEntity[];
};
export declare type AnovaOvenServiceOptions = {
    /** Anova personal access token (starts with "anova-"). Preferred over email/password when set. */
    token?: string;
    email?: string;
    password?: string;
    /** Overrides for local development/testing against a mock server. */
    websocketUrl?: string;
    authUrl?: string;
};
declare const AnovaOvenService_base: new () => TypedEventEmitter<AnovaOvenServiceEvents>;
/**
 * Maintains a single WebSocket connection to the Anova cloud, reconnecting with backoff when it drops.
 */
export default class AnovaOvenService extends AnovaOvenService_base {
    private readonly options;
    readonly log: Logger;
    readonly ovens: Map<DeviceID, AnovaOven>;
    private socket?;
    private connected;
    private running;
    private connecting;
    private credentialsRejected;
    private reconnectAttempts;
    private reconnectTimer?;
    private pingTimer?;
    private staleTimer?;
    private stableTimer?;
    private readonly ovenNames;
    constructor(options: AnovaOvenServiceOptions, log: Logger);
    get isConnected(): boolean;
    /** Connect and stay connected until stop() is called. */
    start(): void;
    stop(): void;
    /** Builds the URL (including credentials) and subprotocols used to open the socket. */
    protected getConnectionParameters(): Promise<{
        url: string;
        protocols?: string[];
    }>;
    private getFirebaseToken;
    private connect;
    private scheduleReconnect;
    /** Skip any pending backoff and reconnect right away (used when the user is actively waiting on a command). */
    private reconnectNow;
    private resetStaleTimer;
    private clearConnectionTimers;
    private clearReconnectTimer;
    private dispatch;
    private waitUntilConnected;
    /**
     * Send a command, waiting for a connection if needed. Retries on timeouts and dropped connections,
     * but not when Anova explicitly rejects the command.
     */
    sendOvenCommand<T extends OvenCommand>(command: T['command'], payload: T['payload']): Promise<void>;
    private sendOnce;
}
export {};
//# sourceMappingURL=AnovaOvenService.d.ts.map