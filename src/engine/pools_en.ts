/**
 * pools_en.ts — pseudonym pools for English documents.
 *
 * Same shape as pools.ts but with English placeholder identities. Convention:
 * names that any native speaker immediately recognizes as "fake / template"
 * (John Doe, Acme, Springfield), so the pseudonymized output reads naturally
 * but never gets confused with a real party.
 */

export const PERSON_POOL_EN: string[] = [
  'John Doe',
  'Jane Doe',
  'Richard Roe',
  'Jane Roe',
  'John Smith',
  'Mary Smith',
  'Robert Johnson',
  'Patricia Johnson',
  'James Brown',
  'Linda Brown',
  'Michael Davis',
  'Barbara Davis',
  'William Miller',
  'Elizabeth Miller',
  'David Wilson',
  'Susan Wilson',
]

export const COMPANY_POOL_EN: string[] = [
  'Acme Corp.',
  'Globex Inc.',
  'Initech LLC',
  'Hooli Ltd.',
  'Stark Industries',
  'Wayne Enterprises',
  'Umbrella Group',
  'Cyberdyne Systems',
  'Soylent Corp.',
  'Wonka Industries',
]

export const CITY_POOL_EN: string[] = [
  'Springfield',
  'Anytown',
  'Pleasantville',
  'Riverdale',
  'Lakewood',
  'Hillcrest',
  'Maplewood',
  'Brookfield',
  'Fairview',
  'Eastwood',
  'Westfield',
  'Northgate',
]

export const STREET_POOL_EN: string[] = [
  '1 Main Street',
  '22 Oak Avenue',
  '8 Elm Road',
  '15 Maple Drive',
  '44 Park Lane',
  '3 High Street',
  '67 Church Road',
  '10 Broadway',
  '5 Liberty Avenue',
  '12 Rose Garden',
  '18 King Street',
  '30 Queen Street',
]
