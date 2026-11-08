import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROPERTY_SPECS,
  ensureSecretKey,
  parseProperties,
  renderProperties,
} from "./properties.js";

const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(CONFIG_DIR, "../../../..");
const PROPERTIES_PATH = path.join(ROOT, "feishu-orgwatch.properties");

const existing = existsSync(PROPERTIES_PATH)
  ? parseProperties(readFileSync(PROPERTIES_PATH, "utf8"))
  : {};
for (const spec of PROPERTY_SPECS) {
  if (existing[spec.key] === undefined) existing[spec.key] = spec.value;
}
writeFileSync(PROPERTIES_PATH, renderProperties(existing), { mode: 0o600 });
chmodSync(PROPERTIES_PATH, 0o600);

const workspaceRaw = process.env.ORGWATCH_WORKSPACE || existing["app.workspace"] || ".";
const workspace = path.resolve(ROOT, workspaceRaw);
const dataDir = path.join(workspace, "data");
const runtimeDir = path.join(workspace, ".runtime");
const logDir = path.join(runtimeDir, "logs");
mkdirSync(dataDir, { recursive: true });
mkdirSync(logDir, { recursive: true });

ensureSecretKey(workspace, process.env.ORGWATCH_SECURITY_SECRET_KEY || existing["security.secret-key"] || "");

const portText = process.env.ORGWATCH_APP_PORT || existing["app.port"] || "18080";
const parsedPort = Number(portText);
const port = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 ? parsedPort : 18080;

process.stdout.write(
  JSON.stringify({
    port,
    host: process.env.ORGWATCH_APP_HOST || existing["app.host"] || "0.0.0.0",
    workspace,
    dataDir,
    logDir,
    propertiesPath: PROPERTIES_PATH,
    pidFile: path.join(runtimeDir, "pids"),
    siteName: existing["app.site-name"] || "feishu-orgwatch",
  }),
);
