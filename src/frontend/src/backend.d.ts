import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface RoomState {
    p1Y: number;
    p2Y: number;
    p1Hits: bigint;
    lastUpdated: bigint;
    winner: string;
    balls: Array<BallData>;
    gameOver: boolean;
    p2Hits: bigint;
    p2Joined: boolean;
    p2ThrowBall: boolean;
}
export interface BallData {
    x: number;
    y: number;
    vy: number;
    speed: number;
}
export interface backendInterface {
    createRoom(): Promise<string>;
    getState(code: string): Promise<RoomState | null>;
    joinRoom(code: string): Promise<boolean>;
    pushGuestInput(code: string, p2Y: number, throwBall: boolean): Promise<void>;
    pushHostState(code: string, p1Y: number, p2Y: number, balls: Array<BallData>, p1Hits: bigint, p2Hits: bigint, gameOver: boolean, winner: string): Promise<void>;
}
