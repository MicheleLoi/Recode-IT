import { describe, it, expect } from 'vitest'
import { ENGINE_VERSION, engineGreeting } from './index'

describe('engine scaffold (Phase 0)', () => {
  it('exposes a version string', () => {
    expect(ENGINE_VERSION).toMatch(/^0\.1\.0/)
  })

  it('engineGreeting interpolates the supplied name', () => {
    expect(engineGreeting('world')).toContain('hello world')
    expect(engineGreeting('world')).toContain(ENGINE_VERSION)
  })
})
