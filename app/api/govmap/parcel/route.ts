import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { coordinates } = await request.json()

    if (!coordinates) {
      return NextResponse.json({ error: 'Coordinates are required' }, { status: 400 })
    }

    const response = await fetch(
      `https://www.govmap.gov.il/api/layers-catalog/apps/parcel-search/address/(${coordinates})`,
      {
        headers: {
          'Content-Type': 'application/json',
        }
      }
    )

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to fetch parcel data' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error fetching parcel data:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}