import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json()

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    const response = await fetch(url)

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to download PDF' }, { status: response.status })
    }

    const buffer = await response.arrayBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="plan.pdf"',
      },
    })

  } catch (error) {
    console.error('Error downloading PDF:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}