import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rolldownOptions: {
      input: { main: "index.html", validation: "validation.html" },
    },
  },
});
