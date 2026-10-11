import { defineConfig } from "@terrazzo/cli"
import css from "@terrazzo/plugin-css"
import js from "@terrazzo/plugin-js"

export default defineConfig({
  tokens: ["./tokens/brand.tokens.json"],
  outDir: "./build/",
  plugins: [
    css({
      filename: "tokens.css",
      variableName: (token) => `--bib-${token.id.replaceAll(".", "-")}`,
    }),
    js({ filename: "tokens.js" }),
  ],
})
