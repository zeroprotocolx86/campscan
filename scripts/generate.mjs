// Generates unique codes and QR-code PNGs, then writes src/data/codes.json.
//
// Run with:  node scripts/generate.mjs   (or:  npm run generate)
//
// Output:
//   src/data/codes.json          database of every code -> message
//   public/qr/<word>.png         one QR per real word (encodes the code only)
//   public/qr/decoys/ПустушкаN.png  one QR per decoy (encodes the code only)
//
// The same set of words / decoys is listed below so the output is deterministic
// across runs. Codes are random 6-character strings without ambiguous symbols
// (0 O 1 I) and guaranteed unique.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// Words that build the hidden Bible verse: "Не будь переможений злом, але перемагай зло добром. Римлян 12:21"
const WORDS = [
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
]

// Decoys: they have their own QR codes but show a "try again" message.
const DECOYS = [
  'Пощастить наступного разу.',
  'Тут нічого немає.',
  'Спробуйте знайти інший QR-код.',
]

// Characters allowed in codes. 0, O, 1 and I are excluded on purpose.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const CODE_LENGTH = 6

function randomCode(existing) {
  // Try random generation first; fall back to a deterministic scan if a
  // collision is extremely unlikely but happens to occur.
  for (let attempt = 0; attempt < 10; attempt++) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
    }
    if (!existing.has(code)) return code
  }
  // Exhaustive fallback: find the first unused code in lexicographic order.
  for (const ch1 of ALPHABET) {
    for (const ch2 of ALPHABET) {
      for (const ch3 of ALPHABET) {
        for (const ch4 of ALPHABET) {
          for (const ch5 of ALPHABET) {
            for (const ch6 of ALPHABET) {
              const code = ch1 + ch2 + ch3 + ch4 + ch5 + ch6
              if (!existing.has(code)) return code
            }
          }
        }
      }
    }
  }
  throw new Error('Code space exhausted')
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true })
}

async function writePng(filePath, payload) {
  // High error correction so the QR stays scannable even if printed on
  // rough paper. encodes ONLY the code string.
  const buffer = await QRCode.toBuffer(payload, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 512,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  })
  await fs.writeFile(filePath, buffer)
}

async function main() {
  const usedCodes = new Set()
  const records = []

  const qrDir = path.join(root, 'public', 'qr')
  const decoyDir = path.join(qrDir, 'decoys')
  await ensureDir(qrDir)
  await ensureDir(decoyDir)

  // Real words.
  for (const word of WORDS) {
    const code = randomCode(usedCodes)
    usedCodes.add(code)
    records.push({ code, word })
    const safe = word // keep the Cyrillic name as the file name
    await writePng(path.join(qrDir, `${safe}.png`), code)
  }

  // Decoys.
  let decoyIndex = 1
  for (const message of DECOYS) {
    const code = randomCode(usedCodes)
    usedCodes.add(code)
    records.push({ code, word: message })
    await writePng(path.join(decoyDir, `Пустушка${decoyIndex}.png`), code)
    decoyIndex += 1
  }

  // Write the database.
  const dataDir = path.join(root, 'src', 'data')
  await ensureDir(dataDir)
  const json = JSON.stringify(records, null, 2) + '\n'
  await fs.writeFile(path.join(dataDir, 'codes.json'), json, 'utf8')

  // Build report.
  console.log('Generated codes:')
  for (const r of records) {
    const kind = DECOYS.includes(r.word) ? 'decoy' : 'word '
    console.log(`  [${kind}] ${r.code} -> ${r.word}`)
  }
  console.log(`\nTotal records: ${records.length}`)
  console.log(`Total unique codes: ${usedCodes.size}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
