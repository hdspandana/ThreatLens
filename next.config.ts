import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js spawns a worker thread and loads a WASM core from its own
  // package directory at runtime. It must be left external (resolved from
  // node_modules) rather than bundled, otherwise the worker never starts in
  // production and OCR hangs.
  serverExternalPackages: ["tesseract.js"],
};

export default nextConfig;
