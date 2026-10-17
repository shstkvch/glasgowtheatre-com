/**
 * Node-side entry point for the shared public API model. The implementation
 * lives under functions/_lib so the Pages Function can bundle it without
 * reaching outside its own directory.
 */
module.exports = require("../functions/_lib/api-core.js");
