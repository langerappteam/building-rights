'use client'

import { useState } from 'react'

type LoadingStep =
  | 'idle'
  | 'searching-address'
  | 'fetching-plans'
  | 'filtering-plans'
  | 'downloading-pdf'
  | 'parsing-pdf'
  | 'complete'

const LOADING_MESSAGES = {
  'idle': '',
  'searching-address': 'מחפש כתובת במערכת GovMap...',
  'fetching-plans': 'מאתר תוכניות בניין לגוש/חלקה...',
  'filtering-plans': 'מסנן תוכניות רלוונטיות...',
  'downloading-pdf': 'מוריד קובץ PDF של התוכנית...',
  'parsing-pdf': 'מחלץ טבלאות זכויות בנייה...',
  'complete': 'הושלם בהצלחה!'
}

export default function Home() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadingStep, setLoadingStep] = useState<LoadingStep>('idle')
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [planDetails, setPlanDetails] = useState<{
    planNumber: string
    cityText: string
    mahut: string
    status: string
    statusDate: string
    block: number
    parcel: number
  } | null>(null)

  const handleSearch = async () => {
    if (!address.trim()) {
      setError('אנא הכנס כתובת')
      return
    }

    setLoading(true)
    setError(null)
    setDownloadUrl(null)
    setPlanDetails(null)

    try {
      setLoadingStep('searching-address')

      const searchResponse = await fetch('/api/govmap/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address }),
      })

      if (!searchResponse.ok) {
        const errorData = await searchResponse.json()
        throw new Error(errorData.error || 'Failed to search address')
      }

      const result = await searchResponse.json()

      if (!result.results || result.results.length === 0) {
        throw new Error('לא נמצאה כתובת תואמת')
      }

      const coords = result.results[0]?.shape.match(/\(([^)]+)\)/)?.[1] || '';

      if (!coords) {
        throw new Error('לא ניתן לחלץ קואורדינטות מהכתובת')
      }

      setLoadingStep('fetching-plans')

      const blockParcelResponse = await fetch('/api/govmap/parcel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ coordinates: decodeURI(coords) }),
      })

      if (!blockParcelResponse.ok) {
        const errorData = await blockParcelResponse.json()
        throw new Error(errorData.error || 'Failed to fetch block and parcel')
      }

      const blockParcelData = await blockParcelResponse.json()
      const block = blockParcelData.properties?.gushnumber;
      const parcel = blockParcelData.properties?.parcelnumber;

      if (!block || !parcel) {
        throw new Error('לא נמצאו נתוני גוש וחלקה לכתובת זו')
      }

      const plansResponse = await fetch('/api/plans/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ block, parcel }),
      });

      if (!plansResponse.ok) {
        const errorData = await plansResponse.json()
        throw new Error(errorData.error || 'Failed to fetch plans')
      }

      const plansData = await plansResponse.json()

      if (!plansData.plansSmall || plansData.plansSmall.length === 0) {
        throw new Error('לא נמצאו תוכניות בניין עבור הכתובת שהוזנה')
      }

      setLoadingStep('filtering-plans')

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

      const sortedPlans = plansData.plansSmall.sort((a: { statusDate: string }, b: { statusDate: string }) => {
        const dateA = parseDate(a.statusDate)
        const dateB = parseDate(b.statusDate)
        return dateB.getTime() - dateA.getTime()
      })

      const lastPlan = sortedPlans.pop()

      if (!lastPlan.documentsSet?.takanon?.path) {
        throw new Error('לא נמצא מסמך תקנון לתוכנית')
      }

      const planPdfUrl = `https://apps.land.gov.il${lastPlan.documentsSet.takanon.path}`
      setLoadingStep('downloading-pdf')

      // First download the PDF
      const pdfResponse = await fetch('/api/download-pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: planPdfUrl }),
      })

      if (!pdfResponse.ok) {
        const errorData = await pdfResponse.json()
        throw new Error(errorData.error || 'Failed to download PDF')
      }

      const pdfBlob = await pdfResponse.blob()
      const pdfFile = new File([pdfBlob], 'plan.pdf', { type: 'application/pdf' })

      setLoadingStep('parsing-pdf')

      // Process the PDF using the existing process-pdf endpoint
      const formData = new FormData()
      formData.append('pdf', pdfFile)

      const processResponse = await fetch('/api/process-pdf', {
        method: 'POST',
        body: formData,
      })

      console.log(processResponse)
      if (!processResponse.ok) {
        const errorData = await processResponse.json()
        throw new Error(errorData.error || 'Failed to process PDF')
      }

      const xlsxBlob = await processResponse.blob()
      const xlsxUrl = window.URL.createObjectURL(xlsxBlob)

      setDownloadUrl(xlsxUrl)
      setPlanDetails({
        planNumber: lastPlan.planNumber,
        cityText: lastPlan.cityText,
        mahut: lastPlan.mahut,
        status: lastPlan.status,
        statusDate: lastPlan.statusDate,
        block: block,
        parcel: parcel,
      })
      setLoadingStep('complete')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'אירעה שגיאה')
      setLoadingStep('idle')
    } finally {
      setLoading(false)
    }
  }

  const getProgressPercentage = () => {
    const steps: LoadingStep[] = [
      'searching-address',
      'fetching-plans',
      'filtering-plans',
      'downloading-pdf',
      'parsing-pdf',
      'complete'
    ]
    const currentIndex = steps.indexOf(loadingStep)
    return currentIndex === -1 ? 0 : ((currentIndex + 1) / steps.length) * 100
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12 px-4" dir="rtl">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">מחלץ זכויות בנייה</h1>
          <p className="text-gray-600 mb-8">
            הכנס כתובת מלאה כדי למצוא ולחלץ זכויות בנייה מתוכניות בניין
          </p>

          <div className="space-y-6">
            <div className="space-y-2">
              <label htmlFor="address" className="block text-sm font-medium text-gray-700">
                כתובת מלאה
              </label>
              <div className="flex gap-2">
                <input
                  id="address"
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && !loading && handleSearch()}
                  placeholder="לדוגמה: רחוב הרצל 1, תל אביב"
                  className="flex-1 px-4 py-2 border text-gray-500 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  disabled={loading}
                />
                <button
                  onClick={handleSearch}
                  disabled={loading || !address.trim()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? 'מחפש...' : 'חיפוש'}
                </button>
              </div>
            </div>

            {loading && (
              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="space-y-3">
                    <p className="text-blue-800 font-medium">{LOADING_MESSAGES[loadingStep]}</p>

                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-500"
                        style={{ width: `${getProgressPercentage()}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs text-gray-600">
                      <div className={`text-center ${loadingStep === 'searching-address' ? 'font-bold text-blue-600' : ''}`}>
                        חיפוש כתובת
                      </div>
                      <div className={`text-center ${['fetching-plans', 'filtering-plans'].includes(loadingStep) ? 'font-bold text-blue-600' : ''}`}>
                        איתור תוכניות
                      </div>
                      <div className={`text-center ${['downloading-pdf', 'parsing-pdf'].includes(loadingStep) ? 'font-bold text-blue-600' : ''}`}>
                        ניתוח מסמכים
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            {downloadUrl && planDetails && (
              <div className="space-y-4">
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <h3 className="text-green-800 font-bold mb-3">ניתוח הושלם בהצלחה!</h3>

                  {planDetails && (
                    <div className="space-y-2 mb-4 text-sm text-gray-700">
                      <p><span className="font-semibold">מספר תוכנית:</span> {planDetails.planNumber}</p>
                      <p><span className="font-semibold">עיר:</span> {planDetails.cityText}</p>
                      <p><span className="font-semibold">מהות:</span> {planDetails.mahut}</p>
                      <p><span className="font-semibold">סטטוס:</span> {planDetails.status}</p>
                      <p><span className="font-semibold">תאריך סטטוס:</span> {planDetails.statusDate}</p>
                    </div>
                  )}

                  <a
                    href={downloadUrl}
                    download="building_rights.xlsx"
                    className="inline-block bg-green-600 text-white py-2 px-4 rounded-lg hover:bg-green-700 transition-colors"
                  >
                    הורד קובץ Excel עם זכויות הבנייה
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}