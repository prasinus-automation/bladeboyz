/**
 * APP_VERSION — manually-kept version string mirrored from `package.json`.
 *
 * The main menu and any other surface that wants to surface a version label
 * (debug logs, crash reports, network handshake payloads, etc.) should read
 * from here rather than importing `package.json`. Importing JSON from the
 * client bundle pulls the whole file into the build, including dev-only
 * fields like `devDependencies`; this tiny module is the canonical seam.
 *
 * **Keep this constant in lockstep with `package.json#version`.** Issue #87
 * (or a follow-up) may wire a Vite `define` to inject the value at build
 * time, but until then it's a manual one-line update.
 */
export const APP_VERSION = '0.1.0';
