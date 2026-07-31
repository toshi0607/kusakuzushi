export const VERSION = "0.0.1";

export type { Cell, ContributionGrid } from "./model";
export { toGrid } from "./model";

export type { Ball, Paddle, BrickRect, Bounds, CollisionSide } from "./physics";
export { clamp, moveBall, reflectOffWalls, reflectOffPaddle, detectBrickCollision, reflectOffBrick } from "./physics";

export type { Item, ItemKind } from "./items";
export { itemRect, moveItem, isItemCaught, isItemOffScreen } from "./items";

export type { GameState, GameConfig, Brick, BrickLayout } from "./game";
export { Game, DEFAULT_CONFIG, MAX_FRAME_DT, computeLayout } from "./game";

export { clearMessageFor, CLEAR_MESSAGES } from "./clear-message";

export type { Theme, RenderOptions } from "./renderer";
export { render, LIGHT_THEME, DARK_THEME, MARQUEE_COLOR } from "./renderer";
