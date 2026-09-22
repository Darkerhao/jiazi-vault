import { randomInt } from 'node:crypto'

export interface PasswordOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
  excludeAmbiguous: boolean
}

export interface GeneratedPassword {
  password: string
  entropy: number
  strength: '弱' | '一般' | '强' | '非常强'
}

export function generatePassword(options: PasswordOptions): GeneratedPassword {
  if (!options || !Number.isInteger(options.length) || options.length < 8 || options.length > 128
    || [options.uppercase, options.lowercase, options.numbers, options.symbols, options.excludeAmbiguous].some((v) => typeof v !== 'boolean')) throw new Error('INVALID_GENERATOR_OPTIONS')
  const groups = [
    options.uppercase ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '',
    options.lowercase ? 'abcdefghijklmnopqrstuvwxyz' : '',
    options.numbers ? '0123456789' : '',
    options.symbols ? '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' : '',
  ].map((group) => options.excludeAmbiguous ? group.replace(/[0O1Il|]/g, '') : group).filter(Boolean)
  if (!groups.length) throw new Error('INVALID_GENERATOR_OPTIONS')
  const alphabet = groups.join('')
  let password: string
  // Rejection sampling keeps every valid password equally likely and covers each selected group.
  do {
    password = Array.from({ length: options.length }, () => alphabet[randomInt(alphabet.length)]).join('')
  } while (!groups.every((group) => [...password].some((character) => group.includes(character))))

  // Inclusion-exclusion counts strings containing at least one character from every group.
  let fraction = 0
  for (let mask = 0; mask < 1 << groups.length; mask++) {
    let excluded = 0
    let count = 0
    for (let i = 0; i < groups.length; i++) {
      if (mask & (1 << i)) { excluded += groups[i].length; count++ }
    }
    fraction += (-1) ** count * ((alphabet.length - excluded) / alphabet.length) ** options.length
  }
  const entropy = options.length * Math.log2(alphabet.length) + Math.log2(fraction)
  return { password, entropy, strength: entropy < 40 ? '弱' : entropy < 60 ? '一般' : entropy < 80 ? '强' : '非常强' }
}
