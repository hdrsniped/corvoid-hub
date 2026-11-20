import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App.tsx"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { loadConfig } from "@/core/config"
import { ExternalLinkGuard } from "./components/external-link-guard.tsx"

// The hub and vault paths come from Rust (corvoid-hub.json) once, before the first render.
loadConfig()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <ThemeProvider>
          <ExternalLinkGuard />
          <App />
        </ThemeProvider>
      </StrictMode>
    )
  })
  .catch((e: unknown) => {
    const root = document.getElementById("root")!
    root.textContent = `Could not read the app config: ${e instanceof Error ? e.message : String(e)}`
    root.className = "p-6 text-sm text-destructive"
  })
