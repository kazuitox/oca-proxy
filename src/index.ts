import axios from "axios";
import express, { type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import packageJson from "../package.json";
import {
	createAuthUrl,
	createOcaHeaders,
	exchangeCodeForTokens,
	getPkceState,
	removePkceState,
	TokenManager,
} from "./auth";
import {
	loadProxyConfig,
	OCA_CONFIG,
	PROXY_HOST,
	PROXY_PORT,
	type ProxyConfig,
	saveProxyConfig,
	TOKEN_FILE,
} from "./config";
import { registerDashboard } from "./dashboard";
import { drawBox, keyValue, type LogEvent, log, logBus } from "./logger";

const ARGV = process.argv.slice(2);

if (ARGV.includes("--version") || ARGV.includes("-v")) {
	console.log(`oca-proxy ${packageJson.version}`);
	process.exit(0);
}

if (ARGV.includes("--help") || ARGV.includes("-h")) {
	console.log(
		[
			"oca-proxy - OpenAI-compatible proxy for Oracle Code Assist",
			"",
			"Usage:",
			"  oca-proxy [--help] [--version]",
			"",
			"Options:",
			"  -h, --help     Show help",
			"  -v, --version  Show version",
		].join("\n"),
	);
	process.exit(0);
}

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.text({ type: "text/plain", limit: "50mb" }));

// Request logging middleware
app.use((req, res, next) => {
	const start = Date.now();
	log.request(req.method, req.originalUrl);

	res.on("finish", () => {
		const duration = Date.now() - start;
		log.response(res.statusCode, req.originalUrl, duration);
	});

	next();
});

// Initialize token manager
const tokenMgr = new TokenManager();

// Load proxy config
const proxyConfig = loadProxyConfig();

registerDashboard(app, tokenMgr);

app.get("/api/logs/stream", (_req: Request, res: Response) => {
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.flushHeaders?.();
	const handler = (ev: LogEvent) => {
		res.write(`data: ${JSON.stringify(ev)}\n\n`);
	};
	logBus.on("log", handler);
	res.on("close", () => {
		logBus.off("log", handler);
		res.end();
	});
});

// Default model for all requests
const DEFAULT_OCA_MODEL = "oca/gpt-4.1";
const OAUTH_CALLBACK_HOST = "127.0.0.1";

function getOAuthBaseUrl(): string {
	return `http://${OAUTH_CALLBACK_HOST}:${PROXY_PORT}`;
}

/**
 * Resolve model mapping - handles both string and object mappings
 */
function resolveModelMapping(requestModel: string): {
	model: string;
	reasoning_effort?: string;
} {
	if (requestModel?.startsWith("oca/")) {
		return { model: requestModel };
	}

	const mapping = proxyConfig.model_mapping?.[requestModel];
	if (mapping) {
		if (typeof mapping === "string") {
			return { model: mapping };
		}
		return {
			model: mapping.target,
			reasoning_effort: mapping.reasoning_effort,
		};
	}

	// Use default model from config or fallback
	const defaultModel = proxyConfig.default_model || DEFAULT_OCA_MODEL;
	const defaultEffort = proxyConfig.default_reasoning_effort;
	return { model: defaultModel, reasoning_effort: defaultEffort };
}

/**
 * Login endpoint - Initiate OAuth flow
 */
app.get("/login", (req: Request, res: Response) => {
	const requestedHost = req.get("host") || "unknown";
	const baseUrl = getOAuthBaseUrl();
	const redirectUri = `${baseUrl}/callback`;
	const authUrl = createAuthUrl(redirectUri);

	log.auth(
		`Redirecting to OAuth login using callback host ${baseUrl} (requested via ${requestedHost})...`,
	);
	res.redirect(authUrl);
});

/**
 * OAuth callback endpoint
 */
app.get("/callback", async (req: Request, res: Response) => {
	const { code, state, error } = req.query;

	if (error) {
		log.error(`OAuth error: ${error}`);
		res.status(400).send(`
			<html><body>
				<h1>Authentication Failed</h1>
				<p>Error: ${error}</p>
				<a href="/">Go Home</a>
			</body></html>
		`);
		return;
	}

	if (!code || !state) {
		res.status(400).send(`
			<html><body>
				<h1>Invalid Callback</h1>
				<p>Missing code or state parameter</p>
				<a href="/">Go Home</a>
			</body></html>
		`);
		return;
	}

	// Retrieve PKCE state
	const pkceData = getPkceState(state as string);
	if (!pkceData) {
		log.error(`Invalid or expired state: ${(state as string).slice(0, 8)}...`);
		res.status(400).send(`
			<html><body>
				<h1>Authentication Failed</h1>
				<p>Invalid or expired state (session may have timed out)</p>
				<a href="/login">Try Again</a>
			</body></html>
		`);
		return;
	}

	removePkceState(state as string);

	try {
		const tokens = await exchangeCodeForTokens(
			code as string,
			pkceData.code_verifier,
			pkceData.redirect_uri,
		);

		// Verify nonce in ID token (if available)
		// Note: We're not strictly validating the ID token here

		if (!tokens.refresh_token) {
			res.status(500).send(`
				<html><body>
					<h1>Authentication Failed</h1>
					<p>No refresh token received</p>
					<a href="/login">Try Again</a>
				</body></html>
			`);
			return;
		}

		// Save refresh token
		tokenMgr.setRefreshToken(tokens.refresh_token);

		log.success("Successfully authenticated with OCA!");

		res.send(`
			<html>
				<head>
					<title>Login Successful</title>
					<style>
						body { font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center; }
						h1 { color: green; }
						a { color: #007bff; text-decoration: none; padding: 10px 20px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px; display: inline-block; margin: 10px; }
						a:hover { background: #e9ecef; }
					</style>
				</head>
				<body>
					<h1>Login Successful!</h1>
					<p>You are now authenticated with Oracle Code Assist.</p>
					<p>Your refresh token has been saved and the proxy is ready to use.</p>
					<a href="/">Go Home</a>
					<a href="/health">Check Status</a>
				</body>
			</html>
		`);
	} catch (err: unknown) {
		const e = err as { response?: { data?: unknown }; message?: string };
		log.error(
			`Token exchange failed: ${JSON.stringify(e.response?.data) || e.message}`,
			e,
		);
		res.status(500).send(`
			<html><body>
				<h1>Authentication Failed</h1>
				<p>Token exchange failed: ${e.message}</p>
				<pre>${JSON.stringify(e.response?.data, null, 2)}</pre>
				<a href="/login">Try Again</a>
			</body></html>
		`);
	}
});

/**
 * Logout endpoint
 */
app.get("/logout", (_req: Request, res: Response) => {
	tokenMgr.clearAuth();
	log.auth("Logged out");

	res.send(`
		<html>
			<head>
				<title>Logged Out</title>
				<style>
					body { font-family: Arial, sans-serif; max-width: 600px; margin: 100px auto; text-align: center; }
					a { color: #007bff; text-decoration: none; padding: 10px 20px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px; display: inline-block; margin: 10px; }
					a:hover { background: #e9ecef; }
				</style>
			</head>
			<body>
				<h1>Logged Out</h1>
				<p>Your authentication has been cleared.</p>
				<a href="/">Go Home</a>
				<a href="/login">Login Again</a>
			</body>
		</html>
	`);
});

/**
 * Health check endpoint
 */
app.get("/health", (_req: Request, res: Response) => {
	const authenticated = tokenMgr.isAuthenticated();
	const tokenExpiry = tokenMgr.getTokenExpiry();

	res.json({
		status: authenticated ? "healthy" : "unauthenticated",
		service: "oca-proxy",
		authenticated,
		token_expiry: tokenExpiry?.toISOString(),
		token_storage: TOKEN_FILE,
	});
});

/**
 * Full models info - GET /api/models/full (for dashboard)
 */
app.get("/api/models/full", async (_req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);

		const response = await axios.get(`${OCA_CONFIG.base_url}/v1/model/info`, {
			headers,
		});

		// Return raw OCA response with full details
		res.json({ data: response.data.data || response.data || [] });
	} catch (error: unknown) {
		const e = error as { message?: string; response?: { status?: number } };
		log.error(`Error listing full models: ${e.message}`, e);
		if (
			e.message &&
			(e.message.includes("Not authenticated") ||
				e.message.includes("Refresh token expired"))
		) {
			res.status(401).json({
				error: {
					message: `🔐 Authentication Required\n\nPlease visit http://localhost:${PROXY_PORT}/login to authenticate.`,
				},
			});
		} else {
			res
				.status(e.response?.status || 500)
				.json({ error: { message: e.message || "Unknown error" } });
		}
	}
});

/**
 * Get proxy config - GET /api/config
 */
app.get("/api/config", (_req: Request, res: Response) => {
	const config = loadProxyConfig();
	res.json({
		default_model: config.default_model || DEFAULT_OCA_MODEL,
		default_reasoning_effort: config.default_reasoning_effort,
		model_mapping: config.model_mapping || {},
		host: config.host || PROXY_HOST,
	});
});

/**
 * Save proxy config - POST /api/config
 */
app.post("/api/config", (req: Request, res: Response) => {
	try {
		const currentConfig = loadProxyConfig();
		const { default_model, default_reasoning_effort, model_mapping, host } = req.body;

		const newConfig: ProxyConfig = {
			...currentConfig,
			default_model: default_model || currentConfig.default_model,
			default_reasoning_effort:
				default_reasoning_effort || currentConfig.default_reasoning_effort,
			model_mapping: model_mapping || currentConfig.model_mapping,
			host: host || currentConfig.host,
		};

		if (saveProxyConfig(newConfig)) {
			// Reload config in memory
			Object.assign(proxyConfig, newConfig);
			log.info("Config saved successfully");
			res.json({ success: true, config: newConfig });
		} else {
			res.status(500).json({ error: "Failed to save config" });
		}
	} catch (error: unknown) {
		const e = error as { message?: string; response?: { status?: number } };
		log.error(`Error listing models: ${e.message}`, e);
		if (e.message?.includes("Not authenticated")) {
			res.status(401).json({ error: { message: e.message } });
		} else {
			res
				.status(e.response?.status || 500)
				.json({ error: { message: e.message || "Unknown error" } });
		}
	}
});

/**
 * List models - GET /v1/models
 */
app.get("/v1/models", async (_req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);

		const response = await axios.get(`${OCA_CONFIG.base_url}/v1/model/info`, {
			headers,
		});

		// Transform to OpenAI format
		const models = (response.data.data || []).map(
			(model: {
				litellm_params?: { model?: string };
				model_name?: string;
			}) => ({
				id: model.litellm_params?.model || model.model_name || "",
				object: "model",
				created: Math.floor(Date.now() / 1000),
				owned_by: "oca",
			}),
		);

		res.json({ object: "list", data: models });
	} catch (error: unknown) {
		const e = error as { message?: string; response?: { status?: number } };
		log.error(`Error listing models: ${e.message}`, e);
		if (e.message?.includes("Not authenticated")) {
			res.status(401).json({ error: { message: e.message } });
		} else {
			res
				.status(e.response?.status || 500)
				.json({ error: { message: e.message || "Unknown error" } });
		}
	}
});

/**
 * Chat completions - POST /v1/chat/completions
 */
app.post("/v1/chat/completions", async (req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);
		const isStreaming = req.body.stream === true;

		// Map model if needed
		const requestBody = { ...req.body };
		const resolved = resolveModelMapping(requestBody.model);
		const originalModel = requestBody.model;
		requestBody.model = resolved.model;
		if (resolved.reasoning_effort && !requestBody.reasoning_effort) {
			requestBody.reasoning_effort = resolved.reasoning_effort;
		}
		if (originalModel !== resolved.model) {
			log.openai(
				`Model mapped: ${originalModel} -> ${resolved.model}${resolved.reasoning_effort ? ` (reasoning: ${resolved.reasoning_effort})` : ""}`,
			);
		}

		log.openai(
			`Chat completion request: model=${requestBody.model}, stream=${isStreaming}${requestBody.reasoning_effort ? `, reasoning=${requestBody.reasoning_effort}` : ""}`,
		);

		const response = await axios.post(
			`${OCA_CONFIG.base_url}/chat/completions`,
			requestBody,
			{
				headers,
				responseType: isStreaming ? "stream" : "json",
			},
		);

		if (isStreaming) {
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");

			response.data.pipe(res);

			response.data.on("error", (err: Error) => {
				log.error(`Stream error: ${err.message}`, err);
				res.end();
			});
		} else {
			res.json(response.data);
		}
	} catch (error: unknown) {
		const e = error as {
			message?: string;
			code?: string;
			response?: { status?: number; data?: unknown };
		};
		log.error(`Error in chat completions: ${e.message}`, e);
		if (
			e.message &&
			(e.message.includes("Not authenticated") ||
				e.message.includes("Refresh token expired"))
		) {
			res.status(401).json({
				error: {
					message: `🔐 OCA Proxy Authentication Required\n\nPlease visit http://localhost:${PROXY_PORT}/login in your browser to authenticate with Oracle Code Assist.\n\nAfter logging in, retry your request.`,
				},
			});
		} else {
			res.status(e.response?.status || 500).json({
				error: {
					message: e.message || "Unknown error",
					code: e.code,
					status: e.response?.status,
					data:
						e.response?.data && typeof e.response.data !== "object"
							? e.response.data
							: undefined,
				},
			});
		}
	}
});

/**
 * Responses API - POST /v1/responses
 */
app.post("/v1/responses", async (req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);
		const isStreaming = req.body.stream !== false;

		// Map model if needed
		const requestBody = { ...req.body };
		const resolved = resolveModelMapping(requestBody.model);
		const originalModel = requestBody.model;
		requestBody.model = resolved.model;
		if (resolved.reasoning_effort && !requestBody.reasoning_effort) {
			requestBody.reasoning_effort = resolved.reasoning_effort;
		}
		if (originalModel !== resolved.model) {
			log.openai(
				`Model mapped: ${originalModel} -> ${resolved.model}${resolved.reasoning_effort ? ` (reasoning: ${resolved.reasoning_effort})` : ""}`,
			);
		}

		// Convert to chat completions format if needed
		if (!requestBody.messages && requestBody.input) {
			let text: string;
			if (typeof requestBody.input === "string") {
				text = requestBody.input;
			} else if (Array.isArray(requestBody.input)) {
				text = requestBody.input
					.filter((p: { type?: string }) => p.type === "text")
					.map((p: { text?: string }) => p.text || "")
					.join("\n");
			} else {
				text = String(requestBody.input);
			}
			requestBody.messages = [{ role: "user", content: text }];
			delete requestBody.input;
		}

		if (requestBody.max_output_tokens) {
			requestBody.max_tokens = requestBody.max_output_tokens;
			delete requestBody.max_output_tokens;
		}

		requestBody.stream = isStreaming;

		log.openai(
			`Responses API request: model=${requestBody.model}, stream=${isStreaming}`,
		);

		const response = await axios.post(
			`${OCA_CONFIG.base_url}/chat/completions`,
			requestBody,
			{
				headers,
				responseType: isStreaming ? "stream" : "json",
			},
		);

		if (isStreaming) {
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");

			response.data.pipe(res);

			response.data.on("error", (err: Error) => {
				log.error(`Stream error: ${err.message}`, err);
				res.end();
			});
		} else {
			res.json(response.data);
		}
	} catch (error: unknown) {
		const e = error as {
			message?: string;
			code?: string;
			response?: { status?: number; data?: unknown };
		};
		log.error(`Error in responses: ${e.message}`, e);
		if (
			e.message &&
			(e.message.includes("Not authenticated") ||
				e.message.includes("Refresh token expired"))
		) {
			res.status(401).json({
				error: {
					message: `🔐 OCA Proxy Authentication Required\n\nPlease visit http://localhost:${PROXY_PORT}/login in your browser to authenticate with Oracle Code Assist.\n\nAfter logging in, retry your request.`,
				},
			});
		} else {
			res.status(e.response?.status || 500).json({
				error: {
					message: e.message || "Unknown error",
					code: e.code,
					status: e.response?.status,
					data:
						e.response?.data && typeof e.response.data !== "object"
							? e.response.data
							: undefined,
				},
			});
		}
	}
});

/**
 * Completions (legacy) - POST /v1/completions
 */
app.post("/v1/completions", async (req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);
		const isStreaming = req.body.stream === true;

		const response = await axios.post(
			`${OCA_CONFIG.base_url}/completions`,
			req.body,
			{
				headers,
				responseType: isStreaming ? "stream" : "json",
			},
		);

		if (isStreaming) {
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");
			response.data.pipe(res);
		} else {
			res.json(response.data);
		}
	} catch (error: unknown) {
		const e = error as { message?: string; response?: { status?: number } };
		log.error(`Error in completions: ${e.message}`, e);
		res
			.status(e.response?.status || 500)
			.json({ error: { message: e.message || "Unknown error" } });
	}
});

/**
 * Embeddings - POST /v1/embeddings
 */
app.post("/v1/embeddings", async (req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);

		const response = await axios.post(
			`${OCA_CONFIG.base_url}/embeddings`,
			req.body,
			{ headers },
		);
		res.json(response.data);
	} catch (error: unknown) {
		const e = error as { message?: string; response?: { status?: number } };
		log.error(`Error in embeddings: ${e.message}`, e);
		res
			.status(e.response?.status || 500)
			.json({ error: { message: e.message || "Unknown error" } });
	}
});

// =============================================================================
// ANTHROPIC API ENDPOINTS (/anthropic/v1/...)
// =============================================================================

/**
 * Convert Anthropic Messages API request to OpenAI Chat Completions format
 */
function anthropicToOpenAI(body: {
	system?: unknown;
	messages?: Array<{ role: string; content: unknown }>;
	model?: string;
	tools?: Array<{
		name?: string;
		description?: string;
		input_schema?: unknown;
	}>;
	tool_choice?: unknown;
	max_tokens?: number;
	temperature?: number;
	top_p?: number;
}): Record<string, unknown> {
	const messages: Array<Record<string, unknown>> = [];

	// Add system message if present
	if (body.system) {
		let systemContent = body.system;
		if (Array.isArray(systemContent)) {
			systemContent = systemContent
				.filter((c: { type?: string }) => c.type === "text")
				.map((c: { text?: string }) => c.text || "")
				.join(" ");
		}
		messages.push({ role: "system", content: systemContent });
	}

	// Convert messages
	for (const msg of body.messages || []) {
		const content = msg.content;
		const role = msg.role;

		if (Array.isArray(content)) {
			const textParts: string[] = [];
			const toolCalls: Array<{
				id?: string;
				type: string;
				function: { name?: string; arguments: string };
			}> = [];

			for (const block of content) {
				if (block.type === "text") {
					textParts.push(block.text || "");
				} else if (block.type === "tool_use") {
					toolCalls.push({
						id: block.id,
						type: "function",
						function: {
							name: block.name,
							arguments: JSON.stringify(block.input || {}),
						},
					});
				} else if (block.type === "tool_result") {
					messages.push({
						role: "tool",
						tool_call_id: block.tool_use_id,
						content: String(block.content || ""),
					});
				}
			}

			const msgDict: {
				role: string;
				content?: string;
				tool_calls?: Array<{
					id?: string;
					type: string;
					function: { name?: string; arguments: string };
				}>;
			} = { role };
			if (textParts.length > 0) msgDict.content = textParts.join(" ");
			if (toolCalls.length > 0) msgDict.tool_calls = toolCalls;
			if (msgDict.content || msgDict.tool_calls) messages.push(msgDict);
		} else {
			messages.push({ role, content });
		}
	}

	// Map model
	const resolved = resolveModelMapping(
		body.model || "claude-3-5-sonnet-20241022",
	);

	const openaiRequest: {
		model: string;
		messages: unknown;
		stream: true;
		reasoning_effort?: string;
		tools?: Array<{
			type: string;
			function: { name?: string; description?: string; parameters?: unknown };
		}>;
		tool_choice?: unknown;
		max_tokens?: number;
		temperature?: number;
		top_p?: number;
	} = {
		model: resolved.model,
		messages,
		stream: true,
	};

	// Add reasoning effort if resolved from mapping
	if (resolved.reasoning_effort) {
		openaiRequest.reasoning_effort = resolved.reasoning_effort;
	}

	// Convert tools
	if (body.tools) {
		openaiRequest.tools = body.tools.map(
			(tool: {
				name?: string;
				description?: string;
				input_schema?: unknown;
			}) => ({
				type: "function",
				function: {
					name: tool.name,
					description: tool.description || "",
					parameters: tool.input_schema || {},
				},
			}),
		);

		if (body.tool_choice) {
			const tc = body.tool_choice as { type?: string; name?: string } | string;
			if (typeof tc === "object" && tc.type === "tool") {
				openaiRequest.tool_choice = {
					type: "function",
					function: { name: tc.name },
				};
			} else if (tc === "auto") {
				openaiRequest.tool_choice = "auto";
			} else if (tc === "any") {
				openaiRequest.tool_choice = "required";
			}
		}
	}

	if (body.max_tokens) {
		openaiRequest.max_tokens = Math.min(body.max_tokens, 16384);
	}
	if (body.temperature !== undefined) {
		openaiRequest.temperature = body.temperature;
	}
	if (body.top_p !== undefined) {
		openaiRequest.top_p = body.top_p;
	}

	return openaiRequest;
}

/**
 * Stream OpenAI response as Anthropic SSE format
 */
async function* streamAnthropicResponse(
	openaiStream: NodeJS.ReadableStream,
	messageId: string,
	modelName: string,
): AsyncGenerator<string> {
	// Send message_start
	yield `event: message_start\ndata: ${JSON.stringify({
		type: "message_start",
		message: {
			id: messageId,
			type: "message",
			role: "assistant",
			content: [],
			model: modelName,
			stop_reason: null,
			usage: { input_tokens: 0, output_tokens: 0 },
		},
	})}\n\n`;

	let contentBlockIndex = 0;
	let textBlockStarted = false;
	let currentToolCall: { id?: string; name?: string; input?: string } | null =
		null;
	let buffer = "";

	for await (const chunk of openaiStream) {
		buffer += chunk.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() || "";

		for (const line of lines) {
			if (!line || line.startsWith(":")) {
				continue;
			}
			if (!line.startsWith("data: ")) {
				continue;
			}

			const dataStr = line.slice(6);
			if (dataStr === "[DONE]") {
				// Send message_stop
				yield `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
				return;
			}

			try {
				const data = JSON.parse(dataStr);
				const choice = data.choices?.[0];
				const delta = choice?.delta;

				// Handle tool calls
				if (delta?.tool_calls) {
					for (const toolCallDelta of delta.tool_calls) {
						const toolCallId = toolCallDelta.id;
						const functionData = toolCallDelta.function || {};

						if (toolCallId) {
							// Stop text block if started
							if (textBlockStarted) {
								yield `event: content_block_stop\ndata: ${JSON.stringify({
									type: "content_block_stop",
									index: contentBlockIndex,
								})}\n\n`;
								contentBlockIndex++;
								textBlockStarted = false;
							}

							// Start new tool_use block
							currentToolCall = {
								id: toolCallId,
								name: functionData.name || "",
								input: "",
							};
							yield `event: content_block_start\ndata: ${JSON.stringify({
								type: "content_block_start",
								index: contentBlockIndex,
								content_block: {
									type: "tool_use",
									id: toolCallId,
									name: functionData.name || "",
								},
							})}\n\n`;
						}

						if (functionData.arguments && currentToolCall) {
							currentToolCall.input += functionData.arguments;
							yield `event: content_block_delta\ndata: ${JSON.stringify({
								type: "content_block_delta",
								index: contentBlockIndex,
								delta: {
									type: "input_json_delta",
									partial_json: functionData.arguments,
								},
							})}\n\n`;
						}
					}
				}
				// Handle text content
				else if (delta?.content) {
					if (!textBlockStarted) {
						yield `event: content_block_start\ndata: ${JSON.stringify({
							type: "content_block_start",
							index: contentBlockIndex,
							content_block: { type: "text", text: "" },
						})}\n\n`;
						textBlockStarted = true;
					}

					yield `event: content_block_delta\ndata: ${JSON.stringify({
						type: "content_block_delta",
						index: contentBlockIndex,
						delta: { type: "text_delta", text: delta.content },
					})}\n\n`;
				}

				// Handle finish
				if (choice?.finish_reason) {
					// Stop current content block
					yield `event: content_block_stop\ndata: ${JSON.stringify({
						type: "content_block_stop",
						index: contentBlockIndex,
					})}\n\n`;

					// Map finish reason
					let stopReason = choice.finish_reason;
					if (stopReason === "tool_calls") {
						stopReason = "tool_use";
					} else if (stopReason === "stop") {
						stopReason = "end_turn";
					}

					const usage = data.usage || {};
					yield `event: message_delta\ndata: ${JSON.stringify({
						type: "message_delta",
						delta: { stop_reason: stopReason, stop_sequence: null },
						usage: { output_tokens: usage.completion_tokens || 0 },
					})}\n\n`;

					yield `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`;
				}
			} catch (_e) {
				// Skip unparseable chunks
			}
		}
	}
}

/**
 * Anthropic Messages API - POST /v1/messages
 */
app.post("/v1/messages", async (req: Request, res: Response) => {
	try {
		const token = await tokenMgr.getToken();
		const headers = createOcaHeaders(token);
		const streamRequested = req.body.stream === true;

		log.anthropic(
			`Message request: model=${req.body.model}, stream=${streamRequested}`,
		);

		// Convert Anthropic to OpenAI format
		const openaiReq = anthropicToOpenAI(req.body);
		log.anthropic(`Mapped model: ${req.body.model} -> ${openaiReq.model}`);

		const messageId = `msg_${uuidv4()}`;

		if (streamRequested) {
			// Streaming response
			res.setHeader("Content-Type", "text/event-stream");
			res.setHeader("Cache-Control", "no-cache");
			res.setHeader("Connection", "keep-alive");

			const response = await axios.post(
				`${OCA_CONFIG.base_url}/chat/completions`,
				openaiReq,
				{
					headers,
					responseType: "stream",
				},
			);

			for await (const chunk of streamAnthropicResponse(
				response.data,
				messageId,
				String(openaiReq.model),
			)) {
				res.write(chunk);
			}
			res.end();
		} else {
			// Non-streaming - collect full response
			openaiReq.stream = true; // OCA always streams

			const response = await axios.post(
				`${OCA_CONFIG.base_url}/chat/completions`,
				openaiReq,
				{
					headers,
					responseType: "stream",
				},
			);

			let fullContent = "";
			let finishReason = "end_turn";
			let promptTokens = 0;
			let completionTokens = 0;
			let buffer = "";

			for await (const chunk of response.data) {
				buffer += chunk.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() || "";

				for (const line of lines) {
					if (!line.startsWith("data: ")) {
						continue;
					}
					const dataStr = line.slice(6);
					if (dataStr === "[DONE]") {
						break;
					}

					try {
						const data = JSON.parse(dataStr);
						const delta = data.choices?.[0]?.delta;
						if (delta?.content) {
							fullContent += delta.content;
						}
						if (data.choices?.[0]?.finish_reason) {
							finishReason =
								data.choices[0].finish_reason === "stop"
									? "end_turn"
									: data.choices[0].finish_reason;
						}
						if (data.usage) {
							promptTokens = data.usage.prompt_tokens || 0;
							completionTokens = data.usage.completion_tokens || 0;
						}
					} catch {}
				}
			}

			res.json({
				id: messageId,
				type: "message",
				role: "assistant",
				content: [{ type: "text", text: fullContent }],
				model: openaiReq.model,
				stop_reason: finishReason,
				usage: { input_tokens: promptTokens, output_tokens: completionTokens },
			});
		}
	} catch (error: unknown) {
		const e = error as { message?: string; response?: { status?: number } };
		log.error(`Error listing full models: ${e.message}`, e);
		if (
			e.message &&
			(e.message.includes("Not authenticated") ||
				e.message.includes("Refresh token expired"))
		) {
			res.status(401).json({
				error: {
					message: `🔐 Authentication Required\n\nPlease visit http://localhost:${PROXY_PORT}/login to authenticate.`,
				},
			});
		} else {
			res
				.status(e.response?.status || 500)
				.json({ error: { message: e.message || "Unknown error" } });
		}
	}
});

app.post("/api/event_logging/batch", (_req: Request, res: Response) => {
	res.status(204).end();
});

// 404 logging catch-all
app.use((req: Request, res: Response) => {
	log.warn(`404 Not Found: ${req.method} ${req.originalUrl}`);
	res.status(404).json({ error: "Not Found" });
});

// Start server
const displayHost = PROXY_HOST === "0.0.0.0" ? "localhost" : PROXY_HOST;
const serverBaseUrl = `http://${displayHost}:${PROXY_PORT}`;
const oauthBaseUrl = getOAuthBaseUrl();

const _server = app.listen(PROXY_PORT, PROXY_HOST, async () => {
	const authStatus = tokenMgr.isAuthenticated()
		? "✓ Authenticated"
		: "✗ Not authenticated";
	const lines = [
		"  OCA Proxy Server",
		"  ",
		keyValue("OCA Base URL:", OCA_CONFIG.base_url),
		keyValue("IDCS URL:", OCA_CONFIG.idcs_url),
		keyValue("Client ID:", OCA_CONFIG.client_id),
		keyValue("Auth Status:", authStatus),
		keyValue("Bind Host:", PROXY_HOST),
		keyValue("OAuth Callback:", `${oauthBaseUrl}/callback`),
		"  ",
		`  ▶ Server listening on ${serverBaseUrl}`,
		"  ",
		"  Endpoints:",
		`    OpenAI:   ${serverBaseUrl}/v1`,
		`    Messages: ${serverBaseUrl}/v1/messages`,
	];
	const banner = drawBox(lines, 58);
	for (const l of banner) {
		log.raw(l);
	}

	if (!tokenMgr.isAuthenticated()) {
		log.info(`Login: ${serverBaseUrl}/login`);

		// Auto-open browser
		try {
			const open = (await import("open")).default;
			setTimeout(() => {
				const url = `${serverBaseUrl}/login`;
				Promise.resolve(open(url))
					.then(() => {
						log.info("Browser opened for authentication");
					})
					.catch((err: unknown) => {
						const msg =
							(err as { message?: string }).message ?? "unknown error";
						log.warn(`Failed to auto-open browser: ${msg}`);
						log.info(`Please open this URL manually: ${url}`);
					});
			}, 1500);
		} catch {
			// open module not available
		}
	} else {
		log.success("Authenticated - Server ready to use!");
		log.info(`Dashboard: ${serverBaseUrl}`);
	}
});

_server.on("error", (e: unknown) => {
	const err = e as { code?: string };
	if (err.code === "EADDRINUSE") {
		log.error(`Port ${PROXY_PORT} already in use; exiting`);
		process.exit(1);
	}
	log.error(`Server error: ${String(e)}`);
	process.exit(1);
});
