import { describe, expect, test } from 'bun:test'
import { DATABASE_LIMITS, getVirtualRowRange, isValidRowLimit, parseMongoFilter } from './database-helpers'

describe('database query guards', () => {
  test('accepts only whole row limits inside the configured bounds', () => {
    expect(isValidRowLimit(DATABASE_LIMITS.minRows)).toBe(true)
    expect(isValidRowLimit(DATABASE_LIMITS.maxRows)).toBe(true)
    expect(isValidRowLimit(0)).toBe(false)
    expect(isValidRowLimit(DATABASE_LIMITS.maxRows + 1)).toBe(false)
    expect(isValidRowLimit(1.5)).toBe(false)
    expect(isValidRowLimit('100')).toBe(false)
  })

  test('accepts a MongoDB document filter', () => {
    expect(parseMongoFilter('{"status":"active","rank":{"$gte":3}}')).toEqual({
      status: 'active',
      rank: { $gte: 3 }
    })
  })

  test('rejects MongoDB scalar/array filters and nested JavaScript execution', () => {
    expect(() => parseMongoFilter('[]')).toThrow('must be a JSON object')
    expect(() => parseMongoFilter('"active"')).toThrow('must be a JSON object')
    expect(() => parseMongoFilter('{"$or":[{"status":"active"},{"$where":"return true"}]}')).toThrow('$where')
  })
})

describe('virtual result window', () => {
  test('keeps the rendered slice bounded and adds overscan around the viewport', () => {
    expect(getVirtualRowRange(10_000, 0, 360)).toEqual({ start: 0, end: 18 })
    expect(getVirtualRowRange(10_000, 180_000, 360)).toEqual({ start: 4_992, end: 5_018 })
    expect(getVirtualRowRange(3, 99_999, 360)).toEqual({ start: 3, end: 3 })
  })

  test('normalizes negative positions and dimensions', () => {
    expect(getVirtualRowRange(-1, -10, -20, 0, -1)).toEqual({ start: 0, end: 0 })
  })
})
