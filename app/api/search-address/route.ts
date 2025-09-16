import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as XLSX from 'xlsx'

interface AddressSearchResult {
  ObjectId: number
  Created: string
  IsEditable: boolean
  Values: number[]
}

interface PlanSearchResult {
  planNumber: string
  planId: number
  cityText: string
  mahut: string
  status: string
  statusDate: string
  relationType: string | null
  documentsSet: {
    takanon?: {
      path: string
      info: string
      codeMismach: number
    }
    [key: string]: any
  }
}

async function updateLoadingStep(step: string) {
  console.log(`Loading step: ${step}`)
}

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json()

    if (!address) {
      return NextResponse.json({ error: 'כתובת לא סופקה' }, { status: 400 })
    }

    updateLoadingStep('searching-address')

    const addressSearchResponse = await fetch(
      'https://ags.govmap.gov.il/Api/Controllers/GovmapApi/SearchAndLocate',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 0,
          address: address,
        }),
      }
    )

    if (!addressSearchResponse.ok) {
      return NextResponse.json({ error: 'לא הצלחנו למצוא את הכתובת' }, { status: 404 })
    }

    const addressData = await addressSearchResponse.json()

    if (!addressData.data || addressData.data.length === 0) {
      return NextResponse.json({ error: 'לא נמצאו נתונים עבור הכתובת' }, { status: 404 })
    }

    const firstResult: AddressSearchResult = addressData.data[0]
    const block = firstResult.Values[0]
    const parcel = firstResult.Values[1]

    console.log(`Found block: ${block}, parcel: ${parcel}`)

    updateLoadingStep('fetching-plans')

    const plansSearchResponse = await fetch(
      'https://apps.land.gov.il/TabaSearch/api/SerachPlans/GetPlans',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          planNumber: '',
          gush: block,
          chelka: parcel,
          statuses: [8],
          planTypes: [21],
          fromStatusDate: null,
          toStatusDate: null,
          planTypesUsed: true,
        }),
      }
    )

    if (!plansSearchResponse.ok) {
      return NextResponse.json({ error: 'לא הצלחנו למצוא תוכניות בנייה' }, { status: 404 })
    }

    const plansData = await plansSearchResponse.json()

    if (!plansData.plansSmall || plansData.plansSmall.length === 0) {
      return NextResponse.json({ error: 'לא נמצאו תוכניות בנייה לכתובת זו' }, { status: 404 })
    }

    updateLoadingStep('filtering-plans')

    const parseDate = (dateStr: string) => {
      const cleaned = dateStr.trim()
      const parts = cleaned.split('/')
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10)
        const month = parseInt(parts[1], 10)
        const year = parseInt(parts[2], 10)
        const fullYear = year < 100 ? (year < 50 ? 2000 + year : 1900 + year) : year
        return new Date(fullYear, month - 1, day)
      }
      return new Date(0)
    }

    const sortedPlans = plansData.plansSmall.sort((a: PlanSearchResult, b: PlanSearchResult) => {
      const dateA = parseDate(a.statusDate)
      const dateB = parseDate(b.statusDate)
      return dateB.getTime() - dateA.getTime()
    })

    const latestPlan = sortedPlans[0]

    if (!latestPlan.documentsSet?.takanon?.path) {
      return NextResponse.json({ error: 'לא נמצא מסמך תקנון לתוכנית' }, { status: 404 })
    }

    const pdfUrl = `https://apps.land.gov.il${latestPlan.documentsSet.takanon.path}`
    console.log(`PDF URL: ${pdfUrl}`)

    updateLoadingStep('downloading-pdf')

    const pdfResponse = await fetch(pdfUrl)

    if (!pdfResponse.ok) {
      return NextResponse.json({ error: 'לא הצלחנו להוריד את מסמך התוכנית' }, { status: 500 })
    }

    const pdfBuffer = await pdfResponse.arrayBuffer()
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64')

    updateLoadingStep('parsing-pdf')

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' })

    const prompt = `
      You are analyzing a PDF document. Find all tables that appear under pages with the title "טבלת זכויות והוראות בניה - מצב מוצע" or similar variations.

      For each table found, extract its complete data structure preserving all rows and columns.

      Return the data in the following JSON format:
      {
        "tables": [
          {
            "pageNumber": <page number>,
            "title": "<table title if any>",
            "headers": ["header1", "header2", ...],
            "rows": [
              ["cell1", "cell2", ...],
              ["cell1", "cell2", ...],
              ...
            ]
          }
        ]
      }

      Important:
      - Preserve the exact structure of each table including merged cells
      - Keep all Hebrew text as-is
      - Include empty cells as empty strings
      - Tables may have different structures - adapt accordingly
    `

    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: 'application/pdf',
          data: pdfBase64,
        },
      },
      prompt,
    ])

    const response = result.response
    const text = response.text()

    let tablesData
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        tablesData = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No valid JSON found in response')
      }
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', text)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    const workbook = XLSX.utils.book_new()

    const summaryData = [
      ['פרטי התוכנית'],
      [],
      ['מספר תוכנית', latestPlan.planNumber],
      ['גוש', block.toString()],
      ['חלקה', parcel.toString()],
      ['עיר', latestPlan.cityText],
      ['מהות', latestPlan.mahut],
      ['סטטוס', latestPlan.status],
      ['תאריך סטטוס', latestPlan.statusDate],
      [],
      ['טבלאות זכויות בנייה:'],
      [],
    ]

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
    summarySheet['!cols'] = [{ wch: 20 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'סיכום')

    if (tablesData.tables && tablesData.tables.length > 0) {
      tablesData.tables.forEach((table: any, index: number) => {
        const worksheetData = []

        if (table.title) {
          worksheetData.push([table.title])
          worksheetData.push([])
        }

        if (table.headers && table.headers.length > 0) {
          worksheetData.push(table.headers)
        }

        if (table.rows && table.rows.length > 0) {
          table.rows.forEach((row: any[]) => {
            worksheetData.push(row)
          })
        }

        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

        const maxCols = Math.max(
          table.headers?.length || 0,
          ...((table.rows || []).map((row: any[]) => row.length))
        )
        const colWidths = Array(maxCols).fill({ wch: 15 })
        worksheet['!cols'] = colWidths

        const sheetName = `טבלה_${index + 1}${table.title ? `_${table.title.slice(0, 15)}` : ''}`
          .replace(/[\\\/\?\*\[\]]/g, '_')
          .slice(0, 31)

        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
      })
    } else {
      const worksheet = XLSX.utils.aoa_to_sheet([['לא נמצאו טבלאות']])
      XLSX.utils.book_append_sheet(workbook, worksheet, 'תוצאה')
    }

    const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })

    const base64Excel = Buffer.from(xlsxBuffer).toString('base64')
    const dataUri = `data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64,${base64Excel}`

    return NextResponse.json({
      downloadUrl: dataUri,
      planDetails: {
        planNumber: latestPlan.planNumber,
        cityText: latestPlan.cityText,
        mahut: latestPlan.mahut,
        status: latestPlan.status,
        statusDate: latestPlan.statusDate,
        block: block,
        parcel: parcel,
      },
    })
  } catch (error) {
    console.error('Error processing address search:', error)
    return NextResponse.json(
      { error: 'אירעה שגיאה בעיבוד הבקשה' },
      { status: 500 }
    )
  }
}