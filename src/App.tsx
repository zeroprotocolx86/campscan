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

type CameraState = 'idle' | 'running' | 'needs-permission'

// Build a quick lookup table: scanned code -> word to show.
const lookup = new Map<string, string>()
for (const record of codes) {
  lookup.set(record.code, record.word)
}

export default function App() {
  const [display, setDisplay] = useState<string>(DEFAULT_HINT)
  const [cameraState, setCameraState] = useState<CameraState>('idle')

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
          fps: 10,
          qrbox: (viewfinderWidth, viewfinderHeight) => {
            // Square scan area that fits the shorter side, capped so small
            // QR codes on screen still get enough of the frame.
            const minSide = Math.min(viewfinderWidth, viewfinderHeight)
            const box = Math.floor(minSide * 0.8)
            return { width: box, height: box }
          },
          aspectRatio: 1.0,
        },
        onScanSuccess,
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        () => {},
      )

      setCameraState('running')
    } catch (err) {
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
      // Ignore the new code until at least COOLDOWN_MS has passed since the
      // previous code was last seen.
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
      setDisplay(word)
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
    // Re-arm and try starting the camera again.
    startCamera()
  }

  return (
    <div className="flex min-h-full w-full flex-col items-center bg-white">
      <main className="flex w-full max-w-2xl flex-col items-center px-4 pb-8 pt-6">
        {/* Camera always first, on top. */}
        <div className="w-full">
          <div
            id={READER_ELEMENT_ID}
            className="w-full overflow-hidden bg-white"
            aria-label="Вікно камери"
          />
        </div>

        {/* Result of the last scan, large text under the camera. */}
        <p
          className="mt-8 w-full text-center text-3xl font-semibold leading-snug text-black sm:text-4xl"
          aria-live="polite"
        >
          {display}
        </p>

        {/* A single blue button, shown only if the browser asks again. */}
        {cameraState === 'needs-permission' && (
          <button
            type="button"
            onClick={handleGrantPermission}
            className="mt-8 rounded-md bg-blue-600 px-6 py-3 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2"
          >
            {PERMISSION_PROMPT}
          </button>
        )}
      </main>
    </div>
  )
}
