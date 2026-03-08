import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { log } from "./logger";

const CONFIG_FILE_OLD = path.join(
	os.homedir(),
	".oca",
	"oca-proxy-config.json",
);
export const CONFIG_FILE = path.join(
	os.homedir(),
	".config",
	"oca",
	"oca-proxy.config.json",
);

interface RawConfig {
	log_level?: string;
	model_mapping?: Record<string, string | ModelMapping>;
	default_model?: string;
	default_reasoning_effort?: string;
	base_url?: string;
	idcs_url?: string;
	port?: number;
	host?: string;
}

function readUserConfig(): RawConfig {
	try {
		if (fs.existsSync(CONFIG_FILE)) {
			return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8")) as RawConfig;
		}
		if (fs.existsSync(CONFIG_FILE_OLD)) {
			return JSON.parse(fs.readFileSync(CONFIG_FILE_OLD, "utf-8")) as RawConfig;
		}
	} catch {}
	return {};
}

const userConfig: RawConfig = readUserConfig();

export const OCA_CONFIG = {
	client_id: "a8331954c0cf48ba99b5dd223a14c6ea",
	idcs_url:
		userConfig.idcs_url ||
		"https://idcs-9dc693e80d9b469480d7afe00e743931.identity.oraclecloud.com",
	scopes: "openid offline_access",
	base_url:
		userConfig.base_url ||
		"https://code-internal.aiservice.us-chicago-1.oci.oraclecloud.com/20250206/app/litellm",
};

export const WHITELISTED_PORTS = [8669, 8668, 8667];

export const TOKEN_FILE = path.join(os.homedir(), ".oca", "refresh_token.json");

export const PROXY_PORT = parseInt(
	process.env.PORT || String(userConfig.port || 8669),
	10,
);

export const PROXY_HOST = process.env.HOST || userConfig.host || "127.0.0.1";

export interface TokenData {
	refresh_token: string;
	created_at: string;
}

export interface ModelMapping {
	target: string;
	reasoning_effort?: string; // e.g., "low", "medium", "high"
}

export interface ProxyConfig {
	log_level?: string;
	model_mapping?: Record<string, string | ModelMapping>;
	default_model?: string;
	default_reasoning_effort?: string;
	base_url?: string;
	idcs_url?: string;
	port?: number;
	host?: string;
}

export function loadProxyConfig(): ProxyConfig {
	try {
		const cfg = readUserConfig();
		return {
			log_level: cfg.log_level || "INFO",
			model_mapping: cfg.model_mapping || {},
			default_model: cfg.default_model,
			default_reasoning_effort: cfg.default_reasoning_effort,
			base_url: cfg.base_url,
			idcs_url: cfg.idcs_url,
			port: cfg.port,
			host: cfg.host,
		};
	} catch {
		return { log_level: "INFO", model_mapping: {} };
	}
}

export function saveProxyConfig(config: ProxyConfig): boolean {
	try {
		const dir = path.dirname(CONFIG_FILE);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
		fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
		return true;
	} catch (e) {
		log.error(`Failed to save config: ${String(e)}`);
		return false;
	}
}

export function loadRefreshToken(): string | null {
	try {
		if (fs.existsSync(TOKEN_FILE)) {
			const data: TokenData = JSON.parse(fs.readFileSync(TOKEN_FILE, "utf-8"));
			return data.refresh_token;
		}
	} catch {}
	return null;
}

export function saveRefreshToken(token: string): void {
	const dir = path.dirname(TOKEN_FILE);
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	const data: TokenData = {
		refresh_token: token,
		created_at: new Date().toISOString(),
	};
	fs.writeFileSync(TOKEN_FILE, JSON.stringify(data, null, 2), { mode: 0o600 });
	log.info(`Refresh token saved to ${TOKEN_FILE}`);
}

export function clearRefreshToken(): void {
	try {
		if (fs.existsSync(TOKEN_FILE)) {
			fs.unlinkSync(TOKEN_FILE);
		}
	} catch {}
}
