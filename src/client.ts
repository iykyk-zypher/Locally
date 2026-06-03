import EventEmitter from "node:events";
import { Message } from "@bufbuild/protobuf";
import { decode } from "@msgpack/msgpack";
import type { Socket } from "engine.io";
import { CPacketDisconnect } from "../gen/protocol2_pb";
import { encode, type EncodeOptions } from "./parser/encoder";

export interface ClientEvents {
	data: [object];
}

/** Represents a connected client. */
export default class Client extends EventEmitter<ClientEvents> {
	/** the underlying Socket for this connection. */
	#socket: Socket;
	/** Constructs a client from a socket. */
	constructor(socket: Socket) {
		super();
		this.#socket = socket;
		this.#socket.on("message", this.#onData.bind(this));
		this.#socket.on("close", (a) => this.emit("close", a));
	}
	/** Handles data coming from the client. This is always MsgPack (Protobuf object -> object.toJSON -> MsgPack -> Sent), so we don't need anything else. */
	#onData(
		data:
			| string
			| ArrayLike<number>
			| ArrayBufferLike
			| ArrayBufferView<ArrayBufferLike>,
	) {
		console.log("[Socket Server] Raw WS frame received. Type:", typeof data, "Length:", (data as any).byteLength || (data as any).length, "Content:", data);
		if (typeof data === "string") {
			// If it's a string connect packet "0", parse it as namespace connect
			if (data === "0") {
				this.emit("data", { t: 0, d: null, n: "/" });
				return;
			}
			console.log("[Socket Server] Plaintext string received, trying to emit as string event:", data);
			// Try to parse as JSON if possible, otherwise skip or disconnect
			try {
				const parsed = JSON.parse(data);
				this.emit("data", parsed);
			} catch {
				this.disconnect("Invalid plaintext data received");
			}
			return;
		}
		
		let mp: any;
		try {
			mp = decode(data);
		} catch (err) {
			console.error("[Socket Server] Failed to decode MessagePack:", err);
			this.disconnect("MessagePack decode error");
			return;
		}

		if (typeof mp !== "object" || mp == null) {
			this.disconnect(
				"MessagePack data isn't an object (or is null/undefined)",
			);
			return;
		}
		
		// Map standard socket.io fields if present to the expected minified fields (t, d, n)
		if ("type" in mp && !("t" in mp)) mp.t = mp.type;
		if ("data" in mp && !("d" in mp)) mp.d = mp.data;
		if ("nsp" in mp && !("n" in mp)) mp.n = mp.nsp;

		this.emit("data", mp);
	}
	send(packet: object | Message, options?: EncodeOptions) {
		const pkt = encode(packet, options);
		this.#socket.send(Buffer.from(pkt.buffer, pkt.byteOffset, pkt.byteLength));
		// this.#socket.send(packet instanceof Message ? packet.toBinary() : packet);
	}
	/** Disconnects the client with an optional reason, defaulting to `No reason provided`. */
	disconnect(reason: string = "No reason provided") {
		if (reason)
			this.send(
				new CPacketDisconnect({
					reason: reason,
				}),
			);
		// this.#socket.close(true);
	}
}

