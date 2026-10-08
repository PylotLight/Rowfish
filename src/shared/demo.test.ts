import { describe, expect, test } from 'bun:test'
import { makeCapture } from './demo'

describe('quick capture demo', () => {
  test('creates a title from the first markdown line', () => {
    expect(makeCapture('# Ship the Mac build\nCheck arm64 and x64', 42)).toEqual({
      id: 'capture-42',
      title: 'Ship the Mac build',
      body: '# Ship the Mac build\nCheck arm64 and x64',
      createdAt: 42
    })
  })

  test('does not create a capture from whitespace', () => {
    expect(makeCapture('   ')).toBeNull()
  })
})
