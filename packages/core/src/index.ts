export const VERSION = "0.0.1";

export type { Cell, ContributionGrid } from "./model";
export { toGrid } from "./model";

export type { Ball, Paddle, BrickRect, Bounds, CollisionSide } from "./physics";
export { clamp, moveBall, reflectOffWalls, reflectOffPaddle, detectBrickCollision, reflectOffBrick } from "./physics";

export type { GameState, GameConfig, Brick, BrickLayout } from "./game";
export { Game, DEFAULT_CONFIG, MAX_FRAME_DT, computeLayout } from "./game";

export type { Theme } from "./renderer";
export { render, LIGHT_THEME, DARK_THEME } from "./renderer";
