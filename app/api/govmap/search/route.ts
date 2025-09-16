import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { address } = await request.json()

    if (!address) {
      return NextResponse.json({ error: 'Address is required' }, { status: 400 })
    }

    const response = await fetch('https://www.govmap.gov.il/api/search-service/autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        searchText: address,
        language: 'he',
        filterType: 'address',
        isAccurate: false,
        maxResults: 1
      }),
    })

    if (!response.ok) {
      return NextResponse.json({ error: 'Failed to search address' }, { status: response.status })
    }

    const data = await response.json()
    return NextResponse.json(data)

  } catch (error) {
    console.error('Error searching address:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}