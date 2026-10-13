import { describe, expect, it } from 'vitest'
import { decodeCsvBytes, guessMapping, mapRow, missingRequired, parseCsv, parseImportDate, parseSize, toCsv } from './data.js'

describe('csv', () => {
  it('writes Excel-friendly CSV: BOM, semicolons, CRLF and quoting', () => {
    const csv = toCsv(['Namn', 'Ort'], [['Åsa "Ö" Berg', 'Malmö; Lund'], ['Örjan', null]])
    expect(csv).toBe('﻿Namn;Ort\r\n"Åsa ""Ö"" Berg";"Malmö; Lund"\r\nÖrjan;')
  })

  it('neutralises cells Excel would run as formulas, but not negative numbers', () => {
    const csv = toCsv(['a'], [['=HYPERLINK("x")'], ['@SUM(A1)'], ['-12'], ['+46 70 123']])
    expect(csv.split('\r\n').slice(1)).toEqual(['"\'=HYPERLINK(""x"")"', "'@SUM(A1)", '-12', "'+46 70 123"])
  })

  it('reads semicolon and comma files and their header', () => {
    expect(parseCsv('﻿Förnamn;E-post\r\nÅsa;asa@x.se\r\n\r\n')).toEqual({ header: ['Förnamn', 'E-post'], rows: [['Åsa', 'asa@x.se']], delimiter: ';' })
    expect(parseCsv('name,city\n"Berg, Åsa",Umeå').rows).toEqual([['Berg, Åsa', 'Umeå']])
  })

  it('decodes Windows-1252 files from Excel', () => {
    const bytes = new Uint8Array([0xc5, 0x73, 0x61, 0x3b, 0xf6]) // "Åsa;ö" in Windows-1252
    expect(decodeCsvBytes(bytes)).toBe('Åsa;ö')
    expect(decodeCsvBytes(new TextEncoder().encode('Åsa;ö'))).toBe('Åsa;ö')
  })
})

describe('guessMapping', () => {
  it('maps Swedish and English headers and skips unknown columns', () => {
    expect(guessMapping('contacts', ['Förnamn', 'Efternamn', 'E-post', 'Mobil', 'Företag', 'Favoritfärg', 'Ägare'])).toEqual([
      'firstName', 'lastName', 'email', 'mobilePhone', 'company', null, 'owner',
    ])
    expect(guessMapping('companies', ['Name', 'Org.nr', 'Website', 'Employees'])).toEqual(['name', 'orgNumber', 'domain', 'size'])
    expect(guessMapping('contacts', ['Name', 'Email'])).toEqual(['fullName', 'email'])
  })

  it('reports required fields that are not mapped', () => {
    expect(missingRequired('contacts', ['email'])).toEqual(['firstName'])
    expect(missingRequired('contacts', ['fullName'])).toEqual([])
  })
})

describe('mapRow', () => {
  it('builds a contact from a row, splitting a full name and translating labels', () => {
    const row = mapRow('contacts', ['fullName', 'email', 'lifecycleStage', 'leadSource', 'tags', null], ['Åsa Öberg Lind', ' ASA@Exempel.se ', 'Kund', 'Webbplats', 'VIP, Norden', 'x'])
    expect(row.issues).toEqual([])
    expect(row.input).toMatchObject({ firstName: 'Åsa', lastName: 'Öberg Lind', email: 'asa@exempel.se', lifecycleStage: 'customer', leadSource: 'website', tags: ['VIP', 'Norden'] })
  })

  it('reports invalid and missing values per field', () => {
    expect(mapRow('contacts', ['firstName', 'email'], ['', 'inte-en-adress']).issues).toEqual([
      { field: 'firstName', code: 'required' },
      { field: 'email', code: 'invalid' },
    ])
    expect(mapRow('companies', ['name', 'size'], ['Bygg AB', 'många']).issues).toEqual([{ field: 'size', code: 'invalid' }])
  })

  it('imports a company with an invalid org number as a private customer, with a notice', () => {
    const row = mapRow('companies', ['name', 'orgNumber', 'fortnoxCustomerNumber'], ['Anna Andersson', '1000000334', '1000000334'])
    expect(row.issues).toEqual([])
    expect(row.notices).toEqual([{ field: 'orgNumber', code: 'imported_as_private' }])
    expect(row.input).toEqual({ name: 'Anna Andersson', customerType: 'private', fortnoxCustomerNumber: '1000000334' })
  })

  it('reads billing, terms and discounts the way ERP exports write them', () => {
    const fields = [
      'name', 'orgNumber', 'email', 'phone', 'street', 'city', 'invoiceEmail', 'paymentTermDays',
      'creditApproved', 'creditLimit', 'discount', 'discountRental', 'contactName',
    ] as const
    const row = mapRow('companies', [...fields], [
      'Bygg AB', '556036-0793', '\u200bInfo@Bygg.se', '\t+46 70 123', 'Box 77, -', '\t-', 'a@bygg.se | b@bygg.se', '30',
      'true', '1 500,50', '0.00', '12,5', 'Anna Ek',
    ])
    expect(row.issues).toEqual([])
    expect(row.notices).toEqual([])
    expect(row.refs).toEqual({ contactName: 'Anna Ek' })
    expect(row.input).toEqual({
      name: 'Bygg AB', orgNumber: '556036-0793', email: 'info@bygg.se', phone: '+46 70 123', street: 'Box 77',
      invoiceEmail: 'a@bygg.se', paymentTermDays: 30, creditApproved: true, creditLimit: 150050, discount: 0, discountRental: 12.5,
    })
  })

  it('parses deal amounts, dates and statuses and keeps names to resolve', () => {
    const row = mapRow('deals', ['name', 'value', 'status', 'expectedCloseDate', 'stage', 'company'], ['Licens', '1 999,50 kr', 'Vunnen', '31/12/2026', 'Offert skickad', 'Kund AB'])
    expect(row).toEqual({
      input: { name: 'Licens', value: 199950, status: 'won', expectedCloseDate: '2026-12-31' },
      refs: { stage: 'Offert skickad', company: 'Kund AB' },
      issues: [],
      notices: [],
    })
  })
})

describe('value parsers', () => {
  it('reads company sizes as ranges or head counts', () => {
    expect(parseSize('10–49')).toBe('10-49')
    expect(parseSize('120')).toBe('50-249')
    expect(parseSize('många')).toBeNull()
  })
  it('reads common date formats and rejects impossible dates', () => {
    expect(parseImportDate('2026-11-09')).toBe('2026-11-09')
    expect(parseImportDate('9.11.2026')).toBe('2026-11-09')
    expect(parseImportDate('2026-02-30')).toBeNull()
  })
})
