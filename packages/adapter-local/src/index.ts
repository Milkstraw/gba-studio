/**
 * @gba-studio/adapter-local — local implementation of the exec/file contract
 * (P0-L1, SYSTEM_PLAN §1.9). Runs the P0-A1 toolchain image via Docker on
 * the dev machine instead of a Fly Machine.
 */
export { LocalAdapter, type LocalAdapterOptions } from './adapter.js';
