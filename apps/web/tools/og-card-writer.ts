import type { IncomingMessage, ServerResponse } from "node:http";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export const OG_CARD_MAX_BYTES = 5 * 1024 * 1024;

export interface OgCardWriterOptions {
  readonly outputPath: string;
  readonly maxBytes?: number;
  readonly getAllowedOrigins: () => readonly string[];
  readonly write: (path: string, data: Buffer) => void;
  readonly ensureOutputDirectory: () => void;
}

export interface OgCardTargetWriterOptions {
  readonly outputs: Readonly<Record<string, string>>;
  readonly maxBytes?: number;
  readonly getAllowedOrigins: () => readonly string[];
  readonly write: (path: string, data: Buffer) => void;
  readonly ensureOutputDirectory: (outputPath: string) => void;
}

function send(response: ServerResponse, statusCode: number, body: string): void {
  if (response.writableEnded || response.destroyed) return;
  response.statusCode = statusCode;
  response.end(body);
}

function discard(request: IncomingMessage): void {
  request.on("error", () => undefined);
  request.resume();
}

function isPngContentType(contentType: string | undefined): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "image/png";
}

function hasPngSignature(data: Buffer): boolean {
  return data.length >= PNG_SIGNATURE.length && data.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function isIpv4Loopback(address: string): boolean {
  const octets = address.split(".");
  return (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255) &&
    Number(octets[0]) === 127
  );
}

/** Only local development clients may trigger a tracked-file write. */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false;
  if (address === "::1") return true;
  if (isIpv4Loopback(address)) return true;

  const ipv4Mapped = /^::ffff:(.+)$/i.exec(address)?.[1];
  if (ipv4Mapped === undefined) return false;
  if (isIpv4Loopback(ipv4Mapped)) return true;

  const hexadecimal = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ipv4Mapped);
  if (hexadecimal === null) return false;

  const value = (Number.parseInt(hexadecimal[1], 16) << 16) | Number.parseInt(hexadecimal[2], 16);
  return (value >>> 24) === 127;
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) return Number.NaN;

  const length = Number(value);
  return Number.isSafeInteger(length) ? length : Number.NaN;
}

/**
 * Creates the dev-only request handler used to save the generated OG PNG.
 * Writes require a loopback, same-origin request; bytes are retained only after
 * those checks and never beyond maxBytes.
 */
export function createOgCardWriter(options: OgCardWriterOptions) {
  const maxBytes = options.maxBytes ?? OG_CARD_MAX_BYTES;

  return (request: IncomingMessage, response: ServerResponse): void => {
    if (request.method !== "POST") {
      send(response, 405, "POST only");
      discard(request);
      return;
    }

    if (!isLoopbackAddress(request.socket.remoteAddress)) {
      send(response, 403, "Local requests only");
      discard(request);
      return;
    }

    const origin = request.headers.origin;
    if (typeof origin !== "string" || !options.getAllowedOrigins().includes(origin)) {
      send(response, 403, "Same-origin requests only");
      discard(request);
      return;
    }

    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !isPngContentType(contentType)) {
      send(response, 415, "image/png required");
      discard(request);
      return;
    }

    const contentLength = request.headers["content-length"];
    if (contentLength !== undefined && typeof contentLength !== "string") {
      send(response, 400, "Invalid Content-Length");
      discard(request);
      return;
    }

    const declaredLength = parseContentLength(contentLength);
    if (Number.isNaN(declaredLength)) {
      send(response, 400, "Invalid Content-Length");
      discard(request);
      return;
    }

    if (declaredLength !== undefined && declaredLength > maxBytes) {
      send(response, 413, "PNG exceeds the size limit");
      discard(request);
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    let rejected = false;

    const abandon = (statusCode: number, body: string): void => {
      if (rejected) return;
      rejected = true;
      chunks.length = 0;
      send(response, statusCode, body);
      request.resume();
    };

    request.on("close", () => {
      if (!request.complete) {
        rejected = true;
        chunks.length = 0;
      }
    });
    request.on("error", () => abandon(400, "Upload failed"));
    request.on("data", (chunk: Buffer) => {
      if (rejected) return;
      if (chunk.length > maxBytes - size) {
        abandon(413, "PNG exceeds the size limit");
        return;
      }
      size += chunk.length;
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (rejected || !request.complete) return;

      const image = Buffer.concat(chunks, size);
      if (!hasPngSignature(image)) {
        abandon(422, "Invalid PNG signature");
        return;
      }

      try {
        options.ensureOutputDirectory();
        options.write(options.outputPath, image);
        send(response, 200, options.outputPath);
      } catch (error) {
        send(response, 500, String(error));
      }
    });
  };
}

/** Selects a fixed, whitelisted output before delegating to the guarded writer. */
export function createOgCardWriterForTargets(options: OgCardTargetWriterOptions) {
  const writers = new Map(
    Object.entries(options.outputs).map(([target, output]) => [
      target,
      createOgCardWriter({
        outputPath: output,
        maxBytes: options.maxBytes,
        getAllowedOrigins: options.getAllowedOrigins,
        write: options.write,
        ensureOutputDirectory: () => options.ensureOutputDirectory(output),
      }),
    ]),
  );

  return (request: IncomingMessage, response: ServerResponse): void => {
    const target = new URL(request.url ?? "", "http://localhost").searchParams.get("target");
    const writer = target === null ? undefined : writers.get(target);
    if (writer === undefined) {
      send(response, 400, `unknown target: ${String(target)}`);
      discard(request);
      return;
    }

    writer(request, response);
  };
}
