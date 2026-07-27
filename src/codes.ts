import codesData from './data/codes.json'

// Shape of a single database record.
export interface CodeRecord {
  code: string
  word: string
}

// codes.json is imported as a typed array.
export const codes: CodeRecord[] = codesData
