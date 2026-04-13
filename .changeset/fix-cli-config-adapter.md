---
"oakbun": patch
---

fix(cli): load oak.config.ts instead of veln.config.ts, use config.adapter directly, and scan *.db files

- `loadConfig()` now checks `oak.config.ts` / `oak.config.js` first (veln.config.* kept for backwards compat)
- `loadAdapter()` uses `config.adapter` directly if provided in config
- Glob extended from `*.sqlite` to `*.{sqlite,db}`
- `VelnConfig` now has an `adapter` field
