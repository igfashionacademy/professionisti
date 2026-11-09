import { defineConfig, loadEnv } from "vite";
import fs from "node:fs";

const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const OPTIONAL = ["VITE_GOOGLE_MAPS_KEY"];

// Guard: refuse to embed anything that looks like a Supabase secret key.
const looksSecret = (v) =>
  /^sb_secret_/.test(v) ||
  (() => {
    try {
      const p = JSON.parse(Buffer.from(v.split(".")[1] ?? "", "base64url").toString());
      return p?.role === "service_role";
    } catch {
      return false;
    }
  })();

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  for (const k of REQUIRED) {
    if (!env[k]) throw new Error(`Missing ${k}. Copy .env.example to .env and fill it in.`);
  }
  for (const k of [...REQUIRED, ...OPTIONAL]) {
    if (env[k] && looksSecret(env[k])) {
      throw new Error(`${k} contains a Supabase SECRET/service_role key. Use the publishable key instead.`);
    }
  }
  // Optional vars must still be defined so %VITE_...% placeholders get replaced (empty = disabled).
  for (const k of OPTIONAL) process.env[k] ??= env[k] ?? "";

  return {
    plugins: [{
      // Brain Power easter egg: copy the song from the project root into dist/, next to index.html
      name: "copy-brainpower",
      closeBundle() {
        if (fs.existsSync("brainpower.mp3")) fs.copyFileSync("brainpower.mp3", "dist/brainpower.mp3");
      },
    }],
    base: "./", // relative URLs: works in the web root or any subfolder on Aruba
    publicDir: "public", // copied as-is into dist (contains .htaccess)
    build: {
      outDir: "dist",
      emptyOutDir: true,
      assetsDir: "", // everything flat in dist/, next to index.html
      sourcemap: false,
    },
  };
});
