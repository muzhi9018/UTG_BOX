# TGBOX

Node.js + TypeScript Telegram userbot (MTProto) built on mtcute.

## Requirements
- Node.js >= 18

## Setup
```bash
pnpm install
```

## Configure
Edit `.env.development` (and `.env.production` if needed):
- `API_ID` and `API_HASH` from <https://my.telegram.org/apps>
- `SESSION_PATH` for SQLite session storage
- `ALLOWED_CHAT_IDS` optional comma-separated list
- `IS_TEST_MODE` optional in non-production (set to `true` to use test DC)
- `DC_HOST`, `DC_PORT`, `DC_ID` optional (set to use custom DC)
- `COMMAND_PREFIXES` optional, comma-separated command prefixes (default `/`)

## Test DC config
When `IS_TEST_MODE` is enabled and no custom values are provided, defaults are used:
- DC host: `149.154.167.40`
- DC port: `443`
- DC ID: `2`

When `IS_TEST_MODE` is enabled, login uses `startTest()` automatically.
If a custom DC is detected, the app prints a warning to confirm DC type (production vs test).

## Development
```bash
pnpm dev
```

On first run, you will be prompted for phone, code, and password (2FA).
The session is persisted to the SQLite file in `SESSION_PATH`.

## Testing
```bash
pnpm test
```

## Production
```bash
pnpm build
pnpm start
```

## Env files
- .env.development
- .env.test
- .env.production

## Built-in commands
- `/ping` -> `pong`
- `/id` -> reply with current chat ID
- `hello*` -> `hi there`
