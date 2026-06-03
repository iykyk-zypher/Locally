import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import selfsigned from "selfsigned";

if (!existsSync("./certs")) {
	mkdirSync("./certs");
}
if (!existsSync("./certs/key.pem") || !existsSync("./certs/cert.pem")) {
	console.log("[Server] Generating self-signed SSL certificates for localhost...");
	const attrs = [{ name: "commonName", value: "localhost" }];
	const pems = selfsigned.generate(attrs, { days: 365, keySize: 2048 });
	writeFileSync("./certs/key.pem", pems.private);
	writeFileSync("./certs/cert.pem", pems.cert);
	console.log("[Server] Self-signed SSL certificates successfully generated and saved to ./certs/");
}
import { createServer } from "node:https";
import { Server, type Socket } from "engine.io";
import Client from "./client";
import {
	CPacketConfirmTransaction,
	CPacketJoinGame,
	CPacketPlayerPosLook,
	CPacketPong,
	CPacketTimeUpdate,
} from "../gen/protocol2_pb";
import { PBCell, CPacketChunkData } from "../gen/protocol3_pb";
import { ID_TO_NAME } from "./protocol";

// Helper to pack a cell into 4-bit entries
function createCell(yBase: number, blockIds: number[]): PBCell {
	const palette = [0];
	for (const id of blockIds) {
		if (id !== 0 && !palette.includes(id)) {
			palette.push(id);
		}
	}

	const bitsPerEntry = 4;
	const bitArray = new Uint8Array(2048);
	let blockRefCount = 0;

	for (let u = 0; u < 4096; u++) {
		const blockId = blockIds[u] ?? 0;
		if (blockId !== 0) {
			blockRefCount++;
		}
		const paletteIndex = palette.indexOf(blockId);

		const longIndex = Math.floor(u / 16);
		const slotIndex = u % 16;
		const byteIndex = longIndex * 8 + Math.floor(slotIndex / 2);

		if (slotIndex % 2 === 0) {
			bitArray[byteIndex] = (bitArray[byteIndex] & 0xf0) | (paletteIndex & 0x0f);
		} else {
			bitArray[byteIndex] = (bitArray[byteIndex] & 0x0f) | ((paletteIndex & 0x0f) << 4);
		}
	}

	return new PBCell({
		y: yBase,
		bitsPerEntry,
		palette,
		blockRefCount,
		bitArray,
	});
}

// Helper to generate a flat chunk column (Bedrock at bottom, Stone, Dirt, and Grass Block on top)
function createFlatChunk(chunkX: number, chunkZ: number): CPacketChunkData {
	const cells: PBCell[] = [];

	// Cell 0: Y=0..15 (Bedrock at Y=0..2, Stone at Y=3..15)
	const cell0Blocks = new Array(4096).fill(0);
	for (let y = 0; y < 16; y++) {
		const blockId = y <= 2 ? 33 : 1; // 33: Bedrock, 1: Stone
		for (let z = 0; z < 16; z++) {
			for (let x = 0; x < 16; x++) {
				const idx = (y << 8) | (z << 4) | x;
				cell0Blocks[idx] = blockId;
			}
		}
	}
	cells.push(createCell(0, cell0Blocks));

	// Cell 1: Y=16..31 (All Stone)
	const cell1Blocks = new Array(4096).fill(1); // 1: Stone
	cells.push(createCell(16, cell1Blocks));

	// Cell 2: Y=32..47 (All Stone)
	const cell2Blocks = new Array(4096).fill(1); // 1: Stone
	cells.push(createCell(32, cell2Blocks));

	// Cell 3: Y=48..63 (All Dirt)
	const cell3Blocks = new Array(4096).fill(10); // 10: Dirt
	cells.push(createCell(48, cell3Blocks));

	// Cell 4: Y=64..79 (Grass Block at Y=64, Air above)
	const cell4Blocks = new Array(4096).fill(0);
	for (let z = 0; z < 16; z++) {
		for (let x = 0; x < 16; x++) {
			const idx = (0 << 8) | (z << 4) | x; // local y = 0 (global Y = 64)
			cell4Blocks[idx] = 8; // 8: Grass Block
		}
	}
	cells.push(createCell(64, cell4Blocks));

	return new CPacketChunkData({
		x: chunkX,
		z: chunkZ,
		cells,
		tileEntities: [],
		dimension: 0,
		biomes: new Array(256).fill(1), // Default biome ID
	});
}


const httpsServer = createServer({
	key: readFileSync("./certs/key.pem"),
	cert: readFileSync("./certs/cert.pem"),
}, async (req, res) => {
	const url = req.url || "/";

	if (url === "/log-error" && req.method === "POST") {
		let body = "";
		req.on("data", chunk => { body += chunk; });
		req.on("end", () => {
			try {
				const err = JSON.parse(body);
				console.error("[Client Error Log]:", err);
			} catch {
				console.error("[Client Error Log] Raw:", body);
			}
			res.writeHead(200, {
				"Content-Type": "text/plain",
				"Access-Control-Allow-Origin": "*",
			});
			res.end("OK");
		});
		return;
	}

	// Serve the game client page at the root URL
	if (url === "/" || url === "/index.html") {
		try {
			console.log("[Proxy] Fetching game client index from miniblox.io...");
			const response = await fetch("https://miniblox.io/");
			let html = await response.text();

			// Inject WebSocket redirector (DISABLED REDIRECT for debug) and Uint8Array constructor patch at the top of <head>
			const redirectScript = `
<script>
console.log("[Proxy] Injecting WebSocket redirection, Pointer Lock instrumentation, and Service Worker bypass...");

// Catch and log all global errors and unhandled promise rejections
window.onerror = function(message, source, lineno, colno, error) {
	const errInfo = { message, source, lineno, colno, error: error ? error.stack : "" };
	console.error("[Proxy] Global Error:", errInfo);
	fetch("/log-error", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(errInfo)
	}).catch(() => {});
};
window.onunhandledrejection = function(event) {
	const reason = event.reason;
	const errInfo = { message: reason ? reason.message : "Unhandled promise rejection", error: reason ? reason.stack : "" };
	console.error("[Proxy] Unhandled Rejection:", errInfo);
	fetch("/log-error", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(errInfo)
	}).catch(() => {});
};

// Monitor Pointer Lock requests and state changes
document.addEventListener("pointerlockchange", function() {
	console.log("[Proxy] Pointer Lock changed. Locked element:", document.pointerLockElement);
	fetch("/log-error", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message: "Pointer Lock changed", element: document.pointerLockElement ? document.pointerLockElement.tagName : "null" })
	}).catch(() => {});
});
document.addEventListener("pointerlockerror", function(err) {
	console.error("[Proxy] Pointer Lock error:", err);
	fetch("/log-error", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message: "Pointer Lock error" })
	}).catch(() => {});
});
const originalRequestPointerLock = Element.prototype.requestPointerLock;
Element.prototype.requestPointerLock = function() {
	console.log("[Proxy] requestPointerLock called on:", this);
	fetch("/log-error", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message: "requestPointerLock called", tag: this.tagName })
	}).catch(() => {});
	return originalRequestPointerLock.apply(this, arguments);
};

// Unregister all Service Workers to bypass caching of old assets
if ('serviceWorker' in navigator) {
	navigator.serviceWorker.getRegistrations().then(function(registrations) {
		for (let registration of registrations) {
			console.log("[Proxy] Unregistering service worker:", registration);
			registration.unregister().then(() => {
				console.log("[Proxy] Service worker unregistered successfully. Reloading page to apply changes...");
				window.location.reload();
			});
		}
	});
}

// 1. Patch Uint8Array constructor (fixing a bug in client's custom decoder)
const OriginalUint8Array = window.Uint8Array;
class PatchedUint8Array extends OriginalUint8Array {
	constructor(buffer, byteOffset, length) {
		if (buffer && buffer.buffer && byteOffset !== undefined) {
			const actualOffset = (buffer.byteOffset || 0) + byteOffset;
			super(buffer.buffer, actualOffset, length);
		} else {
			super(...arguments);
		}
	}
}
Object.defineProperty(PatchedUint8Array, Symbol.hasInstance, {
	value: function(instance) {
		return instance instanceof OriginalUint8Array;
	}
});
window.Uint8Array = PatchedUint8Array;

// 2. Intercept WebSocket connections and redirect to localhost:3002
const OriginalWebSocket = window.WebSocket;
window.WebSocket = function(url, protocols) {
	let targetUrl = url;
	if (url.includes("servers.coolmathblox.ca") || url.includes("miniblox.io")) {
		targetUrl = "wss://localhost:3002/socket.io/?EIO=4&transport=websocket";
		console.log("[Proxy] Redirecting WS connection:", url, "->", targetUrl);
	} else {
		console.log("[Proxy] WS connection initiated (no redirect):", url);
	}
	
	const ws = new OriginalWebSocket(targetUrl, protocols);
	
	// Hook into send to inspect outgoing frames
	const originalSend = ws.send;
	ws.send = function(data) {
		if (data instanceof ArrayBuffer) {
			const bytes = new Uint8Array(data);
			console.log("[Proxy] WS SENT binary frame. Length:", data.byteLength, "Bytes:", Array.from(bytes));
		} else if (data instanceof Blob) {
			console.log("[Proxy] WS SENT blob frame. Length:", data.size);
		} else {
			console.log("[Proxy] WS SENT text frame:", data);
		}
		return originalSend.apply(this, arguments);
	};
	
	// Hook into message event passively
	ws.addEventListener("message", async (event) => {
		if (event.data instanceof ArrayBuffer) {
			const bytes = new Uint8Array(event.data);
			console.log("[Proxy] WS RECEIVED binary frame. Length:", event.data.byteLength, "Bytes:", Array.from(bytes));
		} else if (event.data instanceof Blob) {
			const buf = await event.data.arrayBuffer();
			const bytes = new Uint8Array(buf);
			console.log("[Proxy] WS RECEIVED blob frame. Length:", event.data.size, "Bytes:", Array.from(bytes));
		} else {
			console.log("[Proxy] WS RECEIVED text frame:", event.data);
		}
	});
	
	return ws;
};
Object.assign(window.WebSocket, OriginalWebSocket);
window.WebSocket.prototype = OriginalWebSocket.prototype;
</script>
`;
			html = html.replace("<head>", "<head>" + redirectScript);

			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(html);
		} catch (error) {
			console.error("Error proxying client page:", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Error loading Miniblox client page: " + error);
		}
	} else {
		// Proxy all relative assets (JS, CSS, images, manifest, favicon) from miniblox.io
		try {
			const targetUrl = "https://miniblox.io" + url;
			const response = await fetch(targetUrl);
			
			const headers: Record<string, string> = {
				"Access-Control-Allow-Origin": "*",
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "*",
			};
			
			const contentType = response.headers.get("content-type");
			if (contentType) headers["Content-Type"] = contentType;

			if (url.includes("/assets/index-") && url.endsWith(".js")) {
				console.log(`[Proxy] Dynamically patching index bundle: ${url}`);
				let js = await response.text();
				
				// Inject console.logs into worker handlers
				js = js.replace(
					"case VoxelWorkerMessageType.NEW_CHUNK:{",
					'case VoxelWorkerMessageType.NEW_CHUNK:{console.log("[Worker] NEW_CHUNK at", o.chunkData.x, o.chunkData.z, "cells:", o.chunkData.cells?.length);'
				);
				js = js.replace(
					"case VoxelWorkerMessageType.GENERATE_GEOMETRY:{",
					'case VoxelWorkerMessageType.GENERATE_GEOMETRY:{console.log("[Worker] GENERATE_GEOMETRY at", o.x, o.z);'
				);
				js = js.replace(
					"generateGeometry(e,t){let a=null,r=null;try{a=ChunkMesh.generateGeometryDataForChunk(this.damagedBlockMap,this.world,e,t,!1,this.fastRender)}",
					'generateGeometry(e,t){console.log("[Worker] generateGeometry run", e, t);let a=null,r=null;try{a=ChunkMesh.generateGeometryDataForChunk(this.damagedBlockMap,this.world,e,t,!1,this.fastRender);console.log("[Worker] opaque geometry generated:", a ? "yes" : "empty");}'
				);
				
				js = js.replace(
					"GameContext=reactExports.createContext(null),game=new Game,",
					"GameContext=reactExports.createContext(null),game=new Game;window.game=game;const "
				);
				js = js.replace(
					"const player=new ClientEntityPlayer;",
					"const player=new ClientEntityPlayer;window.player=player;"
				);
				js = js.replace(
					"y=reactExports.useCallback(()=>{Game.isActive()||Game.isChatting()||Game.hasMenuOpen()||requestPointerLock()},[]);",
					'y=reactExports.useCallback(()=>{if(game.inGame()&&!game.chat.showInput&&!game.info.showInventory&&!game.info.showSignEditor&&!game.info.showCommandBlockEditor)requestPointerLock()},[]);'
				);
				
				// Inject logging for onMouseMove
				js = js.replace(
					"onMouseMove(u){if(this.enabled===!1)return;const h=u.movementX||u.mozMovementX||u.webkitMovementX||0,p=u.movementY||u.mozMovementY||u.webkitMovementY||0;this.updateCamera(h,p)}",
					'onMouseMove(u){if(!this._lastLogTime||Date.now()-this._lastLogTime>500){this._lastLogTime=Date.now();fetch("/log-error",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({message:"onMouseMove_debug",enabled:this.enabled,mx:u.movementX,my:u.movementY,clientX:u.clientX,clientY:u.clientY,health:typeof player!=="undefined"?player.getHealth():null,perspective:typeof player!=="undefined"?player.perspective:null,showEscapeMenu:typeof game!=="undefined"?game.info?.showEscapeMenu:null,showInventory:typeof game!=="undefined"?game.info?.showInventory:null,showDeathScreen:typeof game!=="undefined"?game.info?.showDeathScreen:null,inGame:typeof game!=="undefined"?game.inGame():null})}).catch(()=>{});}if(this.enabled===!1)return;const h=u.movementX||u.mozMovementX||u.webkitMovementX||0,p=u.movementY||u.mozMovementY||u.webkitMovementY||0;this.updateCamera(h,p)}'
				);
				
				res.writeHead(200, headers);
				res.end(js);
			} else {
				res.writeHead(response.status, headers);
				const arrayBuffer = await response.arrayBuffer();
				res.end(Buffer.from(arrayBuffer));
			}
		} catch (error) {
			console.error(`Error proxying asset ${url}:`, error);
			res.writeHead(500);
			res.end("Proxy Error");
		}
	}
});

const io = new Server({
	cors: {
		origin: "*",
	},
	transports: ["websocket"],
});

io.attach(httpsServer, {
	path: "/socket.io",
});

io.on("connection", (socket: Socket) => {
	console.log(`[Socket] New connection established! ID: ${socket.id}`);
	socket.on("error", (err) => {
		console.error(`[Socket Error] ID ${socket.id}:`, err);
	});
	
	const cl = new Client(socket);

	cl.on("data", (d: any) => {
		const dataArray = d && typeof d === "object" ? (d.data || d.d) : null;
		if (Array.isArray(dataArray)) {
			const packetId = dataArray[0];
			const payload = dataArray[1];
			const packetName = typeof packetId === "number" ? ID_TO_NAME[packetId] : packetId;
			console.log(`[Socket] Received packet event: ${packetName} (ID: ${packetId})`, payload);

			// Handle login request from the client game
			if (packetName === "SPacketLoginStart") {
				console.log("[Socket] Login started by client. Sending JoinGame packet...");
				const clientVersion = payload?.clientVersion || "3.41.74";
				cl.send(
					new CPacketJoinGame({
						canConnect: true,
						gamemode: "creative",
						name: "Player",
						tick: 0,
						dimension: 0,
						enablePlayerCollision: true,
						serverInfo: {
							serverId: "local-1-1",
							serverName: "Local Server",
							serverVersion: clientVersion,
							serverCategory: "survival",
							accessControl: "public",
							startTime: 0n,
							worldType: "flat",
							pvpEnabled: false,
							cheats: "all",
						}
					}),
				);

				// Send a 5x5 grid of initial chunks around spawn
				console.log("[Socket] Sending initial flat grass chunks...");
				for (let cx = -2; cx <= 2; cx++) {
					for (let cz = -2; cz <= 2; cz++) {
						cl.send(createFlatChunk(cx, cz));
					}
				}

				// Send time update (make it noon so it's bright)
				console.log("[Socket] Sending time update (noon)...");
				cl.send(
					new CPacketTimeUpdate({
						totalTime: 6000,
						worldTime: 6000,
					})
				);

				// Spawn the player at (0, 70, 0)
				console.log("[Socket] Sending player spawn position...");
				cl.send(
					new CPacketPlayerPosLook({
						x: 0,
						y: 70,
						z: 0,
						yaw: 0,
						pitch: 0,
					})
				);
				return;
			}

			// Handle chunk request from the client when it loads new areas
			if (packetName === "SPacketRequestChunk") {
				const x = payload?.x ?? 0;
				const z = payload?.z ?? 0;
				console.log(`[Socket] Generating requested chunk at X: ${x}, Z: ${z}`);
				cl.send(createFlatChunk(x, z));
				return;
			}

			// Handle ping requests to keep connection alive
			if (packetName === "SPacketPing") {
				const timeVal = payload?.time ? BigInt(payload.time) : 0n;
				cl.send(new CPacketPong({ time: timeVal, mspt: 50, tick: 0 }));
				return;
			}
		} else if (
			typeof d === "object" &&
			d !== null &&
			"t" in d &&
			"d" in d &&
			d.t === 0 &&
			d.d === null
		) {
			// Engine.io connection handshake (respond only with sid)
			cl.send({
				// @ts-expect-error: It's private, but I need to use it
				sid: socket.id as string,
				pid: null,
			}, { packetType: 0 });
			console.log("[Socket] Engine.io handshake completed.");
		} else {
			console.log("[Socket] Received unknown format:", d);
		}
	});

	cl.on("close", (reason, description) => {
		console.log(`[Socket] Client ID ${socket.id} disconnected. Reason: ${reason}, Description:`, description);
	});
});

httpsServer.listen(3002, () => {
	console.log("Server running @ https://localhost:3002");
});
