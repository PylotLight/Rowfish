import { describe, expect, test } from 'bun:test'
import { DATABASE_LIMITS, getVirtualRowRange, isValidRowLimit, parseMongoConnectionString, parseMongoFilter, parseMongoPipeline, quotePostgresIdentifier } from './database-helpers'

describe('database query guards', () => {
  test('quotes table-browser identifiers without allowing SQL injection', () => {
    expect(quotePostgresIdentifier('sales')).toBe('"sales"')
    expect(quotePostgresIdentifier('odd"; DROP TABLE users;--')).toBe('"odd""; DROP TABLE users;--"')
  })

  test('parses MongoDB direct and SRV connection strings without exposing credentials', () => {
    expect(parseMongoConnectionString('mongodb://user:secret@db.example:27018/rowfish?authSource=admin')).toEqual({
      host: 'db.example', port: 27018, database: 'rowfish'
    })
    expect(parseMongoConnectionString('mongodb+srv://user:secret@cluster.example/')).toEqual({
      host: 'cluster.example', port: 27017, database: 'admin'
    })
    expect(parseMongoConnectionString('mongodb://db-a.example:27018,db-b.example:27019/rowfish?replicaSet=rs0')).toEqual({
      host: 'db-a.example,db-b.example', port: 27018, database: 'rowfish'
    })
    expect(() => parseMongoConnectionString('https://db.example/rowfish')).toThrow('mongodb://')
    expect(() => parseMongoConnectionString('mongodb+srv://cluster.example:27017/db')).toThrow('must not specify a port')
  })

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

  test('accepts read-only MongoDB aggregation pipelines and blocks writes or server-side JavaScript', () => {
    expect(parseMongoPipeline('[{"$match":{"status":"active"}},{"$limit":20}]')).toEqual([
      { $match: { status: 'active' } }, { $limit: 20 }
    ])
    expect(() => parseMongoPipeline('{}')).toThrow('array of pipeline stage objects')
    expect(() => parseMongoPipeline('[{"$out":"archive"}]')).toThrow('$out')
    expect(() => parseMongoPipeline('[{"$facet":{"items":[{"$merge":"archive"}]}}]')).toThrow('$merge')
    expect(() => parseMongoPipeline('[{"$project":{"computed":{"$function":{"body":"return 1"}}}}]')).toThrow('server-side JavaScript')
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
