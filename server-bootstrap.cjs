const Module = require("node:module");
const path = require("node:path");

const runtimeModules = path.join(__dirname, "runtime_modules");
process.env.NODE_PATH = [runtimeModules, process.env.NODE_PATH].filter(Boolean).join(path.delimiter);
Module._initPaths();

require(path.join(__dirname, "server.js"));
