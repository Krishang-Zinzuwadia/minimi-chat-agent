import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

// Based on vinext 1.4.5's App Router initializer. vinext registers the RSC
// plugin itself. No shared response/data cache for authenticated chat content.
export default defineConfig({
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
