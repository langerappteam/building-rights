import { NextRequest, NextResponse } from 'next/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import * as XLSX from 'xlsx'

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('pdf') as File

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const base64 = Buffer.from(bytes).toString('base64')

    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'Gemini API key not configured' }, { status: 500 })
    }

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' })

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
          data: base64
        }
      },
      prompt
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
    } catch {
      console.error('Failed to parse Gemini response:', text)
      return NextResponse.json({ error: 'Failed to parse AI response' }, { status: 500 })
    }

    const workbook = XLSX.utils.book_new()

    if (tablesData.tables && tablesData.tables.length > 0) {
      tablesData.tables.forEach((table: { title?: string; headers?: string[]; rows?: string[][] }, index: number) => {
        const worksheetData = []

        if (table.title) {
          worksheetData.push([table.title])
          worksheetData.push([])
        }

        if (table.headers && table.headers.length > 0) {
          worksheetData.push(table.headers)
        }

        if (table.rows && table.rows.length > 0) {
          table.rows.forEach((row: string[]) => {
            worksheetData.push(row)
          })
        }

        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData)

        const maxCols = Math.max(
          table.headers?.length || 0,
          ...((table.rows || []).map((row: string[]) => row.length))
        )
        const colWidths = Array(maxCols).fill({ wch: 15 })
        worksheet['!cols'] = colWidths

        const sheetName = `Table_${index + 1}${table.title ? `_${table.title.slice(0, 20)}` : ''}`
          .replace(/[\\\/\?\*\[\]]/g, '_')
          .slice(0, 31)

        XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
      })
    } else {
      const worksheet = XLSX.utils.aoa_to_sheet([['No tables found']])
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Result')
    }

    const xlsxBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })

    return new NextResponse(xlsxBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="extracted_tables.xlsx"',
      },
    })

  } catch (error) {
    console.error('Error processing PDF:', error)
    return NextResponse.json(
      { error: 'Failed to process PDF' },
      { status: 500 }
    )
  }
}