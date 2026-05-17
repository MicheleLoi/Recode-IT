// __GIT_SHA__ is injected at build time by vite.config.ts via `define`.
declare const __GIT_SHA__: string

export const GIT_SHA: string = typeof __GIT_SHA__ === 'string' ? __GIT_SHA__ : 'dev'
