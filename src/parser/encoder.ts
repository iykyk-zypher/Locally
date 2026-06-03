import { brotliCompressSync, constants } from "node:zlib";
import { Message } from "@bufbuild/protobuf";
import { encode as msgpackEncode } from "@msgpack/msgpack";
import { NAME_TO_ID } from "../protocol";

// TODO: fix this encoder just not working (Miniblox isn't recognizing the packets :sob:)
export interface EncodeOptions {
  /** Enable Brotli compression (only for protobuf messages) */
  useCompression?: boolean;
  /** Packet type for non‑protobuf (msgpack) messages. Default: 2 (EVENT) */
  packetType?: number;
}

/**
 * Encodes a message into the Miniblox wire format.
 *
 * Format: [metaHead] [0x00] [content]
 * - metaHead: single byte containing flags and packet ID (protobuf) or packet type (msgpack)
 * - 0x00: padding byte (ignored by decoder)
 * - content: binary protobuf or msgpack data
 */
export function encode(
  msg: object | Message,
  options: EncodeOptions = {},
): Uint8Array {
  const { useCompression = false, packetType = 2 } = options;
  let metaHead = 0;
  let content: Uint8Array;

  if (msg instanceof Message) {
    // ----- Protobuf mode -----
    const name = (msg.constructor as any).typeName || msg.constructor.name;
    console.info("Detected Protobuf message. Name:", name);

    // Set protobuf flag (bit 0)
    metaHead |= 1;

    // Look up packet ID
    const packetID = NAME_TO_ID[name];
    if (packetID === undefined) {
      throw new Error(`packetID for ${name} not found`);
    }

    // Set compression flag (bit 1)
    if (useCompression) {
      metaHead |= 2;
    }

    // Insert packet ID into bits 2 and above
    const idShift = packetID << 2;
    if (idShift > 0xfc) {
      // 0xFC = 0b11111100, maximum safe value for bits 2-7
      throw new Error(`Packet ID ${packetID} too large for metaHead (max 63)`);
    }
    metaHead |= idShift;

    console.info(
      `metaHead = ${metaHead} (packetID=${packetID}, compressed=${useCompression})`,
    );

    // Serialize protobuf message
    content = msg.toBinary();

    // Compress if requested
    if (useCompression) {
      const compressed = brotliCompressSync(content, {
        params: {
          [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC,
          [constants.BROTLI_PARAM_QUALITY]: 4,
        },
      });
      if (!compressed) {
        throw new Error("Failed to compress content");
      }
      content = compressed;
    }
  } else {
    // ----- Msgpack fallback mode -----
    console.info("Fallback msgpack mode for", msg);

    // Encode packet type into bits 5-7 (3 bits)
    if (packetType < 0 || packetType > 7) {
      throw new Error(`packetType must be between 0 and 7, got ${packetType}`);
    }
    metaHead |= (packetType << 5) & 0xe0; // 0xE0 = 0b11100000

    // Msgpack encode the object
    content = msgpackEncode(msg);
  }

  // Build final packet: [metaHead] [content]
  const finalPacket = new Uint8Array(1 + content.byteLength);
  finalPacket[0] = metaHead;
  finalPacket.set(content, 1);

  return finalPacket;
}
