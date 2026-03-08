import type express from "express";
import type { Request, Response } from "express";
import type { TokenManager } from "./auth";
import { OCA_CONFIG, PROXY_HOST, PROXY_PORT, TOKEN_FILE } from "./config";

const DASHBOARD_HOST = PROXY_HOST === "0.0.0.0" ? "localhost" : PROXY_HOST;
const DASHBOARD_BASE_URL = `http://${DASHBOARD_HOST}:${PROXY_PORT}`;

export function registerDashboard(
	app: express.Express,
	tokenMgr: TokenManager,
) {
	/**
	 * Root endpoint - Dashboard
	 */
	app.get("/", async (_req: Request, res: Response) => {
		const authenticated = tokenMgr.isAuthenticated();
		const statusColor = authenticated ? "green" : "orange";
		const statusText = authenticated ? "Authenticated" : "Not Authenticated";
		const actionHtml = authenticated
			? '<a href="/logout" style="color: red;">Logout</a>'
			: '<a href="/login">Login with Oracle Code Assist</a>';

		res.send(`
      <html>
        <head>
          <title>OCA Proxy</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 1200px; margin: 50px auto; padding: 20px; }
            .status { padding: 10px; border-radius: 5px; margin: 20px 0; }
            .authenticated { background-color: #d4edda; border: 1px solid #c3e6cb; }
            .not-authenticated { background-color: #fff3cd; border: 1px solid #ffeaa7; }
            h1 { color: #333; }
            h2 { color: #555; margin-top: 30px; }
            a, button { color: #007bff; text-decoration: none; padding: 10px 20px; background: #f8f9fa; border: 1px solid #ddd; border-radius: 5px; display: inline-block; margin: 10px 5px; cursor: pointer; font-size: 14px; }
            a:hover, button:hover { background: #e9ecef; }
            button:disabled { opacity: 0.6; cursor: not-allowed; }
            .endpoint { background: #f8f9fa; padding: 10px; margin: 10px 0; border-left: 3px solid #007bff; }
            code { background: #f1f1f1; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
            .models-container { margin-top: 20px; }
            .model-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 15px; margin: 10px 0; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
            .model-card h4 { margin: 0 0 10px 0; color: #333; display: flex; align-items: center; gap: 10px; }
            .model-card .model-id { font-family: monospace; background: #e7f3ff; padding: 3px 8px; border-radius: 4px; font-size: 13px; color: #0066cc; }
            .model-card .badges { display: flex; gap: 5px; flex-wrap: wrap; margin: 10px 0; }
            .model-card .badge { padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 500; }
            .badge-vision { background: #d4edda; color: #155724; }
            .badge-reasoning { background: #fff3cd; color: #856404; }
            .badge-api { background: #e7f3ff; color: #004085; }
            .model-details { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-top: 10px; font-size: 13px; }
            .model-details .detail { background: #f8f9fa; padding: 8px; border-radius: 4px; }
            .model-details .detail-label { color: #666; font-size: 11px; text-transform: uppercase; }
            .model-details .detail-value { color: #333; font-weight: 500; }
            .loading { text-align: center; padding: 40px; color: #666; }
            .error { background: #f8d7da; border: 1px solid #f5c6cb; color: #721c24; padding: 15px; border-radius: 5px; margin: 10px 0; }
            .model-count { background: #e9ecef; padding: 5px 15px; border-radius: 20px; font-size: 14px; margin-left: 10px; }
          </style>
        </head>
        <body>
          <h1>OCA Proxy Server</h1>
             <div class="tabs">
              <button class="tab-btn" onclick="showTab('status')">Status</button>
              <button class="tab-btn" onclick="showTab('endpoints')">Endpoints</button>
              <button class="tab-btn" onclick="showTab('models')">Models</button>
              <button class="tab-btn" onclick="showTab('mapping')">Mapping</button>
              <button class="tab-btn" onclick="showTab('config')">Config</button>
              <button class="tab-btn" onclick="showTab('usage')">Usage</button>
              <button class="tab-btn" onclick="showTab('logs')">Logs</button>
            </div>


          <div id="tab-status" class="tab-panel">
            <div class="status ${authenticated ? "authenticated" : "not-authenticated"}">
              <strong>Status:</strong> <span style="color: ${statusColor};">●</span> ${statusText}
            </div>
            <h2>Actions</h2>
            <div>
              ${actionHtml}
              <a href="/health">Health Check</a>
            </div>
          </div>

          <div id="tab-endpoints" class="tab-panel" style="display:none">
            <h2>API Endpoints</h2>
            <h3>OpenAI Format</h3>
            <div class="endpoint">
              <strong>POST /v1/chat/completions</strong><br>
              OpenAI Chat Completions API
            </div>
            <div class="endpoint">
              <strong>POST /v1/responses</strong><br>
              OpenAI Responses API
            </div>
            <div class="endpoint">
              <strong>GET /v1/models</strong><br>
              List available models
            </div>
            <h3>Anthropic Format</h3>
            <div class="endpoint" style="border-left-color: #d97706;">
              <strong>POST /v1/messages</strong><br>
              Anthropic Messages API (for Claude Code)
            </div>
            <h3>Other</h3>
            <div class="endpoint">
              <strong>GET /health</strong><br>
              Health check and status
            </div>
          </div>

          <div id="tab-models" class="tab-panel" style="display:none">
            <h2>Available Models <span id="modelCount" class="model-count">-</span></h2>
            <div><button id="refreshModels" onclick="loadModels()">🔄 Refresh Models</button></div>
            <div id="modelsContainer" class="models-container"><div class="loading">Click "Refresh Models" to load available models...</div></div>
          </div>

          <div id="tab-mapping" class="tab-panel" style="display:none">
            <h2>Model Mappings</h2>
            <div class="config-section" style="background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 20px; margin: 15px 0;">
              <h3 style="margin-top: 0;">Default Model</h3>
              <p style="color: #666; font-size: 13px;">When a request uses a non-OCA model name, it will be mapped to this model.</p>
              <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                <select id="defaultModel" style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 250px;">
                  <option value="">Loading models...</option>
                </select>
                <select id="defaultReasoningEffort" style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                  <option value="">No reasoning effort</option>
                </select>
                <button onclick="saveDefaultModel()" style="background: #28a745; color: white; border: none;">Save Default</button>
              </div>

              <h3 style="margin-top: 25px;">Custom Mappings</h3>
              <p style="color: #666; font-size: 13px;">Map specific model names to OCA models. Example: <code>claude-sonnet-4-5</code> → <code>oca/gpt4</code></p>

              <div id="mappingsContainer" style="margin: 15px 0;">
                <div class="loading">Loading mappings...</div>
              </div>

              <div style="border: 1px dashed #ccc; border-radius: 8px; padding: 15px; margin-top: 15px; background: #fafafa;">
                <h4 style="margin: 0 0 15px 0; color: #555;">Add New Mapping</h4>
                <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                  <input id="newSourceModel" type="text" placeholder="Source model (e.g., claude-sonnet-4-5)"
                    style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; width: 220px;" />
                  <span style="color: #666;">→</span>
                  <select id="newTargetModel" style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; min-width: 200px;">
                    <option value="">Select target model...</option>
                  </select>
                  <select id="newReasoningEffort" style="padding: 8px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px;">
                    <option value="">No reasoning</option>
                  </select>
                  <button onclick="addMapping()" style="background: #007bff; color: white; border: none;">Add Mapping</button>
                </div>
              </div>
            </div>
          </div>

          <div id="tab-config" class="tab-panel" style="display:none">
            <h2>Server Configuration</h2>
            <ul>
              <li>IDCS URL: <code>${OCA_CONFIG.idcs_url}</code></li>
              <li>Client ID: <code>${OCA_CONFIG.client_id}</code></li>
              <li>OCA Base URL: <code>${OCA_CONFIG.base_url}</code></li>
              <li>Token Storage: <code>${TOKEN_FILE}</code></li>
            </ul>
          </div>

           <div id="tab-usage" class="tab-panel" style="display:none">
            <h2>Usage</h2>

            <div class="endpoint">
              <strong>With Claude Code (Anthropic format):</strong><br>
              <code>ANTHROPIC_API_KEY=dummy ANTHROPIC_BASE_URL=${DASHBOARD_BASE_URL} claude</code>
            </div>
            <div class="endpoint">
              <strong>With OpenAI SDK:</strong><br>
              <code>OPENAI_API_KEY=dummy OPENAI_BASE_URL=${DASHBOARD_BASE_URL}/v1</code>
            </div>
          </div>

          <div id="tab-logs" class="tab-panel" style="display:none">
            <h2>Logs</h2>
            <div style="margin-bottom:10px; color:#666;">Realtime (SSE)</div>
            <div id="logsContainer" style="background:#0b0b0b; color:#e5e5e5; padding:10px; border-radius:6px; height:400px; overflow:auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px;">
              <div class="loading">Connecting...</div>
            </div>
          </div>

          <script>

            function showTab(tab) {
              document.querySelectorAll('.tab-panel').forEach(function(panel) {
                panel.style.display = 'none';
              });
              document.querySelectorAll('.tab-btn').forEach(function(btn) {
                btn.classList.remove('active');
              });
              document.getElementById('tab-' + tab).style.display = '';
              document.querySelector('.tab-btn[onclick*="' + tab + '"]').classList.add('active');
              if (tab === 'logs') startSSE();
              else stopLogs();
            }
            window.onload = function() {
              showTab('status');
            };

            let availableModels = [];
            let currentConfig = { default_model: '', model_mapping: {} };
            let modelReasoningOptions = {};

            let logEventSource = null;
            let lastRenderedCount = 0;

            function logsUrl(base) {
              return base;
            }

            function renderLogs(lines) {
              const el = document.getElementById('logsContainer');
              if (!Array.isArray(lines)) lines = [];
              const html = lines.map(ev => {
                const ts = ev.ts || '';
                const lvl = (ev.level || '').padEnd(8);
                let msg = ev.message || '';
                if (ev.type === 'request') msg = (ev.method || '') + ' ' + (ev.path || '') + (ev.extra ? ' ' + ev.extra : '');
                if (ev.type === 'response') msg = (ev.status || '') + ' ' + (ev.path || '') + (ev.duration ? ' ' + ev.duration + 'ms' : '');
                return '<div>[' + ts + '] ' + lvl + ' ' + msg + '</div>';
              }).join('');
              el.innerHTML = html || '<div class="loading">No logs</div>';
              el.scrollTop = el.scrollHeight;
              lastRenderedCount = lines.length;
            }

            function startSSE() {
              stopLogs();
              const container = document.getElementById('logsContainer');
              container.innerHTML = '';
              const es = new EventSource(logsUrl('/api/logs/stream'));
              logEventSource = es;
              const buffer = [];
              es.onmessage = (e) => {
                try {
                  const ev = JSON.parse(e.data);
                  buffer.push(ev);
                  if (buffer.length > 5000) buffer.shift();
                  renderLogs(buffer);
                } catch {}
              };
              es.onerror = () => {
                es.close();
                logEventSource = null;
                container.innerHTML = '<div class="loading">SSE disconnected. Will retry...</div>';
                setTimeout(() => {
                  if (document.getElementById('tab-logs').style.display !== 'none') startSSE();
                }, 2000);
              };
            }

            function stopLogs() {
              if (logEventSource) { try { logEventSource.close(); } catch {} logEventSource = null; }
            }

            async function loadModels() {
              const container = document.getElementById('modelsContainer');
              const countSpan = document.getElementById('modelCount');
              const btn = document.getElementById('refreshModels');

              btn.disabled = true;
              btn.textContent = '⏳ Loading...';
              container.innerHTML = '<div class="loading">Loading models...</div>';

              try {
                const response = await fetch('/api/models/full');
                const data = await response.json();

                if (data.error) {
                  container.innerHTML = '<div class="error">' + data.error.message + '</div>';
                  countSpan.textContent = '0';
                  return;
                }

                const models = data.data || [];
                availableModels = models;
                countSpan.textContent = models.length;

                // Build reasoning options map
                modelReasoningOptions = {};
                models.forEach(model => {
                  const modelId = model.litellm_params?.model || model.model_name;
                  const info = model.model_info || {};
                  if (info.reasoning_effort_options && info.reasoning_effort_options.length > 0) {
                    modelReasoningOptions[modelId] = info.reasoning_effort_options;
                  }
                });

                // Update model selectors
                updateModelSelectors();

                if (models.length === 0) {
                  container.innerHTML = '<div class="loading">No models available</div>';
                  return;
                }

                container.innerHTML = models.map(model => {
                  const info = model.model_info || {};
                  const params = model.litellm_params || {};

                  const badges = [];
                  if (info.supports_vision) badges.push('<span class="badge badge-vision">👁 Vision</span>');
                  if (info.is_reasoning_model) badges.push('<span class="badge badge-reasoning">🧠 Reasoning</span>');
                  if (info.supported_api_list) {
                    info.supported_api_list.forEach(api => {
                      badges.push('<span class="badge badge-api">' + api + '</span>');
                    });
                  }

                  const contextWindow = info.context_window ? (info.context_window / 1000).toFixed(0) + 'K' : 'N/A';
                  const maxOutput = info.max_output_tokens ? (info.max_output_tokens / 1000).toFixed(0) + 'K' : 'N/A';

                  return \`
                    <div class="model-card">
                      <h4>
                        \${model.model_name || 'Unknown'}
                        <span class="model-id">\${params.model || 'N/A'}</span>
                      </h4>
                      <div class="badges">\${badges.join('')}</div>
                      \${info.description ? '<p style="color: #666; margin: 10px 0; font-size: 13px;">' + info.description + '</p>' : ''}
                      <div class="model-details">
                        <div class="detail">
                          <div class="detail-label">Context Window</div>
                          <div class="detail-value">\${contextWindow}</div>
                        </div>
                        <div class="detail">
                          <div class="detail-label">Max Output</div>
                          <div class="detail-value">\${maxOutput}</div>
                        </div>
                        \${info.reasoning_effort_options && info.reasoning_effort_options.length > 0 ? \`
                        <div class="detail">
                          <div class="detail-label">Reasoning Efforts</div>
                          <div class="detail-value">\${info.reasoning_effort_options.join(', ')}</div>
                        </div>\` : ''}
                      </div>
                    </div>
                  \`;
                }).join('');

              } catch (err) {
                container.innerHTML = '<div class="error">Failed to load models: ' + err.message + '</div>';
                countSpan.textContent = '!';
              } finally {
                btn.disabled = false;
                btn.textContent = '🔄 Refresh Models';
              }
            }

            function updateModelSelectors() {
              const defaultSelect = document.getElementById('defaultModel');
              const newTargetSelect = document.getElementById('newTargetModel');

              const optionsHtml = availableModels.map(model => {
                const modelId = model.litellm_params?.model || model.model_name;
                const hasReasoning = modelReasoningOptions[modelId] ? ' 🧠' : '';
                return \`<option value="\${modelId}">\${model.model_name || modelId}\${hasReasoning}</option>\`;
              }).join('');

              defaultSelect.innerHTML = '<option value="">Select default model...</option>' + optionsHtml;
              newTargetSelect.innerHTML = '<option value="">Select target model...</option>' + optionsHtml;

              // Set current default if loaded
              if (currentConfig.default_model) {
                defaultSelect.value = currentConfig.default_model;
                updateReasoningSelector('defaultReasoningEffort', currentConfig.default_model);
              }
            }

            function updateReasoningSelector(selectorId, modelId) {
              const select = document.getElementById(selectorId);
              const options = modelReasoningOptions[modelId] || [];

              if (options.length === 0) {
                select.innerHTML = '<option value="">No reasoning effort</option>';
                select.disabled = true;
              } else {
                select.innerHTML = '<option value="">No reasoning effort</option>' +
                  options.map(opt => \`<option value="\${opt}">\${opt}</option>\`).join('');
                select.disabled = false;
              }
            }

            async function loadConfig() {
              try {
                const response = await fetch('/api/config');
                const data = await response.json();
                currentConfig = data;
                renderMappings();
                updateModelSelectors();
              } catch (err) {
                console.error('Failed to load config:', err);
              }
            }

            function renderMappings() {
              const container = document.getElementById('mappingsContainer');
              const mappings = currentConfig.model_mapping || {};
              const entries = Object.entries(mappings);

              if (entries.length === 0) {
                container.innerHTML = '<div style="color: #666; padding: 10px; text-align: center;">No custom mappings configured</div>';
                return;
              }

              container.innerHTML = entries.map(([source, target]) => {
                let targetModel, reasoningEffort;
                if (typeof target === 'string') {
                  targetModel = target;
                  reasoningEffort = '';
                } else {
                  targetModel = target.target;
                  reasoningEffort = target.reasoning_effort || '';
                }
                const reasoningBadge = reasoningEffort ? \`<span class="badge badge-reasoning" style="margin-left: 5px;">\${reasoningEffort}</span>\` : '';

                return \`
                  <div style="display: flex; align-items: center; gap: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; margin: 5px 0;">
                    <code style="flex: 1;">\${source}</code>
                    <span style="color: #666;">→</span>
                    <code style="flex: 1;">\${targetModel}</code>
                    \${reasoningBadge}
                    <button onclick="deleteMapping('\${source}')" style="background: #dc3545; color: white; border: none; padding: 5px 10px; font-size: 12px;">Delete</button>
                  </div>
                \`;
              }).join('');
            }

            async function saveDefaultModel() {
              const model = document.getElementById('defaultModel').value;
              const reasoning = document.getElementById('defaultReasoningEffort').value;

              if (!model) {
                alert('Please select a model');
                return;
              }

              try {
                const response = await fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    default_model: model,
                    default_reasoning_effort: reasoning || undefined,
                    model_mapping: currentConfig.model_mapping
                  })
                });

                if (response.ok) {
                  const data = await response.json();
                  currentConfig = data.config || currentConfig;
                  alert('Default model saved!');
                } else {
                  alert('Failed to save default model');
                }
              } catch (err) {
                alert('Error: ' + err.message);
              }
            }

            async function addMapping() {
              const source = document.getElementById('newSourceModel').value.trim();
              const target = document.getElementById('newTargetModel').value;
              const reasoning = document.getElementById('newReasoningEffort').value;

              if (!source || !target) {
                alert('Please enter both source and target models');
                return;
              }

              const newMapping = reasoning ? { target, reasoning_effort: reasoning } : target;
              const updatedMappings = { ...currentConfig.model_mapping, [source]: newMapping };

              try {
                const response = await fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    default_model: currentConfig.default_model,
                    model_mapping: updatedMappings
                  })
                });

                if (response.ok) {
                  const data = await response.json();
                  currentConfig = data.config || currentConfig;
                  currentConfig.model_mapping = updatedMappings;
                  renderMappings();
                  document.getElementById('newSourceModel').value = '';
                  document.getElementById('newTargetModel').value = '';
                  document.getElementById('newReasoningEffort').value = '';
                } else {
                  alert('Failed to add mapping');
                }
              } catch (err) {
                alert('Error: ' + err.message);
              }
            }

            async function deleteMapping(source) {
              if (!confirm('Delete mapping for "' + source + '"?')) return;

              const updatedMappings = { ...currentConfig.model_mapping };
              delete updatedMappings[source];

              try {
                const response = await fetch('/api/config', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    default_model: currentConfig.default_model,
                    model_mapping: updatedMappings
                  })
                });

                if (response.ok) {
                  const data = await response.json();
                  currentConfig = data.config || currentConfig;
                  currentConfig.model_mapping = updatedMappings;
                  renderMappings();
                } else {
                  alert('Failed to delete mapping');
                }
              } catch (err) {
                alert('Error: ' + err.message);
              }
            }

            // Event listeners for reasoning effort updates
            document.getElementById('defaultModel').addEventListener('change', function() {
              updateReasoningSelector('defaultReasoningEffort', this.value);
            });

            document.getElementById('newTargetModel').addEventListener('change', function() {
              updateReasoningSelector('newReasoningEffort', this.value);
            });

            // Initialize
            ${authenticated ? "loadModels(); loadConfig();" : "document.getElementById('mappingsContainer').innerHTML = '<div class=\\\"error\\\">Please login first to configure mappings</div>';"}
          </script>
        </body>
      </html>
    `);
	});
}
