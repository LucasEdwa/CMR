import Papa from 'papaparse'
import { z } from 'zod'
import { CURRENCIES } from './auth.js'
import { COMPANY_SIZES, LIFECYCLE_STAGES, createCompanySchema, createContactSchema } from './crm.js'
import { parseMoney } from './money.js'

// ---- CSV ---------------------------------------------------------------------------

// Excel in Sweden expects semicolons, and a UTF-8 BOM to read å, ä and ö correctly.
export const CSV_BOM = '﻿'

// A cell starting with = + - @ (or a tab/CR) is run as a formula by Excel: prefix it with '.
const FORMULA_START = /^[=+\-@\t\r]/
const safeCell = (value: unknown) => {
  const s = value === null || value === undefined ? '' : String(value)
  return FORMULA_START.test(s) && !/^-\d/.test(s) ? `'${s}` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return CSV_BOM + Papa.unparse({ fields: header.map(safeCell), data: rows.map((r) => r.map(safeCell)) }, { delimiter: ';', newline: '\r\n', quotes: false })
}

export type ParsedCsv = { header: string[]; rows: string[][]; delimiter: string }

// Accepts semicolon, comma or tab separated files with a header row. Empty lines are dropped.
export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', delimitersToGuess: [';', ',', '\t'] })
  const [header = [], ...rows] = result.data
  return { header: header.map((h) => h.trim()), rows, delimiter: result.meta.delimiter }
}

// Files saved by Excel on Windows are often Windows-1252, not UTF-8.
export function decodeCsvBytes(bytes: ArrayBuffer | Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// ---- import fields ---------------------------------------------------------------------

export const IMPORT_OBJECTS = ['contacts', 'companies', 'deals'] as const
export type ImportObject = (typeof IMPORT_OBJECTS)[number]

export const IMPORT_FIELDS = {
  contacts: ['firstName', 'lastName', 'fullName', 'email', 'phone', 'mobilePhone', 'title', 'company', 'lifecycleStage', 'leadSource', 'street', 'postalCode', 'city', 'country', 'tags', 'owner'],
  companies: ['name', 'orgNumber', 'vatNumber', 'domain', 'industry', 'size', 'phone', 'street', 'postalCode', 'city', 'country', 'tags', 'owner'],
  deals: ['name', 'value', 'currency', 'pipeline', 'stage', 'status', 'expectedCloseDate', 'company', 'contactEmail', 'owner'],
} as const satisfies Record<ImportObject, readonly string[]>
export type ImportField = (typeof IMPORT_FIELDS)[ImportObject][number]

// Fields that must be mapped before an import can start.
export const REQUIRED_FIELDS: Record<ImportObject, ImportField[][]> = {
  // Either a first name or a full name.
  contacts: [['firstName', 'fullName']],
  companies: [['name']],
  deals: [['name']],
}

// Lowercase letters and digits only: "E-post" and "e post" both become "epost".
export const normalizeLabel = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^a-z0-9åäöéü]+/g, '')

const ADDRESS_ALIASES = {
  street: ['gatuadress', 'adress', 'gata', 'street', 'address', 'streetaddress', 'besöksadress', 'postadress'],
  postalCode: ['postnummer', 'postnr', 'postalcode', 'zip', 'zipcode', 'postcode'],
  city: ['ort', 'stad', 'postort', 'city', 'town'],
  country: ['land', 'country', 'landskod', 'countrycode'],
}

const ALIASES: Record<ImportObject, Partial<Record<ImportField, string[]>>> = {
  contacts: {
    firstName: ['förnamn', 'firstname', 'givenname', 'first'],
    lastName: ['efternamn', 'lastname', 'surname', 'familyname', 'last'],
    fullName: ['namn', 'name', 'fullständigtnamn', 'fullname', 'kontaktperson', 'kontakt', 'contact', 'contactname'],
    email: ['epost', 'epostadress', 'email', 'emailaddress', 'mail', 'mejl'],
    phone: ['telefon', 'tel', 'telefonnummer', 'phone', 'phonenumber', 'arbetstelefon', 'workphone', 'direktnummer'],
    mobilePhone: ['mobil', 'mobiltelefon', 'mobilnummer', 'mobile', 'mobilephone', 'cell', 'cellphone'],
    title: ['titel', 'befattning', 'roll', 'title', 'jobtitle', 'position'],
    company: ['företag', 'företagsnamn', 'bolag', 'organisation', 'company', 'companyname', 'organization', 'account'],
    lifecycleStage: ['livscykel', 'livscykelfas', 'fas', 'lifecyclestage', 'lifecycle'],
    leadSource: ['källa', 'leadkälla', 'leadsource', 'source'],
    tags: ['taggar', 'tagg', 'etiketter', 'tags', 'tag', 'labels'],
    owner: ['ägare', 'ansvarig', 'säljare', 'owner', 'assignedto', 'salesrep'],
    ...ADDRESS_ALIASES,
  },
  companies: {
    name: ['namn', 'företag', 'företagsnamn', 'bolag', 'name', 'company', 'companyname', 'organisation', 'organization'],
    orgNumber: ['organisationsnummer', 'orgnr', 'orgnummer', 'orgno', 'organisationsnr', 'orgnumber', 'registrationnumber'],
    vatNumber: ['momsnummer', 'momsregistreringsnummer', 'vatnummer', 'vat', 'vatnumber', 'vatno'],
    domain: ['domän', 'webbplats', 'hemsida', 'webb', 'domain', 'website', 'web', 'url'],
    industry: ['bransch', 'industry', 'sector', 'sektor'],
    size: ['storlek', 'antalanställda', 'anställda', 'size', 'employees', 'companysize'],
    phone: ['telefon', 'tel', 'växel', 'phone', 'phonenumber'],
    tags: ['taggar', 'tagg', 'etiketter', 'tags', 'tag'],
    owner: ['ägare', 'ansvarig', 'owner', 'assignedto'],
    ...ADDRESS_ALIASES,
  },
  deals: {
    name: ['namn', 'affär', 'affärsnamn', 'name', 'deal', 'dealname', 'opportunity', 'titel', 'title'],
    value: ['värde', 'belopp', 'summa', 'value', 'amount'],
    currency: ['valuta', 'currency'],
    pipeline: ['pipeline', 'säljprocess'],
    stage: ['steg', 'fas', 'stage', 'dealstage'],
    status: ['status', 'state'],
    expectedCloseDate: ['förväntatavslut', 'avslutsdatum', 'stängningsdatum', 'closedate', 'expectedclosedate', 'expectedclose'],
    company: ['företag', 'bolag', 'kund', 'company', 'account', 'organization'],
    contactEmail: ['kontaktepost', 'epost', 'email', 'contactemail', 'kontakt', 'contact'],
    owner: ['ägare', 'ansvarig', 'säljare', 'owner', 'assignedto'],
  },
}

// Suggests a field for each column from its header; each field is used at most once.
export function guessMapping(object: ImportObject, header: string[]): Array<ImportField | null> {
  const used = new Set<ImportField>()
  return header.map((h) => {
    const label = normalizeLabel(h)
    const fields = IMPORT_FIELDS[object] as readonly ImportField[]
    const match =
      fields.find((f) => !used.has(f) && normalizeLabel(f) === label) ??
      fields.find((f) => !used.has(f) && ALIASES[object][f]?.some((a) => normalizeLabel(a) === label))
    if (match) used.add(match)
    return match ?? null
  })
}

export function missingRequired(object: ImportObject, mapping: Array<ImportField | null>): ImportField[] {
  return REQUIRED_FIELDS[object].filter((anyOf) => !anyOf.some((f) => mapping.includes(f))).map((anyOf) => anyOf[0]!)
}

// ---- values -------------------------------------------------------------------------------

// Built-in values written the way people write them in spreadsheets (Swedish and English).
const VALUE_ALIASES = {
  lifecycleStage: {
    lead: ['lead'],
    mql: ['mql', 'marknadskvalificerad', 'marketingqualifiedlead', 'marketingqualified'],
    sql: ['sql', 'säljkvalificerad', 'salesqualifiedlead', 'salesqualified'],
    opportunity: ['affärsmöjlighet', 'opportunity', 'möjlighet'],
    customer: ['kund', 'customer', 'client'],
    evangelist: ['ambassadör', 'evangelist', 'promoter'],
    other: ['annat', 'övrigt', 'other'],
  },
  status: {
    open: ['öppen', 'pågående', 'open'],
    won: ['vunnen', 'vann', 'won', 'closedwon'],
    lost: ['förlorad', 'lost', 'closedlost'],
  },
  lead_source: {
    website: ['webbplats', 'hemsida', 'webb', 'website', 'web'],
    referral: ['rekommendation', 'tips', 'referral'],
    event: ['event', 'mässa', 'evenemang'],
    cold_outreach: ['uppsökande', 'kallsamtal', 'coldoutreach', 'coldcall'],
    social: ['socialamedier', 'linkedin', 'social', 'socialmedia'],
    partner: ['partner', 'återförsäljare'],
    other: ['annat', 'övrigt', 'other'],
  },
  industry: {
    it: ['itochtech', 'it', 'tech', 'mjukvara', 'software'],
    construction: ['bygg', 'byggnation', 'construction'],
    retail: ['handel', 'detaljhandel', 'retail'],
    manufacturing: ['tillverkning', 'industri', 'manufacturing'],
    consulting: ['konsult', 'konsulting', 'consulting'],
    real_estate: ['fastigheter', 'realestate'],
    transport: ['transportochlogistik', 'transport', 'logistik', 'logistics'],
    healthcare: ['vård', 'sjukvård', 'healthcare'],
    education: ['utbildning', 'education'],
    other: ['annat', 'övrigt', 'other'],
  },
} as const

function matchAlias<A extends Record<string, readonly string[]>>(aliases: A, value: string): (keyof A & string) | null {
  const v = normalizeLabel(value)
  for (const [key, list] of Object.entries(aliases) as Array<[keyof A & string, readonly string[]]>) {
    if (normalizeLabel(key) === v || list.some((a) => normalizeLabel(a) === v)) return key
  }
  return null
}

// Picklist value: a built-in key or label, else the text as written (workspace labels are matched by the API).
export const picklistValue = (kind: 'lead_source' | 'industry', value: string) => matchAlias(VALUE_ALIASES[kind], value) ?? value.trim()

export function parseSize(value: string) {
  const v = value.replace(/[–—\s]/g, '-').replace(/-+/g, '-').trim()
  if ((COMPANY_SIZES as readonly string[]).includes(v)) return v as (typeof COMPANY_SIZES)[number]
  const n = Number(value.replace(/\s/g, ''))
  if (!Number.isInteger(n) || n < 1) return null
  return n < 10 ? '1-9' : n < 50 ? '10-49' : n < 250 ? '50-249' : '250+'
}

// yyyy-mm-dd, yyyy/mm/dd, dd/mm/yyyy, dd.mm.yyyy or d-m-yyyy. Returns yyyy-mm-dd or null.
export function parseImportDate(value: string): string | null {
  const v = value.trim()
  let y: number, m: number, d: number
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v)
  if (match) [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else if ((match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(v))) [d, m, y] = [Number(match[1]), Number(match[2]), Number(match[3])]
  else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return date.toISOString().slice(0, 10)
}

export const splitList = (value: string) =>
  value
    .split(/[,;|]/)
    .map((s) => s.trim())
    .filter(Boolean)

// ---- rows -> records -------------------------------------------------------------------------

export type ImportIssue = { field?: ImportField | string; code: string }

// Names that the API resolves to ids (companies, members, pipelines, stages, contacts).
export type ImportRefs = { company?: string; owner?: string; pipeline?: string; stage?: string; contactEmail?: string }

export type MappedRow = { input: Record<string, unknown>; refs: ImportRefs; issues: ImportIssue[] }

// Only the fields the row provides, so updates never overwrite values with defaults.
const provided = (parsed: Record<string, unknown>, input: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(input).map((k) => [k, parsed[k]]))

function zodIssues(error: z.ZodError): ImportIssue[] {
  return error.issues.map((i) => ({ field: String(i.path[0] ?? ''), code: i.code === 'invalid_type' && i.input === undefined ? 'required' : 'invalid' }))
}

// Turns one CSV row into create input for the object, plus references to resolve and any problems.
// Used by the import job and by the preview in the browser, so both agree on what is valid.
export function mapRow(object: ImportObject, mapping: Array<ImportField | null>, values: string[]): MappedRow {
  const raw: Partial<Record<ImportField, string>> = {}
  mapping.forEach((field, i) => {
    const v = values[i]?.trim()
    if (field && v) raw[field] = v
  })
  const issues: ImportIssue[] = []
  const refs: ImportRefs = {}
  const input: Record<string, unknown> = {}
  const copy = (...fields: string[]) => fields.forEach((f) => raw[f as ImportField] !== undefined && (input[f] = raw[f as ImportField]))

  if (raw.owner) refs.owner = raw.owner.toLowerCase()
  if (raw.company) refs.company = raw.company

  if (object === 'contacts') {
    copy('firstName', 'lastName', 'email', 'phone', 'mobilePhone', 'title', 'street', 'postalCode', 'city', 'country')
    if (raw.fullName && !raw.firstName) {
      const parts = raw.fullName.split(/\s+/)
      input.firstName = parts[0]
      if (!raw.lastName) input.lastName = parts.slice(1).join(' ')
    }
    if (raw.lifecycleStage) {
      const stage = matchAlias(VALUE_ALIASES.lifecycleStage, raw.lifecycleStage)
      if (stage) input.lifecycleStage = stage
      else issues.push({ field: 'lifecycleStage', code: 'invalid' })
    }
    if (raw.leadSource) input.leadSource = picklistValue('lead_source', raw.leadSource)
    if (raw.tags) input.tags = splitList(raw.tags)
    if (raw.country) input.country = raw.country.length === 2 ? raw.country.toUpperCase() : raw.country
    const parsed = createContactSchema.safeParse(input)
    if (!parsed.success) issues.push(...zodIssues(parsed.error))
    return { input: parsed.success ? provided(parsed.data, input) : input, refs, issues }
  }

  if (object === 'companies') {
    copy('name', 'orgNumber', 'vatNumber', 'domain', 'phone', 'street', 'postalCode', 'city', 'country')
    if (raw.industry) input.industry = picklistValue('industry', raw.industry)
    if (raw.size) {
      const size = parseSize(raw.size)
      if (size) input.size = size
      else issues.push({ field: 'size', code: 'invalid' })
    }
    if (raw.tags) input.tags = splitList(raw.tags)
    const parsed = createCompanySchema.safeParse(input)
    if (!parsed.success) issues.push(...zodIssues(parsed.error))
    return { input: parsed.success ? provided(parsed.data, input) : input, refs, issues }
  }

  // deals: pipeline, stage, company, contact and owner are names resolved by the API.
  if (raw.name) input.name = raw.name
  else issues.push({ field: 'name', code: 'required' })
  if (raw.value) {
    const value = parseMoney(raw.value)
    if (value === null || value < 0) issues.push({ field: 'value', code: 'invalid' })
    else input.value = value
  }
  if (raw.currency) {
    const c = raw.currency.toUpperCase()
    if ((CURRENCIES as readonly string[]).includes(c)) input.currency = c
    else issues.push({ field: 'currency', code: 'invalid' })
  }
  if (raw.status) {
    const status = matchAlias(VALUE_ALIASES.status, raw.status)
    if (status) input.status = status
    else issues.push({ field: 'status', code: 'invalid' })
  }
  if (raw.expectedCloseDate) {
    const date = parseImportDate(raw.expectedCloseDate)
    if (date) input.expectedCloseDate = date
    else issues.push({ field: 'expectedCloseDate', code: 'invalid' })
  }
  if (raw.pipeline) refs.pipeline = raw.pipeline
  if (raw.stage) refs.stage = raw.stage
  if (raw.contactEmail) {
    const email = z.email().safeParse(raw.contactEmail.toLowerCase())
    if (email.success) refs.contactEmail = email.data
    else issues.push({ field: 'contactEmail', code: 'invalid' })
  }
  return { input, refs, issues }
}

// ---- import API ---------------------------------------------------------------------------

export const IMPORT_MODES = ['skip', 'update'] as const
export const IMPORT_STATUSES = ['queued', 'running', 'done', 'failed', 'undone'] as const
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024
export const MAX_IMPORT_ROWS = 50_000

export const createImportSchema = z.object({
  object: z.enum(IMPORT_OBJECTS),
  fileName: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(MAX_IMPORT_BYTES),
  // One entry per CSV column: the field it goes into, or null to skip the column.
  mapping: z.array(z.string().nullable()).max(200),
  // What to do with rows that match an existing record: leave it, or fill in the mapped values.
  mode: z.enum(IMPORT_MODES).default('skip'),
})
export type CreateImportInput = z.input<typeof createImportSchema>

export const importErrorSchema = z.object({
  // 1-based data row (the header is row 0).
  row: z.number().int(),
  field: z.string().nullable(),
  code: z.string(),
  values: z.array(z.string()),
})
export type ImportError = z.infer<typeof importErrorSchema>

export const importSchema = z.object({
  id: z.uuid(),
  object: z.enum(IMPORT_OBJECTS),
  fileName: z.string(),
  mode: z.enum(IMPORT_MODES),
  status: z.enum(IMPORT_STATUSES),
  header: z.array(z.string()),
  total: z.number().int(),
  processed: z.number().int(),
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  undoneAt: z.string().nullable(),
})
export type Import = z.infer<typeof importSchema>
export const importDetailSchema = importSchema.extend({ errors: z.array(importErrorSchema) })
export type ImportDetail = z.infer<typeof importDetailSchema>

// ---- search, recent, bulk, duplicates -----------------------------------------------------

export const searchHitSchema = z.object({ type: z.enum(['contact', 'company', 'deal']), id: z.uuid(), name: z.string(), detail: z.string().nullable() })
export type SearchHit = z.infer<typeof searchHitSchema>
export const searchResultSchema = z.object({ hits: z.array(searchHitSchema) })

export const bulkIds = z.array(z.uuid()).min(1).max(1000)
export const bulkContactsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: bulkIds }),
  z.object({
    action: z.literal('update'),
    ids: bulkIds,
    changes: z
      .object({
        ownerUserId: z.uuid().nullable().optional(),
        lifecycleStage: z.enum(LIFECYCLE_STAGES).optional(),
        addTags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      })
      .refine((c) => Object.values(c).some((v) => v !== undefined), 'no_changes'),
  }),
])
export const bulkCompaniesSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: bulkIds }),
  z.object({
    action: z.literal('update'),
    ids: bulkIds,
    changes: z
      .object({ ownerUserId: z.uuid().nullable().optional(), addTags: z.array(z.string().trim().min(1).max(40)).max(20).optional() })
      .refine((c) => Object.values(c).some((v) => v !== undefined), 'no_changes'),
  }),
])
export const bulkDealsSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('delete'), ids: bulkIds }),
  z.object({
    action: z.literal('update'),
    ids: bulkIds,
    changes: z.object({ ownerUserId: z.uuid().nullable() }),
  }),
])
export const bulkResultSchema = z.object({ count: z.number().int() })

export const DUPLICATE_REASONS = ['name', 'phone'] as const
export const duplicateGroupSchema = z.object({
  reason: z.enum(DUPLICATE_REASONS),
  contacts: z.array(z.object({ id: z.uuid(), name: z.string(), email: z.string().nullable(), phone: z.string().nullable(), company: z.string().nullable(), createdAt: z.string() })),
})
export type DuplicateGroup = z.infer<typeof duplicateGroupSchema>

// Fields a merge can take from either contact.
export const MERGE_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'mobilePhone', 'title', 'companyId', 'ownerUserId', 'lifecycleStage', 'leadSource', 'street', 'postalCode', 'city', 'country'] as const
export type MergeField = (typeof MERGE_FIELDS)[number]

export const mergeContactsSchema = z.object({
  // The contact that stays. The other one is erased after everything is moved over.
  survivorId: z.uuid(),
  mergedId: z.uuid(),
  // Fields to take from the merged contact; the rest keep the survivor's value.
  takeFromMerged: z.array(z.enum(MERGE_FIELDS)).max(MERGE_FIELDS.length).default([]),
})
