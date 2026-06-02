/**
 * pools_de.ts — pseudonym pools for German documents.
 *
 * Same shape as pools_en.ts — plain lists, no vocab.json (Italian-specific
 * concept). Identities are recognizably generic/fictional so the
 * pseudonymized output reads naturally but is never confused with real parties.
 *
 * Sources: German legal tradition placeholder names (comparable to the Italian
 * "Tizio/Caio"), neutral cities and Bundesland-spread, recognizable fictional
 * organizations. Pool size matches pools_en.ts for parity.
 */

export const PERSON_POOL_DE: string[] = [
  'Hans Müller',
  'Anna Schmidt',
  'Klaus Fischer',
  'Maria Weber',
  'Peter Schneider',
  'Sabine Wagner',
  'Thomas Meyer',
  'Christine Becker',
  'Michael Schulz',
  'Ursula Hoffmann',
  'Wolfgang Braun',
  'Helga Koch',
  'Jürgen Richter',
  'Ingrid Klein',
  'Dieter Wolf',
  'Monika Schäfer',
]

export const COMPANY_POOL_DE: string[] = [
  'Muster GmbH',
  'Beispiel AG',
  'Alpha KG',
  'Beta OHG',
  'Gamma GmbH & Co. KG',
  'Delta Holding',
  'Epsilon Vertriebs GmbH',
  'Zeta Industrie AG',
  'Eta Bau GmbH',
  'Theta Logistik GmbH',
]

export const CITY_POOL_DE: string[] = [
  'Musterstadt',
  'Beispieldorf',
  'Neustadt',
  'Altstadt',
  'Waldheim',
  'Bergdorf',
  'Seefeld',
  'Talheim',
  'Kirchberg',
  'Flurlingen',
  'Hochdorf',
  'Niederdorf',
]

export const STREET_POOL_DE: string[] = [
  'Musterstraße 1',
  'Hauptstraße 22',
  'Gartenweg 8',
  'Birkenallee 15',
  'Schillerstraße 44',
  'Mozartgasse 3',
  'Lindenweg 67',
  'Bahnhofstraße 10',
  'Rathausplatz 5',
  'Rosenweg 12',
  'Fichtenweg 18',
  'Eichenring 30',
]
