/**
 * The one place this Worker talks to the jogruber GitHub-contributions API.
 * Shared by the OGP card (which only needs the folded grid) and the
 * `/api/grid/{user}` passthrough the web app reads, so the upstream URL,
 * the response-size guard, and the payload validation are decided once.
 *
 * Swapping the upstream (e.g. scraping GitHub's own calendar fragment) is a
 * change to this file only — neither the card nor the web app sees the source.
 */

import { parseJogruberContributions, type ContributionCell } from "./jogruber";

export const JOGRUBER_API_BASE = "https://github-contributions-api.jogruber.de/v4";

// Keep this 64 KiB streaming limit aligned with apps/web/src/api.ts; separate
// bundles retain their own error and fallback behavior.
// A 371-cell response is normally below 32 KiB; 64 KiB leaves room for API
// metadata while keeping an untrusted upstream body inexpensive to parse.
export const MAX_RESPONSE_BYTES = 64 * 1024;

export type JogruberResult =
  | {
      status: "ok";
      /** The validated upstream payload, parsed. */
      json: unknown;
      /** The same payload as the bytes it arrived in, for the passthrough route (no re-serialisation). */
      text: string;
      contributions: ContributionCell[];
    }
  | { status: "not-found" }
  | { status: "unavailable"; reason: string };

async function readBoundedText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    throw new Error("jogruber response is too large");
  }

  if (!response.body) {
    throw new Error("jogruber response has no body");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  let cancelled = false;
  const cancel = async () => {
    if (!cancelled) {
      cancelled = true;
      await reader.cancel();
    }
  };

  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        break;
      }
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await cancel().catch(() => undefined);
        throw new Error("jogruber response is too large");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (!done) {
      await cancel().catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/**
 * Fetches `user`'s last-year calendar. Never throws: a network error, a
 * non-2xx status, an oversized body, or a payload that fails validation all
 * come back as `unavailable`, and only the upstream's own 404 as `not-found`,
 * so callers decide between "fall back" and "tell the user" without
 * re-deriving that from exceptions.
 */
export async function fetchJogruberContributions(user: string): Promise<JogruberResult> {
  let response: Response;
  try {
    response = await fetch(`${JOGRUBER_API_BASE}/${encodeURIComponent(user)}?y=last`);
  } catch (error) {
    return { status: "unavailable", reason: `network: ${error instanceof Error ? error.message : String(error)}` };
  }

  if (response.status === 404) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    return { status: "not-found" };
  }
  if (!response.ok) {
    if (response.body) {
      await response.body.cancel().catch(() => undefined);
    }
    return { status: "unavailable", reason: `upstream status ${response.status}` };
  }

  try {
    const text = await readBoundedText(response);
    const json: unknown = JSON.parse(text);
    return { status: "ok", json, text, contributions: parseJogruberContributions(json) };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
}
