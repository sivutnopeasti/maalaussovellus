# UGC Suomi -sähköpostihaku

Lukee CSV-tiedoston, tarkistaa yrityksen julkisen Instagram-näkyvyyden ja kirjoittaa viestin vain, jos some on ohut. Viesti ohjaa lomakkeelle, jolla yritys voi hakea sisällöntuottajaa: <https://ugcsuomi.fi/ilmoita-kampanjasta-sisallontuottajille/>.

Oletuksena mitään ei lähetetä. Komento tekee `out/tulokset.csv`-tiedoston ja esikatselut.

## CSV

Tarvitaan vähintään nimi ja Y-tunnus. Verkkosivu, sähköposti ja Instagram ovat vapaaehtoisia. Erotin voi olla puolipiste tai pilkku.

```csv
nimi;y_tunnus;verkkosivu
Esimerkki Oy;1234567-8;https://esimerkki.fi
```

Jos verkkosivu puuttuu, se haetaan PRH:n avoimesta YTJ-rajapinnasta. Instagram etsitään yrityksen sivulta, ei arvata nimestä. Julkiset seuraaja- ja julkaisuluvut luetaan Instagramin julkisesta profiilista `curl`-komennolla, koska palvelu hylkää Node.js:n oman HTTP-asiakkaan. Sähköposti poimitaan saman sivuston `info@`-tyylisistä osoitteista.

## Arvio

Yritys jätetään rauhaan, jos yksikin näistä toteutuu (rajoja voi muuttaa `.env`-tiedostossa):

- vähintään 3000 seuraajaa
- julkaisujen tykkäysten mediaani vähintään 30
- kommenttien mediaani vähintään 3
- videoiden katseluiden mediaani vähintään 1000
- Metan mainoskirjastossa on aktiivinen mainos Suomessa

Muuten tili on heikko. Jos lukuja ei saada, viestiä ei tehdä. Yksityistä elinkeinonharjoittajaa ei kontaktoida.

Maksettu mainonta tarkistetaan vain, jos `META_ACCESS_TOKEN` on asetettu. Ilman sitä mainoksia ei oleteta puuttuviksi.

## Ajo

```bash
cd outreach
npm install
cp .env.example .env
node src/cli.mjs --csv ../polku/yritykset.csv --out out
```

Lähetys:

```bash
node src/cli.mjs --csv yritykset.csv --send
```

`--send` vaatii `SMTP_HOST`, `OUTREACH_FROM_NAME`, `OUTREACH_FROM_EMAIL` ja `OUTREACH_POSTAL_ADDRESS`. Viestissä on lähettäjän nimi ja postiosoite sekä ohje vastata "Ei kiitos". Estolista on `suppression.txt`. Jo lähetetyt Y-tunnukset ovat `out/lahetetyt.jsonl`.

Tarkistukset: `npm test`.
