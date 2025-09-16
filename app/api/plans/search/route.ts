import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { block, parcel } = await request.json()

    if (!block || !parcel) {
      return NextResponse.json({ error: 'Block and parcel are required' }, { status: 400 })
    }

    const response = await fetch('https://apps.land.gov.il/TabaSearch/api/SerachPlans/GetPlans', {
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
        planTypesUsed: true
      }),
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch plans' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error fetching plans:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}