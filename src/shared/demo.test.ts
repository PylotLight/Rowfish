import { describe, expect, test } from 'bun:test'
import { filterStorageEntries, makeCapture, SAMPLE_STORAGE_ENTRIES } from './demo'

describe('storage explorer demo', () => {
  test('search is case-insensitive and matches file details', () => {
    expect(filterStorageEntries(SAMPLE_STORAGE_ENTRIES, 'PDF').map((entry) => entry.name)).toEqual([
      'brand-guidelines.pdf'
    ])
  })

  test('blank search returns all entries', () => {
    expect(filterStorageEntries(SAMPLE_STORAGE_ENTRIES, '  ')).toHaveLength(SAMPLE_STORAGE_ENTRIES.length)
  })
})

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
