import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertCircle, CheckCircle2, Download, FileUp, RotateCcw } from 'lucide-react'
import {
  IMPORT_FIELDS,
  IMPORT_OBJECTS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  decodeCsvBytes,
  guessMapping,
  mapRow,
  missingRequired,
  parseCsv,
  type Import,
  type ImportDetail,
  type ImportField,
  type ImportObject,
} from '@crm/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/records/ConfirmDialog'
import { NativeSelect } from '@/components/NativeSelect'
import { dataApi, downloadCsv, useDataMutation, useImport, useImports } from '@/lib/data'
import { errorMessage } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

type Loaded = { name: string; text: string; header: string[]; rows: string[][] }

const PREVIEW_ROWS = 5
const LIST_PATHS: Record<ImportObject, string> = { contacts: '/contacts', companies: '/companies', deals: '/deals' }

export function ImportPage() {
  const { t } = useTranslation()
  const [params, setParams] = useSearchParams()
  const object = (IMPORT_OBJECTS as readonly string[]).includes(params.get('object') ?? '') ? (params.get('object') as ImportObject) : 'contacts'
  const [file, setFile] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<Array<ImportField | null>>([])
  const [mode, setMode] = useState<'skip' | 'update'>('skip')
  // The import being shown lives in the URL, so a reload or a link from the history keeps it.
  const importId = params.get('id')
  const start = useDataMutation(dataApi.startImport)

  const chooseObject = (next: ImportObject) => {
    setParams({ object: next }, { replace: true })
    if (file) setMapping(guessMapping(next, file.header))
  }

  const readFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_IMPORT_BYTES) return toast.error(t('import.tooBig', { mb: MAX_IMPORT_BYTES / 1024 / 1024 }))
    const text = decodeCsvBytes(await f.arrayBuffer())
    const { header, rows } = parseCsv(text)
    if (!header.length || !rows.length) return toast.error(t('import.emptyFile'))
    if (rows.length > MAX_IMPORT_ROWS) return toast.error(t('import.tooManyRows', { max: MAX_IMPORT_ROWS }))
    setFile({ name: f.name, text, header, rows })
    setMapping(guessMapping(object, header))
  }

  const missing = file ? missingRequired(object, mapping) : []
  const fields = IMPORT_FIELDS[object] as readonly ImportField[]

  const begin = () =>
    start.mutate(
      { object, fileName: file!.name, csv: file!.text, mapping, mode },
      {
        onSuccess: ({ id }) => {
          setFile(null)
          setParams({ object, id }, { replace: true })
        },
        onError: (err) => toast.error(errorMessage(t, err)),
      },
    )

  return (
    <div className="mx-auto grid max-w-4xl grid-cols-1 gap-6">
      <header>
        <h1 className="text-lg font-semibold">{t('import.title')}</h1>
        <p className="text-muted-foreground">{t('import.intro')}</p>
      </header>

      {importId ? (
        <ImportResult id={importId} onAnother={() => setParams({ object }, { replace: true })} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>{t('import.step1')}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="import-object">{t('import.what')}</Label>
                <NativeSelect id="import-object" value={object} onChange={(e) => chooseObject(e.target.value as ImportObject)}>
                  {IMPORT_OBJECTS.map((o) => (
                    <option key={o} value={o}>
                      {t(`import.objects.${o}`)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="import-file">{t('import.file')}</Label>
                <Input id="import-file" type="file" accept=".csv,text/csv,text/plain" onChange={(e) => readFile(e.target.files?.[0])} />
              </div>
              <p className="text-muted-foreground text-sm sm:col-span-2">
                {t('import.fileHint')}{' '}
                {object === 'contacts' && (
                  <a className="underline" href="/samples/kontakter-500.csv" download>
                    {t('import.sample')}
                  </a>
                )}
              </p>
            </CardContent>
          </Card>

          {file && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('import.step2', { count: file.rows.length, name: file.name })}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('import.column')}</TableHead>
                        <TableHead>{t('import.example')}</TableHead>
                        <TableHead className="w-56">{t('import.field')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {file.header.map((h, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-medium">{h || t('import.unnamed', { n: i + 1 })}</TableCell>
                          <TableCell className="text-muted-foreground max-w-48 truncate">{file.rows.find((r) => r[i]?.trim())?.[i] ?? ''}</TableCell>
                          <TableCell>
                            <NativeSelect
                              aria-label={t('import.fieldFor', { column: h || i + 1 })}
                              value={mapping[i] ?? ''}
                              onChange={(e) => {
                                const value = (e.target.value || null) as ImportField | null
                                // A field can only take one column: the column that had it before is cleared.
                                setMapping((m) => m.map((x, j) => (j === i ? value : x === value ? null : x)))
                              }}
                            >
                              <option value="">{t('import.skip')}</option>
                              {fields.map((f) => (
                                <option key={f} value={f}>
                                  {t(`import.fields.${f}`)}
                                </option>
                              ))}
                            </NativeSelect>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {missing.length > 0 && (
                  <p role="alert" className="text-destructive flex items-center gap-2 text-sm">
                    <AlertCircle className="size-4" aria-hidden />
                    {t('import.missing', { fields: missing.map((f) => t(`import.fields.${f}`)).join(', ') })}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {file && missing.length === 0 && (
            <Card>
              <CardHeader>
                <CardTitle>
                  <h2>{t('import.step3')}</h2>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-5">
                <Preview object={object} file={file} mapping={mapping} />
                <fieldset className="grid gap-2">
                  <legend className="mb-1 text-sm font-medium">{t('import.existing')}</legend>
                  {(['skip', 'update'] as const).map((m) => (
                    <label key={m} className="flex items-start gap-2 text-sm">
                      <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
                      <span>
                        {t(`import.modes.${m}`)}
                        <span className="text-muted-foreground block">{t(`import.modeHints.${object}.${m}`)}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
                <Button className="justify-self-start" onClick={begin} disabled={start.isPending}>
                  <FileUp className="size-4" aria-hidden />
                  {t('import.start', { count: file.rows.length })}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <History />
    </div>
  )
}

// The first rows as they will be imported, checked with the same rules as the import itself.
function Preview({ object, file, mapping }: { object: ImportObject; file: Loaded; mapping: Array<ImportField | null> }) {
  const { t } = useTranslation()
  const used = mapping.filter((f): f is ImportField => !!f)
  return (
    <div className="overflow-x-auto">
      <Table aria-label={t('import.previewLabel')}>
        <TableHeader>
          <TableRow>
            <TableHead className="w-12">#</TableHead>
            {used.map((f) => (
              <TableHead key={f}>{t(`import.fields.${f}`)}</TableHead>
            ))}
            <TableHead>{t('import.check')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {file.rows.slice(0, PREVIEW_ROWS).map((row, r) => {
            const { issues, notices } = mapRow(object, mapping, row)
            return (
              <TableRow key={r}>
                <TableCell className="text-muted-foreground">{r + 1}</TableCell>
                {used.map((f) => (
                  <TableCell key={f} className={cn('max-w-40 truncate', issues.some((i) => i.field === f) && 'text-destructive font-medium')}>
                    {row[mapping.indexOf(f)]}
                  </TableCell>
                ))}
                <TableCell>
                  {issues.length ? (
                    <span className="text-destructive text-sm">{issueText(t, issues[0]!.field ?? null, issues[0]!.code)}</span>
                  ) : notices.length ? (
                    <span className="text-muted-foreground text-sm">{issueText(t, notices[0]!.field ?? null, notices[0]!.code)}</span>
                  ) : (
                    <CheckCircle2 className="size-4 text-green-600" aria-label={t('import.rowOk')} />
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

type T = ReturnType<typeof useTranslation>['t']
// Rows that were skipped or imported with a change, not rows that failed.
const NOT_FAILURES = new Set(['duplicate_in_file', 'imported_as_private'])
const issueText = (t: T, field: string | null, code: string) =>
  t(`import.errors.${code}`, { defaultValue: t('import.errors.invalid'), field: field ? t(`import.fields.${field}`, { defaultValue: field }) : '' })

function ImportResult({ id, onAnother }: { id: string; onAnother: () => void }) {
  const { t } = useTranslation()
  const result = useImport(id)
  const i = result.data
  if (!i) return <Card><CardContent className="py-6">{t('common.loading')}</CardContent></Card>
  const running = i.status === 'queued' || i.status === 'running'
  const percent = i.total ? Math.round((i.processed / i.total) * 100) : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{running ? t('import.running', { name: i.fileName }) : t(`import.statuses.${i.status}`, { name: i.fileName })}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        {running ? (
          <div className="grid gap-2">
            <div className="bg-muted h-2 overflow-hidden rounded-full" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('import.progress')}>
              <div className="bg-primary h-full transition-all" style={{ width: `${percent}%` }} />
            </div>
            <p className="text-muted-foreground text-sm">{t('import.processed', { done: i.processed, total: i.total })}</p>
          </div>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label={t('import.summary')}>
              {(['created', 'updated', 'skipped', 'failed'] as const).map((k) => (
                <div key={k} className={cn('rounded-md border p-3', k === 'failed' && i.failed > 0 && 'border-destructive/50')}>
                  <dt className="text-muted-foreground text-sm">{t(`import.counts.${k}`)}</dt>
                  <dd className={cn('text-2xl font-semibold tabular-nums', k === 'failed' && i.failed > 0 && 'text-destructive')}>{i[k]}</dd>
                </div>
              ))}
            </dl>
            {i.errors.length > 0 && <ErrorReport detail={i} />}
            <div className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={LIST_PATHS[i.object]}>{t(`import.open.${i.object}`)}</Link>
              </Button>
              <Button variant="outline" onClick={onAnother}>
                {t('import.another')}
              </Button>
              {i.status !== 'undone' && <UndoButton imp={i} />}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function ErrorReport({ detail }: { detail: ImportDetail }) {
  const { t } = useTranslation()
  const download = () =>
    downloadCsv(
      `${detail.fileName.replace(/\.csv$/i, '')}-${t('import.errorsFile')}.csv`,
      [t('import.row'), t('import.problem'), ...detail.header],
      detail.errors.map((e) => [e.row, issueText(t, e.field, e.code), ...e.values]),
    )
  return (
    <section className="grid gap-2" aria-labelledby="import-errors">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="import-errors" className="font-medium">
          {t('import.errorsTitle', { count: detail.errors.length })}
        </h3>
        <Button variant="outline" size="sm" onClick={download}>
          <Download className="size-4" aria-hidden />
          {t('import.downloadErrors')}
        </Button>
      </div>
      <div className="max-h-80 overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">{t('import.row')}</TableHead>
              <TableHead>{t('import.problem')}</TableHead>
              <TableHead>{t('import.values')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detail.errors.map((e) => (
              <TableRow key={`${e.row}-${e.code}`}>
                <TableCell>{e.row}</TableCell>
                <TableCell className={NOT_FAILURES.has(e.code) ? 'text-muted-foreground' : 'text-destructive'}>{issueText(t, e.field, e.code)}</TableCell>
                <TableCell className="text-muted-foreground max-w-80 truncate">{e.values.filter(Boolean).join(' · ')}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function UndoButton({ imp }: { imp: Import }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const undo = useDataMutation(dataApi.undoImport)
  if (imp.status !== 'done' && imp.status !== 'failed') return null
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RotateCcw className="size-4" aria-hidden />
        {t('import.undo')}
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('import.undoTitle')}
        description={t('import.undoBody', { created: imp.created, updated: imp.updated })}
        confirmLabel={t('import.undo')}
        pending={undo.isPending}
        onConfirm={() =>
          undo.mutate(imp.id, {
            onSuccess: () => {
              setOpen(false)
              toast.success(t('import.undone'))
            },
            onError: (err) => toast.error(errorMessage(t, err)),
          })
        }
      />
    </>
  )
}

function History() {
  const { t, i18n } = useTranslation()
  const imports = useImports()
  const [, setParams] = useSearchParams()
  if (!imports.data?.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t('import.history')}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {imports.data.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <button type="button" className="grid min-w-0 text-left hover:underline" onClick={() => setParams({ object: i.object, id: i.id })}>
                <span className="truncate font-medium">{i.fileName}</span>
                <span className="text-muted-foreground text-xs">
                  {t(`import.objects.${i.object}`)} · {formatDateTime(i.createdAt, i18n.language)}
                  {i.createdBy && ` · ${i.createdBy}`}
                </span>
              </button>
              <span className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">{t('import.short', { created: i.created, failed: i.failed })}</span>
                <Badge variant={i.status === 'undone' || i.status === 'failed' ? 'secondary' : 'outline'}>{t(`import.badges.${i.status}`)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
