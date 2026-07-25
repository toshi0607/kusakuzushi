import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      // A real GitHub profile URL, not jsdom's default `localhost/`: the
      // content script derives the username from the path and only watches
      // the DOM on profile-shaped URLs, so the default would exercise a
      // page shape the extension never actually runs on.
      jsdom: { url: "https://github.com/toshi0607" },
    },
  },
});
