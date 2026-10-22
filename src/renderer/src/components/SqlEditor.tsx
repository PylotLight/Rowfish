import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import { basicSetup } from 'codemirror'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import {
  sql,
  PostgreSQL,
  MySQL,
  schemaCompletionSource,
  keywordCompletionSource
} from '@codemirror/lang-sql'
import { acceptCompletion, autocompletion } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import {
  defaultKeymap,
  historyKeymap,
  indentWithTab
} from '@codemirror/commands'
import { getSqlStatement } from '../lib/query-workspace'

export interface SqlEditorProps {
  value: string
  onChange: (value: string) => void
  onRun: (query?: string) => void
  disabled?: boolean
  kind?: 'postgres' | 'mongodb'
  tables?: { schema: string; name: string; columns?: string[] }[]
  onSelectionChange?: (selection: string) => void
}

const syntaxColors = syntaxHighlighting(
  HighlightStyle.define([
    { tag: tags.keyword, color: '#c4a2f5' },
    { tag: tags.string, color: '#91d5b6' },
    { tag: tags.number, color: '#ecc48b' },
    { tag: tags.comment, color: '#72839c', fontStyle: 'italic' },
    { tag: tags.operator, color: '#8dbbe9' },
    { tag: tags.name, color: '#d6e4f3' }
  ])
)

const theme = EditorView.theme(
  {
    '&': {
      height: '100%',
      minHeight: '0',
      color: 'var(--editor-text, #d7e1ec)',
      backgroundColor: 'var(--editor-bg, #111923)',
      fontSize: 'var(--editor-font-size, 14px)'
    },
    '.cm-scroller': {
      overflow: 'auto',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeight: '1.6'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--editor-bg, #111923)',
      color: 'var(--editor-gutter, #718096)',
      border: 'none'
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--editor-active-line, #ffffff08)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--editor-active-line, #ffffff08)'
    },
    '.cm-cursor': { borderLeftColor: '#79b8ff' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--editor-selection, #264f78) !important'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--editor-tooltip, #182330)',
      border: '1px solid #334155',
      color: 'var(--editor-text, #d7e1ec)'
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--editor-selection, #26384b)'
    }
  },
  { dark: true }
)

const languageCompartment = new Compartment()
const schemaCompartment = new Compartment()
const editableCompartment = new Compartment()

function schemaConfig(
  tables: SqlEditorProps['tables'],
  dialect: typeof PostgreSQL
) {
  const schema: Record<
    string,
    Record<string, readonly string[]>
  > = Object.create(null)
  for (const { schema: schemaName, name, columns = [] } of tables ?? []) {
    const tablesInSchema = (schema[schemaName] ??= Object.create(null))
    tablesInSchema[name] = columns
  }
  return { dialect, schema, defaultSchema: 'public' }
}

export default function SqlEditor({
  value,
  onChange,
  onRun,
  disabled = false,
  kind = 'postgres',
  tables = [],
  onSelectionChange
}: SqlEditorProps): React.JSX.Element {
  const container = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const latest = useRef({ onChange, onRun, onSelectionChange, disabled })
  latest.current = { onChange, onRun, onSelectionChange, disabled }

  useEffect(() => {
    if (!container.current) return
    const dialect = kind === 'postgres' ? PostgreSQL : MySQL
    const schema = schemaConfig(tables, dialect)
    const language =
      kind === 'mongodb' ? json() : sql({ ...schema, upperCaseKeywords: true })
    const runKeymap = keymap.of([
      {
        key: 'Mod-Enter',
        run: (editor) => {
          if (latest.current.disabled) return true
          const selection = editor.state.selection.main
          const selected = editor.state
            .sliceDoc(selection.from, selection.to)
            .trim()
          latest.current.onRun(
            selected ||
              getSqlStatement(editor.state.doc.toString(), selection.head)
          )
          return true
        }
      },
      {
        key: 'Mod-Shift-Enter',
        run: (editor) => {
          if (latest.current.disabled) return true
          latest.current.onRun(editor.state.doc.toString())
          return true
        }
      }
    ])
    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        syntaxColors,
        languageCompartment.of(language),
        schemaCompartment.of(
          kind === 'mongodb'
            ? []
            : autocompletion({
                override: [
                  schemaCompletionSource(schema),
                  keywordCompletionSource(dialect, true)
                ]
              })
        ),
        editableCompartment.of(EditorView.editable.of(!disabled)),
        runKeymap,
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          { key: 'Tab', run: acceptCompletion },
          indentWithTab
        ]),
        theme,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged)
            latest.current.onChange(update.state.doc.toString())
          if (update.selectionSet || update.docChanged) {
            const selection = update.state.selection.main
            latest.current.onSelectionChange?.(
              update.state.sliceDoc(selection.from, selection.to)
            )
          }
        })
      ]
    })
    view.current = new EditorView({ state, parent: container.current })
    view.current.contentDOM.setAttribute(
      'aria-label',
      kind === 'mongodb' ? 'MongoDB query editor' : 'SQL query editor'
    )
    view.current.contentDOM.setAttribute('role', 'textbox')
    view.current.contentDOM.setAttribute('aria-multiline', 'true')
    return () => {
      view.current?.destroy()
      view.current = null
    }
    // Initial editor creation is stable; changing kind updates its language compartment below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const editor = view.current
    if (!editor) return
    const dialect = kind === 'postgres' ? PostgreSQL : MySQL
    const schema = schemaConfig(tables, dialect)
    editor.dispatch({
      effects: [
        languageCompartment.reconfigure(
          kind === 'mongodb'
            ? json()
            : sql({ ...schema, upperCaseKeywords: true })
        ),
        schemaCompartment.reconfigure(
          kind === 'mongodb'
            ? []
            : autocompletion({
                override: [
                  schemaCompletionSource(schema),
                  keywordCompletionSource(dialect, true)
                ]
              })
        )
      ]
    })
    editor.contentDOM.setAttribute(
      'aria-label',
      kind === 'mongodb' ? 'MongoDB query editor' : 'SQL query editor'
    )
  }, [kind, tables])

  useEffect(() => {
    const editor = view.current
    if (editor)
      editor.dispatch({
        effects: editableCompartment.reconfigure(
          EditorView.editable.of(!disabled)
        )
      })
  }, [disabled])

  useEffect(() => {
    const editor = view.current
    if (editor && editor.state.doc.toString() !== value)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: value }
      })
  }, [value])

  return (
    <div
      ref={container}
      className="rowfish-sql-editor sql-editor"
      style={{
        flex: '1 1 0',
        minHeight: 90,
        overflow: 'hidden',
        opacity: disabled ? 0.65 : 1
      }}
    />
  )
}
