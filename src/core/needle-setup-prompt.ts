/**
 * The prompt the Setup dialog copies for the Needle add-on: a local, offline tool-calling model.
 * Plain text (no cv: words), every path explicit, and the agent asks before it writes anything.
 */
export function buildNeedleSetupPrompt(configPath: string): string {
  return `Set up the optional Needle add-on for Corvoid Hub, my Tauri desktop dashboard for AI projects.

What it is: Needle (Cactus Compute, "Needle 3") turns one sentence typed in Ctrl+K into one of the app's actions. It runs fully offline on my machine, telemetry off. The app starts it as a sidecar (addons/needle/needle_serve.py, already bundled with the app) and only needs two paths in its config.

Ask me for one folder to keep the add-on in (for example D:\\Tools\\needle) and use it below as <folder>. Ask before you write or download anything.

1. Create a virtual environment:
   python -m venv <folder>\\venv
   Use the Python on PATH (3.10 or newer).
2. Install the runtime:
   <folder>\\venv\\Scripts\\python.exe -m pip install --upgrade pip cactus-compute
3. Download the weights into <folder>\\models\\needle3.cact from
   https://huggingface.co/Cactus-Compute/needle3
   (huggingface-cli download Cactus-Compute/needle3, or the file from the repo page; it is about 35 MB).
4. Warm the engine cache once, so the app never needs the network. Run it with the cache next to the weights:
   set CACTUS_TELEMETRY=0
   set HF_HUB_OFFLINE=1
   set XDG_CACHE_HOME=<folder>\\cache
   set HF_HOME=<folder>\\cache\\hf
   <folder>\\venv\\Scripts\\python.exe -I -c "import cactus"
5. Check the install without writing anything:
   <folder>\\venv\\Scripts\\python.exe -I -c "import cactus; print('needle ok')"
   It must not download anything.
6. Write these two keys into ${configPath}, keeping every other key exactly as it is:
   "needlePython": "<folder>\\\\venv\\\\Scripts\\\\python.exe",
   "needleWeights": "<folder>\\\\models\\\\needle3.cact"
   Back the file up first (for example corvoid-hub.json.bak-YYYYMMDD-HHMMSS next to it).
7. Tell me it is done. I open Hub > Add-ons and press Test.

Rules: no paid services, no network after the weights are on disk (CACTUS_TELEMETRY=0, HF_HUB_OFFLINE=1), and never modify my vault or hub files. If a step fails, tell me the error and stop.`
}
