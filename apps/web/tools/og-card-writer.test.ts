import { createServer, request as createRequest, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOgCardWriter, createOgCardWriterForTargets, isLoopbackAddress } from "./og-card-writer";

const ORIGIN = "http://localhost:5173";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const MAX_BYTES = 1024;

interface ResponseResult {
  readonly statusCode: number;
  readonly body: string;
}

let directory: string;
let outputPath: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "og-card-writer-"));
  outputPath = join(directory, "og.png");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function startWriter(emitRequestError = false): Promise<ReturnType<typeof createServer>> {
  const handler = createOgCardWriter({
    outputPath,
    maxBytes: MAX_BYTES,
    getAllowedOrigins: () => [ORIGIN],
    ensureOutputDirectory: () => mkdirSync(dirname(outputPath), { recursive: true }),
    write: writeFileSync,
  });
  const writer = createServer((request, response) => {
    handler(request, response);
    if (emitRequestError) queueMicrotask(() => request.emit("error", new Error("simulated request failure")));
  });

  return new Promise((resolve) => writer.listen(0, "127.0.0.1", () => resolve(writer)));
}

function sendChunkedRequest(
  server: ReturnType<typeof createServer>,
  headers: IncomingHttpHeaders,
  chunks: readonly Buffer[],
): Promise<ResponseResult> {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not listen on TCP");

  return new Promise((resolve, reject) => {
    const request = createRequest(
      {
        host: "127.0.0.1",
        port: address.port,
        method: "POST",
        path: "/",
        headers: { ...headers, "transfer-encoding": "chunked" },
      },
      (response) => {
        const responseChunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => responseChunks.push(chunk));
        response.on("end", () =>
          resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(responseChunks).toString() }),
        );
      },
    );
    request.on("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

function sendHeadersOnly(server: ReturnType<typeof createServer>, headers: IncomingHttpHeaders, path = "/"): Promise<string> {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not listen on TCP");

  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: address.port });
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
      socket.write([`POST ${path} HTTP/1.1`, "Host: 127.0.0.1", ...headerLines, "", ""].join("\r\n"));
    });
    socket.once("data", (response) => {
      socket.destroy();
      resolve(response.toString());
    });
    socket.once("error", reject);
  });
}

function sendRequest(
  server: ReturnType<typeof createServer>,
  headers: IncomingHttpHeaders,
  body?: Buffer,
  path = "/",
): Promise<ResponseResult> {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Test server did not listen on TCP");

  return new Promise((resolve, reject) => {
    const request = createRequest(
      { host: "127.0.0.1", port: address.port, method: "POST", path, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => resolve({ statusCode: response.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      },
    );
    request.on("error", reject);
    request.end(body);
  });
}

async function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
}

async function expectOutputAbsent(): Promise<void> {
  await expect(readFile(outputPath)).rejects.toMatchObject({ code: "ENOENT" });
}

describe("OG card writer HTTP handler", () => {
  it("writes same-origin data with a PNG signature from a loopback client", async () => {
    const server = await startWriter();
    try {
      const response = await sendRequest(server, { origin: ORIGIN, "content-type": "image/png" }, PNG);

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(outputPath);
      await expect(readFile(outputPath)).resolves.toEqual(PNG);
    } finally {
      await closeServer(server);
    }
  });

  it("rejects an oversized declared Content-Length before accepting a body", async () => {
    const server = await startWriter();
    try {
      const response = await sendHeadersOnly(server, {
        origin: ORIGIN,
        "content-type": "image/png",
        "content-length": String(MAX_BYTES + 1),
      });

      expect(response).toMatch(/^HTTP\/1\.1 413 /);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("rejects an oversized streamed body without writing it", async () => {
    const server = await startWriter();
    try {
      const response = await sendChunkedRequest(
        server,
        { origin: ORIGIN, "content-type": "image/png" },
        [PNG, Buffer.alloc(MAX_BYTES)],
      );

      expect(response.statusCode).toBe(413);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("rejects a cross-origin request without writing", async () => {
    const server = await startWriter();
    try {
      const response = await sendRequest(server, { origin: "http://attacker.invalid", "content-type": "image/png" }, PNG);

      expect(response.statusCode).toBe(403);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("rejects a non-PNG content type without writing", async () => {
    const server = await startWriter();
    try {
      const response = await sendRequest(server, { origin: ORIGIN, "content-type": "application/octet-stream" }, PNG);

      expect(response.statusCode).toBe(415);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("rejects a body without the PNG signature without writing", async () => {
    const server = await startWriter();
    try {
      const response = await sendRequest(server, { origin: ORIGIN, "content-type": "image/png" }, Buffer.from("not a PNG"));

      expect(response.statusCode).toBe(422);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("does not write when an in-flight request is aborted", async () => {
    const server = await startWriter();
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Test server did not listen on TCP");

    try {
      await new Promise<void>((resolve) => {
        const request = createRequest({
          host: "127.0.0.1",
          port: address.port,
          method: "POST",
          path: "/",
          headers: { origin: ORIGIN, "content-type": "image/png", "transfer-encoding": "chunked" },
        });
        request.on("error", () => resolve());
        request.write(PNG);
        request.destroy(new Error("client aborted upload"));
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("does not write when the request stream errors", async () => {
    const server = await startWriter(true);
    try {
      const response = await sendRequest(server, { origin: ORIGIN, "content-type": "image/png" }, PNG);

      expect(response.statusCode).toBe(400);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });
});

describe("isLoopbackAddress", () => {
  it.each(["127.0.0.1", "127.255.255.255", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1"])(
    "accepts %s",
    (address) => expect(isLoopbackAddress(address)).toBe(true),
  );

  it.each([undefined, "126.0.0.1", "192.168.1.10", "::2", "::ffff:192.168.1.10", "::ffff:7e00:1"])(
    "rejects %s",
    (address) => expect(isLoopbackAddress(address)).toBe(false),
  );
});

describe("OG card writer targets", () => {
  it("writes a PNG to the exact output mapped by a whitelisted target", async () => {
    const promoTileOutput = join(directory, "promo-tile.png");
    const handler = createOgCardWriterForTargets({
      outputs: { og: outputPath, "promo-tile": promoTileOutput },
      maxBytes: MAX_BYTES,
      getAllowedOrigins: () => [ORIGIN],
      ensureOutputDirectory: (output) => mkdirSync(dirname(output), { recursive: true }),
      write: writeFileSync,
    });
    const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
      const writer = createServer(handler);
      writer.listen(0, "127.0.0.1", () => resolve(writer));
    });

    try {
      const response = await sendRequest(
        server,
        { origin: ORIGIN, "content-type": "image/png" },
        PNG,
        "/?target=promo-tile",
      );

      expect(response.statusCode).toBe(200);
      expect(response.body).toBe(promoTileOutput);
      await expect(readFile(promoTileOutput)).resolves.toEqual(PNG);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });

  it("rejects an unknown target before accepting its body", async () => {
    const handler = createOgCardWriterForTargets({
      outputs: { og: outputPath },
      maxBytes: MAX_BYTES,
      getAllowedOrigins: () => [ORIGIN],
      ensureOutputDirectory: (output) => mkdirSync(dirname(output), { recursive: true }),
      write: writeFileSync,
    });
    const server = await new Promise<ReturnType<typeof createServer>>((resolve) => {
      const writer = createServer(handler);
      writer.listen(0, "127.0.0.1", () => resolve(writer));
    });

    try {
      const response = await sendHeadersOnly(
        server,
        { origin: ORIGIN, "content-type": "image/png", "content-length": String(MAX_BYTES + 1) },
        "/?target=unknown",
      );

      expect(response).toMatch(/^HTTP\/1\.1 400 /);
      await expectOutputAbsent();
    } finally {
      await closeServer(server);
    }
  });
});
