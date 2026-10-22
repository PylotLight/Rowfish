import { describe, expect, test } from 'bun:test'
import type { PostgresTableDetails } from '../../../shared/database'
import { getRowChanges, getSafeRowKey, isSameRow } from './row-editor'

const table = (dataType = 'integer'): PostgresTableDetails => ({
  schema: 'public',
  name: 'records',
  kind: 'table',
  indexes: [],
  constraints: [],
  columns: [
    {
      name: 'id',
      dataType,
      nullable: false,
      defaultValue: null,
      isPrimaryKey: true
    }
  ]
})

describe('row editor safety', () => {
  test('keeps large numeric keys as exact text', () => {
    expect(getSafeRowKey(table('bigint'), { id: '9007199254740993' })).toEqual({
      id: '9007199254740993'
    })
  })
  test('rejects lossy display keys', () => {
    expect(() =>
      getSafeRowKey(table('timestamp with time zone'), {
        id: '2026-01-01T00:00:00.000Z'
      })
    ).toThrow('safely identified')
    expect(() =>
      getSafeRowKey(table('bytea'), { id: '[binary 4 bytes]' })
    ).toThrow('safely identified')
    expect(() =>
      getSafeRowKey(table('text'), { id: 'a'.repeat(8192) })
    ).toThrow('safely identified')
    expect(() =>
      getSafeRowKey(table('bigint'), { id: 9007199254740992 })
    ).toThrow('safely identified')
  })
  test('requires every composite key component', () => {
    const composite = table()
    composite.columns.push({
      ...composite.columns[0]!,
      name: 'tenant',
      dataType: 'text'
    })
    expect(
      getSafeRowKey(composite, { id: 2, tenant: 'acme', other: 'ignore' })
    ).toEqual({ id: 2, tenant: 'acme' })
    expect(() => getSafeRowKey(composite, { id: 2 })).toThrow()
    expect(
      isSameRow(
        composite,
        { id: 2, tenant: 'acme' },
        { id: '2', tenant: 'other' }
      )
    ).toBe(false)
    expect(
      isSameRow(
        composite,
        { id: 2, tenant: 'acme' },
        { id: '2', tenant: 'acme' }
      )
    ).toBe(true)
  })
  test('no primary key never identifies rows', () => {
    const noKey = { ...table(), columns: [] }
    expect(() => getSafeRowKey(noKey, {})).toThrow('primary key')
    expect(isSameRow(noKey, {}, {})).toBe(false)
  })
  test('only sends changed editable fields and distinguishes NULL from empty', () => {
    const columns = [
      { name: 'id', editable: false },
      { name: 'name', editable: true },
      { name: 'note', editable: true }
    ]
    expect(
      getRowChanges(
        { id: '1', name: null, note: '' },
        { id: '2', name: '', note: null },
        columns
      )
    ).toEqual({ name: '', note: null })
    expect(
      getRowChanges({ name: 'same' }, { name: 'same' }, columns.slice(1, 2))
    ).toEqual({})
  })
})
