# OCA Proxy (TypeScript)

OpenAI-compatible proxy server for Oracle Code Assist (OCA).

This proxy handles OCI authentication via web-based OAuth flow and exposes standard OpenAI API endpoints, allowing any OpenAI-compatible tool to use OCA backend models.

Note: Requires Node.js 24 LTS (>=24.0.0 <25).

## Quick Start

```bash
# Run without installing (recommended)
npx oca-proxy
```

Or install globally from npm and run:

```bash
npm install -g oca-proxy
# oca-proxy

## Git hooks

This repo uses Husky to run checks locally to keep the codebase consistent and healthy.

- Pre-commit: runs Biome autofix (`npm run check`), re-stages changes, then runs `npm run lint` to ensure no remaining issues.
- Pre-push: runs `npm run typecheck` and `npm run build` to catch type errors and build failures before pushing.

Setup:
- Hooks are installed automatically via the `prepare` script when you run `npm install`.
- If hooks are missing, run: `npx husky install`.

Skip hooks temporarily (use sparingly):
- Commit without hooks: `git commit -m "msg" --no-verify`
- Push without hooks: `git push --no-verify`
```

### From Source

```bash
cd oca-proxy
npm install
npm run build
npx ./bin/oca-proxy.js
```

On first run, the browser will automatically open for OAuth login. After authentication, the proxy is ready to use.

By default, the proxy binds to `127.0.0.1`. To allow access from other devices on your network, set `HOST=0.0.0.0` (or a specific local IP such as `192.168.1.10`) before starting the server.

Note: the Oracle Code Assist OAuth callback is still fixed to `http://localhost:<PORT>/callback`, because the registered redirect URI only allows localhost-style callbacks. Even when the dashboard is opened from another machine, the login flow must complete in a browser on the machine where `oca-proxy` is running.

## Authentication

The proxy uses web-based OAuth with PKCE on whitelisted ports (8669, 8668, 8667).

- **Login:** Visit `http://127.0.0.1:8669/login` or it opens automatically on first run
- **Logout:** Visit `http://127.0.0.1:8669/logout`
- **Status:** Visit `http://127.0.0.1:8669/health`

Tokens are stored in `~/.oca/refresh_token.json`.

## Usage with OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="dummy",  # Not used, but required by SDK
    base_url="http://127.0.0.1:8669/v1"
)

response = client.chat.completions.create(
    model="oca/gpt-4.1",
    messages=[{"role": "user", "content": "Hello!"}],
    stream=True
)

for chunk in response:
    print(chunk.choices[0].delta.content, end="")
```

## Usage with curl

```bash
curl http://127.0.0.1:8669/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "oca/gpt-4.1",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

## Environment Variables

| Variable | Default | Description                                               |
| -------- | ------- | --------------------------------------------------------- |
| `PORT`   | `8669`  | Proxy server port (must be 8669, 8668, or 8667 for OAuth) |
| `HOST`   | `127.0.0.1` | Bind host for the proxy server. Use `0.0.0.0` to listen on all interfaces. |

## Bind Host Configuration

You can control the bind address with either an environment variable or the config file.

### Environment variable

```bash
HOST=0.0.0.0 npx oca-proxy
```

### Config file

Add `host` to `/.config/oca/oca-proxy.config.json`:

```json
{
  "host": "0.0.0.0"
}
```

If you bind to `0.0.0.0`, access the proxy from another machine using the host machine's LAN IP, for example `http://192.168.1.10:8669/v1`.

However, for authentication you should open `http://localhost:8669/login` directly on the host machine running `oca-proxy` (or through SSH port forwarding to your local machine).

## Supported Endpoints

### OpenAI Format (`/v1/...`)

| Endpoint               | Method | Description                            |
| ---------------------- | ------ | -------------------------------------- |
| `/v1/models`           | GET    | List available models                  |
| `/v1/chat/completions` | POST   | Chat completions (streaming supported) |
| `/v1/responses`        | POST   | Responses API (streaming supported)    |
| `/v1/completions`      | POST   | Legacy completions                     |
| `/v1/embeddings`       | POST   | Text embeddings                        |

### Anthropic Format (`/v1/messages`)

| Endpoint       | Method | Description                                  |
| -------------- | ------ | -------------------------------------------- |
| `/v1/messages` | POST   | Anthropic Messages API (streaming supported) |

### Other

| Endpoint  | Method | Description                     |
| --------- | ------ | ------------------------------- |
| `/`       | GET    | Dashboard with status and links |
| `/login`  | GET    | Start OAuth login flow          |
| `/logout` | GET    | Clear authentication            |
| `/health` | GET    | Health check                    |

## Model Mapping

Models not starting with `oca/` are automatically mapped to `oca/gpt-4.1` by default.

Custom mappings can be configured in `~/.config/oca/oca-proxy.config.json`:

```json
{
  "model_mapping": {
    "gpt-4": "oca/gpt-4.1",
    "claude-3-opus": "oca/openai-o3"
  }
}
```



## Files

```
oca-proxy/
├── bin/
│   └── oca-proxy.js   # Standalone CLI - single build output
├── src/
│   ├── index.ts       # Main proxy server with OAuth endpoints
│   ├── auth.ts        # PKCE auth, token manager, OCA headers
│   ├── config.ts      # Configuration and token storage
│   └── logger.ts      # Logging utility
├── package.json
├── tsconfig.json
└── README.md
```

## Running with PM2

PM2 is a production process manager for Node.js applications. You can run the OCA Proxy via the global binary or npx.

1. Install PM2 globally:

   ```bash
   npm install -g pm2
   ```

2. Start the proxy (choose one):

   - Global install:
     ```bash
     pm2 start oca-proxy --name oca-proxy
     ```

   - Using npx (no global install):
     ```bash
     pm2 start "npx oca-proxy" --name oca-proxy
     ```

3. Monitor and manage:
   - View status: `pm2 status`
   - View logs: `pm2 logs oca-proxy`
   - Restart: `pm2 restart oca-proxy`
   - Stop: `pm2 stop oca-proxy`
   - Delete: `pm2 delete oca-proxy`

For advanced configuration, create `ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'oca-proxy',
      // If installed globally:
      script: 'oca-proxy',
      // Or, if you prefer npx, use:
      // script: 'npx',
      // args: 'oca-proxy',
      env: {
        NODE_ENV: 'production',
        PORT: 8669,
      },
    },
  ],
};
```
 
Then start with `pm2 start ecosystem.config.js`.

## Releases (GitHub Actions)

Tagged pushes that match `v*.*.*` trigger a cross-platform build and GitHub Release with prebuilt binaries using `@yao-pkg/pkg`.

- Workflow: `.github/workflows/release.yml`
- Builds on: Ubuntu, macOS (Node 20)
- Output release assets:
 - `oca-proxy-macos-x64.tar.gz`
 - `oca-proxy-macos-arm64.tar.gz`
 - `oca-proxy-linux-x64.tar.gz`
 - `oca-proxy-linux-arm64.tar.gz`


- How to test builds (Intel and Apple Silicon):
  1. Manually run the workflow without tagging (GitHub → Actions → build-and-release → Run workflow).
  2. Download artifacts for your platform from the run summary.
  3. macOS:
     - Intel: `chmod +x oca-proxy-macos-x64 && ./oca-proxy-macos-x64 --help`
     - Apple Silicon: `chmod +x oca-proxy-macos-arm64 && ./oca-proxy-macos-arm64 --help`
     - Test Intel binary on Apple Silicon via Rosetta: `arch -x86_64 ./oca-proxy-macos-x64 --help`
  4. Linux:
     - x64: `chmod +x oca-proxy-linux-x64 && ./oca-proxy-linux-x64 --help`
     - arm64: `chmod +x oca-proxy-linux-arm64 && ./oca-proxy-linux-arm64 --help`

  5. Optional smoke test: start the server and hit the health endpoint:
     - `./oca-proxy-<platform-arch> &`
     - `curl -s http://127.0.0.1:8669/health`

Cut a release:

```bash
# 1) Bump your version in package.json (optional but recommended)
# 2) Commit and tag
git commit -am "chore: release v1.0.5"
git tag v1.0.5
git push origin v1.0.5
```

Or using npm to manage the version and tag:

```bash
npm version patch   # or minor/major
git push --follow-tags
```

## Homebrew Tap

You can distribute `oca-proxy` via a personal Homebrew tap.

1. Create a tap repo: `your-user/homebrew-tap`
2. Add a formula at `Formula/oca-proxy.rb` (a template exists in this repo under `Formula/oca-proxy.rb`)
3. After a release publishes, update the `sha256` values in the formula for each asset:
  - `shasum -a 256 oca-proxy-macos-x64.tar.gz`
  - `shasum -a 256 oca-proxy-linux-x64.tar.gz`
  - `shasum -a 256 oca-proxy-macos-arm64.tar.gz` (if you publish it)
4. Commit the formula to your tap

Install from your tap:

```bash
brew tap your-user/tap
brew install oca-proxy
```

### Automate tap updates

This repo includes `.github/workflows/brew-tap.yml` which can automatically bump your tap’s formula on every GitHub Release. Requirements:

- Create `GH_PAT` secret (Personal Access Token with `repo` scope) in this repo
- Ensure your tap repo is `your-user/homebrew-tap` (or adjust the workflow’s `tap:` input)

The action computes new checksums and updates URLs in `Formula/oca-proxy.rb` within your tap repository.


