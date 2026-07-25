/**
 * The content script's entry point — the only module with a side effect, so
 * every other file (`content.ts` included) stays importable from a test
 * without mounting anything.
 */

import { autoMount } from "./content";

autoMount(document, window);
