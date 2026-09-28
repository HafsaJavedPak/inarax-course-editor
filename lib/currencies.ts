/**
 * Currencies offered for paid courses (ISO 4217). Common ones for Inara's
 * learners come first; the rest are alphabetical.
 */
export const CURRENCIES = [
  { code: "PKR", name: "Pakistani rupee" },
  { code: "USD", name: "US dollar" },
  { code: "AED", name: "UAE dirham" },
  { code: "SAR", name: "Saudi riyal" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British pound" },
  { code: "AUD", name: "Australian dollar" },
  { code: "BDT", name: "Bangladeshi taka" },
  { code: "BHD", name: "Bahraini dinar" },
  { code: "CAD", name: "Canadian dollar" },
  { code: "CHF", name: "Swiss franc" },
  { code: "CNY", name: "Chinese yuan" },
  { code: "EGP", name: "Egyptian pound" },
  { code: "IDR", name: "Indonesian rupiah" },
  { code: "INR", name: "Indian rupee" },
  { code: "JPY", name: "Japanese yen" },
  { code: "KES", name: "Kenyan shilling" },
  { code: "KWD", name: "Kuwaiti dinar" },
  { code: "LKR", name: "Sri Lankan rupee" },
  { code: "MYR", name: "Malaysian ringgit" },
  { code: "NGN", name: "Nigerian naira" },
  { code: "NPR", name: "Nepalese rupee" },
  { code: "NZD", name: "New Zealand dollar" },
  { code: "OMR", name: "Omani rial" },
  { code: "QAR", name: "Qatari riyal" },
  { code: "SGD", name: "Singapore dollar" },
  { code: "TRY", name: "Turkish lira" },
  { code: "ZAR", name: "South African rand" },
] as const

export type CurrencyCode = (typeof CURRENCIES)[number]["code"]

export const CURRENCY_CODES = CURRENCIES.map((c) => c.code) as [CurrencyCode, ...CurrencyCode[]]

export const DEFAULT_CURRENCY: CurrencyCode = "PKR"
