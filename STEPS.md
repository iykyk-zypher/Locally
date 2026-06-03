# Steps to Run Miniblox Local Server & Client

This guide explains how to install, configure, and run your local Miniblox server.

---

## Step 1: Install Dependencies

Make sure you have [Bun](https://bun.sh/) (recommended) or [Node.js](https://nodejs.org/) installed.

Open a terminal inside the `miniblox-local-server` folder and run:

### Using Bun (Recommended)
```bash
bun install
```

### Using Node/npm
```bash
npm install
```

---

## Step 2: Trust the Local SSL Certificate (CRITICAL)

Miniblox uses secure WebSockets (`wss://`) for server-client communication. Browsers block secure WebSocket connections to untrusted localhost addresses. 

To resolve this, the local server **automatically generates a self-signed SSL certificate** in the `certs/` folder on its first start. You must tell your browser to trust this certificate:

1. Start your local server first (see **Step 3**).
2. Open your web browser and navigate directly to:
   [https://localhost:3002](https://localhost:3002)
3. You will see a security warning page (e.g., *"Your connection is not private"* or *"Potential Security Risk Ahead"*).
4. Click **Advanced** (or **More Info**), then click **Proceed to localhost (unsafe)** or **Accept the Risk and Continue**.
5. Once you see a blank page or a simple message saying `"Error loading Miniblox client page..."`, your browser has successfully accepted and white-listed your local SSL certificate!

---

## Step 3: Run the Server

Start the local server using one of the following commands:

### Using Bun (Recommended)
To run with automatic hot-reload on code edits:
```bash
bun run dev
```
To run normally:
```bash
bun run start
```

### Using Node/npm
To run with automatic hot-reload on code edits:
```bash
npm run node-dev
```
To run normally:
```bash
npm run node-start
```

Once running, you will see `Server running @ https://localhost:3002` in your console.

---

## Step 4: Launch the Game and Play

1. Open your browser and navigate to:
   [https://localhost:3002](https://localhost:3002)
2. **IMPORTANT**: If you have played official Miniblox recently, do a hard reload (**Ctrl + F5**) to clear any cached service workers and load the patched offline client bundle.
3. You will spawn at Y=70 and fall down onto a flat grass platform at Y=64.
4. **Pointer Lock (FPP Camera)**: 
   - Press **Escape** to release the mouse cursor.
   - **Click anywhere on the screen** to lock the cursor back to the center and immediately resume the game.
   - Press **F5** to cycle through first-person and third-person camera views.
