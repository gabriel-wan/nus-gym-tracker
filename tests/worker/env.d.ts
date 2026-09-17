import type { Env as WorkerEnv } from "../../src/index";

// `cloudflare:test` types its `env` as `Cloudflare.Env`, so that is the global
// to augment. Without this, tests see an empty env and every binding is an
// error even though it exists at runtime.
declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
  }
}
