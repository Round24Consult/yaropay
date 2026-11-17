/**
 * ISO 4217 currencies with their minor-unit exponent: how many decimal places one major unit has
 * (NGN 2: 1 naira = 100 kobo; JPY 0; KWD 3). YaroPay stores every amount as an integer number of
 * minor units, so converting to and from major units must use the currency's own exponent.
 *
 * Gateways that count a currency differently from ISO (some treat UGX or HUF as having no decimals)
 * convert in their adapter; this table is the ISO baseline.
 */
const TABLE = {
  AED: ["UAE dirham", 2],
  AFN: ["Afghan afghani", 2],
  ALL: ["Albanian lek", 2],
  AMD: ["Armenian dram", 2],
  ANG: ["Netherlands Antillean guilder", 2],
  AOA: ["Angolan kwanza", 2],
  ARS: ["Argentine peso", 2],
  AUD: ["Australian dollar", 2],
  AWG: ["Aruban florin", 2],
  AZN: ["Azerbaijani manat", 2],
  BAM: ["Bosnia and Herzegovina convertible mark", 2],
  BBD: ["Barbadian dollar", 2],
  BDT: ["Bangladeshi taka", 2],
  BGN: ["Bulgarian lev", 2],
  BHD: ["Bahraini dinar", 3],
  BIF: ["Burundian franc", 0],
  BMD: ["Bermudian dollar", 2],
  BND: ["Brunei dollar", 2],
  BOB: ["Bolivian boliviano", 2],
  BRL: ["Brazilian real", 2],
  BSD: ["Bahamian dollar", 2],
  BTN: ["Bhutanese ngultrum", 2],
  BWP: ["Botswana pula", 2],
  BYN: ["Belarusian ruble", 2],
  BZD: ["Belize dollar", 2],
  CAD: ["Canadian dollar", 2],
  CDF: ["Congolese franc", 2],
  CHF: ["Swiss franc", 2],
  CLP: ["Chilean peso", 0],
  CNY: ["Chinese yuan", 2],
  COP: ["Colombian peso", 2],
  CRC: ["Costa Rican colón", 2],
  CUP: ["Cuban peso", 2],
  CVE: ["Cape Verdean escudo", 2],
  CZK: ["Czech koruna", 2],
  DJF: ["Djiboutian franc", 0],
  DKK: ["Danish krone", 2],
  DOP: ["Dominican peso", 2],
  DZD: ["Algerian dinar", 2],
  EGP: ["Egyptian pound", 2],
  ERN: ["Eritrean nakfa", 2],
  ETB: ["Ethiopian birr", 2],
  EUR: ["Euro", 2],
  FJD: ["Fijian dollar", 2],
  FKP: ["Falkland Islands pound", 2],
  GBP: ["Pound sterling", 2],
  GEL: ["Georgian lari", 2],
  GHS: ["Ghanaian cedi", 2],
  GIP: ["Gibraltar pound", 2],
  GMD: ["Gambian dalasi", 2],
  GNF: ["Guinean franc", 0],
  GTQ: ["Guatemalan quetzal", 2],
  GYD: ["Guyanese dollar", 2],
  HKD: ["Hong Kong dollar", 2],
  HNL: ["Honduran lempira", 2],
  HTG: ["Haitian gourde", 2],
  HUF: ["Hungarian forint", 2],
  IDR: ["Indonesian rupiah", 2],
  ILS: ["Israeli new shekel", 2],
  INR: ["Indian rupee", 2],
  IQD: ["Iraqi dinar", 3],
  IRR: ["Iranian rial", 2],
  ISK: ["Icelandic króna", 0],
  JMD: ["Jamaican dollar", 2],
  JOD: ["Jordanian dinar", 3],
  JPY: ["Japanese yen", 0],
  KES: ["Kenyan shilling", 2],
  KGS: ["Kyrgyzstani som", 2],
  KHR: ["Cambodian riel", 2],
  KMF: ["Comorian franc", 0],
  KRW: ["South Korean won", 0],
  KWD: ["Kuwaiti dinar", 3],
  KYD: ["Cayman Islands dollar", 2],
  KZT: ["Kazakhstani tenge", 2],
  LAK: ["Lao kip", 2],
  LBP: ["Lebanese pound", 2],
  LKR: ["Sri Lankan rupee", 2],
  LRD: ["Liberian dollar", 2],
  LSL: ["Lesotho loti", 2],
  LYD: ["Libyan dinar", 3],
  MAD: ["Moroccan dirham", 2],
  MDL: ["Moldovan leu", 2],
  MGA: ["Malagasy ariary", 2],
  MKD: ["Macedonian denar", 2],
  MMK: ["Myanmar kyat", 2],
  MNT: ["Mongolian tögrög", 2],
  MOP: ["Macanese pataca", 2],
  MRU: ["Mauritanian ouguiya", 2],
  MUR: ["Mauritian rupee", 2],
  MVR: ["Maldivian rufiyaa", 2],
  MWK: ["Malawian kwacha", 2],
  MXN: ["Mexican peso", 2],
  MYR: ["Malaysian ringgit", 2],
  MZN: ["Mozambican metical", 2],
  NAD: ["Namibian dollar", 2],
  NGN: ["Nigerian naira", 2],
  NIO: ["Nicaraguan córdoba", 2],
  NOK: ["Norwegian krone", 2],
  NPR: ["Nepalese rupee", 2],
  NZD: ["New Zealand dollar", 2],
  OMR: ["Omani rial", 3],
  PAB: ["Panamanian balboa", 2],
  PEN: ["Peruvian sol", 2],
  PGK: ["Papua New Guinean kina", 2],
  PHP: ["Philippine peso", 2],
  PKR: ["Pakistani rupee", 2],
  PLN: ["Polish złoty", 2],
  PYG: ["Paraguayan guaraní", 0],
  QAR: ["Qatari riyal", 2],
  RON: ["Romanian leu", 2],
  RSD: ["Serbian dinar", 2],
  RUB: ["Russian ruble", 2],
  RWF: ["Rwandan franc", 0],
  SAR: ["Saudi riyal", 2],
  SBD: ["Solomon Islands dollar", 2],
  SCR: ["Seychellois rupee", 2],
  SDG: ["Sudanese pound", 2],
  SEK: ["Swedish krona", 2],
  SGD: ["Singapore dollar", 2],
  SHP: ["Saint Helena pound", 2],
  SLE: ["Sierra Leonean leone", 2],
  SOS: ["Somali shilling", 2],
  SRD: ["Surinamese dollar", 2],
  SSP: ["South Sudanese pound", 2],
  STN: ["São Tomé and Príncipe dobra", 2],
  SYP: ["Syrian pound", 2],
  SZL: ["Swazi lilangeni", 2],
  THB: ["Thai baht", 2],
  TJS: ["Tajikistani somoni", 2],
  TMT: ["Turkmenistan manat", 2],
  TND: ["Tunisian dinar", 3],
  TOP: ["Tongan paʻanga", 2],
  TRY: ["Turkish lira", 2],
  TTD: ["Trinidad and Tobago dollar", 2],
  TWD: ["New Taiwan dollar", 2],
  TZS: ["Tanzanian shilling", 2],
  UAH: ["Ukrainian hryvnia", 2],
  UGX: ["Ugandan shilling", 0],
  USD: ["US dollar", 2],
  UYU: ["Uruguayan peso", 2],
  UZS: ["Uzbekistani som", 2],
  VES: ["Venezuelan bolívar", 2],
  VND: ["Vietnamese đồng", 0],
  VUV: ["Vanuatu vatu", 0],
  WST: ["Samoan tālā", 2],
  XAF: ["Central African CFA franc", 0],
  XCD: ["East Caribbean dollar", 2],
  XCG: ["Caribbean guilder", 2],
  XOF: ["West African CFA franc", 0],
  XPF: ["CFP franc", 0],
  YER: ["Yemeni rial", 2],
  ZAR: ["South African rand", 2],
  ZMW: ["Zambian kwacha", 2],
  ZWG: ["Zimbabwe gold", 2],
} as const satisfies Record<string, readonly [string, 0 | 2 | 3]>

export type CurrencyCode = keyof typeof TABLE

export interface CurrencyInfo {
  code: CurrencyCode
  name: string
  /** Decimal places in one major unit. */
  exponent: 0 | 2 | 3
}

export const CURRENCY_CODES = Object.keys(TABLE) as CurrencyCode[]

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === "string" && Object.hasOwn(TABLE, v)
}

export function currencyInfo(code: CurrencyCode): CurrencyInfo {
  const [name, exponent] = TABLE[code]
  return { code, name, exponent }
}

/** Decimal places in one major unit of the currency (2 for NGN and USD, 0 for JPY, 3 for KWD). */
export function minorUnitExponent(code: CurrencyCode): 0 | 2 | 3 {
  return TABLE[code][1]
}

/** Minor units to major units: 1500000 NGN -> 15000, 1500 JPY -> 1500, 1500 KWD -> 1.5. */
export function toMajorUnits(minor: number, currency: CurrencyCode): number {
  return minor / 10 ** minorUnitExponent(currency)
}

/** Major units to whole minor units, rounded: 65.5 GHS -> 6550, 1500 JPY -> 1500, 1.5 KWD -> 1500. */
export function toMinorUnits(major: number, currency: CurrencyCode): number {
  return Math.round(major * 10 ** minorUnitExponent(currency))
}
