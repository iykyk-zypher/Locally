# Miniblox Offline Local Server

A standalone offline local server and client-patching proxy for [Miniblox](https://miniblox.io/). This allows you to host a local Miniblox server on `localhost` with flat world grass rendering, custom block physics, and fully working FPP (first-person) and TPP (third-person) cameras.

---

## How It Works

1. **Asset Proxying**: The local server acts as an HTTPS proxy. It fetches official client pages and assets from `miniblox.io` and serves them locally.
2. **On-the-fly Client Patching**: When the browser requests the game JavaScript bundle, the proxy intercepts and patches the client bundle in-memory:
   - **WebGL Buffer Fix**: Patches `Uint8Array` constructor type checks to prevent WebGL attribute upload crashes in Web Workers.
   - **Pointer Lock FPP Fix**: Modifies the canvas click handler to request pointer lock and resume the game immediately upon clicking the screen.
3. **Local Protobuf & MsgPack Server**: Handles WebSocket socket.io connections from the client, processing binary payloads using custom Protobuf definitions (Join Game, Spawn Player, Time Update, Chunk Request, Player Input) to run the game locally.

---

## Features

- **Flat World Chunk Column**: Generates a solid 5-cell deep flat world chunk column (Bedrock at bottom, Stone, Dirt, Grass block on top at Y=64) with correct 4-bit palette entry packing and rendering.
- **Dynamic Pointer Lock Recovery**: Clicking anywhere on the canvas instantly locks the cursor and resumes the game.
- **Diagnostics Expose**: Exposes the client's internal `window.game` and `window.player` instances for console debugging.
- **Automatic SSL Certificate Generation**: The server automatically generates a secure, 2048-bit self-signed SSL certificate for `localhost` inside `./certs/` on first startup, making setup plug-and-play.
- **Dual Runtime Support**: Runs out of the box on both **Bun** and **Node.js** runtimes.

---

## Getting Started

To install and run the project, please follow the step-by-step instructions in:

### 📄 [STEPS.md](./STEPS.md)

---

## Developer Quick Start

### Bun (Recommended)
```bash
bun install
bun run dev
```

### Node.js / npm
```bash
npm install
npm run node-dev
```

Once started, navigate to [https://localhost:3002](https://localhost:3002) in your browser. Refer to `STEPS.md` for trusting the local SSL certificates!

That sounded like AI -_-
