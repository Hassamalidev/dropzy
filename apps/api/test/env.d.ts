declare module 'cloudflare:workers' {
  interface ProvidedEnv extends import('../src/env').Env {}
}
