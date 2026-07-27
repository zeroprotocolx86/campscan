import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { codes } from './codes'

const READER_ELEMENT_ID = 'qr-reader'

// How long (ms) a previously seen code stays "locked" so it is not reported
// again while the same QR sits in front of the camera. Once the camera does
// not see that code for at least this long, the same QR can be scanned again.
const COOLDOWN_MS = 1000

// When the permission needs to be re-requested after it was lost, the user
// gets a single blue button. Text stays informative and free of emoji.
const PERMISSION_PROMPT = 'Надати доступ до камери'

const DEFAULT_HINT = 'Наведіть камеру на QR-код'

type CameraState = 'starting' | 'running' | 'needs-permission'

// Build a quick lookup table: scanned code -> word to show.
const lookup = new Map<string, string>()
// A set of messages that are decoys ("try again") so we can style them apart.
const decoyMessages = new Set<string>()
for (const record of codes) {
  lookup.set(record.code, record.word)
}

// Decoy detection: a record is a decoy if its "word" is not one of the
// expected Bible-verse words. We pre-compute that set from the data file.
const VERSE_WORDS = new Set([
  'Не',
  'будь',
  'переможений',
  'злом',
  'але',
  'перемагай',
  'зло',
  'добром',
  'Римлян',
  '12',
  '21',
])
for (const record of codes) {
  if (!VERSE_WORDS.has(record.word)) {
    decoyMessages.add(record.word)
  }
}

interface DisplayState {
  text: string
  kind: 'hint' | 'word' | 'decoy'
}

const HINT_DISPLAY: DisplayState = {
  text: DEFAULT_HINT,
  kind: 'hint',
}

export default function App() {
  const [display, setDisplay] = useState<DisplayState>(HINT_DISPLAY)
  const [cameraState, setCameraState] = useState<CameraState>('starting')

  // Bump a counter each time a new code is accepted so the result block can
  // re-trigger its entrance animation.
  const [scanSeq, setScanSeq] = useState(0)

  // html5-qrcode instance lives for the whole component lifetime.
  const scannerRef = useRef<Html5Qrcode | null>(null)

  // The last successfully decoded code, used for deduplication.
  const lastCodeRef = useRef<string | null>(null)
  // Timestamp (ms) of the last time we saw lastCodeRef in the camera feed.
  const lastSeenRef = useRef<number>(0)
  // True while a code is in its cooldown window so it cannot be re-accepted.
  const lockedRef = useRef<boolean>(false)

  // Start (or resume) the camera and continuous scanning.
  const startCamera = useCallback(async () => {
    // Already running or starting up? Nothing to do.
    if (scannerRef.current) return

    let scanner: Html5Qrcode | null = null
    try {
      scanner = new Html5Qrcode(READER_ELEMENT_ID, {
        verbose: false,
        useBarCodeDetectorIfSupported: true,
      })
      scannerRef.current = scanner

      // Called by the library every time it thinks it decoded something.
      const onScanSuccess = (decodedText: string) => {
        handleDecoded(decodedText)
      }

      await scanner.start(
        { facingMode: 'environment' },
        {
          // Maximum frame rate. html5-qrcode caps the value internally, so a
          // large number effectively means "scan as fast as the camera feeds
          // frames", giving the fastest possible detection of new QR codes.
          fps: 120,
          // Use the FULL viewfinder as the scan region. The library's small
          // default box is the main reason a QR must be aimed pixel-perfect;
          // scanning the whole frame means any QR anywhere in view is read.
          qrbox: (viewfinderWidth, viewfinderHeight) => ({
            width: viewfinderWidth,
            height: viewfinderHeight,
          }),
          aspectRatio: 1.0,
          // Request the highest-resolution back camera stream available. A
          // sharper image keeps the QR scannable even with glare, slight
          // blur, or an angled print.
          videoConstraints: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
        },
        onScanSuccess,
        () => {},
      )

      setCameraState('running')
    } catch {
      // Most common failure: permission denied or never granted.
      scannerRef.current = null
      if (scanner) {
        try {
          await scanner.clear()
        } catch {
          /* ignore */
        }
      }
      setCameraState('needs-permission')
    }
  }, [])

  // Core decoding logic with one-second-away deduplication.
  const handleDecoded = useCallback((decodedText: string) => {
    const now = Date.now()

    // Same code as before: refresh the "last seen" timestamp so the cooldown
    // only elapses once the code actually disappears from the camera.
    if (decodedText === lastCodeRef.current) {
      lastSeenRef.current = now
      return
    }

    // A different code has appeared.
    if (lockedRef.current) {
      // We are still inside the cooldown window of the previous code.
      if (now - lastSeenRef.current < COOLDOWN_MS) {
        return
      }
      // Cooldown elapsed: unlock and accept the new code below.
      lockedRef.current = false
    }

    // Accept the new code.
    lastCodeRef.current = decodedText
    lastSeenRef.current = now
    lockedRef.current = true

    const word = lookup.get(decodedText.trim())
    // Only real codes (and decoys, which are also in the database) are shown.
    // Anything else is ignored silently -- no popups, no error text.
    if (word !== undefined) {
      setDisplay({
        text: word,
        kind: decoyMessages.has(word) ? 'decoy' : 'word',
      })
      setScanSeq((n) => n + 1)
    }
  }, [])

  // Keep the lock fresh: every 250 ms, if the locked code has not been seen
  // for COOLDOWN_MS, release the lock so the same QR can be scanned again.
  useEffect(() => {
    const interval = window.setInterval(() => {
      if (lockedRef.current && lastCodeRef.current !== null) {
        if (Date.now() - lastSeenRef.current >= COOLDOWN_MS) {
          lockedRef.current = false
        }
      }
    }, 250)
    return () => window.clearInterval(interval)
  }, [])

  // Auto-start the camera on mount. No button is required for the first run.
  useEffect(() => {
    startCamera()

    return () => {
      const scanner = scannerRef.current
      scannerRef.current = null
      lastCodeRef.current = null
      lockedRef.current = false
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {
            /* component unmounting; ignore */
          })
      }
    }
  }, [startCamera])

  const handleGrantPermission = () => {
    setCameraState('starting')
    startCamera()
  }

  return (
    <div className="flex min-h-full w-full flex-col items-center bg-[#f7f7f9] px-4 py-8 sm:py-12">
      <main className="flex w-full max-w-md flex-col items-center">
        {/* Header: a small wordmark above the camera card. */}
        <header className="mb-6 flex flex-col items-center text-center">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 shadow-sm">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                cameraState === 'running'
                  ? 'bg-emerald-500'
                  : 'bg-slate-300'
              }`}
            />
            Сканер активний
          </span>
        </header>

        {/* Camera card: rounded, soft shadow, inner scan overlay. */}
        <section className="relative w-full overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_10px_40px_-12px_rgba(15,23,42,0.25)]">
          <div className="relative aspect-square w-full">
            <div
              id={READER_ELEMENT_ID}
              className="absolute inset-0 h-full w-full"
              aria-label="Вікно камери"
            />

            {/* Thin inner border framing the whole viewfinder. The scanner
               now reads the entire frame, so there is no small target to
               aim for anymore. */}
            <div className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-black/10" />

            {/* While the camera is starting, a calm overlay. */}
            {cameraState === 'starting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/40 backdrop-blur-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span className="text-sm font-medium text-white">
                  Запуск камери...
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Practical scanning tip shown while the result is still the hint. */}
        {display.kind === 'hint' && cameraState === 'running' && (
          <p className="mt-4 px-2 text-center text-sm text-slate-400">
            Тримайте QR-код у межах екрана. Приблизна відстань — 15-30 см.
            Уникайте прямих відблисків на папері.
          </p>
        )}

        {/* Result block. Distinct visual treatment per state. */}
        <section className="mt-8 w-full">
          <ResultBlock key={scanSeq} display={display} />
        </section>

        {/* A single blue button, shown only if the browser asks again. */}
        {cameraState === 'needs-permission' && (
          <div className="mt-8 w-full rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
            <p className="text-sm font-medium text-amber-900">
              Доступ до камери потрібно надати повторно.
            </p>
            <button
              type="button"
              onClick={handleGrantPermission}
              className="mt-4 w-full rounded-xl bg-blue-600 px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-blue-600/20 transition-colors hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
            >
              {PERMISSION_PROMPT}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}

function ResultBlock({ display }: { display: DisplayState }) {
  if (display.kind === 'hint') {
    return (
      <div className="animate-fade-in rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-7 text-center">
        <p className="text-lg font-medium text-slate-400">{display.text}</p>
      </div>
    )
  }

  if (display.kind === 'decoy') {
    return (
      <div className="animate-pop-in rounded-2xl border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
        <p className="text-xl font-semibold leading-snug text-slate-500">
          {display.text}
        </p>
      </div>
    )
  }

  // Real word from the verse.
  return (
    <div className="animate-pop-in rounded-2xl border border-blue-100 bg-gradient-to-b from-blue-50 to-white px-6 py-8 text-center shadow-[0_8px_30px_-12px_rgba(37,99,235,0.35)]">
      <p className="text-4xl font-bold leading-tight text-slate-900 sm:text-5xl">
        {display.text}
      </p>
    </div>
  )
}
